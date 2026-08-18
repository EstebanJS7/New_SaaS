import { Test } from "@nestjs/testing";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { HealthModule } from "./health.module.js";

describe("HealthController", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health/live returns 200 healthy", async () => {
    interface LiveHealthBody {
      status: string;
      service: string;
      timestamp: string;
    }

    const response = await supertest(app.getHttpServer()).get("/health/live").expect(200);

    const body = response.body as LiveHealthBody;

    expect(body).toMatchObject({
      status: "healthy",
      service: "api",
    });
    expect(typeof body.timestamp).toBe("string");
  });
});
