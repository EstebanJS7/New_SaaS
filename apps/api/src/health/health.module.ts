import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { RedisHealthService } from "./redis-health.service.js";

/**
 * PrismaService is injected from the global PrismaModule; RedisHealthService
 * is health-scoped and provided here.
 */
@Module({
  controllers: [HealthController],
  providers: [RedisHealthService],
})
export class HealthModule {}
