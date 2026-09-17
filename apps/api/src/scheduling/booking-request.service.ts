import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { TenantSettingsService } from "../settings/tenant-settings.service.js";
import {
  toAppointmentResponse,
  type AppointmentResponse,
  type AppointmentStatusDto,
} from "./appointment.dto.js";
import {
  assertAppointmentAnchors,
  assertAppointmentAvailability,
  assertNoConflictInTransaction,
  loadSchedulingSettings,
  type AppointmentAnchorPrisma,
} from "./appointment-invariants.js";
import { SCHEDULING_PERMISSIONS } from "./appointment.permissions.js";
import {
  BOOKING_REQUEST_DTO_SCHEMA_VERSION,
  toBookingRequestResponse,
  type ApproveBookingRequestInput,
  type BookingRequestRecord,
  type BookingRequestResponse,
  type BookingRequestStatusDto,
} from "./booking-request.dto.js";

/**
 * Stable `domain.event` action codes for the two staff decisions. They follow
 * the aggregate naming of `portal_booking.requested` (WU4A) and
 * `appointment.created` (EPIC-07): Prisma model -> snake_case domain, then the
 * lifecycle verb.
 */
export const PORTAL_BOOKING_APPROVED_ACTION = "portal_booking.approved";
export const PORTAL_BOOKING_REJECTED_ACTION = "portal_booking.rejected";

/** Audit target type shared with the holder-submission slice. */
export const PORTAL_BOOKING_REQUEST_TARGET_TYPE = "portal_booking_request";

/**
 * Stable, non-distinguishing NOT_FOUND message for an unknown or foreign
 * request id — the scheduling convention (`"Appointment was not found."`).
 */
export const BOOKING_REQUEST_NOT_FOUND_MESSAGE = "Booking request was not found.";

/**
 * Stable CONFLICT message for a request whose Patient is no longer linked to
 * the requesting Customer's guardian chain. A revoked link must never be
 * promoted silently.
 */
export const BOOKING_REQUEST_GUARDIAN_REVOKED_MESSAGE =
  "The patient is no longer linked to the requesting guardian.";

/** Stable CONFLICT message for a request that is not PENDING. */
export const BOOKING_REQUEST_NOT_PENDING_MESSAGE =
  "Only a pending booking request can be approved or rejected.";

// ---------------------------------------------------------------------------
// Rows, delegates and the promotion contract
// ---------------------------------------------------------------------------

/** Tenant-scoped booking-request row the boundary reads. */
export interface BookingRequestRow extends BookingRequestRecord {
  readonly tenantId: string;
  readonly customerId: string;
}

