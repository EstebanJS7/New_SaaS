import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditAppendTx, AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { TenantSettingsService } from "../settings/tenant-settings.service.js";
import {
  schedulingSettingsSchema,
  type SchedulingAvailabilityWindow,
  type SchedulingBlock,
  type SchedulingSettings,
} from "../settings/registry.js";
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
import { SCHEDULING_PERMISSIONS } from "./appointment.permissions.js";

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

/** Non-terminal states that participate in overlap detection. */
const ACTIVE_APPOINTMENT_STATUSES: readonly AppointmentStatusDto[] = [
  "SCHEDULED",
  "CONFIRMED",
  "ARRIVED",
  "IN_PROGRESS",
];

/** Reschedule is allowed only before the appointment is underway (spec/design). */
const RESCHEDULABLE_STATUSES: readonly AppointmentStatusDto[] = ["SCHEDULED", "CONFIRMED"];

/** The single tenant timezone fixed by the PRD for v1. */
export const TENANT_TIMEZONE = "America/Asuncion";

/** Agenda filters supported by the staff views (branch, professional, status). */
export interface AppointmentFilters {
  readonly branchId?: string;
  readonly patientId?: string;
  readonly professionalMembershipId?: string;
  readonly status?: AppointmentStatusDto;
}

// ---------------------------------------------------------------------------
// Timezone / availability math
// ---------------------------------------------------------------------------

interface ZonedParts {
  /** Days since the Unix epoch in the tenant timezone (calendar-day identity). */
  readonly daySerial: number;
  readonly weekday: number;
  readonly minuteOfDay: number;
}

const zonedFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TENANT_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Converts an absolute UTC instant to tenant-timezone wall-clock parts. Using
 * `Intl` (not a fixed offset) means the tenant offset, including any DST shift,
 * is resolved per instant instead of frozen into storage.
 */
export function toZonedParts(date: Date): ZonedParts {
  const parts = zonedFormatter.formatToParts(date);
  const read = (type: string): number =>
    Number(parts.find((entry) => entry.type === type)?.value ?? "0");
  const year = read("year");
  const month = read("month");
  const day = read("day");
  const hour = read("hour");
  const minute = read("minute");
  const startOfDayUtc = Date.UTC(year, month - 1, day);
  return {
    daySerial: Math.floor(startOfDayUtc / 86_400_000),
    weekday: new Date(startOfDayUtc).getUTCDay(),
    minuteOfDay: hour * 60 + minute,
  };
}

/**
 * True when the appointment range fits inside one availability window for the
 * (professional, branch) pair. No windows means unrestricted (design decision);
 * a range spanning more than one local calendar day never fits.
 */
export function isWithinAvailability(
  startAt: Date,
  endAt: Date,
  windows: readonly SchedulingAvailabilityWindow[],
  membershipId: string,
  branchId: string
): boolean {
  const applicable = windows.filter(
    (window) => window.membershipId === membershipId && window.branchId === branchId
  );
  if (applicable.length === 0) {
    return true;
  }

  const start = toZonedParts(startAt);
  const end = toZonedParts(endAt);

  let endMinuteOnStartDay: number;
  if (end.minuteOfDay === 0 && end.daySerial === start.daySerial + 1) {
    // A range ending exactly at local midnight belongs to the start day's 24:00.
    endMinuteOnStartDay = 1440;
  } else if (end.daySerial === start.daySerial) {
    endMinuteOnStartDay = end.minuteOfDay;
  } else {
    return false;
  }

  return applicable.some(
    (window) =>
      window.weekday === start.weekday &&
      window.startMinute <= start.minuteOfDay &&
      endMinuteOnStartDay <= window.endMinute
  );
}

/** True when the appointment range intersects an active one-off block. */
export function intersectsBlock(
  startAt: Date,
  endAt: Date,
  blocks: readonly SchedulingBlock[],
  membershipId: string,
  branchId: string
): boolean {
  return blocks.some((block) => {
    if (block.membershipId !== membershipId || block.branchId !== branchId) {
      return false;
    }
    const blockStart = Date.parse(block.startsAt);
    const blockEnd = Date.parse(block.endsAt);
    if (Number.isNaN(blockStart) || Number.isNaN(blockEnd)) {
      return false;
    }
    return startAt.getTime() < blockEnd && endAt.getTime() > blockStart;
  });
}

/**
 * Acquires a transaction-scoped advisory lock on the professional so overlap
 * detection and insert serialize: the second concurrent create blocks until the
 * first commits, then observes the committed row and returns 409 CONFLICT. The
 * lock releases automatically at commit/rollback.
 */
