import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { TENANT_TIMEZONE } from "../scheduling/appointment-invariants.js";
import {
  PORTAL_BOOKING_DTO_SCHEMA_VERSION,
  toPortalBookingRequestResponse,
  toPortalBookingSummary,
  type PortalBookingListResponse,
  type PortalBookingRequestRecord,
  type PortalBookingRequestResponse,
  type PortalBookingRequestStatusDto,
} from "./portal-booking.dto.js";
import {
  assertHolderOwnedPatient,
  portalResourceNotFound,
  type PortalHolderScopePrisma,
} from "./portal-holder-scope.js";

/**
 * Stable domain action code for a holder-submitted booking request, in the
 * shared "domain.event" shape (id resolution mirrors `clinical_encounter.*`:
 * Prisma model -> snake_case domain, then the lifecycle verb).
 */
export const PORTAL_BOOKING_REQUESTED_ACTION = "portal_booking.requested";

/** Audit target type recorded for the created request. */
export const PORTAL_BOOKING_REQUEST_TARGET_TYPE = "portal_booking_request";

/**
 * Stable `domain.event` action code for a holder-issued cancellation, following
 * the aggregate naming of `portal_booking.requested`/`portal_booking.approved`.
 */
export const PORTAL_BOOKING_CANCELLED_ACTION = "portal_booking.cancelled";

/** Stable CONFLICT message for a request that is no longer PENDING. */
export const PORTAL_BOOKING_NOT_PENDING_MESSAGE =
  "Only a pending booking request can be cancelled.";

/** Patient row reduced to the ONLY field the holder read exposes. */
interface PortalBookingPatientRow {
  readonly id: string;
  readonly name: string;
}

/** Structural Prisma surface consumed by the portal booking boundary. */
interface PortalBookingPrisma extends PortalHolderScopePrisma {
  portalBookingRequest: {
    create: (args: {
      data: {
        tenantId: string;
        customerId: string;
        patientId: string;
        status: PortalBookingRequestStatusDto;
        startAt: Date;
        endAt: Date;
      };
    }) => Promise<PortalBookingRequestRecord>;
    /**
     * The holder read: scoped by the row's OWN `(tenantId, customerId)` — see
     * `listBookingRequests` for why the stored customer id is authoritative.
     */
    findMany: (args: {
      where: { tenantId: string; customerId: string };
      orderBy: { startAt: "asc" };
    }) => Promise<PortalBookingRequestRecord[]>;
    /** Owner-scoped single read used to tell "not owned" (404) from "not pending" (409). */
    findFirst: (args: {
      where: { id: string; tenantId: string; customerId: string };
    }) => Promise<PortalBookingRequestRecord | null>;
    /**
     * Owner-scoped compare-and-set: only a PENDING request owned by the
     * session's Customer is flipped, and the matched count lets the caller
     * abort when another writer already decided it.
     */
    updateMany: (args: {
      where: {
        id: string;
        tenantId: string;
        customerId: string;
        status: PortalBookingRequestStatusDto;
      };
      data: { status: PortalBookingRequestStatusDto };
    }) => Promise<{ count: number }>;
  };
  /** One set-based lookup resolves every involved patient name. */
  patient: {
    findMany: (args: {
      where: { tenantId: string; id: { in: string[] } };
    }) => Promise<PortalBookingPatientRow[]>;
  };
  /** Transactional audit target so the audit row co-commits with the request. */
  auditLog: AuditAppendTx["auditLog"];
  $transaction: <T>(work: (tx: PortalBookingPrisma) => Promise<T>) => Promise<T>;
}

