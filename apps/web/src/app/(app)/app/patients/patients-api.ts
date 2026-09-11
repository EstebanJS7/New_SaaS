"use client";

export type PatientSex = "MALE" | "FEMALE" | "UNKNOWN";

/** Allowlisted Patient DTO mirrored from the WU3 API contract. */
export interface Patient {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly speciesId: string;
  readonly breedId: string | null;
  readonly sex: PatientSex;
  readonly birthDate: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Allowlisted PatientGuardian DTO; references the Core Customer by id only. */
export interface PatientGuardian {
  readonly id: string;
  readonly tenantId: string;
  readonly patientId: string;
  readonly customerId: string;
  readonly isPrimary: boolean;
  readonly isActive: boolean;
  readonly position: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BreedCatalogEntry {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface SpeciesCatalogEntry {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly breeds: readonly BreedCatalogEntry[];
}

interface ApiErrorEnvelope {
  readonly error: {
    readonly code?: string;
    readonly message?: string;
  };
}

/**
 * Carries the stable API error code so the UI branches on the contract instead
 * of fragile message matching. `message` remains the server-provided text.
 */
export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
  }
}

async function parseError(response: Response): Promise<ApiRequestError> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorEnvelope;
  return new ApiRequestError(
    body.error?.code ?? "UNKNOWN",
    body.error?.message ?? `Request failed (${response.status})`,
    response.status
  );
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api/patients${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/patients${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/patients${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

export function listPatients(): Promise<Patient[]> {
  return getJson("");
}

export function getPatient(id: string): Promise<Patient> {
  return getJson(`/${id}`);
}

export function getCatalog(): Promise<SpeciesCatalogEntry[]> {
  return getJson("/catalog");
}

export function createPatient(body: unknown): Promise<Patient> {
  return postJson("", body);
}

export function updatePatient(id: string, body: unknown): Promise<Patient> {
  return putJson(`/${id}`, body);
}

export function deactivatePatient(id: string): Promise<Patient> {
  return postJson(`/${id}/deactivate`, {});
}

export function listGuardians(patientId: string): Promise<PatientGuardian[]> {
  return getJson(`/${patientId}/guardians`);
}

export function getGuardian(patientId: string, id: string): Promise<PatientGuardian> {
  return getJson(`/${patientId}/guardians/${id}`);
}

export function createGuardian(patientId: string, body: unknown): Promise<PatientGuardian> {
  return postJson(`/${patientId}/guardians`, body);
}

export function updateGuardian(
  patientId: string,
  id: string,
  body: unknown
): Promise<PatientGuardian> {
  return putJson(`/${patientId}/guardians/${id}`, body);
}

export function setPrimaryGuardian(patientId: string, id: string): Promise<PatientGuardian> {
  return postJson(`/${patientId}/guardians/${id}/primary`, {});
}

export function deactivateGuardian(patientId: string, id: string): Promise<PatientGuardian> {
  return postJson(`/${patientId}/guardians/${id}/deactivate`, {});
}

/**
 * Maps the stable `patients.*` error contract to staff-facing UX copy.
 *
 * These messages are UX-only; the backend still enforces every gate, and any
 * unmapped code falls through to the server message.
 */
export function userFacingPatientError(error: Error): string {
  const code = error instanceof ApiRequestError ? error.code : "";
  switch (code) {
    case "UNAUTHENTICATED":
      return "You must be signed in to view patients.";
    case "FORBIDDEN":
      return "You do not have permission to manage patients.";
    case "FEATURE_NOT_ENTITLED":
      return "The veterinary module is not enabled for this tenant.";
    case "NOT_FOUND":
      return "Patient not found.";
    default:
      return error.message;
  }
}
