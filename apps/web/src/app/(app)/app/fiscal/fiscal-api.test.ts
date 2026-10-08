/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  FISCAL_DOCUMENT_STATUSES,
  cancelFiscalDocument,
  getFiscalDocument,
  isFiscalConflict,
  isFiscalNotFound,
  isFiscalNotEntitled,
  isFiscalPermissionDenied,
  isFiscalTransportError,
  isFiscalValidationFailed,
  issueFiscalDocument,
  listFiscalDocuments,
  userFacingFiscalError,
  type FiscalDocument,
} from "./fiscal-api";
const ID = "99999999-9999-4999-8999-999999999999";
const DOC: FiscalDocument = {
  id: ID,
  invoiceId: ID,
  provider: "FAKE",
  status: "QUEUED",
  attemptCount: 0,
  externalId: null,
  cdc: null,
  lastErrorCode: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  cancelledAt: null,
};
const FISCAL_DOCUMENT_FIELDS = [
  "id",
  "invoiceId",
  "provider",
  "status",
  "attemptCount",
  "externalId",
  "cdc",
  "lastErrorCode",
  "createdAt",
  "updatedAt",
  "cancelledAt",
] as const satisfies readonly (keyof FiscalDocument)[];
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function url(call: number): string {
  return (fetchMock.mock.calls[call] as unknown as [string])[0];
}
const fetchMock = vi.fn();
describe("fiscal-api", () => {
  afterEach(() => vi.restoreAllMocks());
  it("pins the allowlisted DTO and status mirror", () => {
    expect(Object.keys(DOC).sort()).toEqual([...FISCAL_DOCUMENT_FIELDS].sort());
    expect(Object.keys(DOC)).not.toEqual(
      expect.arrayContaining(["tenantId", "requestSnapshot", "responseSnapshot"])
    );
    // Nine until FISC-010 WU-D: FISC-009 had appended SIGNING to the database
    // enum while this mirror still described the older set.
    expect(FISCAL_DOCUMENT_STATUSES).toHaveLength(10);
  });
  it("issues all four calls through the fiscal proxy", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([DOC]))
      .mockResolvedValueOnce(jsonResponse([DOC]))
      .mockResolvedValueOnce(jsonResponse(DOC))
      .mockResolvedValueOnce(jsonResponse(DOC, 201))
      .mockResolvedValueOnce(jsonResponse({ ...DOC, status: "CANCELLED" }));
    global.fetch = fetchMock;
    await listFiscalDocuments({});
    expect(url(0)).toBe("/api/fiscal/fiscal-documents");
    await listFiscalDocuments({ status: "QUEUED" });
    expect(url(1)).toBe("/api/fiscal/fiscal-documents?status=QUEUED");
    await getFiscalDocument(ID);
    expect(url(2)).toBe(`/api/fiscal/fiscal-documents/${ID}`);
    await issueFiscalDocument({ invoiceId: ID });
    expect(url(3)).toBe("/api/fiscal/fiscal-documents");
    await cancelFiscalDocument(ID, { reason: "duplicate" });
    expect(url(4)).toBe(`/api/fiscal/fiscal-documents/${ID}/cancel`);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls).toHaveLength(5);
    for (const [, init] of calls) {
      expect(init.cache).toBe("no-store");
      const headers = new Headers(init.headers);
      expect(headers.has("tenantid")).toBe(false);
      expect(headers.has("idempotency-key")).toBe(false);
      if (init.method === "POST") {
        expect(headers.get("content-type")).toBe("application/json");
      } else {
        expect(init.body).toBeUndefined();
      }
    }
    expect(calls[3]?.[1].method).toBe("POST");
    expect(Object.keys(JSON.parse(calls[3]?.[1].body as string) as object)).toEqual(["invoiceId"]);
    expect(calls[4]?.[1].method).toBe("POST");
    expect(Object.keys(JSON.parse(calls[4]?.[1].body as string) as object)).toEqual(["reason"]);
  });
  it("classifies errors and preserves safe server copy", () => {
    const e = (code: string) => new ApiRequestError(code, "safe message", 400);
    expect(isFiscalPermissionDenied(e("FORBIDDEN"))).toBe(true);
    expect(isFiscalNotEntitled(e("FEATURE_NOT_ENTITLED"))).toBe(true);
    expect(isFiscalNotFound(e("NOT_FOUND"))).toBe(true);
    expect(isFiscalConflict(e("CONFLICT"))).toBe(true);
    expect(isFiscalValidationFailed(e("VALIDATION_FAILED"))).toBe(true);
    expect(isFiscalTransportError(new TypeError())).toBe(true);
    expect(isFiscalTransportError(e("CONFLICT"))).toBe(false);
    expect(userFacingFiscalError(e("VALIDATION_FAILED"))).toBe("safe message");
  });
  it("never logs", async () => {
    const spy = vi.spyOn(console, "error");
    fetchMock.mockResolvedValue(jsonResponse([DOC]));
    global.fetch = fetchMock;
    await listFiscalDocuments();
    expect(spy).not.toHaveBeenCalled();
  });
});
