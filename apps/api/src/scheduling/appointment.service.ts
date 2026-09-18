import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditAppendTx, AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { TenantSettingsService } from "../settings/tenant-settings.service.js";
import {
  APPOINTMENT_DTO_SCHEMA_VERSION,
  createAppointmentInputSchema,
  rescheduleAppointmentInputSchema,
  toAppointmentResponse,
  type AppointmentOptionsResponse,
  type AppointmentResponse,
  type AppointmentStatusDto,
  type CreateAppointmentInput,
  type RescheduleAppointmentInput,
} from "./appointment.dto.js";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  assertAppointmentAnchors,
  assertAppointmentAvailability,
  assertNoConflictInTransaction,
  assertSchedulingAnchors,
  loadSchedulingSettings,
} from "./appointment-invariants.js";
import {
  computeAvailableSlots,
  resolveAvailabilityWindow,
  toAvailabilityResponse,
  zonedDayMinuteToUtc,
  type AvailabilityQuery,
  type AvailabilityResponse,
} from "./appointment-availability.js";
import { SCHEDULING_PERMISSIONS } from "./appointment.permissions.js";

// The creation invariants (tenant anchors, availability/blocks, conflict
// serialization) and the time math now live in `appointment-invariants.ts` so
// the staff booking-request approval path runs the IDENTICAL sequence. These
// re-exports keep the historical import path stable for existing callers/tests.
export {
  TENANT_TIMEZONE,
  intersectsBlock,
  isWithinAvailability,
  toZonedParts,
} from "./appointment-invariants.js";

// ---------------------------------------------------------------------------
// Rows, delegate contracts and transition table
// ---------------------------------------------------------------------------

