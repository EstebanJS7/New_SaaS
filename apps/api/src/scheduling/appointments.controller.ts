import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { z, type ZodType } from "zod";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import {
  createAppointmentInputSchema,
  rescheduleAppointmentInputSchema,
  type AppointmentOptionsResponse,
  type AppointmentResponse,
  type AppointmentStatusDto,
} from "./appointment.dto.js";
import { availabilityQuerySchema, type AvailabilityResponse } from "./appointment-availability.js";
import { SCHEDULING_PERMISSIONS } from "./appointment.permissions.js";
import { AppointmentService, type AppointmentFilters } from "./appointment.service.js";

/**
 * Staff appointment surface (EPIC-07 WU3).
 *
 * Tenant identity is never read from the request: it comes exclusively from the
 * server-side request context, so a foreign Branch/Patient/membership UUID is a
 * byte-equivalent 404. Every route declares its granular
 * `scheduling.appointment.*` permission and the service re-asserts the same key
 * as defense in depth. Inputs are Zod-validated before the service (unknown
 * keys are rejected) and responses are allowlisted CONFIDENTIAL DTOs — no
 * Prisma model crosses the boundary. There is no generic status-update route:
 * the six lifecycle commands are explicit named paths.
 */
@Controller("appointments")
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentService) {}

  /** Lists the tenant's appointments, optionally filtered. */
  @Get()
  @RequirePermissions(SCHEDULING_PERMISSIONS.read)
  async list(@Query() query: unknown): Promise<AppointmentResponse[]> {
    const filters = parseInput(appointmentFiltersQuery, query, "Invalid appointment filters.");
    return this.appointments.listAppointments(filters);
  }

  /** Creates a SCHEDULED appointment for an in-tenant VETERINARIAN membership. */
  @Post()
  @RequirePermissions(SCHEDULING_PERMISSIONS.manage)
  async create(@Body() body: unknown): Promise<AppointmentResponse> {
    const input = parseInput(
      createAppointmentInputSchema,
      body,
      "Invalid appointment create body."
    );
    return this.appointments.createAppointment(input);
  }

  /** Filter options: the tenant's branches plus assignable VETERINARIAN memberships. */
  @Get("options")
  @RequirePermissions(SCHEDULING_PERMISSIONS.read)
  async options(): Promise<AppointmentOptionsResponse> {
    return this.appointments.listAppointmentOptions();
  }

  /** Read-only free-slot offer for one professional/branch/date (DEC-007 A1). */
  @Get("availability")
  @RequirePermissions(SCHEDULING_PERMISSIONS.read)
  async availability(@Query() query: unknown): Promise<AvailabilityResponse> {
    const input = parseInput(
      availabilityQuerySchema,
      query,
      "Invalid appointment availability query."
    );
    return this.appointments.listAvailability(input);
  }

  /** Reads one appointment; a foreign UUID is indistinguishable from absent. */
  @Get(":id")
  @RequirePermissions(SCHEDULING_PERMISSIONS.read)
  async get(@Param() params: unknown): Promise<AppointmentResponse> {
    const { id } = parseInput(appointmentIdParam, params, "Invalid appointment id.");
    return this.appointments.getAppointment(id);
  }

  /** Version-guarded reschedule of a SCHEDULED/CONFIRMED appointment. */
  @Put(":id")
  @RequirePermissions(SCHEDULING_PERMISSIONS.manage)
  async reschedule(@Param() params: unknown, @Body() body: unknown): Promise<AppointmentResponse> {
    const { id } = parseInput(appointmentIdParam, params, "Invalid appointment id.");
    const input = parseInput(
      rescheduleAppointmentInputSchema,
      body,
      "Invalid appointment reschedule body."
    );
    return this.appointments.rescheduleAppointment(id, input);
  }

  /** `SCHEDULED → CONFIRMED`. */
  @Post(":id/confirm")
  @RequirePermissions(SCHEDULING_PERMISSIONS.transition)
  async confirm(@Param() params: unknown): Promise<AppointmentResponse> {
    return this.transition(params, "confirm");
  }

  /** `CONFIRMED → ARRIVED`. */
  @Post(":id/arrive")
  @RequirePermissions(SCHEDULING_PERMISSIONS.transition)
  async arrive(@Param() params: unknown): Promise<AppointmentResponse> {
    return this.transition(params, "arrive");
  }

  /** `ARRIVED → IN_PROGRESS`. */
  @Post(":id/start")
  @RequirePermissions(SCHEDULING_PERMISSIONS.transition)
  async start(@Param() params: unknown): Promise<AppointmentResponse> {
    return this.transition(params, "start");
  }

  /** `IN_PROGRESS → COMPLETED` (terminal). */
  @Post(":id/complete")
  @RequirePermissions(SCHEDULING_PERMISSIONS.transition)
  async complete(@Param() params: unknown): Promise<AppointmentResponse> {
    return this.transition(params, "complete");
  }

  /** `SCHEDULED|CONFIRMED → CANCELLED` (terminal). */
  @Post(":id/cancel")
  @RequirePermissions(SCHEDULING_PERMISSIONS.transition)
  async cancel(@Param() params: unknown): Promise<AppointmentResponse> {
    return this.transition(params, "cancel");
  }

  /** `CONFIRMED|ARRIVED → NO_SHOW` (terminal). */
  @Post(":id/no-show")
  @RequirePermissions(SCHEDULING_PERMISSIONS.transition)
  async noShow(@Param() params: unknown): Promise<AppointmentResponse> {
    return this.transition(params, "no-show");
  }

  private async transition(
    params: unknown,
    command: "confirm" | "arrive" | "start" | "complete" | "cancel" | "no-show"
  ): Promise<AppointmentResponse> {
    const { id } = parseInput(appointmentIdParam, params, "Invalid appointment id.");
    return this.appointments.transitionAppointment(id, command);
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

/** Appointment-addressed path parameter. */
const appointmentIdParam = z.object({ id: z.string().uuid() });

/** Runtime mirror of the DTO status union, pinned so the enum cannot drift. */
const APPOINTMENT_STATUSES = [
  "SCHEDULED",
  "CONFIRMED",
  "ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const satisfies readonly AppointmentStatusDto[];

/** Agenda list filters (branch, professional, status); unknown keys are rejected. */
const appointmentFiltersQuery = z
  .object({
    branchId: z.string().uuid().optional(),
    patientId: z.string().uuid().optional(),
    professionalMembershipId: z.string().uuid().optional(),
    status: z.enum(APPOINTMENT_STATUSES).optional(),
  })
  .strict()
  .transform((filters): AppointmentFilters => ({
    ...(filters.branchId !== undefined && { branchId: filters.branchId }),
    ...(filters.patientId !== undefined && { patientId: filters.patientId }),
    ...(filters.professionalMembershipId !== undefined && {
      professionalMembershipId: filters.professionalMembershipId,
    }),
    ...(filters.status !== undefined && { status: filters.status }),
  }));
