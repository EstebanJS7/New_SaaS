/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";
const cookieMock = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies: cookieMock }));
import { POST, PUT, GET } from "./route";
const fetchMock = vi.fn<typeof fetch>();
const patient = "11111111-1111-4111-8111-111111111111",
  key = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  cookieMock.mockResolvedValue({ get: () => ({ value: "staff" }), toString: () => "staff=staff" });
  fetchMock.mockReset().mockResolvedValue(new Response("{}", { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
describe.each(["treatments", "studies", "weights"])("%s creation key proxy", (kind) => {
  function request(method: string, suffix = "", value = key) {
    return new NextRequest("http://localhost/api/clinical/" + patient + "/" + kind + suffix, {
      method,
      headers: { "Idempotency-Key": "never-forwarded", "x-tenant-id": "forged" },
      ...(method !== "GET" && { body: JSON.stringify({ idempotencyKey: value }) }),
    });
  }
  it("forwards the opaque creation key with the staff cookie and preserves conflict", async () => {
    fetchMock.mockResolvedValue(new Response('{"error":{"code":"CONFLICT"}}', { status: 409 }));
    const response = await POST(request("POST"));
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const init = fetchMock.mock.calls[0][1];
    expect(init?.headers).toEqual({
      cookie: STAFF_SESSION_COOKIE + "=staff",
      "content-type": "application/json",
    });
    expect(init).not.toHaveProperty("signal");
    if (typeof init?.body !== "string") throw Error("Expected JSON text");
    expect(JSON.parse(init.body)).toEqual({ idempotencyKey: key });
  });

  it("rejects the body key on PUT/search and never forwards a key header", async () => {
    expect((await PUT(request("PUT", "/" + key))).status).toBe(400);
    expect((await POST(request("POST", "/search"))).status).toBe(400);
    await GET(request("GET", "/" + key));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const [, init] of fetchMock.mock.calls)
      expect(new Headers(init?.headers).has("Idempotency-Key")).toBe(false);
  });

  it("preserves legacy POST and PUT bodies without manufacturing protection", async () => {
    for (const [method, handler, suffix] of [
      ["POST", POST, ""],
      ["PUT", PUT, "/" + key],
    ] as const) {
      const body = kind === "weights" ? '{ "quantity": "0.125" }' : "{}";
      const response = await handler(
        new NextRequest("http://localhost/api/clinical/" + patient + "/" + kind + suffix, {
          method,
          body,
        })
      );
      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(fetchMock.mock.calls.at(-1)?.[1]?.body).toBe(body);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
