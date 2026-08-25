import { Module } from "@nestjs/common";
import { PrismaModule } from "@newsaas/database";
import { AuthModule } from "./auth/auth.module.js";
import { CommonModule } from "./common/common.module.js";
import { ContextModule } from "./context/context.module.js";
import { HealthModule } from "./health/health.module.js";

@Module({
  imports: [CommonModule, ContextModule, PrismaModule, HealthModule, AuthModule],
})
export class AppModule {}
