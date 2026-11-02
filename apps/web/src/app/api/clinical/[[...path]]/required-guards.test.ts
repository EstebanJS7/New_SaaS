/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const cookies = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies }));
import { POST, PUT } from "./route";
const fetchMock = vi.fn<typeof fetch>();
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  cookies.mockResolvedValue({ get: () => ({ value: "staff" }) });
  fetchMock.mockReset().mockImplementation(() => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
describe.each(["treatments", "studies", "weights"])("%s required guards", (kind) => {
  const path = "http://localhost/api/clinical/" + id + "/" + kind;
  it("rejects missing/invalid creation keys before upstream", async () => {
    for (const idempotencyKey of [undefined, null, "", "invalid", 42, {}, []]) {
      const response = await POST(
        new NextRequest(path, { method: "POST", body: JSON.stringify({ idempotencyKey }) })
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects each omitted/invalid correction guard independently before upstream", async () => {
    const invalid = [
      {},
      { expectedVersion: 1 },
      { correctionReason: "Synthetic correction" },
      ...[undefined, null, 0, -1, 1.5, "1", 2147483648, {}, true].map((expectedVersion) => ({
        expectedVersion,
        correctionReason: "Synthetic correction",
      })),
      ...[undefined, null, "", "  ", "x".repeat(2001), 42, {}, []].map((correctionReason) => ({
        expectedVersion: 1,
        correctionReason,
      })),
    ];
    for (const command of invalid) {
      const response = await PUT(
        new NextRequest(path + "/" + id, { method: "PUT", body: JSON.stringify(command) })
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("preserves valid boundary guards and exact bytes without extra reads", async () => {
    const body =
      '{ "expectedVersion": 2147483647, "correctionReason": "' + "x".repeat(2000) + '" }';
    expect((await PUT(new NextRequest(path + "/" + id, { method: "PUT", body }))).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(body);
  });
});
it("checks nested draft command guards before submission can mark PENDING", async () => {
  for (const command of [
    {},
    { expectedVersion: 1 },
    { correctionReason: "Reason" },
    { idempotencyKey: "invalid" },
  ]) {
    const response = await POST(
      new NextRequest("http://localhost/api/clinical/" + id + "/drafts/" + id + "/submit", {
        method: "POST",
        body: JSON.stringify({ version: 1, command }),
      })
    );
    expect(response.status).toBe(400);
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
