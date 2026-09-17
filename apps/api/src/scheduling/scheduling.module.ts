import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { AppointmentService } from "./appointment.service.js";
import { AppointmentsController } from "./appointments.controller.js";
import { BookingRequestService } from "./booking-request.service.js";
import { BookingRequestsController } from "./booking-requests.controller.js";

/**
 * Staff Scheduling module (EPIC-07). WU2 owns the domain service; WU3 adds the
 * HTTP surface (`AppointmentsController`); EPIC-08 WU4B adds the staff
 * booking-request decision surface (`BookingRequestsController`).
 *
 * Dependencies mirror the service boundary: request context, RBAC permission
 * resolution, transactional audit, and the typed tenant-settings namespace
 * (`TenantSettingsService` from SettingsModule). There is intentionally NO
 * entitlements import: the `scheduling` capability has no feature-code gate in
 * the twelve MVP codes — its authorized surface is the granular permission
 * catalog only.
 */
@Module({
  imports: [ContextModule, RbacModule, AuditModule, SettingsModule],
  controllers: [AppointmentsController, BookingRequestsController],
  providers: [AppointmentService, BookingRequestService],
  exports: [AppointmentService],
})
export class SchedulingModule {}
