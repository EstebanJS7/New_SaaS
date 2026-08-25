import { Controller, Get, Res } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import type { FastifyReply } from "fastify";
import { withTimeout } from "../common/utils/with-timeout.js";
import { RedisHealthService } from "./redis-health.service.js";

/** Per-dependency probe budget; keeps readiness responsive during outages. */
const DEPENDENCY_TIMEOUT_MS = 1500;

type DependencyStatus = "up" | "down";

interface LiveHealthDto {
  status: "healthy";
  service: "api";
  timestamp: string;
}

/**
 * Readiness semantics:
 * - healthy   → all dependencies up            → HTTP 200
 * - degraded  → only the cache tier is down    → HTTP 503
 * - unhealthy → a primary dependency is down   → HTTP 503
 *
 * Any non-healthy state returns 503 per the health-probe contract; the
 * distinction only aids operators reading the body.
 */
type ReadyStatus = "healthy" | "degraded" | "unhealthy";

interface ReadyHealthDto {
  status: ReadyStatus;
  service: "api";
  timestamp: string;
  checks: {
    database: DependencyStatus;
    redis: DependencyStatus;
  };
}

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisHealthService
  ) {}

  @Get("live")
  live(): LiveHealthDto {
    return {
      status: "healthy",
      service: "api",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("ready")
  async ready(@Res() reply: FastifyReply): Promise<void> {
    const [database, redis] = await Promise.all([this.pingDatabase(), this.pingRedis()]);

    const status: ReadyStatus =
      database === "up" && redis === "up"
        ? "healthy"
        : database === "down"
          ? "unhealthy"
          : "degraded";

    const payload: ReadyHealthDto = {
      status,
      service: "api",
      timestamp: new Date().toISOString(),
      checks: { database, redis },
    };

    await reply.status(status === "healthy" ? 200 : 503).send(payload);
  }

  private async pingDatabase(): Promise<DependencyStatus> {
    try {
      await withTimeout(
        async () => this.prisma.$queryRaw`SELECT 1`,
        DEPENDENCY_TIMEOUT_MS,
        "database"
      );
      return "up";
    } catch {
      return "down";
    }
  }

  private async pingRedis(): Promise<DependencyStatus> {
    const up = await this.redis.ping(DEPENDENCY_TIMEOUT_MS);
    return up ? "up" : "down";
  }
}
