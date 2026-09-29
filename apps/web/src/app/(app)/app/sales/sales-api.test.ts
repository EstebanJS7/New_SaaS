/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  SALE_CASH_SESSION_REQUIRED_MESSAGE,
  SALE_CASH_SESSIONS_AMBIGUOUS_MESSAGE,
  SALE_FEATURE_NOT_ENTITLED_MESSAGE,
  SALE_IDEMPOTENCY_KEY_CONFLICT_MESSAGE,
  SALE_ITEM_INACTIVE_MESSAGE,
  SALE_INSUFFICIENT_STOCK_MESSAGE,
  SALE_NOT_EDITABLE_MESSAGE,
  SALE_PAYMENT_TOTAL_MISMATCH_MESSAGE,
  cancelSale,
  classifySaleCompletionError,
  completeSale,
  createSale,
  formatWireAmount,
  getSale,
  isSaleCashSessionRequired,
  isSaleCashSessionsAmbiguous,
  isSaleConflict,
  isSaleIdempotencyConflict,
  isSaleInactiveItem,
  isSaleInsufficientStock,
  isSaleNotEditable,
  isSaleNotFound,
  isSaleNotEntitled,
  isSalePaymentTotalMismatch,
  isSalePermissionDenied,
  isSaleTransportError,
  isWirePaymentAmount,
  isWireQuantity,
  isWireUnitPrice,
  listSales,
  updateSale,
  userFacingSaleError,
  type CompleteSaleInput,
  type Sale,
  type SaleCompletionFailure,
} from "./sales-api";

const SALE_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";