/** The appointment row created by an approval (allowlisted response source). */
export interface BookingRequestAppointmentRow {
  readonly id: string;
  readonly tenantId: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly professionalMembershipId: string;
  readonly status: AppointmentStatusDto;
  readonly version: number;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Appointment insert: provenance `PORTAL` plus the fulfilled request id. */
export interface BookingRequestAppointmentCreateData {
  readonly tenantId: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly professionalMembershipId: string;
  readonly status: AppointmentStatusDto;
  readonly version: number;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly source: "PORTAL";
  readonly portalBookingRequestId: string;
}

/**
 * Appointment read predicate: the provenance pre-check (`portalBookingRequestId`)
 * AND the overlap predicate the shared creation invariants evaluate.
 */
export interface BookingRequestAppointmentWhere {
  tenantId: string;
  portalBookingRequestId?: string;
  professionalMembershipId?: string;
  status?: AppointmentStatusDto | { in: AppointmentStatusDto[] };
  startAt?: { lt: Date };
  endAt?: { gt: Date };
  id?: string | { not: string };
}

/** Delegates shared by the root client and its transaction scope. */
export interface BookingRequestTransaction {
  portalBookingRequest: {
    findFirst: (args: {
      where: { id: string; tenantId: string };
    }) => Promise<BookingRequestRow | null>;
    /**
     * Compare-and-set on `status: PENDING` so two writers cannot both promote
     * the same request: the loser observes `{ count: 0 }` and aborts.
     */
    updateMany: (args: {
      where: { id: string; tenantId: string; status: BookingRequestStatusDto };
      data: { status: BookingRequestStatusDto };
    }) => Promise<{ count: number }>;
  };
  appointment: {
    findFirst: (args: {
      where: BookingRequestAppointmentWhere;
    }) => Promise<BookingRequestAppointmentRow | null>;
    create: (args: {
      data: BookingRequestAppointmentCreateData;
    }) => Promise<BookingRequestAppointmentRow>;
  };
  /** Guardian-chain re-validation seam (tenant-scoped). */
  patientGuardian: {
    findFirst: (args: {
      where: { tenantId: string; patientId: string; customerId: string; isActive: boolean };
      select: { patientId: true };
    }) => Promise<{ patientId: string } | null>;
  };
  /** Tenant anchors, evaluated by the SHARED creation invariants. */
  branch: AppointmentAnchorPrisma["branch"];
  patient: AppointmentAnchorPrisma["patient"];
  tenantMembership: AppointmentAnchorPrisma["tenantMembership"];
  auditLog: AuditAppendTx["auditLog"];
  /** Advisory-lock seam used by the shared conflict serialization. */
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
}

export interface BookingRequestPrisma {
  $transaction: <T>(work: (tx: BookingRequestTransaction) => Promise<T>) => Promise<T>;
  portalBookingRequest: BookingRequestTransaction["portalBookingRequest"] & {
    findMany: (args: {
      where: { tenantId: string };
      orderBy: { startAt: "asc" };
    }) => Promise<BookingRequestRow[]>;
  };
  appointment: BookingRequestTransaction["appointment"];
  branch: BookingRequestTransaction["branch"];
  patient: BookingRequestTransaction["patient"];
  tenantMembership: BookingRequestTransaction["tenantMembership"];
}

/**
 * Exact unique constraint that makes a repeated approval idempotent:
 * `@@unique([tenantId, portalBookingRequestId])` on `appointment`, which maps to
 * the PostgreSQL index `appointment_tenant_id_portal_booking_request_id_key`.
 */
const PORTAL_BOOKING_LINK_CONSTRAINT = "appointment_tenant_id_portal_booking_request_id_key";

/** The constraint's columns/fields, normalized once for shape-agnostic matching. */
const PORTAL_BOOKING_LINK_FIELDS: readonly string[] = ["tenantid", "portalbookingrequestid"];

function normalizeUniqueTargetToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * True only for the `(tenantId, portalBookingRequestId)` unique conflict. Prisma
 * reports `meta.target` as either the violated index/constraint name or the
 * violated column/field names; both shapes are recognized, everything else is
 * not this service's key and must propagate untouched.
 */
function matchesPortalBookingLinkTarget(target: unknown): boolean {
  const expectedConstraint = normalizeUniqueTargetToken(PORTAL_BOOKING_LINK_CONSTRAINT);

  if (typeof target === "string") {
    return normalizeUniqueTargetToken(target) === expectedConstraint;
  }
  if (!Array.isArray(target)) {
    return false;
  }

  const tokens = target.filter((entry): entry is string => typeof entry === "string");
  if (tokens.length === 0) {
    return false;
  }

  if (tokens.length === 1 && normalizeUniqueTargetToken(tokens[0]) === expectedConstraint) {
    return true;
  }

  const normalized = tokens.map(normalizeUniqueTargetToken);
  return (
    normalized.length === PORTAL_BOOKING_LINK_FIELDS.length &&
    PORTAL_BOOKING_LINK_FIELDS.every((field) => normalized.includes(field))
  );
}

/**
 * Prisma unique-constraint violation (`P2002`) scoped to the exact appointment
 * link key. This is the last-resort arbiter for a concurrent repeat approval:
 * two writers that both pass the sequential pre-check race to insert, the loser
 * hits the unique index, and this lets the loser recover to the winner's row
 * instead of surfacing an INTERNAL 500. Any other `P2002` is rethrown.
 */
function isPortalBookingLinkConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  return candidate.code === "P2002" && matchesPortalBookingLinkTarget(candidate.meta?.target);
}

