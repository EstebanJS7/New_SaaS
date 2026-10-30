/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { STAFF_SESSION_COOKIE, PORTAL_SESSION_COOKIE } from "@/lib/session-cookie";
const cookiesMock = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
import { POST, GET } from "./route";
const fetchMock = vi.fn<typeof fetch>();
function request(body = "{}", search = "") {
  return new NextRequest(
    `http://localhost/api/clinical/11111111-1111-4111-8111-111111111111/weights/search${search}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "test-request",
        "x-tenant-id": "foreign",
      },
      body,
    }
  );
}
beforeEach(() => {
  cookiesMock.mockResolvedValue({
    get: (key: string) => (key === STAFF_SESSION_COOKIE ? { value: "staff-token" } : undefined),
  });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
describe("private weight search proxy", () => {
  it("forwards exact JSON bytes, only staff authority, and disables caching", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"items":[]}', {
        headers: { "content-type": "application/json", "x-request-id": "upstream-id" },
      })
    );
    const body = '{ "minQuantity": "1.234", "period": "last30", "page": 2 }';
    const outgoing = request(body);
    const response = await POST(outgoing);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "http://localhost:3001/patients/11111111-1111-4111-8111-111111111111/clinical/weights/search",
      expect.objectContaining({
        method: "POST",
        body,
        cache: "no-store",
        signal: outgoing.signal,
        headers: {
          cookie: `${STAFF_SESSION_COOKIE}=staff-token`,
          "content-type": "application/json",
          "x-request-id": "test-request",
        },
      })
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toBe("upstream-id");
    expect(await response.json()).toEqual({ items: [] });
  });
  it.each([
    "null",
    "[]",
    "invalid",
    '{"tenantId":"foreign"}',
    '{"pageSize":1000}',
    '{"q":"unsupported"}',
  ])("refuses an invalid body %s without upstream access", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refuses query search text instead of forwarding it", async () => {
    expect((await POST(request("{}", "?q=Confidential"))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([undefined, { value: "" }])("requires a staff session %j", async (value) => {
    cookiesMock.mockResolvedValue({ get: () => value });
    expect((await POST(request())).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not use a Portal session or forward its cookie", async () => {
    cookiesMock.mockResolvedValue({
      get: (key: string) => (key === PORTAL_SESSION_COOKIE ? { value: "portal-token" } : undefined),
    });
    expect((await POST(request())).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404, 500])(
    "preserves upstream status %s and error envelope",
    async (status) => {
      const envelope = { error: { code: "TEST_CODE", message: "Static test error" } };
      fetchMock.mockResolvedValue(new Response(JSON.stringify(envelope), { status }));
      const response = await POST(request());
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(envelope);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  );
});

it("proxies only an authorized patient-anchored detail without caching", async () => {
  fetchMock.mockResolvedValue(new Response('{"quantity":"12.345"}'));
  const response = await GET(
    new NextRequest(
      "http://localhost/api/clinical/11111111-1111-4111-8111-111111111111/weights/22222222-2222-4222-8222-222222222222"
    )
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(fetchMock.mock.calls[0][0]).toBe(
    "http://localhost:3001/patients/11111111-1111-4111-8111-111111111111/clinical/weights/22222222-2222-4222-8222-222222222222"
  );
});
