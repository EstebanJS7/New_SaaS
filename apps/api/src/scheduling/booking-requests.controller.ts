import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { z, type ZodType } from "zod";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { type AppointmentResponse } from "./appointment.dto.js";
import { SCHEDULING_PERMISSIONS } from "./appointment.permissions.js";
import { approveBookingRequestSchema, type BookingRequestResponse } from "./booking-request.dto.js";
import { BookingRequestService } from "./booking-request.service.js";

/**
 * Staff booking-request decision surface (EPIC-08 WU4B).
 *
 * Lives OFF the `/portal/*` surface, so the staff guard chain
 * (Auth < Tenancy < Rbac) applies: a portal session on these routes is rejected
 * at the boundary with 401 UNAUTHENTICATED. Every route declares
 * `scheduling.appointment.manage` and the service re-asserts the same key as
 * defense in depth. Tenant identity is never read from the request — it comes
 * exclusively from the server-side context, so a foreign request id is a
 * byte-equivalent 404 and a foreign Branch/professional anchor is a 404. Inputs
 * are Zod-validated before the service (unknown keys are rejected) and the
 * appointment response is the allowlisted scheduling DTO.
 */
@Controller("booking-requests")
export class BookingRequestsController {
  constructor(private readonly bookings: BookingRequestService) {}

  /** Lists the tenant's requests, including status so pending work is visible. */
  @Get()
  @RequirePermissions(SCHEDULING_PERMISSIONS.manage)
  async list(): Promise<BookingRequestResponse[]> {
    return this.bookings.listBookingRequests();
  }

  /** Promotes one PENDING request to exactly ONE `PORTAL` appointment. */
  @Post(":id/approve")
  @RequirePermissions(SCHEDULING_PERMISSIONS.manage)
  async approve(@Param() params: unknown, @Body() body: unknown): Promise<AppointmentResponse> {
    const { id } = parseInput(bookingRequestIdParam, params, "Invalid booking request id.");
    const input = parseInput(
      approveBookingRequestSchema,
      body,
      "Invalid booking request approval body."
    );
    return this.bookings.approveBookingRequest(id, input);
  }

  /** Rejects one PENDING request; no appointment is created. */
  @Post(":id/reject")
  @RequirePermissions(SCHEDULING_PERMISSIONS.manage)
  async reject(@Param() params: unknown): Promise<BookingRequestResponse> {
    const { id } = parseInput(bookingRequestIdParam, params, "Invalid booking request id.");
    return this.bookings.rejectBookingRequest(id);
  }
}

/** Rejects the whole request with 400 `VALIDATION_FAILED` when invalid. */
function parseInput<T>(schema: ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_FAILED", message);
  }
  return parsed.data;
}

/** Booking-request-addressed path parameter. */
const bookingRequestIdParam = z.object({ id: z.string().uuid() });
