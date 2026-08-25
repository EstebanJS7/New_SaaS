import { Module } from "@nestjs/common";
import { PrismaModule } from "@newsaas/database";
import { CommonModule } from "./common/common.module.js";
import { HealthModule } from "./health/health.module.js";

@Module({
  imports: [CommonModule, PrismaModule, HealthModule],
})
export class AppModule {}
