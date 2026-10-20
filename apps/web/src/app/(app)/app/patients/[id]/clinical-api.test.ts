/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  amendEncounter,
  closeEncounter,
  createDeworming,
  createEncounter,
  createVaccination,
  getEncounter,
  isClinicalConflict,
  isClinicalPermissionDenied,
  listDeworming,
  listEncounters,
  listVaccinations,
  toClientSafeEncounter,
  updateDeworming,
  updateDraft,
  updateVaccination,
  userFacingClinicalError,
  type ClinicalDeworming,
  type ClinicalEncounter,
  type ClinicalVaccination,
} from "./clinical-api";

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const ENCOUNTER_ID = "22222222-2222-4222-8222-222222222222";
const VACCINATION_ID = "33333333-3333-4333-8333-333333333333";
const DEWORMING_ID = "44444444-4444-4444-8444-444444444444";
const ADMINISTERED_AT = "2026-10-19T12:30:00.000Z";
const DUE_AT = "2027-10-19T12:30:00.000Z";

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

const VACCINATION: ClinicalVaccination = {
  id: VACCINATION_ID,
  tenantId: "tenant-a",
  patientId: PATIENT_ID,
  vaccine: "Rabies",
  administeredAt: ADMINISTERED_AT,
  nextDueAt: DUE_AT,
  createdAt: ADMINISTERED_AT,
  updatedAt: ADMINISTERED_AT,
};