/**
 * True when a failed approval may simply have LOST a race to a concurrent
 * approval of the same request. Under the default REJECT policy three shapes are
 * possible: the per-tenant unique on `portal_booking_request_id`, the overlap
 * check seeing the winner's just-committed appointment (the loser acquires the
 * advisory lock after the winner commits), and the compare-and-set finding the
 * request already decided. All three describe one idempotent outcome, so the
 * caller recovers to the linked appointment — but only when one actually exists,
 * so a genuine slot conflict still surfaces as `409`.
 */
function isRecoverableApprovalRace(error: unknown): boolean {
  return (
    isPortalBookingLinkConflict(error) ||
    (error instanceof DomainError && error.code === "CONFLICT")
  );
}

/** Resolved approved slot plus whether it differs from the holder's request. */
interface ApprovedSlot {
  readonly startAt: Date;
  readonly endAt: Date;
  readonly overridden: boolean;
}

/**
 * The request row keeps the times the holder asked for; the appointment carries
 * the approved slot. When staff supply an explicit override that is the slot;
 * otherwise it is the stored request's range. `overridden` is what makes the
 * override visible in the audit trail (as a boolean, never as a value).
 */
function resolveApprovedSlot(
  input: ApproveBookingRequestInput,
  request: BookingRequestRow
): ApprovedSlot {
  const startAt = input.startAt !== undefined ? new Date(input.startAt) : request.startAt;
  const endAt = input.endAt !== undefined ? new Date(input.endAt) : request.endAt;
  const overridden =
    startAt.getTime() !== request.startAt.getTime() || endAt.getTime() !== request.endAt.getTime();
  return { startAt, endAt, overridden };
}

// ---------------------------------------------------------------------------
// Application boundary
// ---------------------------------------------------------------------------

/**
 * Staff booking-request decision boundary (EPIC-08 WU4B).
 *
 * - Tenant identity comes ONLY from the staff request context; an unknown or
 *   foreign request id is the scheduling NOT_FOUND shape.
 * - Every command re-asserts `scheduling.appointment.manage` AND a staff
 *   identity as defense in depth for non-HTTP callers; a portal identity has no
 *   role context, so the permission re-assertion fails closed with FORBIDDEN.
 * - Approval runs the SAME creation invariants as `AppointmentService.create`:
 *   tenant anchors (incl. VETERINARIAN), availability/blocks, and — under the
 *   default REJECT policy — the professional advisory lock plus overlap check.
 *   Those reads, the appointment insert, the request status flip and the audit
 *   row all commit in ONE transaction.
 * - Staff may approve into a different slot (`startAt`/`endAt` override); the
 *   request keeps the holder's requested times and only the appointment moves.
 * - Approval is idempotent: the sequential pre-check returns an already-linked
 *   appointment, and the `(tenantId, portalBookingRequestId)` unique recovers
 *   the concurrent loser to that same appointment.
 * - Rejection flips a PENDING request to `REJECTED` and creates nothing.
 * - Each command appends exactly one co-committed STAFF audit row. No event is
 *   emitted and cash/stock/fiscal are untouched.
 */
@Injectable()
export class BookingRequestService {
  constructor(
    @Inject(PrismaService) private readonly prisma: BookingRequestPrisma,
    private readonly requestContext: RequestContextService,
    private readonly permissionResolver: PermissionResolver,
    private readonly audit: AuditWriter,
    private readonly settings: TenantSettingsService
  ) {}

  /** Lists the tenant's requests (including status, so pending work is visible). */
  async listBookingRequests(): Promise<BookingRequestResponse[]> {
    const tenantId = this.requestContext.requireTenantId();
    await this.requireManagePermission();

    const rows = await this.prisma.portalBookingRequest.findMany({
      where: { tenantId },
      orderBy: { startAt: "asc" },
    });
    return rows.map(toBookingRequestResponse);
  }

