import { describe, expect, it, vi } from "vitest";
import { loadCapabilities, parseCapabilitiesBody } from "./load-capabilities";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("parseCapabilitiesBody (UX-037)", () => {
  it("accepts two string lists", () => {
    expect(
      parseCapabilitiesBody({ permissions: ["sales.sale.create"], features: ["veterinary"] })
    ).toEqual({ permissions: ["sales.sale.create"], features: ["veterinary"] });
  });

  it("accepts two empty lists as KNOWN and empty", () => {
    expect(parseCapabilitiesBody({ permissions: [], features: [] })).toEqual({
      permissions: [],
      features: [],
    });
  });

  it.each([
    ["null", null],
    ["a string", "permissions"],
    ["a missing features list", { permissions: [] }],
    ["a missing permissions list", { features: [] }],
    ["a non-string permission", { permissions: [1], features: [] }],
    ["a non-array feature list", { permissions: [], features: "veterinary" }],
  ])("treats %s as unknown", (_label, body) => {
    expect(parseCapabilitiesBody(body)).toEqual({});
  });
});

describe("loadCapabilities (UX-037)", () => {
  const options = { apiUrl: "http://api.test", cookie: "sid=abc" };

  it("forwards the session cookie to the caller's own capabilities route", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ permissions: ["a.b"], features: ["c"] }));

    await expect(loadCapabilities({ ...options, fetchImpl })).resolves.toEqual({
      permissions: ["a.b"],
      features: ["c"],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("http://api.test/memberships/me/capabilities");
    expect(new Headers(init?.headers).get("cookie")).toBe("sid=abc");
    expect(init?.cache).toBe("no-store");
  });

  it.each([401, 403, 404, 500, 503])(
    "treats a %s answer as unknown, never as no permissions",
    async (status) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ permissions: [], features: [] }, status));
      await expect(loadCapabilities({ ...options, fetchImpl })).resolves.toEqual({});
    }
  );

  it("treats a network failure or timeout as unknown", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("timeout"));
    await expect(loadCapabilities({ ...options, fetchImpl })).resolves.toEqual({});
  });

  it("treats an unparseable body as unknown", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(loadCapabilities({ ...options, fetchImpl })).resolves.toEqual({});
  });

  it("treats a malformed body as unknown", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ permissions: "all", features: [] }));
    await expect(loadCapabilities({ ...options, fetchImpl })).resolves.toEqual({});
  });
});
