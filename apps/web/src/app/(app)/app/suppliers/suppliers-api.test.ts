/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  createSupplier,
  deactivateSupplier,
  getSupplier,
  isSupplierConflict,
  isSupplierPermissionDenied,
  listSuppliers,
  updateSupplier,
  userFacingSupplierError,
  type Supplier,
} from "./suppliers-api";

const SUPPLIER_ID = "11111111-1111-4111-8111-111111111111";

const SUPPLIER: Supplier = {
  id: SUPPLIER_ID,
  tenantId: "tenant-a",
  name: "Distribuidora Central",
  legalName: "Distribuidora Central S.A.",
  taxId: "80012345-6",
  email: "compras@distribuidora.example",
  phone: "+595981123456",
  address: "Av. Mcal. López 1234, Asunción",
  isActive: true,
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
};

const CONFLICT_MESSAGE = "A supplier with this tax identifier already exists in this tenant.";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

describe("suppliers-api transport contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listSuppliers GETs /api/suppliers with no filter when none is given", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([SUPPLIER])));
    global.fetch = fetchMock;

    await expect(listSuppliers()).resolves.toEqual([SUPPLIER]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe("/api/suppliers");
    expect(init).toMatchObject({ cache: "no-store" });
    expect(init.method).toBeUndefined();
    // No tenant, role or permission header is invented by the client either.
    expect(init.headers).toBeUndefined();
  });

  it("listSuppliers serializes the status filter as isActive", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock;

    await listSuppliers({ isActive: false });

    const [input] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL];
    expect(resolveRequestUrl(input)).toBe("/api/suppliers?isActive=false");
  });

  it("listSuppliers sends the status filter that was asked for, including active-only", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock;

    await listSuppliers({ isActive: true });

    const [input] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL];
    expect(resolveRequestUrl(input)).toBe("/api/suppliers?isActive=true");
  });

  it("getSupplier GETs /api/suppliers/:id and returns the DTO", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(SUPPLIER)));
    global.fetch = fetchMock;

    await expect(getSupplier(SUPPLIER_ID)).resolves.toEqual(SUPPLIER);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe(`/api/suppliers/${SUPPLIER_ID}`);
    expect(init).toMatchObject({ cache: "no-store" });
  });

  it("createSupplier POSTs the body to the collection root", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(SUPPLIER, 201)));
    global.fetch = fetchMock;

    const body = { name: "Distribuidora Central", taxId: "80012345-6" };
    await expect(createSupplier(body)).resolves.toEqual(SUPPLIER);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe("/api/suppliers");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(init.body).toBe(JSON.stringify(body));
  });

  it("updateSupplier PUTs the body to /api/suppliers/:id", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(SUPPLIER)));
    global.fetch = fetchMock;

    const body = { name: "Distribuidora Central S.A." };
    await expect(updateSupplier(SUPPLIER_ID, body)).resolves.toEqual(SUPPLIER);

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe(`/api/suppliers/${SUPPLIER_ID}`);
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify(body));
  });

  it("deactivateSupplier POSTs to the deactivate command with an empty body", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ...SUPPLIER, isActive: false })));
    global.fetch = fetchMock;

    await expect(deactivateSupplier(SUPPLIER_ID)).resolves.toMatchObject({ isActive: false });

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe(`/api/suppliers/${SUPPLIER_ID}/deactivate`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
  });

  it("surfaces the stable error code and status on 404", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "NOT_FOUND", message: "Supplier was not found." } }, 404)
      )
    );
    global.fetch = fetchMock;

    const error = await getSupplier("missing").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe("NOT_FOUND");
    expect((error as ApiRequestError).status).toBe(404);
    expect((error as ApiRequestError).message).toBe("Supplier was not found.");
  });

  it("surfaces the stable, value-free 409 conflict and classifies it", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ error: { code: "CONFLICT", message: CONFLICT_MESSAGE } }, 409))
    );
    global.fetch = fetchMock;

    const error = await createSupplier({ name: "Distribuidora", taxId: "80012345-6" }).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe("CONFLICT");
    expect((error as ApiRequestError).status).toBe(409);
    expect(isSupplierConflict(error as Error)).toBe(true);
    // The conflict copy never echoes the submitted identifier.
    expect((error as ApiRequestError).message).not.toContain("80012345-6");
    expect(userFacingSupplierError(error as Error)).toBe(CONFLICT_MESSAGE);
  });

  it("classifies only a CONFLICT as the identifier conflict", () => {
    expect(
      isSupplierConflict(new ApiRequestError("NOT_FOUND", "Supplier was not found.", 404))
    ).toBe(false);
    expect(isSupplierConflict(new ApiRequestError("FORBIDDEN", "Access denied.", 403))).toBe(false);
    expect(isSupplierConflict(new ApiRequestError("VALIDATION_FAILED", "Bad body.", 400))).toBe(
      false
    );
    expect(isSupplierConflict(new ApiRequestError("CONFLICT", CONFLICT_MESSAGE, 409))).toBe(true);
  });

  it("classifies only a FORBIDDEN as the permission refusal", () => {
    expect(
      isSupplierPermissionDenied(new ApiRequestError("FORBIDDEN", "Access denied.", 403))
    ).toBe(true);
    expect(isSupplierPermissionDenied(new ApiRequestError("CONFLICT", CONFLICT_MESSAGE, 409))).toBe(
      false
    );
    expect(
      isSupplierPermissionDenied(new ApiRequestError("UNAUTHENTICATED", "Sign in.", 401))
    ).toBe(false);
    expect(
      isSupplierPermissionDenied(new ApiRequestError("FEATURE_NOT_ENTITLED", "No.", 403))
    ).toBe(false);
  });

  it("falls back to UNKNOWN when the failure carries no envelope", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("boom", { status: 500 })));
    global.fetch = fetchMock;

    const error = await listSuppliers().catch((caught: unknown) => caught);

    expect((error as ApiRequestError).code).toBe("UNKNOWN");
    expect((error as ApiRequestError).status).toBe(500);
  });

  it("maps permission and not-found codes to staff-facing copy", () => {
    expect(userFacingSupplierError(new ApiRequestError("FORBIDDEN", "Access denied.", 403))).toBe(
      "You do not have permission to manage suppliers."
    );
    expect(
      userFacingSupplierError(new ApiRequestError("NOT_FOUND", "Resource was not found.", 404))
    ).toBe("Supplier not found.");
    expect(
      userFacingSupplierError(
        new ApiRequestError("UNAUTHENTICATED", "Authentication required.", 401)
      )
    ).toBe("You must be signed in to view suppliers.");
    // An unmapped code keeps the server message instead of inventing a cause.
    expect(
      userFacingSupplierError(new ApiRequestError("VALIDATION_FAILED", "Bad body.", 400))
    ).toBe("Bad body.");
  });

  it("never writes a supplier payload to the console on success or conflict", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
    ];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SUPPLIER, 201))
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "CONFLICT", message: CONFLICT_MESSAGE } }, 409)
      );
    global.fetch = fetchMock;

    // The whole CONFIDENTIAL identity/contact set flows through both calls.
    const payload = {
      name: SUPPLIER.name,
      legalName: SUPPLIER.legalName,
      taxId: SUPPLIER.taxId,
      email: SUPPLIER.email,
      phone: SUPPLIER.phone,
      address: SUPPLIER.address,
    };
    await createSupplier(payload);
    await updateSupplier(SUPPLIER_ID, payload).catch(() => undefined);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
