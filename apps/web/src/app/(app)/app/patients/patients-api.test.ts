/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  getGuardian,
  createPatient,
  updatePatient,
  patientWriteBlocked,
  userFacingPatientError,
  type PatientGuardian,
} from "./patients-api";

const GUARDIAN: PatientGuardian = {
  id: "guardian-1",
  tenantId: "tenant-a",
  patientId: "patient-1",
  customerId: "customer-1",
  isPrimary: true,
  isActive: true,
  position: 0,
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
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

describe("patients-api guardian contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getGuardian GETs /patients/:patientId/guardians/:id and returns the DTO", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(GUARDIAN)));
    global.fetch = fetchMock;

    await expect(getGuardian("patient-1", "guardian-1")).resolves.toEqual(GUARDIAN);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveRequestUrl(input)).toBe("/api/patients/patient-1/guardians/guardian-1");
    expect(init).toMatchObject({ cache: "no-store" });
    expect(init.method).toBeUndefined();
  });

  it("getGuardian surfaces the stable error code and status on 404", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          { error: { code: "NOT_FOUND", message: "Patient guardian was not found." } },
          404
        )
      )
    );
    global.fetch = fetchMock;

    const error = await getGuardian("patient-1", "guardian-x").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe("NOT_FOUND");
    expect((error as ApiRequestError).status).toBe(404);
  });
});

describe("patient identity command acknowledgements", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([400, 401, 403, 404, 409, 500, 408])(
    "sanitizes HTTP %s while retaining status and outcome",
    async (status) => {
      global.fetch = vi.fn(() =>
        Promise.resolve(jsonResponse({ error: { message: "PRIVATE patient data" } }, status))
      );
      const error = await createPatient({ name: "synthetic" }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).status).toBe(status);
      expect(userFacingPatientError(error)).not.toContain("PRIVATE");
      expect(patientWriteBlocked(error)).toBe([401, 403, 404, 500, 408].includes(status));
      expect(global.fetch).toHaveBeenCalledOnce();
    }
  );
  it.each([null, {}, [], { id: 123 }])(
    "treats malformed success %j as uncertain and never replays",
    async (body) => {
      global.fetch = vi.fn(() => Promise.resolve(jsonResponse(body)));
      const error = await updatePatient("p", { name: "new" }).catch((e: unknown) => e);
      expect(patientWriteBlocked(error)).toBe(true);
      expect(global.fetch).toHaveBeenCalledOnce();
    }
  );
  it("preserves the exact command and disables caching", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ id: "confirmed" })));
    await updatePatient("p", { breedId: null, birthDate: null });
    expect(global.fetch).toHaveBeenCalledWith("/api/patients/p", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: '{"breedId":null,"birthDate":null}',
      cache: "no-store",
    });
  });
  it("marks lost command response uncertain but a failed read can be retried", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("private transport")));
    const write = await createPatient({}).catch((e: unknown) => e);
    const read = await getGuardian("p", "g").catch((e: unknown) => e);
    expect(patientWriteBlocked(write)).toBe(true);
    expect(patientWriteBlocked(read)).toBe(false);
    expect(userFacingPatientError(write)).not.toContain("private transport");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
