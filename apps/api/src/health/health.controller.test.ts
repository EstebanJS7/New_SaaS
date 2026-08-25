import { Test } from "@nestjs/testing";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { PrismaModule, PrismaService } from "@newsaas/database";
import { HealthModule } from "./health.module.js";
import { RedisHealthService } from "./redis-health.service.js";

interface LiveHealthBody {
  status: string;
  service: string;
  timestamp: string;
}

interface ReadyChecks {
  database: string;
  redis: string;
}

interface ReadyHealthBody {
  status: string;
  service: string;
  timestamp: string;
  checks: ReadyChecks;
}

function fakeDatabase(behavior: "up" | "down" | "hanging"): PrismaService {
  const base =
    behavior === "up"
      ? (): Promise<Record<string, number>[]> => Promise.resolve([{ ok: 1 }])
      : behavior === "down"
        ? (): Promise<never> => Promise.reject(new Error("db connection refused"))
        : (): Promise<never> => new Promise<never>(() => undefined);
  // PrismaClient is a Proxy — fakes are attached by token, never instanceof.
  return { $queryRaw: base } as unknown as PrismaService;
}

function fakeRedis(up: boolean): RedisHealthService {
  return {
    ping: (): Promise<boolean> => Promise.resolve(up),
  } as unknown as RedisHealthService;
}

async function bootApp(
  database: PrismaService,
  redis: RedisHealthService
): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [PrismaModule, HealthModule],
  })
    .overrideProvider(PrismaService)
    .useValue(database)
    .overrideProvider(RedisHealthService)
    .useValue(redis)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe("HealthController", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await bootApp(fakeDatabase("up"), fakeRedis(true));
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health/live returns 200 healthy regardless of dependencies", async () => {
    const response = await supertest(app.getHttpServer()).get("/health/live").expect(200);

    const body = response.body as LiveHealthBody;
    expect(body).toMatchObject({
      status: "healthy",
      service: "api",
    });
    expect(typeof body.timestamp).toBe("string");
  });

  it("GET /health/ready returns 200 healthy when all dependencies are up", async () => {
    const response = await supertest(app.getHttpServer()).get("/health/ready").expect(200);

    const body = response.body as ReadyHealthBody;
    expect(body.status).toBe("healthy");
    expect(body.service).toBe("api");
    expect(body.checks).toEqual({ database: "up", redis: "up" });
    expect(typeof body.timestamp).toBe("string");
  });

  it("returns 503 degraded when only Redis is unreachable while /live stays 200", async () => {
    const degradedApp = await bootApp(fakeDatabase("up"), fakeRedis(false));
    try {
      const ready = await supertest(degradedApp.getHttpServer()).get("/health/ready").expect(503);
      expect((ready.body as ReadyHealthBody).status).toBe("degraded");
      expect((ready.body as ReadyHealthBody).checks).toEqual({
        database: "up",
        redis: "down",
      });

      const live = await supertest(degradedApp.getHttpServer()).get("/health/live").expect(200);
      expect((live.body as LiveHealthBody).status).toBe("healthy");
    } finally {
      await degradedApp.close();
    }
  });

  it("returns 503 unhealthy when the database is unreachable", async () => {
    const downApp = await bootApp(fakeDatabase("down"), fakeRedis(true));
    try {
      const ready = await supertest(downApp.getHttpServer()).get("/health/ready").expect(503);
      expect((ready.body as ReadyHealthBody).status).toBe("unhealthy");
      expect((ready.body as ReadyHealthBody).checks.database).toBe("down");
      expect((ready.body as ReadyHealthBody).checks.redis).toBe("up");
    } finally {
      await downApp.close();
    }
  });

  it("returns 503 unhealthy when every dependency is down", async () => {
    const darkApp = await bootApp(fakeDatabase("down"), fakeRedis(false));
    try {
      const ready = await supertest(darkApp.getHttpServer()).get("/health/ready").expect(503);
      expect((ready.body as ReadyHealthBody).status).toBe("unhealthy");
      expect((ready.body as ReadyHealthBody).checks).toEqual({
        database: "down",
        redis: "down",
      });
    } finally {
      await darkApp.close();
    }
  });

  it("treats a hung database probe as down after the dependency timeout", async () => {
    const hungApp = await bootApp(fakeDatabase("hanging"), fakeRedis(true));
    try {
      const ready = await supertest(hungApp.getHttpServer()).get("/health/ready").expect(503);
      expect((ready.body as ReadyHealthBody).checks.database).toBe("down");
    } finally {
      await hungApp.close();
    }
  }, 10_000);

  it("registers /health/ready alongside /health/live on the same controller", async () => {
    // Route-registration proof: both paths answer on the real HTTP server.
    await supertest(app.getHttpServer()).get("/health/live").expect(200);
    await supertest(app.getHttpServer()).get("/health/ready").expect(200);
  });
});
