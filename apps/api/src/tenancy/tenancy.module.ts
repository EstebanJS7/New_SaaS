import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ContextModule } from "../context/context.module.js";
import { MembershipsController } from "./membership.controller.js";
import { TenantActiveGuard } from "./tenant-active.guard.js";
import { TenantMembershipRepository } from "./tenant-membership.repository.js";

/**
 * Tenancy core (design D5 / slice S4).
 *
 * The TenantActiveGuard registers through APP_GUARD so it is GLOBAL for every
 * module composing this one. ORDER IS CONTRACT (design D3 wire order):
 * AppModule must import AuthModule BEFORE this module so the authentication
 * guard enriches the RequestContext before tenant resolution runs.
 * `tenancy.wiring.test.ts` enforces that composition order.
 */
@Module({
  imports: [ContextModule],
  controllers: [MembershipsController],
  providers: [
    TenantMembershipRepository,
    TenantActiveGuard,
    // Global for the whole app; runs after AuthGuard by module composition
    // order (see class doc and app.module.ts imports array).
    { provide: APP_GUARD, useClass: TenantActiveGuard },
  ],
})
export class TenancyModule {}
