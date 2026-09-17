import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { ContextModule } from "../context/context.module.js";
import { EntitlementsModule } from "../entitlements/entitlements.module.js";
import { PortalAccessController } from "./portal-access.controller.js";
import { PortalAccessService } from "./portal-access.service.js";
import { PortalAuthController } from "./portal-auth.controller.js";
import { PortalAuthGuard } from "./portal-auth.guard.js";
import { PortalAuthService } from "./portal-auth.service.js";
import { PortalReadController } from "./portal-read.controller.js";
import { PortalReadService } from "./portal-read.service.js";
import { PortalSessionService } from "./portal-session.service.js";

/**
 * Isolated first-party portal boundary (EPIC-08 D2/D7/D8).
 *
 * Owns the portal session table/cookie, the PortalAuthGuard, the portal login
 * surface, and the staff portal-access provisioning commands. It reuses the
 * SAME argon2id credential boundary, auth config posture, and failure-budget
 * limiter as staff (exported by AuthModule) but never the staff session, cookie,
 * guard, or permission metadata.
 *
 * The PortalAuthGuard registers through APP_GUARD so it is global — AppModule
 * must import this module LAST so it runs after the staff chain
 * (Auth < Tenancy < Rbac < Portal). The guard itself only enforces the
 * `/portal/*` surface, and the staff guards symmetrically skip it.
 */
@Module({
  imports: [ContextModule, AuthModule, AuditModule, EntitlementsModule],
  controllers: [PortalAuthController, PortalAccessController, PortalReadController],
  providers: [
    PortalSessionService,
    PortalAuthService,
    PortalAccessService,
    PortalReadService,
    PortalAuthGuard,
    // Registered LAST in the chain; global for the whole app.
    { provide: APP_GUARD, useClass: PortalAuthGuard },
  ],
})
export class PortalModule {}
