import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import {
  PORTAL_BOOKING_DTO_SCHEMA_VERSION,
  toPortalBookingRequestResponse,
  type PortalBookingRequestRecord,
  type PortalBookingRequestResponse,
  type PortalBookingRequestStatusDto,
} from "./portal-booking.dto.js";
import { assertHolderOwnedPatient, type PortalHolderScopePrisma } from "./portal-holder-scope.js";

/**
 * Stable domain action code for a holder-submitted booking request, in the
 * shared "domain.event" shape (id resolution mirrors `clinical_encounter.*`:
 * Prisma model -> snake_case domain, then the lifecycle verb).
 */
export const PORTAL_BOOKING_REQUESTED_ACTION = "portal_booking.requested";

/** Audit target type recorded for the created request. */
export const PORTAL_BOOKING_REQUEST_TARGET_TYPE = "portal_booking_request";

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
  };
  /** Transactional audit target so the audit row co-commits with the request. */
  auditLog: AuditAppendTx["auditLog"];
  $transaction: <T>(work: (tx: PortalBookingPrisma) => Promise<T>) => Promise<T>;
}

/**
 * Holder booking-request command (EPIC-08 WU4A).
 *
 * Scope is deliberate: the holder's tenant and Customer come ONLY from the
 * authenticated portal context, the pet must be reachable through the shared
 * active-guardian chain (anything else is the byte-equivalent NOT_FOUND), and a
 * submission persists exactly ONE `PENDING` request plus its co-committed
 * PORTAL-attributed audit row. It creates NO Appointment, evaluates NO overlap
 * or availability and auto-confirms NOTHING: staff approval is a later slice
 * (WU4B), so the request stays outside the appointment ledger entirely.
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
}
