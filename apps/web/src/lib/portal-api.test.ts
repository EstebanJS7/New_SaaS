/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  getPortalMe,
  getPortalPet,
  isPortalDeniedError,
  isPortalNotFoundError,
  listPortalPets,
  userFacingPortalError,
} from "./portal-api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>): [RequestInfo | URL, RequestInit] {
  return fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
}

describe("portal-api contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getPortalMe GETs /api/portal/me with cache: no-store and no method", async () => {
    const me = {
      portal: { portalAccessId: "access-1", customerId: "customer-1" },
      requestId: "r1",
    };
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(me)));
    global.fetch = fetchMock;

    await expect(getPortalMe()).resolves.toEqual(me);

    const [input, init] = lastCall(fetchMock);
    expect(resolveRequestUrl(input)).toBe("/api/portal/me");
    expect(init).toMatchObject({ cache: "no-store" });
    expect(init.method).toBeUndefined();
  });

  it("listPortalPets GETs /api/portal/pets with cache: no-store", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock;

    await expect(listPortalPets()).resolves.toEqual([]);

    const [input, init] = lastCall(fetchMock);
    expect(resolveRequestUrl(input)).toBe("/api/portal/pets");
    expect(init).toMatchObject({ cache: "no-store" });
  });

  it("getPortalPet GETs /api/portal/pets/:id with cache: no-store", async () => {
    const pet = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Rex",
      speciesId: "species-1",
      breedId: null,
      sex: "MALE",
      birthDate: null,
      isActive: true,
      clinical: { encounters: [], vaccinations: [] },
    };
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(pet)));
    global.fetch = fetchMock;

    await expect(getPortalPet(pet.id)).resolves.toEqual(pet);

    const [input, init] = lastCall(fetchMock);
    expect(resolveRequestUrl(input)).toBe(`/api/portal/pets/${pet.id}`);
    expect(init).toMatchObject({ cache: "no-store" });
  });

  it("surfaces the stable error code and status on a 404", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "NOT_FOUND", message: "Portal pet was not found." } }, 404)
      )
    );
    global.fetch = fetchMock;

    const error = await getPortalPet("11111111-1111-4111-8111-111111111111").catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe("NOT_FOUND");
    expect((error as ApiRequestError).status).toBe(404);
    expect(isPortalNotFoundError(error)).toBe(true);
    expect(isPortalDeniedError(error)).toBe(false);
  });

  it("classifies FORBIDDEN and FEATURE_NOT_ENTITLED as denied", () => {
    expect(isPortalDeniedError(new ApiRequestError("FORBIDDEN", "nope", 403))).toBe(true);
    expect(isPortalDeniedError(new ApiRequestError("FEATURE_NOT_ENTITLED", "nope", 403))).toBe(
      true
    );
    expect(isPortalDeniedError(new ApiRequestError("UNAUTHENTICATED", "nope", 401))).toBe(false);
    expect(isPortalDeniedError(new Error("boom"))).toBe(false);
  });
});

describe("userFacingPortalError", () => {
  it("never echoes the server message text for a known or unknown code", () => {
    const known = new ApiRequestError("NOT_FOUND", "Portal pet was not found.", 404);
    expect(userFacingPortalError(known)).not.toContain("Portal pet was not found.");

    const unknown = new ApiRequestError("SOMETHING_NEW", "raw upstream detail", 500);
    const copy = userFacingPortalError(unknown);
    expect(copy).not.toContain("raw upstream detail");
    expect(copy).toBe("Something went wrong. Please try again.");
  });

  it("maps denied codes to distinct copy", () => {
    expect(userFacingPortalError(new ApiRequestError("FORBIDDEN", "x", 403))).toBe(
      "You do not have access to this portal."
    );
    expect(userFacingPortalError(new ApiRequestError("FEATURE_NOT_ENTITLED", "x", 403))).toBe(
      "The client portal is not available for this clinic."
    );
  });

  it("treats a masked not-found as uncertain rather than claiming the pet exists elsewhere", () => {
    const copy = userFacingPortalError(new ApiRequestError("NOT_FOUND", "x", 404));
    expect(copy).toContain("may not exist");
    expect(copy).toContain("may not be linked to your account");
  });
});
