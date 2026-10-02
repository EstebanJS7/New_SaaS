/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  BILLING_FEATURE_NOT_ENTITLED_MESSAGE,
  INVOICE_CUSTOMER_REQUIRED_MESSAGE,
  INVOICE_NOT_CANCELLABLE_MESSAGE,
  INVOICE_NOT_DRAFT_MESSAGE,
  INVOICE_SALE_ALREADY_INVOICED_MESSAGE,
  INVOICE_SALE_NOT_COMPLETED_MESSAGE,
  cancelInvoice,
  confirmInvoice,
  createInvoice,
  getInvoice,
  isBillingConflict,
  isBillingCustomerRequired,
  isBillingNotCancellable,
  isBillingNotDraft,
  isBillingNotFound,
  isBillingNotEntitled,
  isBillingPermissionDenied,
  isBillingSaleAlreadyInvoiced,
  isBillingSaleNotCompleted,
  isBillingTransportError,
  listInvoices,
  userFacingBillingError,
  type Invoice,
  type InvoiceLine,
} from "./billing-api";

const INVOICE_ID = "99999999-9999-4999-8999-999999999999";
const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CATALOG_ITEM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const INVOICE_LINE: InvoiceLine = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  catalogItemId: CATALOG_ITEM_ID,
  position: 0,
  description: "Consultation",
  rateCode: "IVA_10",
  unitPrice: "10.50",
  quantity: "1.000",
  lineTotal: "10.50",
  taxableBase: "9.55",
  taxAmount: "0.95",
};

