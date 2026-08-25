import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The graceful-shutdown spec guarantee is end-to-end only if the bootstrap
 * wires NestJS shutdown hooks; without enableShutdownHooks() the
 * onApplicationShutdown handlers never fire in the real process and unit
 * tests calling them directly stay green — a false pass. This scan fails if
 * someone removes the wiring.
 */
describe("API bootstrap shutdown wiring", () => {
  it("enables NestJS shutdown hooks so Prisma disconnects on SIGTERM/SIGINT", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain("app.enableShutdownHooks();");
    // It must be called on the app, inside bootstrap(), before listen().
    const hooksIndex = source.indexOf("app.enableShutdownHooks();");
    const listenIndex = source.indexOf("await app.listen(");
    expect(hooksIndex).toBeGreaterThan(-1);
    expect(listenIndex).toBeGreaterThan(hooksIndex);
  });
});
