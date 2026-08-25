import { Module } from "@nestjs/common";
import { ContextModule } from "../context/context.module.js";
import { AuditWriter } from "./audit-writer.service.js";

/**
 * Audit scaffolding (design D9 / slice S6).
 *
 * Exposes the append-only {@link AuditWriter} as a platform capability. No
 * controller exists: audit rows have no read API in this epic (direct DB
 * inspection only), and no mutation surface will ever exist on this boundary.
 */
@Module({
  imports: [ContextModule],
  providers: [AuditWriter],
  exports: [AuditWriter],
})
export class AuditModule {}
