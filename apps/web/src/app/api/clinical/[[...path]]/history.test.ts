/** @vitest-environment node */
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const cookies = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies }));
import { GET, POST, PUT } from "./route";
const fetch = vi.fn<typeof globalThis.fetch>();
beforeEach(() => {
  cookies.mockResolvedValue({ get: () => ({ value: "staff" }) });
  fetch.mockReset().mockImplementation(() => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => vi.unstubAllGlobals());
it("resolves only the private patient-scoped history capability, rejecting query content", async () => {
  const path = "http://localhost/api/clinical/11111111-1111-4111-8111-111111111111/history-access";
  expect((await GET(new NextRequest(path))).headers.get("cache-control")).toBe("private, no-store");
  expect(fetch.mock.calls[0][1]?.headers).toEqual({ cookie: STAFF_SESSION_COOKIE + "=staff" });
  const calls = fetch.mock.calls.length;
  expect((await GET(new NextRequest(path + "?q=private"))).status).toBe(400);
  expect(fetch).toHaveBeenCalledTimes(calls);
});
describe.each(["treatments", "studies", "weights"])("%s history BFF", (kind) => {
  const path = `http://localhost/api/clinical/11111111-1111-4111-8111-111111111111/${kind}/22222222-2222-4222-8222-222222222222`;
  it("forwards only history pagination with no-store and abort propagation", async () => {
    const req = new NextRequest(path + "/history/search", {
      method: "POST",
      body: '{"beforeVersion":21}',
    });
    const response = await POST(req);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: '{"beforeVersion":21}',
      cache: "no-store",
      signal: req.signal,
    });
  });
  it("rejects clinical text/tenant spoofing/query content and requires the staff cookie", async () => {
    for (const body of [{ q: "clinical" }, { tenantId: "forged" }])
      expect(
        (
          await POST(
            new NextRequest(path + "/history/search", {
              method: "POST",
              body: JSON.stringify(body),
            })
          )
        ).status
      ).toBe(400);
    expect(
      (
        await POST(
          new NextRequest(path + "/history/search?q=private", { method: "POST", body: "{}" })
        )
      ).status
    ).toBe(400);
    cookies.mockResolvedValue({ get: () => undefined });
    expect(
      (await POST(new NextRequest(path + "/history/search", { method: "POST", body: "{}" }))).status
    ).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("accepts correction reason only on PUT while preserving the exact body", async () => {
    const body = '{"expectedVersion":1,"correctionReason":"Motivo sintético"}';
    expect((await PUT(new NextRequest(path, { method: "PUT", body }))).status).toBe(200);
    expect(fetch.mock.calls[0][1]?.body).toBe(body);
  });
});
