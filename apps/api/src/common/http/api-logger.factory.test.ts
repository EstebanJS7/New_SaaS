import { describe, expect, it } from "vitest";
import { createApiLogger, LOG_REDACT_PATHS, REDACTED_PLACEHOLDER } from "./api-logger.factory.js";
import type { DestinationStream } from "pino";

function captureStream(lines: string[]): DestinationStream {
  return {
    write(message: string): void {
      lines.push(message);
    },
  };
}

function parseLines(lines: string[]): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("createApiLogger", () => {
  it("redacts credential-shaped keys at top level and one segment deep", () => {
    const lines: string[] = [];
    const logger = createApiLogger({ stream: captureStream(lines), level: "info" });

    logger.info(
      {
        password: "hunter2",
        passwordHash: "$argon2id$v=19$secret",
        token: "raw-token",
        tokenHash: "deadbeef",
        hash: "cafebabe",
        username: "ada",
      },
      "top-level credential probe"
    );
    logger.info(
      {
        user: {
          password: "hunter3",
          passwordHash: "$argon2id$v=19$secret3",
          displayName: "grace",
        },
      },
      "nested credential probe"
    );

    const entries = parseLines(lines);
    const topLevel = entries[0] as Record<string, string>;
    expect(topLevel.password).toBe(REDACTED_PLACEHOLDER);
    expect(topLevel.passwordHash).toBe(REDACTED_PLACEHOLDER);
    expect(topLevel.token).toBe(REDACTED_PLACEHOLDER);
    expect(topLevel.tokenHash).toBe(REDACTED_PLACEHOLDER);
    expect(topLevel.hash).toBe(REDACTED_PLACEHOLDER);
    expect(topLevel.username).toBe("ada");

    const nestedUser = (entries[1]?.user ?? {}) as Record<string, string>;
    expect(nestedUser.password).toBe(REDACTED_PLACEHOLDER);
    expect(nestedUser.passwordHash).toBe(REDACTED_PLACEHOLDER);
    expect(nestedUser.displayName).toBe("grace");
  });

  it("never emits cookie or authorization headers from request logs", () => {
    const lines: string[] = [];
    const logger = createApiLogger({ stream: captureStream(lines), level: "info" });

    logger.info(
      {
        req: {
          method: "POST",
          headers: {
            cookie: "ns_staff_session=super-secret-value",
            authorization: "Bearer super-secret-token",
          },
        },
      },
      "request probe"
    );

    const [entry] = parseLines(lines);
    expect(entry).toBeDefined();
    const req = entry.req as { headers?: Record<string, string> };
    expect(req.headers?.cookie).toBe(REDACTED_PLACEHOLDER);
    expect(req.headers?.authorization).toBe(REDACTED_PLACEHOLDER);
  });

  it("declares the contracted redaction paths", () => {
    expect([...LOG_REDACT_PATHS]).toEqual([
      "req.headers.cookie",
      "req.headers.authorization",
      "password",
      "passwordHash",
      "token",
      "tokenHash",
      "hash",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.tokenHash",
      "*.hash",
    ]);
  });

  it("binds the service base field onto every line", () => {
    const lines: string[] = [];
    const logger = createApiLogger({ stream: captureStream(lines), level: "info" });
    logger.info("base fields");

    const [entry] = parseLines(lines);
    expect(entry?.service).toBe("api");
  });

  it("honors an explicit level override", () => {
    const lines: string[] = [];
    const logger = createApiLogger({ stream: captureStream(lines), level: "silent" });
    logger.info("should be dropped");

    expect(lines).toHaveLength(0);
  });
});
