import { Controller, Get } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import type { DestinationStream } from "pino";
import { z } from "zod";
import { DomainError } from "@newsaas/shared";
import { CommonModule } from "./common/common.module.js";
import { createApiLogger } from "./common/http/api-logger.factory.js";
import { createFastifyAdapter } from "./common/http/fastify-adapter.factory.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface ErrorEnvelopeBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
  };
}

@Controller("probe")
class ProbeController {
  @Get("ok")
  ok(): Record<string, boolean> {
    return { ok: true };
  }

  @Get("domain-error")
  domainError(): never {
    throw new DomainError("FORBIDDEN", "Membership suspended");
  }

  @Get("zod")
  zodFailure(): never {
    const schema = z.object({ email: z.string().email(), age: z.number() });
    const parsed = schema.safeParse({ email: "not-an-email", age: "x" });
    if (!parsed.success) {
      // Throwing the raw ZodError exercises direct duck-typed detection.
      throw parsed.error;
    }
    throw new BadRequestException();
  }

  @Get("bad-request")
  badRequest(): never {
    throw new BadRequestException({
      statusCode: 400,
      message: ["name is required", "role is invalid"],
    });
  }

  @Get("boom")
  boom(): never {
    throw new Error("SECRET-STACK-MARKER");
  }
}

describe("API contract baseline (wiring proof)", () => {
  let app: NestFastifyApplication;
  let lines: string[];
  let requestIdsSeen: string[];

  const readLines = (): Record<string, unknown>[] =>
    lines.map((line) => JSON.parse(line) as Record<string, unknown>);

  beforeAll(async () => {
    lines = [];
    const stream: DestinationStream = {
      write(message: string): void {
        lines.push(message);
      },
    };
    const logger = createApiLogger({ stream, level: "info" });

    const moduleRef = await Test.createTestingModule({
      imports: [CommonModule],
      controllers: [ProbeController],
    }).compile();

    // Built through the SAME factory as production main.ts: genReqId +
    // echo hook come from the shared seam, not from test-only setup.
    const adapter = createFastifyAdapter({ loggerInstance: logger });
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("echoes an adopted inbound request id on success and error paths", async () => {
    const ok = await supertest(app.getHttpServer())
      .get("/probe/ok")
      .set("X-Request-Id", "inbound-tracked-id")
      .expect(200);
    expect(ok.headers["x-request-id"]).toBe("inbound-tracked-id");

    const failed = await supertest(app.getHttpServer())
      .get("/probe/domain-error")
      .set("X-Request-Id", "inbound-tracked-id")
      .expect(403);
    expect(failed.headers["x-request-id"]).toBe("inbound-tracked-id");
  });

  it("generates and echoes a UUID when no inbound header exists", async () => {
    const response = await supertest(app.getHttpServer()).get("/probe/ok").expect(200);

    const echoed = response.headers["x-request-id"];
    expect(typeof echoed).toBe("string");
    expect(echoed).toMatch(UUID_PATTERN);
  });

  it("replaces a hostile oversized inbound header instead of adopting it", async () => {
    const hostile = `${"a".repeat(128)}<script>`;
    const response = await supertest(app.getHttpServer())
      .get("/probe/ok")
      .set("X-Request-Id", hostile)
      .expect(200);

    const echoed = String(response.headers["x-request-id"]);
    expect(echoed).not.toBe(hostile);
    expect(echoed).toMatch(UUID_PATTERN);
  });

  it("renders DomainError deterministically through the registry", async () => {
    const response = await supertest(app.getHttpServer())
      .get("/probe/domain-error")
      .set("X-Request-Id", "envelope-correlation")
      .expect(403);

    const body = response.body as ErrorEnvelopeBody;
    expect(body).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Membership suspended",
        requestId: "envelope-correlation",
      },
    });
  });

  it("renders validation failures as VALIDATION_FAILED with sanitized detail", async () => {
    const zodCase = await supertest(app.getHttpServer()).get("/probe/zod").expect(400);
    const zodBody = zodCase.body as ErrorEnvelopeBody;
    expect(zodBody.error.code).toBe("VALIDATION_FAILED");
    expect(zodBody.error.message).toContain("email:");
    expect(zodBody.error.requestId).toBe(zodCase.headers["x-request-id"]);
    // Sanitization: raw rejected input values are never echoed.
    expect(zodBody.error.message).not.toContain("not-an-email");

    const badRequest = await supertest(app.getHttpServer()).get("/probe/bad-request").expect(400);
    const badRequestBody = badRequest.body as ErrorEnvelopeBody;
    expect(badRequestBody.error.code).toBe("VALIDATION_FAILED");
    expect(badRequestBody.error.message).toBe("name is required; role is invalid");
  });

  it("renders unmatched routes as NOT_FOUND envelopes", async () => {
    const response = await supertest(app.getHttpServer()).get("/definitely-missing").expect(404);

    const body = response.body as ErrorEnvelopeBody;
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.requestId).toBe(response.headers["x-request-id"]);
  });

  it("suppresses unknown failure internals while keeping correlation", async () => {
    const markerBefore = lines.length;

    const response = await supertest(app.getHttpServer())
      .get("/probe/boom")
      .set("X-Request-Id", "boom-correlation")
      .expect(500);

    const body = response.body as ErrorEnvelopeBody;
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toBe("Internal server error.");
    expect(body.error.requestId).toBe("boom-correlation");

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("SECRET-STACK-MARKER");
    expect(serialized.toLowerCase()).not.toContain("stack");

    // Server-side diagnostics keep the details, bound to the request id.
    const requestLines = readLines().slice(markerBefore);
    const errorLine = requestLines.find((entry) => "failure" in entry);
    expect(errorLine).toBeDefined();
    const loggedFailure = errorLine?.failure as { type?: string };
    expect(loggedFailure?.type).toBe("Error");
  });

  it("binds the request id to EVERY structured log line the request produces", async () => {
    const markerBefore = lines.length;

    const response = await supertest(app.getHttpServer())
      .get("/probe/domain-error")
      .set("X-Request-Id", "log-binding-check")
      .set("Cookie", "ns_staff_session=session-value-must-not-leak")
      .expect(403);
    expect(response.status).toBe(403);

    const requestLines = readLines().slice(markerBefore);
    expect(requestLines.length).toBeGreaterThan(0);
    for (const entry of requestLines) {
      const bound =
        typeof entry.reqId === "string"
          ? entry.reqId
          : ((entry.req as { id?: string } | undefined)?.id ?? undefined);
      expect(bound).toBe("log-binding-check");
    }
  });

  it("never writes credential header values into log lines", async () => {
    const markerBefore = lines.length;

    await supertest(app.getHttpServer())
      .get("/probe/ok")
      .set("Cookie", "ns_staff_session=supersecretcookievalue")
      .set("Authorization", "Bearer supersecretbearervalue")
      .expect(200);

    const serialized = JSON.stringify(readLines().slice(markerBefore));
    expect(serialized).not.toContain("supersecretcookievalue");
    expect(serialized).not.toContain("supersecretbearervalue");
  });

  it("keeps request ids unique across sequential generated requests", async () => {
    requestIdsSeen = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await supertest(app.getHttpServer()).get("/probe/ok").expect(200);
      requestIdsSeen.push(String(response.headers["x-request-id"]));
    }
    expect(new Set(requestIdsSeen).size).toBe(requestIdsSeen.length);
  });
});
