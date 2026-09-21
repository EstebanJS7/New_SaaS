import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import {
  createPortalBookingRequestBody,
  type PortalBookingListResponse,
  type PortalBookingRequestResponse,
} from "./portal-booking.dto.js";
import { PortalBookingService } from "./portal-booking.service.js";
import { portalResourceIdParamSchema } from "./portal-read.dto.js";

/**
 * Holder booking-request surface (EPIC-08): the WU4A COMMAND and the
 * holder-facing READ of the holder's own requests.
 *
 * Lives on the `/portal/*` surface ONLY: it carries no staff
 * `@RequirePermissions` metadata (the staff chain skips the portal surface) and
 * the PortalAuthGuard enforces the portal session + `portal` entitlement. The
 * holder's tenant and Customer are resolved server-side from the session; a
 * `tenantId`/`customerId` in the path, query or body is never read — `.strict()`
 * rejects the body outright and the read takes no input at all.
 *
 * The command is intentionally narrow: it CREATES a PENDING request. Approval,
 * the Appointment it may later produce, availability and overlap evaluation are
 * staff-side and belong to a later slice.
 */
@Controller("portal")
export class PortalBookingController {
  constructor(private readonly bookings: PortalBookingService) {}

  /**
   * The holder's OWN booking requests, oldest start first, each with its
   * resolved patient name and lifecycle status. Query-free: tenant and Customer
   * are server-side facts, so a client identity hint is never read.
   */
  @Get("bookings")
  list(): Promise<PortalBookingListResponse> {
    return this.bookings.listBookingRequests();
  }

  /**
   * Submits a booking request for a holder-owned pet. A pet outside the
   * holder's active-guardian chain (another Customer in the same tenant, another
   * tenant, or an unknown id) is the shared byte-equivalent 404; a malformed id
   * or payload is a 400 VALIDATION_FAILED.
   */
  @Post("pets/:id/bookings")
  create(@Param() params: unknown, @Body() body: unknown): Promise<PortalBookingRequestResponse> {
    const parsedParams = portalResourceIdParamSchema.safeParse(params);
    if (!parsedParams.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid resource id.");
    }
    const parsedBody = createPortalBookingRequestBody.safeParse(body);
    if (!parsedBody.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid booking request body.");
    }
    return this.bookings.createBookingRequest(parsedParams.data.id, {
      startAt: new Date(parsedBody.data.startAt),
      endAt: new Date(parsedBody.data.endAt),
    });
  }

  /**
   * Cancels one of the holder's OWN PENDING requests (DEC-007 A2d). Ownership is
   * the row's stored `(tenantId, customerId)` — see the service for why a
   * request stays cancellable after a guardian link is revoked, unlike an
   * appointment. An already-decided request is a `409`; a request belonging to
   * another Customer is the byte-equivalent 404.
   */
  @Post("bookings/:id/cancel")
  @HttpCode(200)
  cancel(@Param() params: unknown): Promise<PortalBookingRequestResponse> {
    const parsedParams = portalResourceIdParamSchema.safeParse(params);
    if (!parsedParams.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid resource id.");
    }
    return this.bookings.cancelBookingRequest(parsedParams.data.id);
  }
}
