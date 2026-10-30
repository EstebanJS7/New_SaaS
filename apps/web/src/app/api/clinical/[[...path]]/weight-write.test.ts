/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";
const cookiesMock = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
import { POST, PUT } from "./route";
const fetchMock = vi.fn<typeof fetch>();
const base = "/api/clinical/11111111-1111-4111-8111-111111111111/weights";
function request(method: "POST" | "PUT", body = "{}", query = "") {
  return new NextRequest(
    `http://localhost${base}${method === "PUT" ? "/22222222-2222-4222-8222-222222222222" : ""}${query}`,
    {
      method,
      headers: {
        "content-type": "application/json",
        "x-request-id": "synthetic",
        "x-tenant-id": "forged",
      },
      body,
    }
  );
}
beforeEach(() => {
  cookiesMock.mockResolvedValue({
    get: (key: string) => (key === STAFF_SESSION_COOKIE ? { value: "staff" } : undefined),
  });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
describe.each(["POST", "PUT"] as const)("Weight %s proxy", (method) => {
  const call = method === "POST" ? POST : PUT;
  it("keeps exact bytes, only staff authority, private caching and no abort of uncertain commands", async () => {
    fetchMock.mockResolvedValue(new Response('{"id":"synthetic"}', { status: 200 }));
    const body = '{ "quantity": "0.125", "unit": "KG" }';
    const response = await call(request(method, body));
    expect(fetchMock.mock.calls[0][1]).toEqual({
      method,
      headers: {
        cookie: `${STAFF_SESSION_COOKIE}=staff`,
        "content-type": "application/json",
        "x-request-id": "synthetic",
      },
      body,
      cache: "no-store",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each(['{"tenantId":"forged"}', '{"status":"CLOSED"}', "[]", "invalid"])(
    "refuses unsafe body %s",
    async (body) => {
      expect((await call(request(method, body))).status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );
  it("rejects queries and a missing staff cookie before upstream", async () => {
    expect((await call(request(method, "{}", "?quantity=private"))).status).toBe(400);
    cookiesMock.mockResolvedValue({ get: () => undefined });
    expect((await call(request(method))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404, 500])("preserves upstream failure %s", async (status) => {
    fetchMock.mockResolvedValue(new Response('{"error":{"code":"SYNTHETIC"}}', { status }));
    const response = await call(request(method));
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
