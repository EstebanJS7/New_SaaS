import { Controller, Get } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { describe, expect, it } from "vitest";
import supertest from "supertest";
import type { DestinationStream } from "pino";
import { CommonModule } from "../../common/common.module.js";
import { createApiLogger } from "./api-logger.factory.js";
import {
  createFastifyAdapter,
  type CreateFastifyAdapterOptions,
} from "./fastify-adapter.factory.js";

/**
 * Public probe: reaching ANY route proves headers/hooks ran for normal
 * requests; the health-shaped path keeps the suite free of auth concerns.
 */
@Controller("probe")
class ProbeController {
  @Get("public")
  publicRoute(): Record<string, string> {
    return { ok: "yes" };
  }
}

interface ErrorEnvelopeBody {
  readonly error: { readonly code: string; readonly message: string; readonly requestId: string };
}

async function bootWith(
  adapterOptions: CreateFastifyAdapterOptions
): Promise<NestFastifyApplication> {
  const stream: DestinationStream = {
    write(message: string): void {
      void message;
    },
  };
  const logger = createApiLogger({ stream, level: "info" });

  const moduleRef = await Test.createTestingModule({
    imports: [CommonModule],
    controllers: [ProbeController],
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter({
      ...adapterOptions,
      loggerInstance: adapterOptions.loggerInstance ?? logger,
    })
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe("transport security baseline (real adapter factory)", () => {
  // Each case boots a real Nest app over the adapter factory; under full-suite
  // parallel contention first-boot compile can exceed the 5s default.
  it(
    "sets nosniff, frame-deny and referrer-policy on every response — including errors",
    { timeout: 30_000 },
    async () => {
      const app = await bootWith({});
      try {
        const ok = await supertest(app.getHttpServer()).get("/probe/public").expect(200);
        expect(ok.headers["x-content-type-options"]).toBe("nosniff");
        expect(ok.headers["x-frame-options"]).toBe("DENY");
        expect(ok.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");

        // Errors take the same hook: a 404 envelope still carries the baseline.
        const missing = await supertest(app.getHttpServer()).get("/nowhere").expect(404);
        expect(missing.headers["x-content-type-options"]).toBe("nosniff");
        expect(missing.headers["x-frame-options"]).toBe("DENY");
        expect((missing.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");
      } finally {
        await app.close();
      }
    }
  );

  it(
    "omits HSTS unless explicitly enabled, then emits it with includeSubDomains",
    { timeout: 30_000 },
    async () => {
      const plainApp = await bootWith({});
      try {
        const plain = await supertest(plainApp.getHttpServer()).get("/probe/public").expect(200);
        expect(plain.headers["strict-transport-security"]).toBeUndefined();
      } finally {
        await plainApp.close();
      }

      const hstsApp = await bootWith({ hstsEnabled: true });
      try {
        const secure = await supertest(hstsApp.getHttpServer()).get("/probe/public").expect(200);
        expect(secure.headers["strict-transport-security"]).toBe(
          "max-age=31536000; includeSubDomains"
        );
      } finally {
        await hstsApp.close();
      }
    }
  );

  it("CORS is deny-by-default: any cross-origin request without an allowlist is rejected", async () => {
    const app = await bootWith({});
    try {
      const rejected = await supertest(app.getHttpServer())
        .get("/probe/public")
        .set("Origin", "https://evil.example")
        .expect(403);

      const body = rejected.body as ErrorEnvelopeBody;
      expect(body.error.code).toBe("FORBIDDEN");
      // No ACAO header ever leaves the server for denied origins.
      expect(rejected.headers["access-control-allow-origin"]).toBeUndefined();
      // The envelope keeps the correlation contract.
      expect(body.error.requestId).toEqual(expect.any(String));
      expect(rejected.headers["x-request-id"]).toBe(body.error.requestId);
    } finally {
      await app.close();
    }
  });

  it("same-origin requests (no Origin header) pass untouched with no ACAO", async () => {
    const app = await bootWith({});
    try {
      const sameOrigin = await supertest(app.getHttpServer()).get("/probe/public").expect(200);
      expect(sameOrigin.headers["access-control-allow-origin"]).toBeUndefined();
      expect(sameOrigin.body).toEqual({ ok: "yes" });
    } finally {
      await app.close();
    }
  });

  it("allowlisted origins are echoed exactly; others stay blocked; preflight answers OPTIONS", async () => {
    const allowed = "https://app.newsaas.test";
    const app = await bootWith({ corsAllowedOrigins: [allowed] });
    try {
      const allowedRequest = await supertest(app.getHttpServer())
        .get("/probe/public")
        .set("Origin", allowed)
        .expect(200);
      expect(allowedRequest.headers["access-control-allow-origin"]).toBe(allowed);
      // Vary prevents shared caches from mixing CORS verdicts across origins.
      expect(allowedRequest.headers.vary).toContain("Origin");

      const blocked = await supertest(app.getHttpServer())
        .get("/probe/public")
        .set("Origin", "https://near-miss.newsaas.test.example")
        .expect(403);
      expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();

      const preflight = await supertest(app.getHttpServer())
        .options("/probe/public")
        .set("Origin", allowed)
        .set("Access-Control-Request-Method", "POST")
        .expect(204);
      expect(preflight.headers["access-control-allow-origin"]).toBe(allowed);
      expect(preflight.headers["access-control-allow-methods"]).toContain("POST");

      // Preflight for a NON-allowlisted origin is also refused outright.
      await supertest(app.getHttpServer())
        .options("/probe/public")
        .set("Origin", "https://evil.example")
        .set("Access-Control-Request-Method", "POST")
        .expect(403);
    } finally {
      await app.close();
    }
  });
});
