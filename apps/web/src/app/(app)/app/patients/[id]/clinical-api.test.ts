/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  amendEncounter,
  closeEncounter,
  createEncounter,
  getEncounter,
  isClinicalConflict,
  isClinicalPermissionDenied,
  listEncounters,
  toClientSafeEncounter,
  updateDraft,
  userFacingClinicalError,
  type ClinicalEncounter,
} from "./clinical-api";

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const ENCOUNTER_ID = "22222222-2222-4222-8222-222222222222";

const ENCOUNTER: ClinicalEncounter = {
  id: ENCOUNTER_ID,
  tenantId: "tenant-a",
  patientId: PATIENT_ID,
  status: "DRAFT",
  version: 3,
  reasonForVisit: "Limping",
  anamnesis: "Started two days ago",
  diagnosis: "Soft tissue injury",
  treatmentPlan: "Rest and NSAIDs",
  internalNotes: "Suspected owner non-compliance",
  clientSummary: "Mild sprain; rest and recheck in a week.",
  amendsEncounterId: null,
  amendmentReason: null,
  closedAt: null,
  closedByUserProfileId: null,
  createdAt: "2026-09-12T00:00:00.000Z",
  updatedAt: "2026-09-12T00:00:00.000Z",
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

function lastCall(fetchMock: ReturnType<typeof vi.fn>): {
  url: string;
  init: RequestInit;
  body: unknown;
} {
  const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
  const rawBody = init.body;
  return {
    url: resolveRequestUrl(input),
    init,
    body: typeof rawBody === "string" ? JSON.parse(rawBody) : undefined,
  };
}

/** Captures a rejection so a test can assert on the error value. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((caught: unknown) => caught);
}

describe("clinical-api contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listEncounters GETs the patient-anchored proxy path", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([ENCOUNTER])));
    global.fetch = fetchMock;

    await expect(listEncounters(PATIENT_ID)).resolves.toEqual([ENCOUNTER]);

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`/api/clinical/${PATIENT_ID}/encounters`);
    expect(call.init).toMatchObject({ cache: "no-store" });
    expect(call.init.method).toBeUndefined();
  });

  it("getEncounter GETs the patient-anchored item path", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(ENCOUNTER)));
    global.fetch = fetchMock;

    await getEncounter(PATIENT_ID, ENCOUNTER_ID);

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`/api/clinical/${PATIENT_ID}/encounters/${ENCOUNTER_ID}`);
    expect(call.init.method).toBeUndefined();
  });

  it("createEncounter POSTs the create body", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(ENCOUNTER, 201)));
    global.fetch = fetchMock;

    await createEncounter(PATIENT_ID, { reasonForVisit: "Limping" });

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`/api/clinical/${PATIENT_ID}/encounters`);
    expect(call.init.method).toBe("POST");
    expect(call.body).toEqual({ reasonForVisit: "Limping" });
  });

  it("updateDraft PUTs content plus the last-read version", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ...ENCOUNTER, version: 4 })));
    global.fetch = fetchMock;

    await updateDraft(PATIENT_ID, ENCOUNTER_ID, { ...ENCOUNTER, version: 3 });

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`/api/clinical/${PATIENT_ID}/encounters/${ENCOUNTER_ID}`);
    expect(call.init.method).toBe("PUT");
    expect(call.body).toMatchObject({ version: 3, diagnosis: "Soft tissue injury" });
  });

  it("closeEncounter POSTs only the version to the close command", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ ...ENCOUNTER, status: "CLOSED" }))
    );
    global.fetch = fetchMock;

    await closeEncounter(PATIENT_ID, ENCOUNTER_ID, 3);

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`/api/clinical/${PATIENT_ID}/encounters/${ENCOUNTER_ID}/close`);
    expect(call.init.method).toBe("POST");
    expect(call.body).toEqual({ version: 3 });
  });

  it("amendEncounter POSTs the reason to the amendments command", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ ...ENCOUNTER, id: "enc-2", status: "CLOSED" }, 201))
    );
    global.fetch = fetchMock;

    await amendEncounter(PATIENT_ID, ENCOUNTER_ID, { reason: "Correct the diagnosis" });

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`/api/clinical/${PATIENT_ID}/encounters/${ENCOUNTER_ID}/amendments`);
    expect(call.init.method).toBe("POST");
    expect(call.body).toEqual({ reason: "Correct the diagnosis" });
  });

  it("surfaces the stable error code and maps permission denials", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403))
    );
    global.fetch = fetchMock;

    const error = await listEncounters(PATIENT_ID).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe("FORBIDDEN");
    expect((error as ApiRequestError).status).toBe(403);
    expect(isClinicalPermissionDenied(error as Error)).toBe(true);
    expect(userFacingClinicalError(error as Error)).toBe(
      "You do not have permission to manage clinical records."
    );
  });

  it("classifies a 409 as a clinical conflict", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "CONFLICT", message: "Updated elsewhere." } }, 409)
      )
    );
    global.fetch = fetchMock;

    const error = await closeEncounter(PATIENT_ID, ENCOUNTER_ID, 1).catch(
      (caught: unknown) => caught
    );

    expect(isClinicalConflict(error as Error)).toBe(true);
    expect(isClinicalPermissionDenied(error as Error)).toBe(false);
  });

  it("toClientSafeEncounter strips the staff-only internal notes", () => {
    const clientSafe = toClientSafeEncounter(ENCOUNTER);

    expect(clientSafe).not.toHaveProperty("internalNotes");
    expect(clientSafe.clientSummary).toBe(ENCOUNTER.clientSummary);
    // The input is never mutated.
    expect(ENCOUNTER.internalNotes).toBe("Suspected owner non-compliance");
  });

  describe("identifier validation", () => {
    it("rejects a malformed patient id before any request", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      const error = await rejectionOf(listEncounters("not-a-uuid"));

      expect(error).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).code).toBe("INVALID_IDENTIFIER");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects an empty patient id before any request", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      const error = await rejectionOf(createEncounter(""));

      expect(error).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).code).toBe("INVALID_IDENTIFIER");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a malformed encounter id before any request", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      const error = await rejectionOf(getEncounter(PATIENT_ID, "enc-1"));

      expect(error).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).code).toBe("INVALID_IDENTIFIER");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a malformed encounter id on a command before any request", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      const error = await rejectionOf(closeEncounter(PATIENT_ID, "", 1));

      expect(error).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).code).toBe("INVALID_IDENTIFIER");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("error normalization", () => {
    it("converts a rejected fetch into a stable ApiRequestError, not a TypeError", async () => {
      const fetchMock = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
      global.fetch = fetchMock;

      const error = await rejectionOf(listEncounters(PATIENT_ID));

      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error).not.toBeInstanceOf(TypeError);
      expect((error as ApiRequestError).code).toBe("NETWORK_ERROR");
      expect((error as ApiRequestError).status).toBe(0);
    });

    it("normalizes a null JSON error body to UNKNOWN", async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve(
          new Response("null", { status: 500, headers: { "content-type": "application/json" } })
        )
      );
      global.fetch = fetchMock;

      const error = await rejectionOf(listEncounters(PATIENT_ID));

      expect(error).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).code).toBe("UNKNOWN");
      expect((error as ApiRequestError).status).toBe(500);
    });

    it("normalizes an invalid JSON error body to UNKNOWN", async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve(
          new Response("not-json", { status: 502, headers: { "content-type": "text/html" } })
        )
      );
      global.fetch = fetchMock;

      const error = await rejectionOf(listEncounters(PATIENT_ID));

      expect(error).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).code).toBe("UNKNOWN");
      expect((error as ApiRequestError).status).toBe(502);
    });

    it("normalizes a non-envelope JSON error body to UNKNOWN", async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve(jsonResponse({ message: "no envelope here" }, 500))
      );
      global.fetch = fetchMock;

      const error = await rejectionOf(listEncounters(PATIENT_ID));

      expect(error).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).code).toBe("UNKNOWN");
      expect((error as ApiRequestError).message).toBe("Request failed (500)");
    });

    it("normalizes an array JSON error body to UNKNOWN", async () => {
      const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(["oops"], 500)));
      global.fetch = fetchMock;

      const error = await rejectionOf(listEncounters(PATIENT_ID));

      expect(error).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).code).toBe("UNKNOWN");
    });

    it("normalizes an unreadable success body to MALFORMED_RESPONSE", async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve(
          new Response("{", { status: 200, headers: { "content-type": "application/json" } })
        )
      );
      global.fetch = fetchMock;

      const error = await rejectionOf(listEncounters(PATIENT_ID));

      expect(error).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).code).toBe("MALFORMED_RESPONSE");
    });
  });
});
