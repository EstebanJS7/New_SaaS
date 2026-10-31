import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeTreatment } from "./treatment-write-api";
import { writeStudy } from "./study-write-api";
import { writeWeight } from "./weight-write-api";

const patient = "11111111-1111-4111-8111-111111111111";
const record = "22222222-2222-4222-8222-222222222222";
const key = "33333333-3333-4333-8333-333333333333";
const date = "2026-10-20T15:00:00.000Z";
const fetchMock = vi.fn<typeof fetch>();
function commandBody(init?: RequestInit): unknown {
  if (typeof init?.body !== "string") throw Error("Expected a JSON command body");
  return JSON.parse(init.body) as unknown;
}

// Checked by tsc, never invoked: permitting one of these calls must fail typecheck.
const invalidTypedCalls = () => {
  // @ts-expect-error Creation requires its caller-owned attempt.
  void writeTreatment(patient, undefined, {});
  // @ts-expect-error Creation requires its caller-owned attempt.
  void writeStudy(patient, undefined, {});
  // @ts-expect-error Creation requires its caller-owned attempt.
  void writeWeight(patient, undefined, {});
  // @ts-expect-error Correction requires its original version.
  void writeTreatment(patient, record, {});
  // @ts-expect-error Correction requires its original version.
  void writeStudy(patient, record, {});
  // @ts-expect-error Correction requires its original version.
  void writeWeight(patient, record, {});
  // @ts-expect-error A correction cannot carry a creation attempt.
  void writeWeight(patient, record, { expectedVersion: 1 }, { key });
};
void invalidTypedCalls;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const writers = [
  {
    kind: "treatments",
    write: writeTreatment,
    input: { description: "Sintético", administeredAt: date, context: null },
  },
  {
    kind: "studies",
    write: writeStudy,
    input: { studyType: "Sintético", performedAt: date, result: "" },
  },
  {
    kind: "weights",
    write: writeWeight,
    input: { quantity: "0.125", measuredAt: date, unit: "KG" },
  },
] as const;
describe.each(writers)("$kind owned write contract", ({ kind, write, input }) => {
  // Exercise JS/untyped callers without weakening the production signatures.
  const invoke = write as unknown as (...args: unknown[]) => Promise<unknown>;
  const success = () =>
    new Response(JSON.stringify({ id: record, ...input, version: 1 }), { status: 201 });
  it.each([undefined, {}, { key: "" }, { key: 7 }, { key: "clinical text" }])(
    "rejects invalid or absent attempt %j before any request",
    async (attempt) => {
      await expect(invoke(patient, undefined, input, attempt)).rejects.toMatchObject({
        code: "INVALID_WRITE_GUARD",
        status: 0,
        uncertain: false,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );
  it.each([undefined, 0, -1, 1.5, "1", null, NaN, Infinity, 2147483648])(
    "rejects invalid or absent version %j without re-reading a newer baseline",
    async (expectedVersion) => {
      await expect(invoke(patient, record, { expectedVersion })).rejects.toMatchObject({
        code: "INVALID_WRITE_GUARD",
        status: 0,
        uncertain: false,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );
  it("rejects mixed creation/correction guards before network", async () => {
    await expect(
      invoke(patient, undefined, { ...input, expectedVersion: 1 }, { key })
    ).rejects.toMatchObject({ code: "INVALID_WRITE_GUARD" });
    await expect(invoke(patient, record, { expectedVersion: 1 }, { key })).rejects.toMatchObject({
      code: "INVALID_WRITE_GUARD",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps the caller's key and exact command for an explicit retry after network failure", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Lost response"))
      .mockImplementation(() => Promise.resolve(success()));
    const attempt = { key };
    await expect(invoke(patient, undefined, input, attempt)).rejects.toMatchObject({
      uncertain: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await invoke(patient, undefined, input, attempt);
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2);
    for (const [url, init] of posts) {
      expect(url).toBe(`/api/clinical/${patient}/${kind}`);
      expect(commandBody(init)).toEqual({ ...input, idempotencyKey: key });
      expect(init?.cache).toBe("no-store");
    }
    expect(attempt.key).toBe(key);
  });
  it("forwards the caller's version unchanged without obtaining a replacement", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(success()));
    await invoke(patient, record, { ...input, expectedVersion: 2147483647, correctionReason: "Motivo sintético" });
    const puts = fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(commandBody(puts[0][1])).toEqual({ ...input, expectedVersion: 2147483647, correctionReason: "Motivo sintético" });
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PUT");
  });
});

it("uses only GET for a confirmed weight even when the old attempt key is unusable", async () => {
  fetchMock
    .mockResolvedValueOnce(new Response("{}", { status: 503 }))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: record, quantity: "0.125", measuredAt: date, unit: "KG", version: 1 })
      )
    );
  const attempt = { key: "", savedId: record };
  await expect(writeWeight(patient, undefined, {}, attempt)).rejects.toMatchObject({
    code: "READ_AFTER_COMMIT_FAILED",
  });
  await expect(writeWeight(patient, undefined, {}, attempt)).resolves.toMatchObject({
    quantity: "0.125",
    unit: "KG",
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const [url, init] of fetchMock.mock.calls) {
    expect(url).toBe(`/api/clinical/${patient}/weights/${record}`);
    expect(init?.method ?? "GET").toBe("GET");
  }
});
