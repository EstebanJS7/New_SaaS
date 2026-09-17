import { Body, Controller, Param, Post } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import {
  createPortalBookingRequestBody,
  type PortalBookingRequestResponse,
} from "./portal-booking.dto.js";
import { PortalBookingService } from "./portal-booking.service.js";
import { portalResourceIdParamSchema } from "./portal-read.dto.js";

/**
 * Holder booking-request command surface (EPIC-08 WU4A).
 *
 * Lives on the `/portal/*` surface ONLY: it carries no staff
 * `@RequirePermissions` metadata (the staff chain skips the portal surface) and
 * the PortalAuthGuard enforces the portal session + `portal` entitlement. The
 * holder's tenant and Customer are resolved server-side from the session; a
 * `tenantId`/`customerId` in the path, query or body is never read — `.strict()`
 * rejects the body outright.
 *
 * The command is intentionally narrow: it CREATES a PENDING request. Approval,
 * the Appointment it may later produce, availability and overlap evaluation are
 * staff-side and belong to a later slice.
 */
@Controller("portal")
export class PortalBookingController {
  constructor(private readonly bookings: PortalBookingService) {}

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
}