const INVOICE: Invoice = {
  id: INVOICE_ID,
  saleId: SALE_ID,
  customerId: null,
  currency: "PYG",
  status: "DRAFT",
  series: "A",
  number: null,
  confirmedAt: null,
  cancelledAt: null,
  cancelReason: null,
  lines: [INVOICE_LINE],
  total: "10.50",
  taxTotal: "0.95",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

/**
 * The exact key set `InvoiceResponse` declares in
 * `apps/api/src/billing/billing.dto.ts`, field for field. It is the allowlist the
 * fixture must equal, so a field the type gained or lost cannot pass unnoticed.
 */
const INVOICE_FIELDS = [
  "id",
  "saleId",
  "customerId",
  "currency",
  "status",
  "series",
  "number",
  "confirmedAt",
  "cancelledAt",
  "cancelReason",
  "lines",
  "total",
  "taxTotal",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof Invoice)[];

/** The exact key set `InvoiceLineResponse` declares, field for field. */
const INVOICE_LINE_FIELDS = [
  "id",
  "catalogItemId",
  "position",
  "description",
  "rateCode",
  "unitPrice",
  "quantity",
  "lineTotal",
  "taxableBase",
  "taxAmount",
] as const satisfies readonly (keyof InvoiceLine)[];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

describe("billing-api transport contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("carries exactly the API's invoice fields and none the API does not return", () => {
    // Sorted, because the fixture's declaration order is not a contract.
    expect(Object.keys(INVOICE).sort()).toEqual([...INVOICE_FIELDS].sort());
    expect(Object.keys(INVOICE_LINE).sort()).toEqual([...INVOICE_LINE_FIELDS].sort());

    // The DTO has no tenant key (the caller's tenant is the request's own
    // identity) and no fiscal or payment field (DEC-042/DEC-044).
    for (const absent of ["tenantId", "fiscalStatus", "fiscalDocumentId", "payments"]) {
      expect(Object.keys(INVOICE)).not.toContain(absent);
    }
    expect(Object.keys(INVOICE_LINE)).not.toContain("tenantId");
  });

  it("returns the server's money and quantity strings verbatim, without arithmetic", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([INVOICE])));
    global.fetch = fetchMock;

    const [invoice] = await listInvoices();

    // Exact fixed-scale strings, never parsed into a float: the surface renders
    // them and computes nothing (DEC-038).
    expect(invoice?.total).toBe("10.50");
    expect(invoice?.taxTotal).toBe("0.95");
    expect(invoice?.lines[0]?.unitPrice).toBe("10.50");
    expect(invoice?.lines[0]?.quantity).toBe("1.000");
    expect(invoice?.lines[0]?.taxableBase).toBe("9.55");
    expect(invoice?.lines[0]?.taxAmount).toBe("0.95");
    for (const value of [
      invoice?.total,
      invoice?.taxTotal,
      invoice?.lines[0]?.unitPrice,
      invoice?.lines[0]?.quantity,
      invoice?.lines[0]?.lineTotal,
    ]) {
      expect(typeof value).toBe("string");
    }
  });

  it("listInvoices GETs /api/billing/invoices with no query when no filter is given", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([INVOICE])));
    global.fetch = fetchMock;

    await expect(listInvoices()).resolves.toEqual([INVOICE]);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe("/api/billing/invoices");
    expect(init).toMatchObject({ cache: "no-store" });
    expect(init.method).toBeUndefined();
    // No tenant, permission or user header is invented by the client either.
    expect(init.headers).toBeUndefined();
  });

  it("listInvoices serializes the status filter", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock;

    await listInvoices({ status: "CONFIRMED" });

    const [input] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL];
    expect(resolveRequestUrl(input)).toBe("/api/billing/invoices?status=CONFIRMED");
  });

  it("getInvoice GETs one invoice by id without a query", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(INVOICE)));
    global.fetch = fetchMock;

    await expect(getInvoice(INVOICE_ID)).resolves.toEqual(INVOICE);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe(`/api/billing/invoices/${INVOICE_ID}`);
    expect(init).toMatchObject({ cache: "no-store" });
    expect(init.method).toBeUndefined();
  });

  it("createInvoice POSTs the sale id alone", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(INVOICE, 201)));
    global.fetch = fetchMock;

    await expect(createInvoice({ saleId: SALE_ID })).resolves.toEqual(INVOICE);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe("/api/billing/invoices");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    // The currency, the customer, the lines and the totals are all derived from
    // the source sale, so none of them crosses the wire.
    expect(JSON.parse(init.body as string)).toEqual({ saleId: SALE_ID });
    for (const absent of ["tenantId", "status", "currency", "customerId", "series", "total"]) {
      expect(JSON.parse(init.body as string)).not.toHaveProperty(absent);
    }
  });

  it("confirmInvoice POSTs the payload-free confirm path with no body", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ ...INVOICE, status: "CONFIRMED" }))
    );
    global.fetch = fetchMock;

    await confirmInvoice(INVOICE_ID);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe(`/api/billing/invoices/${INVOICE_ID}/confirm`);
    expect(init.method).toBe("POST");
    // The transition is payload-free and state-guarded: it takes no body and no
    // caller-owned idempotency key (DEC-041).
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
  });

  it("cancelInvoice POSTs the reason alone to the invoice's cancel path", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ ...INVOICE, status: "CANCELLED", cancelReason: "Duplicate document." })
      )
    );
    global.fetch = fetchMock;

    await cancelInvoice(INVOICE_ID, { reason: "Duplicate document." });

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe(`/api/billing/invoices/${INVOICE_ID}/cancel`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ reason: "Duplicate document." });
    // The status, the timestamps and the number are written by the command.
    for (const absent of ["tenantId", "status", "cancelledAt", "cancelReason", "number"]) {
      expect(JSON.parse(init.body as string)).not.toHaveProperty(absent);
    }
  });

  it("surfaces the stable sale conflicts and classifies them apart", () => {
    const notCompleted = new ApiRequestError("CONFLICT", INVOICE_SALE_NOT_COMPLETED_MESSAGE, 409);
    const customerRequired = new ApiRequestError(
      "CONFLICT",
      INVOICE_CUSTOMER_REQUIRED_MESSAGE,
      409
    );
    const alreadyInvoiced = new ApiRequestError(
      "CONFLICT",
      INVOICE_SALE_ALREADY_INVOICED_MESSAGE,
      409
    );

    expect(isBillingSaleNotCompleted(notCompleted)).toBe(true);
    expect(isBillingCustomerRequired(notCompleted)).toBe(false);
    expect(isBillingSaleAlreadyInvoiced(notCompleted)).toBe(false);

    expect(isBillingCustomerRequired(customerRequired)).toBe(true);
    expect(isBillingSaleNotCompleted(customerRequired)).toBe(false);

    expect(isBillingSaleAlreadyInvoiced(alreadyInvoiced)).toBe(true);
    expect(isBillingSaleNotCompleted(alreadyInvoiced)).toBe(false);

    // An unrecognized conflict is still a conflict, just unclassified.
    const unknown = new ApiRequestError("CONFLICT", "Something else.", 409);
    expect(isBillingConflict(unknown)).toBe(true);
    expect(isBillingSaleNotCompleted(unknown)).toBe(false);
    expect(isBillingCustomerRequired(unknown)).toBe(false);
    expect(isBillingSaleAlreadyInvoiced(unknown)).toBe(false);
  });

  it("classifies the confirm and cancel state guards apart", () => {
    const notDraft = new ApiRequestError("CONFLICT", INVOICE_NOT_DRAFT_MESSAGE, 409);
    const notCancellable = new ApiRequestError("CONFLICT", INVOICE_NOT_CANCELLABLE_MESSAGE, 409);

    expect(isBillingNotDraft(notDraft)).toBe(true);
    expect(isBillingNotCancellable(notDraft)).toBe(false);

    expect(isBillingNotCancellable(notCancellable)).toBe(true);
    expect(isBillingNotDraft(notCancellable)).toBe(false);

    // Both are the shared stable CONFLICT, so the surface can still render a conflict.
    expect(isBillingConflict(notDraft)).toBe(true);
    expect(isBillingConflict(notCancellable)).toBe(true);
    expect(isBillingSaleAlreadyInvoiced(notDraft)).toBe(false);
  });

  it("keeps the entitlement refusal apart from the permission refusal", () => {
    const notEntitled = new ApiRequestError(
      "FEATURE_NOT_ENTITLED",
      BILLING_FEATURE_NOT_ENTITLED_MESSAGE,
      403
    );
    const forbidden = new ApiRequestError("FORBIDDEN", "Access denied.", 403);

    expect(isBillingNotEntitled(notEntitled)).toBe(true);
    expect(isBillingPermissionDenied(notEntitled)).toBe(false);

    expect(isBillingPermissionDenied(forbidden)).toBe(true);
    expect(isBillingNotEntitled(forbidden)).toBe(false);
  });

  it("maps not-found, entitlement, permission and transport failures to distinct copy", () => {
    expect(userFacingBillingError(new ApiRequestError("FORBIDDEN", "Access denied.", 403))).toBe(
      "You do not have permission to manage invoices."
    );
    expect(
      userFacingBillingError(
        new ApiRequestError("FEATURE_NOT_ENTITLED", BILLING_FEATURE_NOT_ENTITLED_MESSAGE, 403)
      )
    ).toBe("Billing features are not enabled for this tenant.");
    expect(
      userFacingBillingError(new ApiRequestError("NOT_FOUND", "Invoice was not found.", 404))
    ).toBe("Invoice not found.");
    expect(
      userFacingBillingError(
        new ApiRequestError("UNAUTHENTICATED", "Authentication required.", 401)
      )
    ).toBe("You must be signed in to use billing.");
    expect(userFacingBillingError(new TypeError("Failed to fetch"))).toBe(
      "The request could not reach the server. Check your connection and try again."
    );
    // An unmapped code keeps the server message instead of inventing a cause.
    expect(userFacingBillingError(new ApiRequestError("VALIDATION_FAILED", "Bad body.", 400))).toBe(
      "Bad body."
    );
  });

  it("surfaces a backend 404 as a failure and never as data", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "NOT_FOUND", message: "Invoice was not found." } }, 404)
      )
    );
    global.fetch = fetchMock;

    const error = await getInvoice(INVOICE_ID).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).status).toBe(404);
    expect(isBillingNotFound(error as Error)).toBe(true);
    expect(isBillingTransportError(error as Error)).toBe(false);
    expect(isBillingTransportError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("surfaces the stable confirm conflict and classifies it", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "CONFLICT", message: INVOICE_NOT_DRAFT_MESSAGE } }, 409)
      )
    );
    global.fetch = fetchMock;

    const error = await confirmInvoice(INVOICE_ID).catch((caught: unknown) => caught);

    expect((error as ApiRequestError).status).toBe(409);
    expect(isBillingConflict(error as Error)).toBe(true);
    expect(isBillingNotDraft(error as Error)).toBe(true);
    // The copy names the condition rather than echoing any document value.
    expect(userFacingBillingError(error as Error)).toBe(INVOICE_NOT_DRAFT_MESSAGE);
  });

  it("falls back to UNKNOWN when the failure carries no envelope", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("boom", { status: 500 })));
    global.fetch = fetchMock;

    const error = await listInvoices().catch((caught: unknown) => caught);

    expect((error as ApiRequestError).code).toBe("UNKNOWN");
    expect((error as ApiRequestError).status).toBe(500);
    expect(userFacingBillingError(error as Error)).toBe("Request failed (500)");
  });

  it("never writes an invoice payload to the console", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
    ];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([INVOICE]))
      .mockResolvedValueOnce(jsonResponse(INVOICE))
      .mockResolvedValueOnce(jsonResponse(INVOICE, 201))
      .mockResolvedValueOnce(jsonResponse({ ...INVOICE, status: "CONFIRMED" }))
      .mockResolvedValueOnce(jsonResponse({ ...INVOICE, status: "CANCELLED" }))
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "CONFLICT", message: INVOICE_NOT_DRAFT_MESSAGE } }, 409)
      );
    global.fetch = fetchMock;

    await listInvoices({ status: "DRAFT" });
    await getInvoice(INVOICE_ID);
    await createInvoice({ saleId: SALE_ID });
    await confirmInvoice(INVOICE_ID);
    await cancelInvoice(INVOICE_ID, { reason: "Duplicate document." });
    await confirmInvoice(INVOICE_ID).catch(() => undefined);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
