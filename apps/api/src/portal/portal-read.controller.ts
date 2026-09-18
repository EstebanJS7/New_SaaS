import { Controller, Get, Param, Query } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import {
  portalResourceIdParamSchema,
  type PortalAppointment,
  type PortalPetDetail,
  type PortalPetSummary,
} from "./portal-read.dto.js";
import {
  portalAvailabilityQuerySchema,
  type PortalAvailabilityResponse,
} from "./portal-availability.dto.js";
import { PortalAvailabilityService } from "./portal-availability.service.js";
import { PortalReadService } from "./portal-read.service.js";

/**
 * Holder-owned portal READ surface (EPIC-08 WU3): own pets, pet detail with an
 * allowlisted clinical summary + vaccination history, own appointments, and the
 * DEC-007 A2a union availability read.
 *
 * These routes live on the `/portal/*` surface ONLY: they carry no staff
 * `@RequirePermissions` annotation (the staff guard chain skips the surface) and
 * the PortalAuthGuard enforces the portal session + `portal` entitlement. The
 * holder's tenant and Customer are resolved server-side from the session; a
 * path or query `tenantId`/`customerId` is never read.
 *
 * Booking COMMANDS ship separately (WU4A, `PortalBookingController`); profile
 * writes, invoices/documents/notifications and the deferred clinical subdomains
 * are NOT registered at all, so a request to any of them is an
 * unauthenticated-surface 404 rather than a portal operation.
 */
@Controller("portal")
export class PortalReadController {
  constructor(
    private readonly reads: PortalReadService,
    private readonly availability: PortalAvailabilityService
  ) {}

  /**
   * Free-slot offer across every VETERINARIAN for a date (DEC-007 A2a). The
   * holder does not pick a professional, so this is a UNION, not a schedule:
   * a slot is offered when at least one in-tenant professional can take it.
   * Times only — no professional identity and no staffing count ever leaves.
   */
  @Get("availability")
  listAvailability(@Query() query: unknown): Promise<PortalAvailabilityResponse> {
    const parsed = portalAvailabilityQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid availability query.");
    }
    return this.availability.listAvailability(parsed.data);
  }

  /** Lists the authenticated holder's pets. */
  @Get("pets")
  listPets(): Promise<PortalPetSummary[]> {
    return this.reads.listPets();
  }

  /** Pet detail with the client-safe clinical summary and vaccinations. */
  @Get("pets/:id")
  getPet(@Param() params: unknown): Promise<PortalPetDetail> {
    return this.reads.getPet(parseResourceId(params));
  }

  /** Lists appointments for the authenticated holder's pets. */
  @Get("appointments")
  listAppointments(): Promise<PortalAppointment[]> {
    return this.reads.listAppointments();
  }

  /** One appointment, only when it belongs to a holder-owned pet. */
  @Get("appointments/:id")
  getAppointment(@Param() params: unknown): Promise<PortalAppointment> {
    return this.reads.getAppointment(parseResourceId(params));
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
