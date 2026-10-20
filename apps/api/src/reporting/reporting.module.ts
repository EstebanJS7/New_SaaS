import { Module } from "@nestjs/common";
import { ContextModule } from "../context/context.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { ReportingController } from "./reporting.controller.js";
import { ReportRepository } from "./reporting.repository.js";
import { ReportingService } from "./reporting.service.js";

/**
 * Reporting module (EPIC-18 REP-002). A leaf consumer of the platform: it imports
 * Context (request context — the tenant every report is scoped to), RBAC (the
 * permission re-assertion behind the route decorator) and Settings (the typed
 * `sales.defaultCurrency` read the response echoes) and is never imported by
 * another domain module. PrismaService arrives through the @Global PrismaModule,
 * as in the Catalog/Inventory/Purchases/Sales/Cash modules.
 *
 * Core domain: a report READS what other domains own and writes nothing, so this
 * module provides only its own repository and service — no cross-module
 * repository seam, no writer, no audit (reads are never audited).
 *
 * **No entitlement ([[DEC-062]]).** `EntitlementsModule` is deliberately absent:
 * PRD §9.1 fixes twelve feature codes and `reporting` is a domain, not an
 * entitlement, so reports are ungated by feature code and guarded by
 * `reports.read`/`reports.export` alone. Adding a gate here would silently
 * reverse an accepted decision.
 */
@Module({
  imports: [ContextModule, RbacModule, SettingsModule],
  controllers: [ReportingController],
  providers: [ReportRepository, ReportingService],
})
export class ReportingModule {}
