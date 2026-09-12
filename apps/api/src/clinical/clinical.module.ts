import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { EntitlementsModule } from "../entitlements/entitlements.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { ClinicalEncountersController } from "./clinical.encounters.controller.js";
import { ClinicalRecordsController } from "./clinical.records.controller.js";
import { ClinicalRecordsService } from "./clinical.records.service.js";
import { ClinicalService } from "./clinical.service.js";

/**
 * Veterinary Clinical records module (EPIC-06). A leaf consumer of the
 * platform: it imports Context/RBAC/Audit/Entitlements and is never imported by
 * a Core module.
 *
 * WU2A provides the encounter core (`ClinicalService`: lifecycle, autosave
 * version guard, close, linked audited amendments, entitlement/permission
 * gates, tenant isolation). WU2B adds the specialized records
 * (`ClinicalRecordsService`: treatments, vaccinations, deworming, studies,
 * weights), both extending the shared `ClinicalServiceBase` boundary. WU3 adds
 * the HTTP controllers (`ClinicalEncountersController`,
 * `ClinicalRecordsController`), Zod inputs, DTO surface and route-contract
 * inventory on top of these services without changing them.
 */
@Module({
  imports: [ContextModule, RbacModule, AuditModule, EntitlementsModule],
  controllers: [ClinicalEncountersController, ClinicalRecordsController],
  providers: [ClinicalService, ClinicalRecordsService],
  exports: [ClinicalService, ClinicalRecordsService],
})
export class ClinicalModule {}