  /**
   * Promotes one PENDING request to exactly one appointment. A request that
   * already produced an appointment returns that appointment (idempotent); a
   * REJECTED request is a CONFLICT; a revoked guardian link is a CONFLICT.
   */
  async approveBookingRequest(
    id: string,
    input: ApproveBookingRequestInput
  ): Promise<AppointmentResponse> {
    const tenantId = this.requestContext.requireTenantId();
    await this.requireManagePermission();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const request = await this.findRequestOrThrow(tenantId, id);

    // Idempotency pre-check: the linked appointment IS the success result of a
    // repeated approval, so a retry never mints a second appointment and a
    // DIFFERENT override never rewrites the appointment already produced.
    const alreadyPromoted = await this.prisma.appointment.findFirst({
      where: { tenantId, portalBookingRequestId: id },
    });
    if (alreadyPromoted) {
      return toAppointmentResponse(alreadyPromoted);
    }

    if (request.status !== "PENDING") {
      throw new DomainError("CONFLICT", BOOKING_REQUEST_NOT_PENDING_MESSAGE);
    }

    let promoted: BookingRequestAppointmentRow;
    try {
      promoted = await this.prisma.$transaction(async (tx) => {
        // Re-read inside the transaction: the request may have been decided
        // since the pre-check, and a decided request must never be re-promoted.
        const current = await tx.portalBookingRequest.findFirst({ where: { id, tenantId } });
        if (!current) {
          throw new DomainError("NOT_FOUND", BOOKING_REQUEST_NOT_FOUND_MESSAGE);
        }
        if (current.status !== "PENDING") {
          throw new DomainError("CONFLICT", BOOKING_REQUEST_NOT_PENDING_MESSAGE);
        }

        // Guardian-chain re-validation: a link revoked after submission must not
        // be promoted silently.
        const link = await tx.patientGuardian.findFirst({
          where: {
            tenantId,
            patientId: current.patientId,
            customerId: current.customerId,
            isActive: true,
          },
          select: { patientId: true },
        });
        if (!link) {
          throw new DomainError("CONFLICT", BOOKING_REQUEST_GUARDIAN_REVOKED_MESSAGE);
        }

        const slot = resolveApprovedSlot(input, current);

        // IDENTICAL creation invariants as the staff create path: tenant
        // anchors (incl. VETERINARIAN), availability/blocks, then the
        // transaction-scoped lock + overlap check under REJECT. All of it runs
        // on the OPEN tx so an unavailable slot rolls back with the insert.
        await assertAppointmentAnchors(tx, tenantId, {
          branchId: input.branchId,
          patientId: current.patientId,
          membershipId: input.professionalMembershipId,
        });
        const settings = await loadSchedulingSettings(this.settings);
        assertAppointmentAvailability(settings, {
          membershipId: input.professionalMembershipId,
          branchId: input.branchId,
          startAt: slot.startAt,
          endAt: slot.endAt,
        });
        await assertNoConflictInTransaction(tx, settings, {
          tenantId,
          membershipId: input.professionalMembershipId,
          branchId: input.branchId,
          startAt: slot.startAt,
          endAt: slot.endAt,
        });

        const appointment = await tx.appointment.create({
          data: {
            tenantId,
            branchId: input.branchId,
            patientId: current.patientId,
            professionalMembershipId: input.professionalMembershipId,
            status: "SCHEDULED",
            version: 1,
            // The appointment carries the APPROVED slot; the request row keeps
            // the times the holder originally asked for.
            startAt: slot.startAt,
            endAt: slot.endAt,
            source: "PORTAL",
            portalBookingRequestId: id,
          },
        });

        // Compare-and-set: if another writer already decided this request the
        // row count is zero and the whole transaction (appointment included)
        // aborts.
        const { count } = await tx.portalBookingRequest.updateMany({
          where: { id, tenantId, status: "PENDING" },
          data: { status: "APPROVED" },
        });
        if (count === 0) {
          throw new DomainError("CONFLICT", BOOKING_REQUEST_NOT_PENDING_MESSAGE);
        }

        await this.appendAudit(
          tx,
          PORTAL_BOOKING_APPROVED_ACTION,
          id,
          tenantId,
          actorUserProfileId,
          {
            changedFields: slot.overridden ? ["status", "startAt", "endAt"] : ["status"],
            slotOverridden: slot.overridden,
          }
        );
        return appointment;
      });
    } catch (error) {
      // Concurrent repeat approval: the loser of the race can fail on the
      // per-tenant unique on `portal_booking_request_id`, on the overlap check
      // seeing the winner's appointment, or on the compare-and-set finding the
      // request already decided. All of them ARE the idempotent outcome when an
      // appointment is linked to this request, so recover to the winner's row.
      // With nothing linked the original error propagates unchanged, so a
      // genuine slot conflict stays a `409`.
      if (!isRecoverableApprovalRace(error)) {
        throw error;
      }
      const linked = await this.prisma.appointment.findFirst({
        where: { tenantId, portalBookingRequestId: id },
      });
      if (!linked) {
        throw error;
      }
      return toAppointmentResponse(linked);
    }

    return toAppointmentResponse(promoted);
  }

