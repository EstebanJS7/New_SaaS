import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { TenantSettingsService } from "../settings/tenant-settings.service.js";
import {
  APPOINTMENT_DTO_SCHEMA_VERSION,
  rescheduleAppointmentInputSchema,
  type AppointmentStatusDto,
  type RescheduleAppointmentInput,
} from "../scheduling/appointment.dto.js";
import {
  RESCHEDULABLE_STATUSES,
  assertAppointmentAvailability,
  assertNoConflictInTransaction,
  compareAndSetReschedule,
  loadSchedulingSettings,
} from "../scheduling/appointment-invariants.js";
import { APPOINTMENT_TRANSITIONS, type AppointmentRow } from "../scheduling/appointment.service.js";
import {
  holderPatientIds,
  portalResourceNotFound,
  type PortalHolderScopePrisma,
} from "./portal-holder-scope.js";
import type { PortalAppointment } from "./portal-read.dto.js";

/**
 * Stable `domain.event` action code for a holder-issued reschedule. It matches
 * the staff action because the aggregate is the appointment; the PORTAL actor
 * attribution (never a staff profile) is what tells the two origins apart.
 */
export const PORTAL_APPOINTMENT_RESCHEDULED_ACTION = "appointment.rescheduled";

/** Audit target type recorded for every appointment mutation. */
export const PORTAL_APPOINTMENT_TARGET_TYPE = "appointment";

/** Prisma `where` shapes the portal appointment boundary uses. */
interface PortalAppointmentWhere {
  id?: string | { not: string };
  tenantId?: string;
  patientId?: string | { in: string[] };
  professionalMembershipId?: string;
  status?: AppointmentStatusDto | { in: AppointmentStatusDto[] };
  version?: number;
  startAt?: { lt: Date };
  endAt?: { gt: Date };
}

/** Prisma write payload; `version` may be an increment (optimistic guard). */
interface PortalAppointmentUpdateData {
  status?: AppointmentStatusDto;
  version?: number | { increment: number };
  startAt?: Date;
  endAt?: Date;
}

/**
 * Structural Prisma surface consumed by the portal appointment write boundary.
 * Declared explicitly (the pattern shared with `PortalReadService`) so the
 * service stays unit-testable and the in-memory boundary fake satisfies it
 * without the real client. `patientGuardian` comes from the shared holder-scope
 * primitive; `$queryRaw` is the advisory-lock seam the shared conflict
 * serialization uses.
 */
interface PortalAppointmentPrisma extends PortalHolderScopePrisma {
  appointment: {
    findFirst: (args: { where: PortalAppointmentWhere }) => Promise<AppointmentRow | null>;
    updateMany: (args: {
      where: PortalAppointmentWhere;
      data: PortalAppointmentUpdateData;
    }) => Promise<{ count: number }>;
  };
  auditLog: AuditAppendTx["auditLog"];
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
  $transaction: <T>(work: (tx: PortalAppointmentPrisma) => Promise<T>) => Promise<T>;
}

/** Maps a persisted row to the allowlisted holder projection; never spreads. */
function toPortalAppointment(row: AppointmentRow): PortalAppointment {
  return {
    id: row.id,
    patientId: row.patientId,
    status: row.status,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    version: row.version,
  };
}

/**
 * Holder appointment WRITE boundary (DEC-007 A2d): cancel and reschedule of the
 * holder's OWN appointment.
 *
 * OWNERSHIP IS GUARDIAN-SCOPED, and the asymmetry with the booking-request
 * command is deliberate. An appointment has no customer column — it belongs to
 * a patient — so the holder may act on it only while an ACTIVE
 * `patient_guardian` link still connects the session's Customer to that
 * patient, exactly as the portal appointment READ does it. A non-owned, foreign
 * or unknown appointment is the byte-equivalent `NOT_FOUND` the rest of the
 * holder surface returns.
 *
 * STATE AND SCHEDULING RULES ARE CALLED, NEVER RE-DERIVED: `cancel` consults the
 * shared `APPOINTMENT_TRANSITIONS` table (so an illegal state produces the same
 * `409` the staff path produces), and reschedule calls the shared availability,
 * block, advisory-lock/overlap, settings and version-plus-status compare-and-set
 * helpers. Only `SCHEDULED` and `CONFIRMED` — the scheduling-owned
 * `RESCHEDULABLE_STATUSES` — may be moved or cancelled.
 *
 * Every successful mutation appends exactly ONE co-committed PORTAL audit row
 * (`actorPortalAccessId`, never `actorUserProfileId`) carrying the schema
 * version and field NAMES only. No event is emitted and cash/stock/fiscal are
 * untouched.
 */