/** Tenant-scoped appointment row as read from Prisma. */
export interface AppointmentRow {
  id: string;
  tenantId: string;
  branchId: string;
  patientId: string;
  professionalMembershipId: string;
  status: AppointmentStatusDto;
  version: number;
  startAt: Date;
  endAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Prisma `where` shapes the boundary uses (lookups + overlap detection). */
export interface AppointmentWhere {
  id?: string | { not: string };
  tenantId: string;
  branchId?: string;
  patientId?: string;
  professionalMembershipId?: string;
  status?: AppointmentStatusDto | { in: AppointmentStatusDto[] };
  version?: number;
  /** Overlap predicate: existing.startAt < candidate.endAt. */
  startAt?: { lt: Date };
  /** Overlap predicate: existing.endAt > candidate.startAt. */
  endAt?: { gt: Date };
}

export interface AppointmentCreateData {
  tenantId: string;
  branchId: string;
  patientId: string;
  professionalMembershipId: string;
  status: AppointmentStatusDto;
  version: number;
  startAt: Date;
  endAt: Date;
}

export interface AppointmentUpdateData {
  status?: AppointmentStatusDto;
  version?: number | { increment: number };
  startAt?: Date;
  endAt?: Date;
}

export interface AppointmentDelegate {
  findMany: (args: {
    where: AppointmentWhere;
    orderBy?: { startAt?: "asc" | "desc" };
  }) => Promise<AppointmentRow[]>;
  findFirst: (args: { where: AppointmentWhere }) => Promise<AppointmentRow | null>;
  create: (args: { data: AppointmentCreateData }) => Promise<AppointmentRow>;
  updateMany: (args: {
    where: AppointmentWhere;
    data: AppointmentUpdateData;
  }) => Promise<{ count: number }>;
}

/** Read-only tenant-ownership lookup for the Branch anchor. */
export interface AppointmentBranchDelegate {
  findFirst: (args: {
    where: { id: string; tenantId: string };
    select: { id: true };
  }) => Promise<{ id: string } | null>;
  findMany: (args: {
    where: { tenantId: string };
    orderBy?: { name?: "asc" | "desc" };
  }) => Promise<{ id: string; name: string }[]>;
}

/** Read-only tenant-ownership lookup for the Patient anchor. */
export interface AppointmentPatientDelegate {
  findFirst: (args: {
    where: { id: string; tenantId: string };
    select: { id: true };
  }) => Promise<{ id: string } | null>;
}

/** Tenant-ownership + role lookup for the professional TenantMembership anchor. */
export interface AppointmentMembershipDelegate {
  findFirst: (args: {
    where: { id: string; tenantId: string };
    select: { id: true; role: { select: { code: true } } };
  }) => Promise<{ id: string; role: { code: string } } | null>;
  findMany: (args: {
    where: { tenantId: string; role: { code: string } };
    orderBy?: { id?: "asc" | "desc" };
  }) => Promise<{ id: string }[]>;
}

/** Delegates shared by the root client and its transaction scope. */
export interface AppointmentTransaction {
  appointment: AppointmentDelegate;
  auditLog: AuditAppendTx["auditLog"];
  /** Raw-SQL seam for the pg advisory lock that serializes overlap checks. */
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
}

export interface AppointmentPrisma {
  $transaction: <T>(work: (tx: AppointmentTransaction) => Promise<T>) => Promise<T>;
  branch: AppointmentBranchDelegate;
  patient: AppointmentPatientDelegate;
  tenantMembership: AppointmentMembershipDelegate;
  appointment: AppointmentDelegate;
}

/** The six named lifecycle commands; no generic status patch exists. */
export type AppointmentTransitionCommand =
  "confirm" | "arrive" | "start" | "complete" | "cancel" | "no-show";

interface AppointmentTransitionRule {
  readonly from: readonly AppointmentStatusDto[];
  readonly to: AppointmentStatusDto;
  readonly action: string;
}

/**
 * Explicit transition table (spec: Explicit lifecycle transitions). Anything not
 * listed here — including every command from a terminal state — is rejected with
 * 409 CONFLICT and leaves the stored state unchanged.
 */
export const APPOINTMENT_TRANSITIONS: Readonly<
  Record<AppointmentTransitionCommand, AppointmentTransitionRule>
> = Object.freeze({
  confirm: { from: ["SCHEDULED"], to: "CONFIRMED", action: "appointment.confirmed" },
  arrive: { from: ["CONFIRMED"], to: "ARRIVED", action: "appointment.arrived" },
  start: { from: ["ARRIVED"], to: "IN_PROGRESS", action: "appointment.started" },
  complete: { from: ["IN_PROGRESS"], to: "COMPLETED", action: "appointment.completed" },
  cancel: { from: ["SCHEDULED", "CONFIRMED"], to: "CANCELLED", action: "appointment.cancelled" },
  "no-show": { from: ["CONFIRMED", "ARRIVED"], to: "NO_SHOW", action: "appointment.no_show" },
});

/** Reschedule is allowed only before the appointment is underway (spec/design). */
const RESCHEDULABLE_STATUSES: readonly AppointmentStatusDto[] = ["SCHEDULED", "CONFIRMED"];

/** Agenda filters supported by the staff views (branch, professional, status). */
export interface AppointmentFilters {
  readonly branchId?: string;
  readonly patientId?: string;
  readonly professionalMembershipId?: string;
  readonly status?: AppointmentStatusDto;
}

interface AuditDescriptor {
  action: string;
  targetId: string;
  changedFields: string[];
}

// ---------------------------------------------------------------------------
// Appointment application boundary
// ---------------------------------------------------------------------------

/**
 * Scheduling application boundary (EPIC-07 WU2).
 *
 * - Tenant identity comes exclusively from `RequestContextService`; foreign
 *   Branch/Patient/membership UUIDs surface as byte-equivalent 404.
 * - Every operation re-applies its granular `scheduling.appointment.*` permission
 *   as defense in depth; WU3 routes declare the same keys.
 * - Availability/blocks/policy come from the typed `scheduling` settings
 *   namespace; availability and block violations always return 409, while
 *   overlap handling follows `conflictPolicy` (REJECT by default).
 * - Under REJECT, a `pg_advisory_xact_lock` wraps the overlap check and insert.
 * - Every mutation appends exactly one audit row co-committed in the same
 *   transaction, carrying stable IDs and field names only. No appointment event
 *   is emitted.
 */
@Injectable()
export class AppointmentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: AppointmentPrisma,
    private readonly requestContext: RequestContextService,
    private readonly permissionResolver: PermissionResolver,
    private readonly audit: AuditWriter,
    private readonly settings: TenantSettingsService
  ) {}

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  async listAppointments(filters: AppointmentFilters = {}): Promise<AppointmentResponse[]> {
    const tenantId = this.requestContext.requireTenantId();
    await this.requirePermission(SCHEDULING_PERMISSIONS.read);

    const where: AppointmentWhere = { tenantId };
    if (filters.branchId !== undefined) where.branchId = filters.branchId;
    if (filters.patientId !== undefined) where.patientId = filters.patientId;
    if (filters.professionalMembershipId !== undefined) {
      where.professionalMembershipId = filters.professionalMembershipId;
    }
    if (filters.status !== undefined) where.status = filters.status;

    const rows = await this.prisma.appointment.findMany({
      where,
      orderBy: { startAt: "asc" },
    });
    return rows.map(toAppointmentResponse);
  }

  async getAppointment(id: string): Promise<AppointmentResponse> {
    const tenantId = this.requestContext.requireTenantId();
    await this.requirePermission(SCHEDULING_PERMISSIONS.read);
    return toAppointmentResponse(await this.findAppointmentOrThrow(tenantId, id));
  }

  async listAppointmentOptions(): Promise<AppointmentOptionsResponse> {
    const tenantId = this.requestContext.requireTenantId();
    await this.requirePermission(SCHEDULING_PERMISSIONS.read);

    const [branches, memberships] = await Promise.all([
      this.prisma.branch.findMany({ where: { tenantId }, orderBy: { name: "asc" } }),
      this.prisma.tenantMembership.findMany({
        where: { tenantId, role: { code: "VETERINARIAN" } },
        orderBy: { id: "asc" },
      }),
    ]);

    return {
      branches: branches.map((branch) => ({ id: branch.id, name: branch.name })),
      professionals: memberships.map((membership) => ({ membershipId: membership.id })),
    };
  }

  /**
   * Read-only free-slot offer for one professional/branch/day (DEC-007 A1).
   *
   * It resolves the SAME anchors as the write path (foreign branch/membership ->
   * byte-equivalent 404; in-tenant non-VETERINARIAN -> 400), then filters a
   * local-day grid by CALLING the shared availability/block predicates against
   * the SAME `scheduling` settings and excludes overlaps against the SAME active
   * status list. Queries: 2 anchors + 1 settings read + exactly ONE overlap read
   * for the whole day (never one query per candidate). Writes nothing.
   */
  async listAvailability(input: AvailabilityQuery): Promise<AvailabilityResponse> {
    const tenantId = this.requestContext.requireTenantId();
    await this.requirePermission(SCHEDULING_PERMISSIONS.read);

    await assertSchedulingAnchors(this.prisma, tenantId, {
      branchId: input.branchId,
      membershipId: input.professionalMembershipId,
    });

    const settings = await loadSchedulingSettings(this.settings);
    const window = resolveAvailabilityWindow(
      input.date,
      input.professionalMembershipId,
      input.branchId,
      settings
    );
    if (!window.hasCandidates) {
      return toAvailabilityResponse(input, window.basis, []);
    }

    // ONE set-based overlap read for the entire day window, narrowed to the
    // tenant + professional and the shared active status list. Per-candidate
    // filtering happens in memory against this result.
    const activeAppointments = await this.prisma.appointment.findMany({
      where: {
        tenantId,
        professionalMembershipId: input.professionalMembershipId,
        status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
        startAt: { lt: zonedDayMinuteToUtc(input.date, window.dayEndMinute) },
        endAt: { gt: zonedDayMinuteToUtc(input.date, window.dayStartMinute) },
      },
    });

    const slots = computeAvailableSlots({ input, settings, window, activeAppointments });
    return toAvailabilityResponse(input, window.basis, slots);
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  async createAppointment(input: CreateAppointmentInput): Promise<AppointmentResponse> {
    const tenantId = this.requestContext.requireTenantId();
    await this.requirePermission(SCHEDULING_PERMISSIONS.manage);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const parsed = createAppointmentInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Appointment input failed validation.");
    }
    const data = parsed.data;
    const startAt = new Date(data.startAt);
    const endAt = new Date(data.endAt);

    await assertAppointmentAnchors(this.prisma, tenantId, {
      branchId: data.branchId,
      patientId: data.patientId,
      membershipId: data.professionalMembershipId,
    });

    const settings = await loadSchedulingSettings(this.settings);
    assertAppointmentAvailability(settings, {
      membershipId: data.professionalMembershipId,
      branchId: data.branchId,
      startAt,
      endAt,
    });

    const row = await this.prisma.$transaction(async (tx) => {
      await assertNoConflictInTransaction(tx, settings, {
        tenantId,
        membershipId: data.professionalMembershipId,
        branchId: data.branchId,
        startAt,
        endAt,
      });

      const created = await tx.appointment.create({
        data: {
          tenantId,
          branchId: data.branchId,
          patientId: data.patientId,
          professionalMembershipId: data.professionalMembershipId,
          status: "SCHEDULED",
          version: 1,
          startAt,
          endAt,
        },
      });

      await this.appendAudit(
        tx,
        {
          action: "appointment.created",
          targetId: created.id,
          changedFields: [
            "branchId",
            "patientId",
            "professionalMembershipId",
            "startAt",
            "endAt",
            "status",
          ],
        },
        tenantId,
        actorUserProfileId
      );
      return created;
    });

    return toAppointmentResponse(row);
  }

  async rescheduleAppointment(
    id: string,
    input: RescheduleAppointmentInput
  ): Promise<AppointmentResponse> {
    const tenantId = this.requestContext.requireTenantId();
    await this.requirePermission(SCHEDULING_PERMISSIONS.manage);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const parsed = rescheduleAppointmentInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Reschedule input failed validation.");
    }
    const data = parsed.data;
    const startAt = new Date(data.startAt);
    const endAt = new Date(data.endAt);

    const existing = await this.findAppointmentOrThrow(tenantId, id);
    if (!RESCHEDULABLE_STATUSES.includes(existing.status)) {
      throw new DomainError(
        "CONFLICT",
        "Only scheduled or confirmed appointments can be rescheduled."
      );
    }

    const settings = await loadSchedulingSettings(this.settings);
    assertAppointmentAvailability(settings, {
      membershipId: existing.professionalMembershipId,
      branchId: existing.branchId,
      startAt,
      endAt,
    });

    const row = await this.prisma.$transaction(async (tx) => {
      await assertNoConflictInTransaction(tx, settings, {
        tenantId,
        membershipId: existing.professionalMembershipId,
        branchId: existing.branchId,
        startAt,
        endAt,
        excludeId: id,
      });

      // Status predicate blocks terminal rows; the version predicate blocks a
      // stale caller. Either miss changes nothing and returns 409.
      const { count } = await tx.appointment.updateMany({
        where: { id, tenantId, status: existing.status, version: data.version },
        data: { startAt, endAt, version: { increment: 1 } },
      });
      if (count === 0) {
        throw new DomainError("CONFLICT", "The appointment was updated by another writer.");
      }

      const updated = await tx.appointment.findFirst({ where: { id, tenantId } });
      if (!updated) {
        throw new DomainError("NOT_FOUND", "Appointment was not found.");
      }

      await this.appendAudit(
        tx,
        {
          action: "appointment.rescheduled",
          targetId: id,
          changedFields: ["startAt", "endAt", "version"],
        },
        tenantId,
        actorUserProfileId
      );
      return updated;
    });

    return toAppointmentResponse(row);
  }

  async transitionAppointment(
    id: string,
    command: AppointmentTransitionCommand
  ): Promise<AppointmentResponse> {
    const tenantId = this.requestContext.requireTenantId();
    await this.requirePermission(SCHEDULING_PERMISSIONS.transition);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const rule = APPOINTMENT_TRANSITIONS[command];
    if (!rule) {
      throw new DomainError("VALIDATION_FAILED", "Unknown appointment transition command.");
    }

    const existing = await this.findAppointmentOrThrow(tenantId, id);
    if (!rule.from.includes(existing.status)) {
      throw new DomainError(
        "CONFLICT",
        `Cannot ${command} an appointment in status ${existing.status}.`
      );
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.appointment.updateMany({
        where: { id, tenantId, status: existing.status },
        data: { status: rule.to, version: { increment: 1 } },
      });
      if (count === 0) {
        throw new DomainError("CONFLICT", "The appointment was updated by another writer.");
      }

      const updated = await tx.appointment.findFirst({ where: { id, tenantId } });
      if (!updated) {
        throw new DomainError("NOT_FOUND", "Appointment was not found.");
      }

      await this.appendAudit(
        tx,
        { action: rule.action, targetId: id, changedFields: ["status", "version"] },
        tenantId,
        actorUserProfileId
      );
      return updated;
    });

    return toAppointmentResponse(row);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async requirePermission(key: string): Promise<void> {
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(key)) {
      throw new DomainError("FORBIDDEN", "The required scheduling permission is missing.");
    }
  }

  private async findAppointmentOrThrow(tenantId: string, id: string): Promise<AppointmentRow> {
    const row = await this.prisma.appointment.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", "Appointment was not found.");
    }
    return row;
  }

  /** One co-committed audit row per mutation; stable IDs and field names only. */
  private async appendAudit(
    tx: AuditAppendTx,
    descriptor: AuditDescriptor,
    tenantId: string,
    actorUserProfileId: string
  ): Promise<void> {
    await this.audit.append(
      {
        action: descriptor.action,
        tenantId,
        actorUserProfileId,
        targetType: "appointment",
        targetId: descriptor.targetId,
        metadata: {
          schemaVersion: APPOINTMENT_DTO_SCHEMA_VERSION,
          changedFields: descriptor.changedFields,
        },
      },
      tx
    );
  }
}