async function lockProfessional(
  tx: AppointmentTransaction,
  tenantId: string,
  membershipId: string
): Promise<void> {
  const key = `${tenantId}:${membershipId}`;
  // `pg_advisory_xact_lock` returns `void`; Prisma `$queryRaw` cannot
  // deserialize that column type (P2010), so cast the result to `text` — the
  // lock still blocks and the query returns one row.
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
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

    await this.assertTenantAnchors(tenantId, {
      branchId: data.branchId,
      patientId: data.patientId,
      membershipId: data.professionalMembershipId,
    });

    const settings = await this.loadSchedulingSettings();
    this.assertAvailability(settings, data.professionalMembershipId, data.branchId, startAt, endAt);

    const row = await this.prisma.$transaction(async (tx) => {
      if (settings.conflictPolicy === "REJECT") {
        await lockProfessional(tx, tenantId, data.professionalMembershipId);
        await this.assertNoOverlap(tx, tenantId, data.professionalMembershipId, startAt, endAt);
      }

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

    const settings = await this.loadSchedulingSettings();
    this.assertAvailability(
      settings,
      existing.professionalMembershipId,
      existing.branchId,
      startAt,
      endAt
    );

    const row = await this.prisma.$transaction(async (tx) => {
      if (settings.conflictPolicy === "REJECT") {
        await lockProfessional(tx, tenantId, existing.professionalMembershipId);
        await this.assertNoOverlap(
          tx,
          tenantId,
          existing.professionalMembershipId,
          startAt,
          endAt,
          id
        );
      }

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

  /**
   * Resolves the Branch, Patient and professional membership within the active
   * tenant. A foreign (or unknown) UUID is always 404; an in-tenant membership
   * without the VETERINARIAN role is a 400 rule violation.
   */
  private async assertTenantAnchors(
    tenantId: string,
    anchors: { branchId: string; patientId: string; membershipId: string }
  ): Promise<void> {
    const [branch, patient, membership] = await Promise.all([
      this.prisma.branch.findFirst({
        where: { id: anchors.branchId, tenantId },
        select: { id: true },
      }),
      this.prisma.patient.findFirst({
        where: { id: anchors.patientId, tenantId },
        select: { id: true },
      }),
      this.prisma.tenantMembership.findFirst({
        where: { id: anchors.membershipId, tenantId },
        select: { id: true, role: { select: { code: true } } },
      }),
    ]);

    if (!branch) {
      throw new DomainError("NOT_FOUND", "Branch was not found.");
    }
    if (!patient) {
      throw new DomainError("NOT_FOUND", "Patient was not found.");
    }
    if (!membership) {
      throw new DomainError("NOT_FOUND", "Professional membership was not found.");
    }
    if (membership.role.code !== "VETERINARIAN") {
      throw new DomainError(
        "VALIDATION_FAILED",
        "The assigned professional must have the VETERINARIAN role."
      );
    }
  }

  private async assertNoOverlap(
    tx: AppointmentTransaction,
    tenantId: string,
    membershipId: string,
    startAt: Date,
    endAt: Date,
    excludeId?: string
  ): Promise<void> {
    const overlap = await tx.appointment.findFirst({
      where: {
        tenantId,
        professionalMembershipId: membershipId,
        status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
        ...(excludeId !== undefined && { id: { not: excludeId } }),
      },
    });
    if (overlap) {
      throw new DomainError("CONFLICT", "The professional already has an overlapping appointment.");
    }
  }

  /** Availability and block violations are unconditional 409s (not policy-driven). */
  private assertAvailability(
    settings: SchedulingSettings,
    membershipId: string,
    branchId: string,
    startAt: Date,
    endAt: Date
  ): void {
    if (!isWithinAvailability(startAt, endAt, settings.availability, membershipId, branchId)) {
      throw new DomainError(
        "CONFLICT",
        "The appointment is outside the professional's availability for this branch."
      );
    }
    if (intersectsBlock(startAt, endAt, settings.blocks, membershipId, branchId)) {
      throw new DomainError(
        "CONFLICT",
        "The appointment falls inside a one-off block for the professional."
      );
    }
  }

  private async loadSchedulingSettings(): Promise<SchedulingSettings> {
    const raw = await this.settings.get("scheduling");
    const parsed = schedulingSettingsSchema.safeParse(raw);
    if (!parsed.success) {
      throw new DomainError("INTERNAL", "Stored scheduling settings are invalid.");
    }
    return parsed.data;
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