@Injectable()
export class PortalAppointmentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PortalAppointmentPrisma,
    private readonly requestContext: RequestContextService,
    private readonly audit: AuditWriter,
    private readonly settings: TenantSettingsService
  ) {}

  /**
   * Cancels one holder-owned appointment. Ownership is re-validated inside the
   * transaction so a revoked guardian link cannot be raced past between the
   * read and the write; the shared transition rule then decides whether the
   * state allows `cancel` and supplies both the target status and the audit
   * action. An illegal state changes nothing and returns the staff `409`.
   */
  async cancelAppointment(id: string): Promise<PortalAppointment> {
    const tenantId = this.requestContext.requireTenantId();
    const customerId = this.requestContext.requirePortalCustomerId();
    const portalAccessId = this.requestContext.requirePortalAccessId();
    const rule = APPOINTMENT_TRANSITIONS.cancel;

    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await this.findHolderAppointmentOrThrow(tx, tenantId, customerId, id);
      if (!rule.from.includes(existing.status)) {
        throw new DomainError(
          "CONFLICT",
          `Cannot cancel an appointment in status ${existing.status}.`
        );
      }

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

      await this.audit.append(
        {
          action: rule.action,
          tenantId,
          actorPortalAccessId: portalAccessId,
          targetType: PORTAL_APPOINTMENT_TARGET_TYPE,
          targetId: id,
          metadata: {
            schemaVersion: APPOINTMENT_DTO_SCHEMA_VERSION,
            changedFields: ["status", "version"],
          },
        },
        tx
      );
      return updated;
    });

    return toPortalAppointment(row);
  }

  /**
   * Reschedules one holder-owned appointment to `{ startAt, endAt }`, guarded by
   * the caller's last-read `version`.
   *
   * The pre-checks (ownership, reschedulable state, availability/blocks) run
   * before the transaction so an unavailable slot is rejected without opening a
   * write; the transaction then re-validates ownership, serializes on the
   * professional and re-runs the overlap check through the SHARED invariant, and
   * calls the SHARED version-plus-status compare-and-set the staff reschedule
   * also calls. A miss on either predicate is the staff `409` and persists
   * nothing.
   */
  async rescheduleAppointment(
    id: string,
    input: RescheduleAppointmentInput
  ): Promise<PortalAppointment> {
    const tenantId = this.requestContext.requireTenantId();
    const customerId = this.requestContext.requirePortalCustomerId();
    const portalAccessId = this.requestContext.requirePortalAccessId();

    const parsed = rescheduleAppointmentInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Reschedule input failed validation.");
    }
    const data = parsed.data;
    const startAt = new Date(data.startAt);
    const endAt = new Date(data.endAt);

    const existing = await this.findHolderAppointmentOrThrow(this.prisma, tenantId, customerId, id);
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
      // Ownership + state re-validation inside the transaction: a guardian link
      // revoked after the pre-check must not let the reschedule through.
      const current = await this.findHolderAppointmentOrThrow(tx, tenantId, customerId, id);
      if (!RESCHEDULABLE_STATUSES.includes(current.status)) {
        throw new DomainError(
          "CONFLICT",
          "Only scheduled or confirmed appointments can be rescheduled."
        );
      }

      await assertNoConflictInTransaction(tx, settings, {
        tenantId,
        membershipId: current.professionalMembershipId,
        branchId: current.branchId,
        startAt,
        endAt,
        excludeId: id,
      });

      // The version-plus-status predicate and its conflict outcome are the
      // SHARED scheduling helper — the same one the staff reschedule calls, so
      // the two predicates cannot drift. Either miss returns the staff 409.
      const updated = await compareAndSetReschedule(tx, {
        id,
        tenantId,
        status: current.status,
        version: data.version,
        startAt,
        endAt,
      });

      await this.audit.append(
        {
          action: PORTAL_APPOINTMENT_RESCHEDULED_ACTION,
          tenantId,
          actorPortalAccessId: portalAccessId,
          targetType: PORTAL_APPOINTMENT_TARGET_TYPE,
          targetId: id,
          metadata: {
            schemaVersion: APPOINTMENT_DTO_SCHEMA_VERSION,
            changedFields: ["startAt", "endAt", "version"],
          },
        },
        tx
      );
      return updated;
    });

    return toPortalAppointment(row);
  }

  /**
   * Resolves one appointment only when an ACTIVE guardian link still connects
   * the holder's Customer to its patient. This is the guardian-scoped twin of
   * the booking-request command's owner-scoped lookup: a non-owned, foreign or
   * unknown id is the SAME `NOT_FOUND`, so the outcomes are byte-equivalent.
   */
  private async findHolderAppointmentOrThrow(
    prisma: PortalAppointmentPrisma,
    tenantId: string,
    customerId: string,
    id: string
  ): Promise<AppointmentRow> {
    const patientIds = await holderPatientIds(prisma, tenantId, customerId);
    if (patientIds.length === 0) {
      throw portalResourceNotFound();
    }
    const row = await prisma.appointment.findFirst({
      where: { id, tenantId, patientId: { in: patientIds } },
    });
    if (!row) {
      throw portalResourceNotFound();
    }
    return row;
  }
}
