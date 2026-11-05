import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createFastifyAdapter } from "./fastify-adapter.factory.js";

/**
 * DEC-093: which address `request.ip` reports — the login and recovery rate
 * limits key on it. Without trusted proxies a forged `X-Forwarded-For` is
 * ignored; with the deployment's internal network trusted, the client address
 * Caddy and the web BFF pass on is the one the API sees.
 */
let instance: FastifyInstance | null = null;

afterEach(async () => {
  await instance?.close();
  instance = null;
});

async function ipSeen(trustedProxies: readonly string[] | undefined, forwardedFor?: string) {
  const adapter = createFastifyAdapter(trustedProxies === undefined ? {} : { trustedProxies });
  instance = adapter.getInstance() as unknown as FastifyInstance;
  instance.get("/ip", (request) => ({ ip: request.ip }));
  await instance.ready();
  const response = await instance.inject({
    method: "GET",
    url: "/ip",
    remoteAddress: "172.30.0.5",
    headers: forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor },
  });
  return (response.json() as { ip: string }).ip;
}

describe("trusted proxies (DEC-093)", () => {
  it("ignores X-Forwarded-For when no proxy is trusted", async () => {
    expect(await ipSeen(undefined, "203.0.113.10")).toBe("172.30.0.5");
  });

  it("reports the client a trusted hop forwarded", async () => {
    expect(await ipSeen(["172.30.0.0/24"], "203.0.113.10")).toBe("203.0.113.10");
  });

  it("does not let a client forge a hop in front of the trusted ones", async () => {
    // A browser-supplied value sits LEFT of what the trusted proxy appended.
    expect(await ipSeen(["172.30.0.0/24"], "6.6.6.6, 203.0.113.10")).toBe("203.0.113.10");
  });

  it("ignores the header from an untrusted peer", async () => {
    expect(await ipSeen(["10.0.0.0/8"], "203.0.113.10")).toBe("172.30.0.5");
  });
});