const SALE: Sale = {
  id: SALE_ID,
  tenantId: "tenant-a",
  customerId: null,
  currency: "PYG",
  status: "DRAFT",
  lines: [
    {
      id: "line-1",
      catalogItemId: ITEM_ID,
      rateCode: "IVA_10",
      unitPrice: "1500.00",
      quantity: "2.000",
      lineTotal: "3000.00",
      taxableBase: "2727.27",
      taxAmount: "272.73",
    },
  ],
  total: "3000.00",
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const COMPLETED = {
  ...SALE,
  status: "COMPLETED",
  payments: [{ id: "payment-1", method: "CASH", amount: "3000.00" }],
  replay: false,
} as const;

const PAYMENTS: CompleteSaleInput = {
  payments: [{ method: "CASH", amount: "3000.00" }],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

describe("sales-api transport contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listSales GETs /api/sales with no filter when none is given", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([SALE])));
    global.fetch = fetchMock;

    await expect(listSales()).resolves.toEqual([SALE]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe("/api/sales");
    expect(init).toMatchObject({ cache: "no-store" });
    expect(init.method).toBeUndefined();
    // No tenant, role or permission header is invented by the client either.
    expect(init.headers).toBeUndefined();
  });

  it("listSales serializes the lifecycle filter as status", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock;

    await listSales({ status: "DRAFT" });

    const [input] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL];
    expect(resolveRequestUrl(input)).toBe("/api/sales?status=DRAFT");
  });

  it("getSale GETs /api/sales/:id and returns the DTO", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(SALE)));
    global.fetch = fetchMock;

    await expect(getSale(SALE_ID)).resolves.toEqual(SALE);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe(`/api/sales/${SALE_ID}`);
    expect(init).toMatchObject({ cache: "no-store" });
  });

  it("createSale POSTs the optional customer and line set to the collection root", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(SALE, 201)));
    global.fetch = fetchMock;

    const body = {
      customerId: CUSTOMER_ID,
      lines: [{ catalogItemId: ITEM_ID, quantity: "2.000", unitPrice: "1500.00" }],
    };
    await expect(createSale(body)).resolves.toEqual(SALE);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe("/api/sales");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(init.body).toBe(JSON.stringify(body));
  });

  it("updateSale PUTs the whole desired line set to /api/sales/:id", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(SALE)));
    global.fetch = fetchMock;

    const body = {
      customerId: null,
      lines: [{ catalogItemId: ITEM_ID, quantity: "3.000" }],
    };
    await expect(updateSale(SALE_ID, body)).resolves.toEqual(SALE);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe(`/api/sales/${SALE_ID}`);
    expect(init.method).toBe("PUT");
    // The update body never carries a status: the lifecycle has its own commands,
    // and the omitted unit price falls back to the catalog reference price.
    const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(parsed).toEqual(body);
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("total");
  });

  it("cancelSale POSTs to the cancel command with an empty body", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ ...SALE, status: "CANCELLED" }, 201))
    );
    global.fetch = fetchMock;

    await expect(cancelSale(SALE_ID)).resolves.toMatchObject({ status: "CANCELLED" });

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe(`/api/sales/${SALE_ID}/cancel`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
  });

  it("completeSale POSTs the payment set without inventing an Idempotency-Key", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(COMPLETED, 201)));
    global.fetch = fetchMock;

    const result = await completeSale(SALE_ID, PAYMENTS);

    expect(result.sale).toEqual(COMPLETED);
    expect(result.replayed).toBe(false);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe(`/api/sales/${SALE_ID}/complete`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(PAYMENTS));
    // The key is optional and caller-owned: the client never generates one.
    expect(init.headers).toEqual({ "content-type": "application/json" });
  });

  it("completeSale forwards the caller's Idempotency-Key verbatim when one is given", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ ...COMPLETED, replay: true }, 200))
    );
    global.fetch = fetchMock;

    const result = await completeSale(SALE_ID, PAYMENTS, { idempotencyKey: "counter-1-abc" });

    const [, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("counter-1-abc");
    // A 200 replay is the API's own answer and still carries the completed sale.
    expect(result.replayed).toBe(true);
  });

  it("never retries a rejected completion", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "CONFLICT", message: SALE_NOT_EDITABLE_MESSAGE } }, 409)
      )
    );
    global.fetch = fetchMock;

    await expect(completeSale(SALE_ID, PAYMENTS)).rejects.toBeInstanceOf(ApiRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces the stable error code and status on 404", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "NOT_FOUND", message: "Sale was not found." } }, 404)
      )
    );
    global.fetch = fetchMock;

    const error = await getSale("missing").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe("NOT_FOUND");
    expect((error as ApiRequestError).status).toBe(404);
    expect(isSaleNotFound(error as Error)).toBe(true);
    expect(userFacingSaleError(error as Error)).toBe("Sale not found.");
  });

  it("classifies every distinct completion outcome", async () => {
    const cases: readonly {
      readonly status: number;
      readonly code: string;
      readonly message: string;
      readonly expected: SaleCompletionFailure;
    }[] = [
      {
        status: 403,
        code: "FEATURE_NOT_ENTITLED",
        message: SALE_FEATURE_NOT_ENTITLED_MESSAGE,
        expected: "not-entitled",
      },
      {
        status: 403,
        code: "FORBIDDEN",
        message: "Access denied.",
        expected: "permission-denied",
      },
      {
        status: 404,
        code: "NOT_FOUND",
        message: "Sale was not found.",
        expected: "not-found",
      },
      {
        status: 409,
        code: "CONFLICT",
        message: SALE_NOT_EDITABLE_MESSAGE,
        expected: "not-editable",
      },
      {
        status: 400,
        code: "VALIDATION_FAILED",
        message: SALE_PAYMENT_TOTAL_MISMATCH_MESSAGE,
        expected: "payment-total-mismatch",
      },
      {
        status: 409,
        code: "CONFLICT",
        message: SALE_CASH_SESSION_REQUIRED_MESSAGE,
        expected: "missing-cash-session",
      },
      {
        status: 409,
        code: "CONFLICT",
        message: SALE_CASH_SESSIONS_AMBIGUOUS_MESSAGE,
        expected: "ambiguous-cash-session",
      },
      {
        status: 409,
        code: "CONFLICT",
        message: SALE_INSUFFICIENT_STOCK_MESSAGE,
        expected: "insufficient-stock",
      },
      {
        status: 409,
        code: "CONFLICT",
        message: SALE_ITEM_INACTIVE_MESSAGE,
        expected: "inactive-item",
      },
      {
        status: 409,
        code: "CONFLICT",
        message: SALE_IDEMPOTENCY_KEY_CONFLICT_MESSAGE,
        expected: "idempotency-conflict",
      },
      {
        status: 409,
        code: "CONFLICT",
        message: "Some other conflict.",
        expected: "conflict",
      },
      {
        status: 400,
        code: "VALIDATION_FAILED",
        message: "A sale line requires a unit price.",
        expected: "validation",
      },
    ];

    for (const testCase of cases) {
      const fetchMock = vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            { error: { code: testCase.code, message: testCase.message } },
            testCase.status
          )
        )
      );
      global.fetch = fetchMock;

      const error = await completeSale(SALE_ID, PAYMENTS).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).status).toBe(testCase.status);
      expect(classifySaleCompletionError(error as Error)).toBe(testCase.expected);
    }
  });

  it("classifies a transport failure that never reached the API", () => {
    expect(classifySaleCompletionError(new TypeError("Failed to fetch"))).toBe("transport");
    expect(isSaleTransportError(new TypeError("Failed to fetch"))).toBe(true);
    expect(
      isSaleTransportError(new ApiRequestError("CONFLICT", SALE_NOT_EDITABLE_MESSAGE, 409))
    ).toBe(false);
  });

  it("keeps the distinct 409 conditions distinguishable from one another", () => {
    const notEditable = new ApiRequestError("CONFLICT", SALE_NOT_EDITABLE_MESSAGE, 409);
    const missingSession = new ApiRequestError("CONFLICT", SALE_CASH_SESSION_REQUIRED_MESSAGE, 409);
    const ambiguousSession = new ApiRequestError(
      "CONFLICT",
      SALE_CASH_SESSIONS_AMBIGUOUS_MESSAGE,
      409
    );
    const idempotency = new ApiRequestError("CONFLICT", SALE_IDEMPOTENCY_KEY_CONFLICT_MESSAGE, 409);

    expect(isSaleConflict(notEditable)).toBe(true);
    expect(isSaleNotEditable(notEditable)).toBe(true);
    expect(isSaleCashSessionRequired(notEditable)).toBe(false);
    expect(isSaleIdempotencyConflict(notEditable)).toBe(false);

    expect(isSaleCashSessionRequired(missingSession)).toBe(true);
    expect(isSaleCashSessionsAmbiguous(missingSession)).toBe(false);
    expect(isSaleNotEditable(missingSession)).toBe(false);

    expect(isSaleCashSessionsAmbiguous(ambiguousSession)).toBe(true);
    expect(isSaleCashSessionRequired(ambiguousSession)).toBe(false);

    expect(isSaleIdempotencyConflict(idempotency)).toBe(true);
    expect(isSaleNotEditable(idempotency)).toBe(false);

    // A conflict with an unrecognized message is still a conflict, just unclassified.
    const unknown = new ApiRequestError("CONFLICT", "Something else.", 409);
    expect(isSaleConflict(unknown)).toBe(true);
    expect(isSaleNotEditable(unknown)).toBe(false);
    expect(classifySaleCompletionError(unknown)).toBe("conflict");
  });

  it("classifies only the API's own code and message pairs", () => {
    // A non-`DRAFT` conflict under the payment-mismatch code is not a mismatch.
    expect(
      isSalePaymentTotalMismatch(
        new ApiRequestError("CONFLICT", SALE_PAYMENT_TOTAL_MISMATCH_MESSAGE, 409)
      )
    ).toBe(false);
    // The same message under `VALIDATION_FAILED` is.
    expect(
      isSalePaymentTotalMismatch(
        new ApiRequestError("VALIDATION_FAILED", SALE_PAYMENT_TOTAL_MISMATCH_MESSAGE, 400)
      )
    ).toBe(true);
    expect(
      isSaleInsufficientStock(new ApiRequestError("CONFLICT", SALE_ITEM_INACTIVE_MESSAGE, 409))
    ).toBe(false);
    expect(
      isSaleInactiveItem(new ApiRequestError("CONFLICT", SALE_ITEM_INACTIVE_MESSAGE, 409))
    ).toBe(true);
    expect(isSalePermissionDenied(new ApiRequestError("FORBIDDEN", "Access denied.", 403))).toBe(
      true
    );
    expect(
      isSalePermissionDenied(
        new ApiRequestError("FEATURE_NOT_ENTITLED", SALE_FEATURE_NOT_ENTITLED_MESSAGE, 403)
      )
    ).toBe(false);
    expect(
      isSaleNotEntitled(
        new ApiRequestError("FEATURE_NOT_ENTITLED", SALE_FEATURE_NOT_ENTITLED_MESSAGE, 403)
      )
    ).toBe(true);
  });

  it("falls back to UNKNOWN when the failure carries no envelope", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("boom", { status: 500 })));
    global.fetch = fetchMock;

    const error = await listSales().catch((caught: unknown) => caught);

    expect((error as ApiRequestError).code).toBe("UNKNOWN");
    expect((error as ApiRequestError).status).toBe(500);
    expect(classifySaleCompletionError(error as Error)).toBe("unknown");
  });

  it("maps the entitlement, permission, not-found and transport failures to distinct copy", () => {
    expect(userFacingSaleError(new ApiRequestError("FORBIDDEN", "Access denied.", 403))).toBe(
      "You do not have permission to manage sales."
    );
    expect(
      userFacingSaleError(
        new ApiRequestError("FEATURE_NOT_ENTITLED", SALE_FEATURE_NOT_ENTITLED_MESSAGE, 403)
      )
    ).toBe("Sales features are not enabled for this tenant.");
    expect(
      userFacingSaleError(new ApiRequestError("NOT_FOUND", "Resource was not found.", 404))
    ).toBe("Sale not found.");
    expect(
      userFacingSaleError(new ApiRequestError("UNAUTHENTICATED", "Authentication required.", 401))
    ).toBe("You must be signed in to use the counter.");
    expect(userFacingSaleError(new TypeError("Failed to fetch"))).toBe(
      "The request could not reach the server. Check your connection and try again."
    );
    // An unmapped code keeps the server message instead of inventing a cause.
    expect(
      userFacingSaleError(new ApiRequestError("CONFLICT", SALE_NOT_EDITABLE_MESSAGE, 409))
    ).toBe(SALE_NOT_EDITABLE_MESSAGE);
  });

  it("keeps the stable conflict copy value-free", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "CONFLICT", message: SALE_NOT_EDITABLE_MESSAGE } }, 409)
      )
    );
    global.fetch = fetchMock;

    const error = (await completeSale(SALE_ID, PAYMENTS).catch(
      (caught: unknown) => caught
    )) as ApiRequestError;

    expect(error.message).not.toContain("3000.00");
    expect(error.message).not.toContain(CUSTOMER_ID);
    expect(error.message).not.toContain(ITEM_ID);
  });

  it("never writes a sale or payment payload to the console", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
    ];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SALE, 201))
      .mockResolvedValueOnce(jsonResponse(COMPLETED, 201))
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "CONFLICT", message: SALE_NOT_EDITABLE_MESSAGE } }, 409)
      );
    global.fetch = fetchMock;

    // The whole INTERNAL sale payload flows through every call.
    await createSale({
      customerId: SALE.customerId,
      lines: [{ catalogItemId: ITEM_ID, quantity: "2.000", unitPrice: "1500.00" }],
    });
    await completeSale(SALE_ID, PAYMENTS);
    await completeSale(SALE_ID, PAYMENTS).catch(() => undefined);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe("sales-api wire money discipline", () => {
  it("groups an exact amount textually, never through a float", () => {
    expect(formatWireAmount("1500.00")).toBe("1,500.00");
    expect(formatWireAmount("3000.00")).toBe("3,000.00");
    expect(formatWireAmount("0.00")).toBe("0.00");
    expect(formatWireAmount("10.5")).toBe("10.5");
    expect(formatWireAmount("1500")).toBe("1,500");
    expect(formatWireAmount("1234.56")).toBe("1,234.56");
  });

  it("keeps every digit of an amount no float could represent", () => {
    // 30 integer digits and 2 decimals: `Number` would round this immediately,
    // so the digit-for-digit result proves no numeric conversion happened.
    expect(formatWireAmount("123456789012345678901234567890.12")).toBe(
      "123,456,789,012,345,678,901,234,567,890.12"
    );
  });

  it("returns a literal the wire did not produce unchanged instead of mangling it", () => {
    for (const value of ["", "abc", "-1.00", "1e3", "1,500.00", "1.2.3"]) {
      expect(formatWireAmount(value)).toBe(value);
    }
  });

  it("recognizes an exact quantity and rejects zero, a float and a sign", () => {
    expect(isWireQuantity("2.000")).toBe(true);
    expect(isWireQuantity("1")).toBe(true);
    expect(isWireQuantity("0.000")).toBe(false);
    expect(isWireQuantity("0")).toBe(false);
    expect(isWireQuantity("1.2345")).toBe(false);
    expect(isWireQuantity("-1.000")).toBe(false);
    expect(isWireQuantity("1e3")).toBe(false);
    expect(isWireQuantity("1,000")).toBe(false);
  });

  it("recognizes a non-negative unit price and rejects a float or a sign", () => {
    expect(isWireUnitPrice("0")).toBe(true);
    expect(isWireUnitPrice("0.00")).toBe(true);
    expect(isWireUnitPrice("1500.00")).toBe(true);
    expect(isWireUnitPrice("1.234")).toBe(false);
    expect(isWireUnitPrice("-1.00")).toBe(false);
    expect(isWireUnitPrice("1e3")).toBe(false);
  });

  it("recognizes a strictly positive payment amount", () => {
    expect(isWirePaymentAmount("3000.00")).toBe(true);
    expect(isWirePaymentAmount("0.00")).toBe(false);
    expect(isWirePaymentAmount("0")).toBe(false);
    expect(isWirePaymentAmount("-3000.00")).toBe(false);
    expect(isWirePaymentAmount("3000.000")).toBe(false);
  });
});
