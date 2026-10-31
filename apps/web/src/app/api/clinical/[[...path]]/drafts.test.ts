/** @vitest-environment node */
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";
const cookies = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies }));
import { GET, POST, PUT } from "./route";
const fetch = vi.fn<typeof globalThis.fetch>();
const base = "http://localhost/api/clinical/11111111-1111-4111-8111-111111111111/drafts",
  id = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  cookies.mockResolvedValue({ get: () => ({ value: "staff-session" }) });
  fetch.mockReset().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => vi.unstubAllGlobals());
describe.each([
  { method: "GET", path: id, body: undefined, handler: GET, read: true },
  { method: "POST", path: "search", body: { kind: "weight" }, handler: POST, read: true },
  { method: "PUT", path: id, body: { version: 0, copy: {} }, handler: PUT, read: false },
  {
    method: "POST",
    path: id + "/submit",
    body: { version: 1, command: {} },
    handler: POST,
    read: false,
  },
  { method: "POST", path: id + "/complete", body: { version: 2 }, handler: POST, read: false },
  { method: "POST", path: id + "/discard", body: { version: 1 }, handler: POST, read: false },
])("$method $path", ({ method, path, body, handler, read }) => {
  it("forwards exact JSON with only the staff cookie, private/no-store and read-only abort", async () => {
    const req = new NextRequest(base + "/" + path, {
      method,
      ...(body && { body: JSON.stringify(body) }),
    });
    const response = await handler(req);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(str(url)).not.toContain("?");
    expect(init).toMatchObject({
      method,
      cache: "no-store",
      headers: { cookie: STAFF_SESSION_COOKIE + "=staff-session" },
    });
    expect(init?.body).toBe(body ? JSON.stringify(body) : undefined);
    expect(init?.signal).toBe(read ? req.signal : undefined);
  });
  it("rejects URL query content before upstream access", async () => {
    expect(
      (
        await handler(
          new NextRequest(base + "/" + path + "?clinical=private", {
            method,
            ...(body && { body: JSON.stringify(body) }),
          })
        )
      ).status
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires a staff session and never trusts identity from the body", async () => {
    cookies.mockResolvedValue({ get: () => undefined });
    expect(
      (
        await handler(
          new NextRequest(base + "/" + path, {
            method,
            ...(body && { body: JSON.stringify(body) }),
          })
        )
      ).status
    ).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    if (body) {
      cookies.mockResolvedValue({ get: () => ({ value: "staff" }) });
      expect(
        (
          await handler(
            new NextRequest(base + "/" + path, {
              method,
              body: JSON.stringify({ ...body, tenantId: "forged", authorId: "forged" }),
            })
          )
        ).status
      ).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    }
  });
});

function str(value: unknown): string {
  if (typeof value !== "string") throw new Error("String expected");
  return value;
}