/**
 * Holder booking-request boundary (EPIC-08): the WU4A holder COMMAND and the
 * holder-facing READ of the holder's own requests.
 *
 * Scope is deliberate for both directions of the boundary: the holder's tenant
 * and Customer come ONLY from the authenticated portal context, the pet of a
 * command must be reachable through the shared active-guardian chain (anything
 * else is the byte-equivalent NOT_FOUND), and a submission persists exactly ONE
 * `PENDING` request plus its co-committed PORTAL-attributed audit row. It
 * creates NO Appointment, evaluates NO overlap or availability and
 * auto-confirms NOTHING: staff approval is WU4B, so a request stays outside the
 * appointment ledger. The read writes NOTHING at all.
 *
 * OWNERSHIP ASYMMETRY (DEC-007 A2d) — READ THIS BEFORE "UNIFYING" THE RULES.
 * The cancel command below scopes by the request row's OWN
 * `(tenantId, customerId)`, while `PortalAppointmentService` scopes an
 * appointment through the holder's ACTIVE guardian chain. That difference is
 * intentional and load-bearing:
 *
 * - a booking request is the holder's OWN SUBMISSION, so it stays VISIBLE (and
 *   cancellable) after the guardian link to its pet is revoked; the stored
 *   customer id, not the mutable pet relationship, is the owner.
 * - an appointment belongs to a PATIENT, so it is ACTIONABLE only while the
 *   holder still has an active guardian link to that patient.
 *
 * Visibility of your own submission versus authority over a pet you no longer
 * have. Deriving request ownership from the guardian chain would silently hide
 * a holder's own requests; deriving appointment ownership from the stored
 * customer would let a former guardian keep moving a pet's schedule. Both
 * failure modes are covered by tests in this slice.
 */