  /**
   * Rejects one PENDING request. Only PENDING may be rejected; an already
   * decided request is a CONFLICT and is never double-applied. No appointment
   * is created.
   */
  async rejectBookingRequest(id: string): Promise<BookingRequestResponse> {
    const tenantId = this.requestContext.requireTenantId();
    await this.requireManagePermission();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    await this.findRequestOrThrow(tenantId, id);

    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.portalBookingRequest.updateMany({
        where: { id, tenantId, status: "PENDING" },
        data: { status: "REJECTED" },
      });
      if (count === 0) {
        throw new DomainError("CONFLICT", BOOKING_REQUEST_NOT_PENDING_MESSAGE);
      }

      await this.appendAudit(tx, PORTAL_BOOKING_REJECTED_ACTION, id, tenantId, actorUserProfileId, {
        changedFields: ["status"],
      });

      const updated = await tx.portalBookingRequest.findFirst({ where: { id, tenantId } });
      if (!updated) {
        throw new DomainError("NOT_FOUND", BOOKING_REQUEST_NOT_FOUND_MESSAGE);
      }
      return updated;
    });

    return toBookingRequestResponse(row);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async requireManagePermission(): Promise<void> {
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(SCHEDULING_PERMISSIONS.manage)) {
      throw new DomainError("FORBIDDEN", "The required scheduling permission is missing.");
    }
  }

  private async findRequestOrThrow(tenantId: string, id: string): Promise<BookingRequestRow> {
    const row = await this.prisma.portalBookingRequest.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", BOOKING_REQUEST_NOT_FOUND_MESSAGE);
    }
    return row;
  }

  /**
   * One co-committed STAFF audit row per decision; stable ids and field NAMES
   * only. An approval that moved the slot lists `startAt`/`endAt` in
   * `changedFields` and carries the `slotOverridden` boolean — the actual
   * CONFIDENTIAL scheduling values never enter the trail.
   */
  private async appendAudit(
    tx: AuditAppendTx,
    action: string,
    targetId: string,
    tenantId: string,
    actorUserProfileId: string,
    metadata: { changedFields: string[]; slotOverridden?: boolean }
  ): Promise<void> {
    await this.audit.append(
      {
        action,
        tenantId,
        actorUserProfileId,
        targetType: PORTAL_BOOKING_REQUEST_TARGET_TYPE,
        targetId,
        metadata: {
          schemaVersion: BOOKING_REQUEST_DTO_SCHEMA_VERSION,
          changedFields: metadata.changedFields,
          ...(metadata.slotOverridden !== undefined
            ? { slotOverridden: metadata.slotOverridden }
            : {}),
        },
      },
      tx
    );
  }
}
