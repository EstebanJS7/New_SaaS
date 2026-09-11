import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { EntitlementsModule } from "../entitlements/entitlements.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { PatientGuardiansController } from "./patient-guardians.controller.js";
import { PatientsCatalogService } from "./patients.catalog.service.js";
import { PatientsController } from "./patients.controller.js";
import { PatientsService } from "./patients.service.js";

/**
 * Veterinary Patients module (EPIC-05). A leaf consumer of the platform: it
 * imports Context/Audit/RBAC/Entitlements and is never imported by a Core
 * module. WU3.2 shipped the read controller, WU3.3 grew commands on the same
 * controller, and WU3.4 adds the separate guardian controller.
 */
@Module({
  imports: [ContextModule, RbacModule, AuditModule, EntitlementsModule],
  controllers: [PatientsController, PatientGuardiansController],
  providers: [PatientsService, PatientsCatalogService],
  exports: [PatientsService],
})
export class PatientsModule {}
