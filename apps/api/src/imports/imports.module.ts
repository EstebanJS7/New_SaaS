import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { ImportArtefactPipe } from "./import-artefact.pipe.js";
import { ImportsController } from "./imports.controller.js";
import { ImportRepository } from "./imports.repository.js";
import { ImportsService } from "./imports.service.js";

/**
 * Imports module (EPIC-19 IMP-001). A leaf consumer of the platform: it imports
 * Context (the request context every read and write is scoped to), RBAC (the
 * permission re-assertion behind the route decorators) and Audit (the
 * append-only writer the transitions co-commit with), and is never imported by
 * another domain module. PrismaService arrives through the @Global PrismaModule,
 * and the `STORAGE_PORT` arrives through the @Global `StorageModule.forRoot()`
 * registered in the composition root, exactly as in the branding boundary — so
 * this module wires no storage driver of its own.
 *
 * Core Business domain: an import job references no other domain table (the row
 * outcomes reference a job, never a customer or a patient — [[DEC-071]]), so the
 * module provides nothing beyond its repository, its service, its pipe and its
 * single controller.
 *
 * **No entitlement ([[DEC-072]]).** `EntitlementsModule` is deliberately absent:
 * importing is a staff action over data the tenant already owns, a thirteenth
 * feature code was refused, and the `imports.*` permission family is the whole
 * guard. Adding a gate here would silently reverse an accepted decision.
 */
@Module({
  imports: [ContextModule, RbacModule, AuditModule],
  controllers: [ImportsController],
  providers: [ImportRepository, ImportsService, ImportArtefactPipe],
})
export class ImportsModule {}
