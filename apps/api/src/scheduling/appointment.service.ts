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
  type AppointmentServiceProjection,
  type AppointmentStatusDto,
  type CreateAppointmentInput,
  type RescheduleAppointmentInput,
} from "./appointment.dto.js";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  RESCHEDULABLE_STATUSES,
  assertAppointmentAnchors,
  assertAppointmentAvailability,
  assertAppointmentServiceAnchor,
  assertNoConflictInTransaction,
  assertSchedulingAnchors,
  compareAndSetReschedule,
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
  /** OPTIONAL Catalog SERVICE reference (EPIC-09 WU4); `null` when unset. */
  serviceId: string | null;
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
  /** Agenda filter on the OPTIONAL Catalog SERVICE reference (EPIC-09 WU4). */
  serviceId?: string;
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
  /** OPTIONAL Catalog SERVICE reference; omitted means `null`. */
  serviceId?: string | null;
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

/**
 * Read-only Catalog seam for the OPTIONAL SERVICE association (EPIC-09 WU4).
 *
 * `findFirst` is the anchor guard's tenant-scoped resolution; `findMany` is the
 * batched identity read the response projection uses (never one query per
 * appointment). Only `id`, `name`, `kind` and `isActive` are selectable — no
 * price, tax, rate or currency column is part of this contract, so scheduling
 * cannot read one.
 */
export interface AppointmentCatalogItemDelegate {
  findFirst: (args: {
    where: { id: string; tenantId: string };
    select: { id: true; kind: true; isActive: true };
  }) => Promise<{ id: string; kind: string; isActive: boolean } | null>;
  findMany: (args: {
    where: { tenantId: string; id: { in: string[] } };
    select: { id: true; name: true; kind: true };
  }) => Promise<{ id: string; name: string; kind: string }[]>;
}

export interface AppointmentPrisma {
  $transaction: <T>(work: (tx: AppointmentTransaction) => Promise<T>) => Promise<T>;
  branch: AppointmentBranchDelegate;
  patient: AppointmentPatientDelegate;
  tenantMembership: AppointmentMembershipDelegate;
  appointment: AppointmentDelegate;
  /** Read-only Catalog item lookup for the OPTIONAL SERVICE association. */
  catalogItem: AppointmentCatalogItemDelegate;
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

/** Agenda filters supported by the staff views (branch, professional, status, service). */
export interface AppointmentFilters {
  readonly branchId?: string;
  readonly patientId?: string;
  readonly professionalMembershipId?: string;
  readonly status?: AppointmentStatusDto;
  /** OPTIONAL Catalog SERVICE filter (EPIC-09 WU4); omitted adds no predicate. */
  readonly serviceId?: string;
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
    // An omitted service filter adds NO predicate, so existing query behavior is
    // unchanged; a supplied one narrows to rows carrying exactly that reference.
    if (filters.serviceId !== undefined) where.serviceId = filters.serviceId;

    const rows = await this.prisma.appointment.findMany({
      where,
      orderBy: { startAt: "asc" },
    });
    return this.mapAppointments(tenantId, rows);
  }

