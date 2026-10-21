import { Module } from "@nestjs/common";
import { IMPORT_PREVIEW_PRODUCER } from "@newsaas/imports";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { createImportPreviewProducer } from "./import-preview.producer.js";
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
 *
 * **The preview producer ([[IMP-002]]).** The preview is asynchronous by decision,
 * so the trigger enqueues and the worker consumes — and the transport is the
 * PACKAGE's, because one queue is produced by one deployable and consumed by
 * another and both must name the same queue, job and job identity. This module is
 * only the composition root: it decides which producer the environment gets
 * (`import-preview.producer.ts`), and exports the token so a future command with
 * the same need reuses one connection instead of opening its own.
 */
@Module({
  imports: [ContextModule, RbacModule, AuditModule],
  controllers: [ImportsController],
  providers: [
    ImportRepository,
    ImportsService,
    ImportArtefactPipe,
    {
      provide: IMPORT_PREVIEW_PRODUCER,
      // Read at construction, so the connection is created once per process and
      // never per enqueue.
      useFactory: () => createImportPreviewProducer(process.env),
    },
  ],
  exports: [IMPORT_PREVIEW_PRODUCER],
})
export class ImportsModule {}