const DEWORMING: ClinicalDeworming = {
  id: DEWORMING_ID,
  tenantId: "tenant-a",
  patientId: PATIENT_ID,
  product: "Praziquantel",
  administeredAt: ADMINISTERED_AT,
  nextDueAt: null,
  createdAt: ADMINISTERED_AT,
  updatedAt: ADMINISTERED_AT,
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

/**
 * The specialized-record client (EPIC-18 REP-010). The proxy, the permissions
 * and the API already existed; what these tests pin down is the REQUEST SHAPE
 * the staff surface sends, including the explicit `null` that clears a due date
 * (DEC-065) and the shared error mapping the section reuses.
 */
describe("clinical specialized record contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listVaccinations GETs the patient-anchored vaccinations path", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([VACCINATION])));
    global.fetch = fetchMock;

    await expect(listVaccinations(PATIENT_ID)).resolves.toEqual([VACCINATION]);

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`/api/clinical/${PATIENT_ID}/vaccinations`);
    expect(call.init).toMatchObject({ cache: "no-store" });
    expect(call.init.method).toBeUndefined();
  });

  it("createVaccination POSTs the vaccine, the administered instant and the due instant", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(VACCINATION, 201)));
    global.fetch = fetchMock;

    await createVaccination(PATIENT_ID, {
      vaccine: "Rabies",
      administeredAt: ADMINISTERED_AT,
      nextDueAt: DUE_AT,
    });

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`/api/clinical/${PATIENT_ID}/vaccinations`);
    expect(call.init.method).toBe("POST");
    expect(call.body).toEqual({
      vaccine: "Rabies",
      administeredAt: ADMINISTERED_AT,
      nextDueAt: DUE_AT,
    });
  });

  it("createVaccination omits nextDueAt when no due date was entered", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ ...VACCINATION, nextDueAt: null }, 201))
    );
    global.fetch = fetchMock;

    await createVaccination(PATIENT_ID, { vaccine: "Rabies", administeredAt: ADMINISTERED_AT });

    // The create body never carries `nextDueAt: null`: the API's create schema
    // accepts an ABSENT key as "no due date" and rejects null there.
    const call = lastCall(fetchMock);
    expect(call.body).toEqual({
      vaccine: "Rabies",
      administeredAt: ADMINISTERED_AT,
    });
    // The key is absent from the serialized JSON, not present with a null value.
    const rawBody = call.init.body;
    const keys =
      typeof rawBody === "string"
        ? Object.keys(JSON.parse(rawBody) as Record<string, unknown>).sort()
        : [];
    expect(keys).toEqual(["administeredAt", "vaccine"]);
  });

  it("updateVaccination PUTs a corrected due instant to the item path", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(VACCINATION)));
    global.fetch = fetchMock;

    await updateVaccination(PATIENT_ID, VACCINATION_ID, {
      vaccine: "Rabies (booster)",
      administeredAt: ADMINISTERED_AT,
      nextDueAt: DUE_AT,
    });

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`/api/clinical/${PATIENT_ID}/vaccinations/${VACCINATION_ID}`);
    expect(call.init.method).toBe("PUT");
    expect(call.body).toEqual({
      vaccine: "Rabies (booster)",
      administeredAt: ADMINISTERED_AT,
      nextDueAt: DUE_AT,
    });
  });

  it("updateVaccination serializes an explicit null that clears the due date", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ ...VACCINATION, nextDueAt: null }))
    );
    global.fetch = fetchMock;

    await updateVaccination(PATIENT_ID, VACCINATION_ID, { nextDueAt: null });

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`/api/clinical/${PATIENT_ID}/vaccinations/${VACCINATION_ID}`);
    // The serialized body must carry the JSON null, not an omitted key and not
    // an empty string: `null` is the documented way to REMOVE a wrong due date.
    expect(call.init.body).toBe('{"nextDueAt":null}');
    expect(call.body).toEqual({ nextDueAt: null });
  });

  it("listDeworming GETs the patient-anchored deworming path", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([DEWORMING])));
    global.fetch = fetchMock;

    await expect(listDeworming(PATIENT_ID)).resolves.toEqual([DEWORMING]);

    expect(lastCall(fetchMock).url).toBe(`/api/clinical/${PATIENT_ID}/deworming`);
  });

  it("createDeworming POSTs the product and the administered instant", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(DEWORMING, 201)));
    global.fetch = fetchMock;

    await createDeworming(PATIENT_ID, {
      product: "Praziquantel",
      administeredAt: ADMINISTERED_AT,
      nextDueAt: DUE_AT,
    });

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`/api/clinical/${PATIENT_ID}/deworming`);
    expect(call.init.method).toBe("POST");
    expect(call.body).toEqual({
      product: "Praziquantel",
      administeredAt: ADMINISTERED_AT,
      nextDueAt: DUE_AT,
    });
  });

  it("updateDeworming PUTs an explicit null that clears the due date", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(DEWORMING)));
    global.fetch = fetchMock;

    await updateDeworming(PATIENT_ID, DEWORMING_ID, { nextDueAt: null });

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`/api/clinical/${PATIENT_ID}/deworming/${DEWORMING_ID}`);
    expect(call.init.method).toBe("PUT");
    expect(call.body).toEqual({ nextDueAt: null });
  });

  it("surfaces a 400 validation message verbatim instead of a generic failure", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          { error: { code: "VALIDATION_FAILED", message: "Invalid vaccination body." } },
          400
        )
      )
    );
    global.fetch = fetchMock;

    const error = (await rejectionOf(
      createVaccination(PATIENT_ID, { vaccine: "", administeredAt: ADMINISTERED_AT })
    )) as ApiRequestError;

    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.status).toBe(400);
    expect(userFacingClinicalError(error)).toBe("Invalid vaccination body.");
    expect(isClinicalConflict(error)).toBe(false);
    expect(isClinicalPermissionDenied(error)).toBe(false);
  });

  it("reuses the shared permission mapping for a 403 on a vaccination write", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403))
    );
    global.fetch = fetchMock;

    const error = (await rejectionOf(
      updateVaccination(PATIENT_ID, VACCINATION_ID, { nextDueAt: null })
    )) as ApiRequestError;

    expect(error.status).toBe(403);
    expect(isClinicalPermissionDenied(error)).toBe(true);
    expect(userFacingClinicalError(error)).toBe(
      "You do not have permission to manage clinical records."
    );
  });

  it("distinguishes a 409 conflict from a validation failure", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "CONFLICT", message: "Changed elsewhere." } }, 409)
      )
    );
    global.fetch = fetchMock;

    const error = (await rejectionOf(
      createDeworming(PATIENT_ID, { product: "Praziquantel", administeredAt: ADMINISTERED_AT })
    )) as ApiRequestError;

    expect(error.code).toBe("CONFLICT");
    expect(isClinicalConflict(error)).toBe(true);
    expect(userFacingClinicalError(error)).toBe("Changed elsewhere.");
  });

  it("rejects a malformed vaccination id before any request", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    const error = (await rejectionOf(
      updateVaccination(PATIENT_ID, "vacc-1", { nextDueAt: null })
    )) as ApiRequestError;

    expect(error.code).toBe("INVALID_IDENTIFIER");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed patient id on a deworming write before any request", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    const error = (await rejectionOf(
      createDeworming("not-a-uuid", { product: "Praziquantel", administeredAt: ADMINISTERED_AT })
    )) as ApiRequestError;

    expect(error.code).toBe("INVALID_IDENTIFIER");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends no tenant or patient authority in the body", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(VACCINATION, 201)));
    global.fetch = fetchMock;

    await createVaccination(PATIENT_ID, {
      vaccine: "Rabies",
      administeredAt: ADMINISTERED_AT,
      nextDueAt: DUE_AT,
    });

    const body = lastCall(fetchMock).body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["administeredAt", "nextDueAt", "vaccine"]);
    expect(body).not.toHaveProperty("tenantId");
    expect(body).not.toHaveProperty("patientId");
  });
});