@Injectable()
export class PortalBookingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PortalBookingPrisma,
    private readonly requestContext: RequestContextService,
    private readonly audit: AuditWriter
  ) {}

  /**
   * Persists one PENDING booking request for a holder-owned pet and returns the
   * created identity. Ownership and the write share one transaction with the
   * audit append, so an ownership revocation race or a failed append leaves
   * nothing persisted (audit-or-nothing).
   */
  async createBookingRequest(
    patientId: string,
    input: { readonly startAt: Date; readonly endAt: Date }
  ): Promise<PortalBookingRequestResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const customerId = this.requestContext.requirePortalCustomerId();
    const portalAccessId = this.requestContext.requirePortalAccessId();

    const row = await this.prisma.$transaction(async (tx) => {
      // Evaluated INSIDE the transaction so the ownership read and the insert
      // share one snapshot. This is deliberately not a row lock: a concurrent
      // unlink that commits in between is still possible, so staff approval
      // re-validates the guardian link before promoting the request.
      await assertHolderOwnedPatient(tx, tenantId, customerId, patientId);

      const created = await tx.portalBookingRequest.create({
        data: {
          tenantId,
          customerId,
          patientId,
          status: "PENDING",
          startAt: input.startAt,
          endAt: input.endAt,
        },
      });

      // PORTAL-attributed row: the holder is the actor and a staff actor is
      // never passed. `changedFields` mirrors `appointment.created` — stable
      // field NAMES, no CONFIDENTIAL scheduling values in the trail.
      await this.audit.append(
        {
          action: PORTAL_BOOKING_REQUESTED_ACTION,
          tenantId,
          actorPortalAccessId: portalAccessId,
          targetType: PORTAL_BOOKING_REQUEST_TARGET_TYPE,
          targetId: created.id,
          metadata: {
            schemaVersion: PORTAL_BOOKING_DTO_SCHEMA_VERSION,
            changedFields: ["patientId", "startAt", "endAt", "status"],
          },
        },
        tx
      );

      return created;
    });

    return toPortalBookingRequestResponse(row);
  }

  /**
   * Cancels one PENDING booking request that belongs to the authenticated
   * holder and returns its updated status.
   *
   * OWNERSHIP is the row's OWN `(tenantId, customerId)` — the same owner-scoping
   * as `listBookingRequests`, and for the same reason: a request is the holder's
   * own submission, so it remains cancellable after the guardian link to its pet
   * is revoked. A request owned by another Customer, another tenant or an
   * unknown id is the byte-equivalent NOT_FOUND (never a 403), because the
   * `(tenantId, customerId, status: PENDING)` compare-and-set simply matches
   * nothing; only an OWNED request in a non-PENDING state is a grounded `409`.
   *
   * The status flip and its single PORTAL-attributed audit row commit in ONE
   * transaction; a non-PENDING request or a failed append leaves the stored
   * status untouched. No appointment is created or touched.
   */
  async cancelBookingRequest(id: string): Promise<PortalBookingRequestResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const customerId = this.requestContext.requirePortalCustomerId();
    const portalAccessId = this.requestContext.requirePortalAccessId();

    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.portalBookingRequest.updateMany({
        where: { id, tenantId, customerId, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      if (count === 0) {
        // The compare-and-set matched nothing: either the request is not the
        // holder's (mask as NOT_FOUND) or it is already decided (grounded 409).
        const existing = await tx.portalBookingRequest.findFirst({
          where: { id, tenantId, customerId },
        });
        if (!existing) {
          throw portalResourceNotFound();
        }
        throw new DomainError("CONFLICT", PORTAL_BOOKING_NOT_PENDING_MESSAGE);
      }

      await this.audit.append(
        {
          action: PORTAL_BOOKING_CANCELLED_ACTION,
          tenantId,
          actorPortalAccessId: portalAccessId,
          targetType: PORTAL_BOOKING_REQUEST_TARGET_TYPE,
          targetId: id,
          metadata: {
            schemaVersion: PORTAL_BOOKING_DTO_SCHEMA_VERSION,
            changedFields: ["status"],
          },
        },
        tx
      );

      const updated = await tx.portalBookingRequest.findFirst({
        where: { id, tenantId, customerId },
      });
      if (!updated) {
        throw portalResourceNotFound();
      }
      return updated;
    });

    return toPortalBookingRequestResponse(row);
  }

  /**
   * Lists the authenticated holder's OWN booking requests, earliest start first,
   * each with its resolved patient name.
   *
   * OWNERSHIP SCOPING (the reading this slice commits to): the
   * `portal_booking_request` row STORES the Customer that submitted it and the
   * WU4A command sets that column from the authenticated portal context, so the
   * row's own `(tenantId, customerId)` IS the authoritative owner of the
   * request — not a derivation through the mutable guardian chain. The filter
   * therefore pins BOTH clauses and never accepts either from the request:
   *
   * - `tenantId` from the portal context, so another tenant's row can never
   *   contribute even if it were crafted with this holder's own customer id;
   * - `customerId` from the portal context, so another Customer in the SAME
   *   tenant is excluded even when the row points at a pet this holder guards.
   *
   * A guardian-chain derivation would be strictly weaker here: it is a mutable
   * relationship over pets, while a request is a holder's own submission, so a
   * pet transferred between customers would leak or hide requests.
   *
   * The patient names are resolved in exactly ONE set-based query for the
   * involved patients (never one per row) and that lookup is scoped to the same
   * tenant, so no foreign-tenant patient row can supply a name. The projection
   * is allowlisted; this read writes nothing.
   */
  async listBookingRequests(): Promise<PortalBookingListResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const customerId = this.requestContext.requirePortalCustomerId();

    const rows = await this.prisma.portalBookingRequest.findMany({
      where: { tenantId, customerId },
      orderBy: { startAt: "asc" },
    });

    if (rows.length === 0) {
      return { timeZone: TENANT_TIMEZONE, bookings: [] };
    }

    const patientIds = [...new Set(rows.map((row) => row.patientId))];
    const patients = await this.prisma.patient.findMany({
      where: { tenantId, id: { in: patientIds } },
    });
    const patientNames = new Map(patients.map((patient) => [patient.id, patient.name]));

    const bookings = rows.map((row) => {
      const patientName = patientNames.get(row.patientId);
      if (patientName === undefined) {
        // A request without a resolvable in-tenant patient is an integrity
        // breach, not a client error: fail loudly instead of printing an id or
        // silently dropping a status the holder is waiting for.
        throw new DomainError(
          "INTERNAL",
          "Booking request references a patient that cannot be resolved."
        );
      }
      return toPortalBookingSummary(row, patientName);
    });

    return { timeZone: TENANT_TIMEZONE, bookings };
  }
}