  async getAppointment(id: string): Promise<AppointmentResponse> {
    const tenantId = this.requestContext.requireTenantId();
    await this.requirePermission(SCHEDULING_PERMISSIONS.read);
    const row = await this.findAppointmentOrThrow(tenantId, id);
    const [response] = await this.mapAppointments(tenantId, [row]);
    if (!response) {
      throw new DomainError("INTERNAL", "Appointment response could not be produced.");
    }
    return response;
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
    // Resolve the OPTIONAL reference once: `null` means "no service attached".
    const serviceId = data.serviceId ?? null;

    await assertAppointmentAnchors(this.prisma, tenantId, {
      branchId: data.branchId,
      patientId: data.patientId,
      membershipId: data.professionalMembershipId,
    });

    // OPTIONAL Catalog SERVICE anchor: absent/null is a no-op; a present value
    // must resolve to an in-tenant ACTIVE SERVICE item (foreign/unknown -> 404,
    // in-tenant rule violation -> 400) BEFORE anything is written.
    await assertAppointmentServiceAnchor(this.prisma, tenantId, serviceId);

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
          serviceId,
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
            ...(serviceId === null ? [] : ["serviceId"]),
          ],
        },
        tenantId,
        actorUserProfileId
      );
      return created;
    });

    const [response] = await this.mapAppointments(tenantId, [row]);
    if (!response) {
      throw new DomainError("INTERNAL", "Appointment response could not be produced.");
    }
    return response;
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

    // The OPTIONAL service reference is only touched when the caller supplied
    // the key: absent leaves it untouched, `null` clears it. Either way the
    // duration stays the caller's `startAt`/`endAt`.
    if (data.serviceId !== undefined) {
      await assertAppointmentServiceAnchor(this.prisma, tenantId, data.serviceId);
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
      // stale caller. Either miss changes nothing and returns 409. The
      // predicate and the conflict outcome are the SHARED scheduling helper
      // (DEC-007 A2d), also called by the portal reschedule.
      const updated = await compareAndSetReschedule(tx, {
        id,
        tenantId,
        status: existing.status,
        version: data.version,
        startAt,
        endAt,
        ...(data.serviceId !== undefined && { serviceId: data.serviceId }),
      });

      await this.appendAudit(
        tx,
        {
          action: "appointment.rescheduled",
          targetId: id,
          changedFields: [
            "startAt",
            "endAt",
            "version",
            ...(data.serviceId !== undefined ? ["serviceId"] : []),
          ],
        },
        tenantId,
        actorUserProfileId
      );
      return updated;
    });

    const [response] = await this.mapAppointments(tenantId, [row]);
    if (!response) {
      throw new DomainError("INTERNAL", "Appointment response could not be produced.");
    }
    return response;
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

    const [response] = await this.mapAppointments(tenantId, [row]);
    if (!response) {
      throw new DomainError("INTERNAL", "Appointment response could not be produced.");
    }
    return response;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Maps appointment rows to the allowlisted DTO, resolving every linked
   * service in ONE tenant-scoped batched read (never one query per row).
   */
  private async mapAppointments(
    tenantId: string,
    rows: readonly AppointmentRow[]
  ): Promise<AppointmentResponse[]> {
    const services = await this.loadServiceProjections(tenantId, rows);
    return rows.map((row) => toAppointmentResponse(row, this.resolveService(row, services)));
  }

  /**
   * Batched identity read for the connected services. Only `id`, `name` and
   * `kind` are selected: no price, tax, rate or currency value is read from
   * Catalog at all. Deactivated items are still returned, because an existing
   * link keeps rendering its identity.
   */
  private async loadServiceProjections(
    tenantId: string,
    rows: readonly AppointmentRow[]
  ): Promise<Map<string, AppointmentServiceProjection>> {
    const ids = [
      ...new Set(rows.flatMap((row) => (row.serviceId === null ? [] : [row.serviceId]))),
    ];
    if (ids.length === 0) {
      return new Map();
    }

    const items = await this.prisma.catalogItem.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, name: true, kind: true },
    });
    return new Map(
      items.map((item) => [
        item.id,
        {
          id: item.id,
          name: item.name,
          kind: item.kind as AppointmentServiceProjection["kind"],
        },
      ])
    );
  }

  /**
   * Resolves one row's projection. The composite tenant FK plus the catalog
   * DELETE rejection guarantee the referenced item exists in this tenant, so a
   * miss is a scoping defect and fails loudly instead of silently returning a
   * `serviceId` with no `service`.
   */
  private resolveService(
    row: AppointmentRow,
    services: ReadonlyMap<string, AppointmentServiceProjection>
  ): AppointmentServiceProjection | null {
    if (row.serviceId === null) {
      return null;
    }
    const service = services.get(row.serviceId);
    if (!service) {
      throw new DomainError("INTERNAL", "The linked appointment service is unavailable.");
    }
    return service;
  }

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
