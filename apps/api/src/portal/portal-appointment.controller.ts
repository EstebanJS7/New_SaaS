import { Body, Controller, HttpCode, Param, Post, Put } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { rescheduleAppointmentInputSchema } from "../scheduling/appointment.dto.js";
import { PortalAppointmentService } from "./portal-appointment.service.js";
import { portalResourceIdParamSchema, type PortalAppointment } from "./portal-read.dto.js";

/**
 * Holder appointment WRITE surface (DEC-007 A2d): cancel and reschedule of the
 * holder's OWN appointment.
 *
 * Lives on the `/portal/*` surface ONLY: it carries no staff
 * `@RequirePermissions` metadata (the staff chain skips the portal surface) and
 * the PortalAuthGuard enforces the portal session + `portal` entitlement. The
 * holder's tenant and Customer are resolved server-side from the session; a
 * `tenantId`/`customerId` in the path, query or body is never read — the
 * reschedule body is `.strict()`, so a client identity hint is a 400.
 *
 * Ownership is GUARDIAN-SCOPED here, unlike the booking-request command: an
 * appointment belongs to a patient, so it is actionable only while the holder's
 * ACTIVE guardian link to that patient exists (see
 * `PortalAppointmentService`). A non-owned id is the shared byte-equivalent 404.
 *
 * The read half of this resource (`GET /portal/appointments/:id`) is
 * `PortalReadController`; the two controllers deliberately share the base path
 * and differ by method.
 */
@Controller("portal")
export class PortalAppointmentController {
  constructor(private readonly appointments: PortalAppointmentService) {}

  /**
   * Cancels one holder-owned appointment. `SCHEDULED`/`CONFIRMED` become
   * `CANCELLED` through the shared transition rule; any other state is the same
   * `409` the staff path returns.
   */
  @Post("appointments/:id/cancel")
  @HttpCode(200)
  cancel(@Param() params: unknown): Promise<PortalAppointment> {
    return this.appointments.cancelAppointment(parseResourceId(params));
  }

  /**
   * Reschedules one holder-owned appointment to `{ startAt, endAt }` guarded by
   * the caller's last-read `version`. Unavailable, blocked, overlapping or stale
   * inputs are `409` and persist nothing.
   */
  @Put("appointments/:id")
  reschedule(@Param() params: unknown, @Body() body: unknown): Promise<PortalAppointment> {
    const id = parseResourceId(params);
    const parsedBody = rescheduleAppointmentInputSchema.safeParse(body);
    if (!parsedBody.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid reschedule body.");
    }
    return this.appointments.rescheduleAppointment(id, parsedBody.data);
  }
}

/** Validates the shared UUID path param; malformed input is a 400. */
function parseResourceId(params: unknown): string {
  const parsed = portalResourceIdParamSchema.safeParse(params);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_FAILED", "Invalid resource id.");
  }
  return parsed.data.id;
}
