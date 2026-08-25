import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const appModuleSource = readFileSync(new URL("./app.module.ts", import.meta.url), "utf8");

/**
 * Bootstrap wiring cannot be exercised in-process without a reachable
 * database (AppModule boots PrismaModule), so — like main.shutdown.test.ts —
 * this scan proves the wiring exists in the real entrypoint. The runtime
 * behavior of every wired piece is proven end to end in
 * error-envelope.integration.test.ts through the SAME factories.
 */
describe("API bootstrap contract wiring", () => {
  it("builds the adapter through the shared factory (request-id + logger)", () => {
    expect(mainSource).toContain("createFastifyAdapter(");
    expect(mainSource).toContain("createApiLogger(");
    expect(mainSource).not.toContain("new FastifyAdapter()");
  });

  it("passes the pino root logger into the adapter", () => {
    expect(mainSource).toMatch(/createFastifyAdapter\(\{[\s\S]*?loggerInstance:\s*logger/);
  });

  it("feeds the CORS allowlist and HSTS posture from parsed env (transport baseline)", () => {
    expect(mainSource).toContain("corsAllowedOrigins:");
    expect(mainSource).toContain("hstsEnabled:");
  });

  it("contains no console.* calls in the bootstrap path", () => {
    expect(mainSource).not.toMatch(/\bconsole\./);
  });

  it("registers the global exception filter for the whole application", () => {
    expect(appModuleSource).toContain("CommonModule");
  });

  it("keeps shutdown hooks enabled before listen", () => {
    const hooksIndex = mainSource.indexOf("app.enableShutdownHooks();");
    const listenIndex = mainSource.indexOf("await app.listen(");
    expect(hooksIndex).toBeGreaterThan(-1);
    expect(listenIndex).toBeGreaterThan(hooksIndex);
  });
});

describe("global filter module registration", () => {
  it("wires GlobalExceptionFilter through APP_FILTER inside CommonModule", () => {
    const commonModuleSource = readFileSync(
      new URL("./common/common.module.ts", import.meta.url),
      "utf8"
    );
    expect(commonModuleSource).toContain("APP_FILTER");
    expect(commonModuleSource).toContain("GlobalExceptionFilter");
  });
});
