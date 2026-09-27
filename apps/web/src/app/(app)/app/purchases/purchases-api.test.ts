/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  PURCHASE_ITEM_INACTIVE_MESSAGE,
  PURCHASE_ITEM_NOT_TRACKED_MESSAGE,
  PURCHASE_NOT_EDITABLE_MESSAGE,
  cancelPurchase,
  createPurchase,
  getPurchase,
  isPurchaseConflict,
  isPurchaseInactiveItemConflict,
  isPurchaseNotEditableConflict,
  isPurchaseNotFound,
  isPurchasePermissionDenied,
  isPurchaseTransportError,
  isPurchaseUntrackedItemConflict,
  listPurchases,
  receivePurchase,
  updatePurchase,
  userFacingPurchaseError,
  type Purchase,
} from "./purchases-api";

const PURCHASE_ID = "22222222-2222-4222-8222-222222222222";
const SUPPLIER_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";

const PURCHASE: Purchase = {
  id: PURCHASE_ID,
  tenantId: "tenant-a",
  supplierId: SUPPLIER_ID,
  status: "DRAFT",
  lines: [
    { id: "line-1", catalogItemId: ITEM_ID, quantity: "2.000", unitCost: "1500.00" },
    {
      id: "line-2",
      catalogItemId: "44444444-4444-4444-8444-444444444444",
      quantity: "1.000",
      unitCost: null,
    },
  ],
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
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

describe("purchases-api transport contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listPurchases GETs /api/purchases with no filter when none is given", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([PURCHASE])));
    global.fetch = fetchMock;

    await expect(listPurchases()).resolves.toEqual([PURCHASE]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe("/api/purchases");
    expect(init).toMatchObject({ cache: "no-store" });
    expect(init.method).toBeUndefined();
    // No tenant, role or permission header is invented by the client either.
    expect(init.headers).toBeUndefined();
  });

  it("listPurchases serializes the lifecycle filter as status", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock;

    await listPurchases({ status: "RECEIVED" });

    const [input] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL];
    expect(resolveRequestUrl(input)).toBe("/api/purchases?status=RECEIVED");
  });

  it("getPurchase GETs /api/purchases/:id and returns the DTO", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(PURCHASE)));
    global.fetch = fetchMock;

    await expect(getPurchase(PURCHASE_ID)).resolves.toEqual(PURCHASE);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe(`/api/purchases/${PURCHASE_ID}`);
    expect(init).toMatchObject({ cache: "no-store" });
  });

  it("createPurchase POSTs the supplier and line set to the collection root", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(PURCHASE, 201)));
    global.fetch = fetchMock;

    const body = {
      supplierId: SUPPLIER_ID,
      lines: [{ catalogItemId: ITEM_ID, quantity: "2.000", unitCost: "1500.00" }],
    };
    await expect(createPurchase(body)).resolves.toEqual(PURCHASE);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe("/api/purchases");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(init.body).toBe(JSON.stringify(body));
  });

  it("updatePurchase PUTs the whole desired line set to /api/purchases/:id", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(PURCHASE)));
    global.fetch = fetchMock;

    const body = {
      supplierId: SUPPLIER_ID,
      lines: [{ catalogItemId: ITEM_ID, quantity: "3.000" }],
    };
    await expect(updatePurchase(PURCHASE_ID, body)).resolves.toEqual(PURCHASE);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe(`/api/purchases/${PURCHASE_ID}`);
    expect(init.method).toBe("PUT");
    // The update body never carries a status: the lifecycle has its own commands.
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect(JSON.parse(init.body as string)).not.toHaveProperty("status");
  });

  it("cancelPurchase POSTs to the cancel command with an empty body", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ ...PURCHASE, status: "CANCELLED" }, 201))
    );
    global.fetch = fetchMock;

    await expect(cancelPurchase(PURCHASE_ID)).resolves.toMatchObject({ status: "CANCELLED" });

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe(`/api/purchases/${PURCHASE_ID}/cancel`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
  });

  it("receivePurchase POSTs to the receive command with an empty body", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ ...PURCHASE, status: "RECEIVED" }, 201))
    );
    global.fetch = fetchMock;

    await expect(receivePurchase(PURCHASE_ID)).resolves.toMatchObject({ status: "RECEIVED" });

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe(`/api/purchases/${PURCHASE_ID}/receive`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
  });

  it("surfaces the stable error code and status on 404", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "NOT_FOUND", message: "Purchase was not found." } }, 404)
      )
    );
    global.fetch = fetchMock;

    const error = await getPurchase("missing").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe("NOT_FOUND");
    expect((error as ApiRequestError).status).toBe(404);
    expect(isPurchaseNotFound(error as Error)).toBe(true);
    expect(userFacingPurchaseError(error as Error)).toBe("Purchase not found.");
  });

  it("classifies each receive conflict by its stable value-free message", async () => {
    const cases = [
      {
        message: PURCHASE_NOT_EDITABLE_MESSAGE,
        matches: isPurchaseNotEditableConflict,
      },
      {
        message: PURCHASE_ITEM_INACTIVE_MESSAGE,
        matches: isPurchaseInactiveItemConflict,
      },
      {
        message: PURCHASE_ITEM_NOT_TRACKED_MESSAGE,
        matches: isPurchaseUntrackedItemConflict,
      },
    ] as const;

    for (const testCase of cases) {
      const fetchMock = vi.fn(() =>
        Promise.resolve(
          jsonResponse({ error: { code: "CONFLICT", message: testCase.message } }, 409)
        )
      );
      global.fetch = fetchMock;

      const error = (await receivePurchase(PURCHASE_ID).catch(
        (caught: unknown) => caught
      )) as ApiRequestError;

      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error.code).toBe("CONFLICT");
      expect(error.status).toBe(409);
      expect(isPurchaseConflict(error)).toBe(true);
      expect(testCase.matches(error)).toBe(true);
      // The conflict copy never echoes a stored quantity, cost or id.
      expect(error.message).not.toContain("2.000");
      expect(error.message).not.toContain(ITEM_ID);
      expect(userFacingPurchaseError(error)).toBe(testCase.message);
    }
  });

  it("keeps the three conflict conditions distinguishable from one another", () => {
    const notEditable = new ApiRequestError("CONFLICT", PURCHASE_NOT_EDITABLE_MESSAGE, 409);
    const inactive = new ApiRequestError("CONFLICT", PURCHASE_ITEM_INACTIVE_MESSAGE, 409);
    const untracked = new ApiRequestError("CONFLICT", PURCHASE_ITEM_NOT_TRACKED_MESSAGE, 409);

    expect(isPurchaseNotEditableConflict(notEditable)).toBe(true);
    expect(isPurchaseInactiveItemConflict(notEditable)).toBe(false);
    expect(isPurchaseUntrackedItemConflict(notEditable)).toBe(false);

    expect(isPurchaseInactiveItemConflict(inactive)).toBe(true);
    expect(isPurchaseNotEditableConflict(inactive)).toBe(false);
    expect(isPurchaseUntrackedItemConflict(inactive)).toBe(false);

    expect(isPurchaseUntrackedItemConflict(untracked)).toBe(true);
    expect(isPurchaseNotEditableConflict(untracked)).toBe(false);
    expect(isPurchaseInactiveItemConflict(untracked)).toBe(false);

    // A conflict with an unrecognized message is still a conflict, just unclassified.
    const unknown = new ApiRequestError("CONFLICT", "Something else.", 409);
    expect(isPurchaseConflict(unknown)).toBe(true);
    expect(isPurchaseNotEditableConflict(unknown)).toBe(false);
  });

  it("classifies only a FORBIDDEN as the permission refusal", () => {
    expect(
      isPurchasePermissionDenied(new ApiRequestError("FORBIDDEN", "Access denied.", 403))
    ).toBe(true);
    expect(
      isPurchasePermissionDenied(
        new ApiRequestError("CONFLICT", PURCHASE_NOT_EDITABLE_MESSAGE, 409)
      )
    ).toBe(false);
    expect(
      isPurchasePermissionDenied(new ApiRequestError("UNAUTHENTICATED", "Sign in.", 401))
    ).toBe(false);
  });

  it("identifies a transport failure that never reached the API", () => {
    expect(isPurchaseTransportError(new TypeError("Failed to fetch"))).toBe(true);
    expect(
      isPurchaseTransportError(new ApiRequestError("CONFLICT", PURCHASE_NOT_EDITABLE_MESSAGE, 409))
    ).toBe(false);
  });

  it("falls back to UNKNOWN when the failure carries no envelope", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("boom", { status: 500 })));
    global.fetch = fetchMock;

    const error = await listPurchases().catch((caught: unknown) => caught);

    expect((error as ApiRequestError).code).toBe("UNKNOWN");
    expect((error as ApiRequestError).status).toBe(500);
  });

  it("maps permission, not-found and transport failures to distinct staff-facing copy", () => {
    expect(userFacingPurchaseError(new ApiRequestError("FORBIDDEN", "Access denied.", 403))).toBe(
      "You do not have permission to manage purchases."
    );
    expect(
      userFacingPurchaseError(new ApiRequestError("NOT_FOUND", "Resource was not found.", 404))
    ).toBe("Purchase not found.");
    expect(
      userFacingPurchaseError(
        new ApiRequestError("UNAUTHENTICATED", "Authentication required.", 401)
      )
    ).toBe("You must be signed in to view purchases.");
    expect(userFacingPurchaseError(new TypeError("Failed to fetch"))).toBe(
      "The request could not reach the server. Check your connection and try again."
    );
    // An unmapped code keeps the server message instead of inventing a cause.
    expect(
      userFacingPurchaseError(new ApiRequestError("VALIDATION_FAILED", "Bad body.", 400))
    ).toBe("Bad body.");
  });

  it("never writes a purchase payload to the console on success or conflict", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
    ];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(PURCHASE, 201))
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "CONFLICT", message: PURCHASE_NOT_EDITABLE_MESSAGE } }, 409)
      );
    global.fetch = fetchMock;

    // The whole INTERNAL purchase payload flows through both calls.
    const payload = {
      supplierId: PURCHASE.supplierId,
      lines: PURCHASE.lines.map((line) => ({
        catalogItemId: line.catalogItemId,
        quantity: line.quantity,
        unitCost: line.unitCost,
      })),
    };
    await createPurchase(payload);
    await receivePurchase(PURCHASE_ID).catch(() => undefined);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
