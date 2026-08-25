import { Module } from "@nestjs/common";
import { PrismaModule } from "@newsaas/database";
import { AuthModule } from "./auth/auth.module.js";
import { CommonModule } from "./common/common.module.js";
import { ContextModule } from "./context/context.module.js";
import { HealthModule } from "./health/health.module.js";
import { TenancyModule } from "./tenancy/tenancy.module.js";

// Guard-chain wire order (design D3): AuthModule's AuthGuard must register
// BEFORE TenancyModule's TenantActiveGuard — keep this import order stable.
@Module({
  imports: [CommonModule, ContextModule, PrismaModule, HealthModule, AuthModule, TenancyModule],
})
export class AppModule {}
