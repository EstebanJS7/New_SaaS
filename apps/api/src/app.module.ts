import { Module } from "@nestjs/common";
import { PrismaModule } from "@newsaas/database";
import { HealthModule } from "./health/health.module.js";

@Module({
  imports: [PrismaModule, HealthModule],
})
export class AppModule {}
