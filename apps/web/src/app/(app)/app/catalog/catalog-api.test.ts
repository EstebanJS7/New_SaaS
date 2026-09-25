/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  createCatalogItem,
  deactivateCatalogItem,
  getCatalogItem,
  listCatalogItems,
  listTaxRates,
  updateCatalogItem,
  userFacingCatalogError,
  type CatalogItem,
} from "./catalog-api";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const RATE_ID = "22222222-2222-4222-8222-222222222222";

const ITEM: CatalogItem = {
  id: ITEM_ID,
  tenantId: "tenant-a",
  kind: "SERVICE",
  name: "Consulta clínica",
  taxRateId: RATE_ID,
  taxRate: { code: "IVA_10", name: "IVA 10%", rate: "0.1" },
  referencePriceAmount: "150000.00",
  referencePriceCurrency: "PYG",
  isActive: true,
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
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

describe("catalog-api transport contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listCatalogItems GETs /api/catalog with no filter when none is given", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([ITEM])));
    global.fetch = fetchMock;

    await expect(listCatalogItems()).resolves.toEqual([ITEM]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe("/api/catalog");
    expect(init).toMatchObject({ cache: "no-store" });
    expect(init.method).toBeUndefined();
  });

  it("listCatalogItems serializes the kind and status filters as kind/isActive", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock;

    await listCatalogItems({ kind: "PRODUCT", isActive: false });

    const [input] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL];
    expect(resolveRequestUrl(input)).toBe("/api/catalog?kind=PRODUCT&isActive=false");
  });

  it("listCatalogItems sends only the filter that was asked for", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock;

    await listCatalogItems({ isActive: true });

    const [input] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL];
    expect(resolveRequestUrl(input)).toBe("/api/catalog?isActive=true");
  });

  it("getCatalogItem GETs /api/catalog/:id and returns the DTO", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(ITEM)));
    global.fetch = fetchMock;

    await expect(getCatalogItem(ITEM_ID)).resolves.toEqual(ITEM);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe(`/api/catalog/${ITEM_ID}`);
    expect(init).toMatchObject({ cache: "no-store" });
  });

  it("listTaxRates GETs /api/catalog/tax-rates", async () => {
    const rates = [{ id: RATE_ID, code: "IVA_10", name: "IVA 10%", rate: "0.1" }];
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(rates)));
    global.fetch = fetchMock;

    await expect(listTaxRates()).resolves.toEqual(rates);

    const [input] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL];
    expect(resolveRequestUrl(input)).toBe("/api/catalog/tax-rates");
  });

  it("createCatalogItem POSTs the body to the collection root", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(ITEM, 201)));
    global.fetch = fetchMock;

    const body = { kind: "SERVICE", name: "Consulta clínica", taxRateId: RATE_ID };
    await expect(createCatalogItem(body)).resolves.toEqual(ITEM);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe("/api/catalog");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(init.body).toBe(JSON.stringify(body));
  });

  it("updateCatalogItem PUTs the body to /api/catalog/:id", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(ITEM)));
    global.fetch = fetchMock;

    const body = { name: "Consulta general" };
    await expect(updateCatalogItem(ITEM_ID, body)).resolves.toEqual(ITEM);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe(`/api/catalog/${ITEM_ID}`);
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify(body));
  });

  it("deactivateCatalogItem POSTs to the deactivate command with an empty body", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ...ITEM, isActive: false })));
    global.fetch = fetchMock;

    await expect(deactivateCatalogItem(ITEM_ID)).resolves.toMatchObject({ isActive: false });

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe(`/api/catalog/${ITEM_ID}/deactivate`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
  });

  it("surfaces the stable error code and status on 404", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "NOT_FOUND", message: "Catalog item was not found." } }, 404)
      )
    );
    global.fetch = fetchMock;

    const error = await getCatalogItem("missing").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe("NOT_FOUND");
    expect((error as ApiRequestError).status).toBe(404);
    expect((error as ApiRequestError).message).toBe("Catalog item was not found.");
  });

  it("falls back to UNKNOWN when the failure carries no envelope", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("boom", { status: 500 })));
    global.fetch = fetchMock;

    const error = await listCatalogItems().catch((caught: unknown) => caught);

    expect((error as ApiRequestError).code).toBe("UNKNOWN");
    expect((error as ApiRequestError).status).toBe(500);
  });

  it("maps permission and not-found codes to staff-facing copy", () => {
    expect(userFacingCatalogError(new ApiRequestError("FORBIDDEN", "Access denied.", 403))).toBe(
      "You do not have permission to manage catalog items."
    );
    expect(
      userFacingCatalogError(new ApiRequestError("NOT_FOUND", "Resource was not found.", 404))
    ).toBe("Catalog item not found.");
    // An unmapped code keeps the server message instead of inventing a cause.
    expect(userFacingCatalogError(new ApiRequestError("VALIDATION_FAILED", "Bad rate.", 400))).toBe(
      "Bad rate."
    );
  });
});
