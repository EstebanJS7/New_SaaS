/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const cookies = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies }));
import { POST, PUT } from "./route";
const fetch = vi.fn<typeof globalThis.fetch>();
beforeEach(() => {
  cookies.mockResolvedValue({ get: () => ({ value: "staff" }) });
  fetch
    .mockReset()
    .mockResolvedValue(new Response('{"error":{"code":"CONFLICT"}}', { status: 409 }));
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => vi.unstubAllGlobals());
describe.each(["treatments", "studies", "weights"])("%s CAS proxy", (kind) => {
  const url = "http://localhost/api/clinical/11111111-1111-4111-8111-111111111111/" + kind;
  it("forwards the exact conditional body and returns private 409 without aborting the command", async () => {
    const body = '{ "expectedVersion": 1 }';
    const response = await PUT(
      new NextRequest(url + "/22222222-2222-4222-8222-222222222222", { method: "PUT", body })
    );
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fetch.mock.calls[0][1]?.body).toBe(body);
    expect(fetch.mock.calls[0][1]).not.toHaveProperty("signal");
  });
  it("rejects expectedVersion on creation/search before upstream", async () => {
    for (const suffix of ["", "/search"])
      expect(
        (
          await POST(
            new NextRequest(url + suffix, {
              method: "POST",
              body: JSON.stringify({ expectedVersion: 1 }),
            })
          )
        ).status
      ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
