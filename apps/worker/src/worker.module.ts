import { Module } from "@nestjs/common";
import { RedisHealthService } from "./redis/redis-health.service.js";

@Module({
  providers: [RedisHealthService],
})
export class WorkerModule {}
