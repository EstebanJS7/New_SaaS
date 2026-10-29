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

export interface PatientSearchRow {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly sex: PatientSex;
  readonly speciesName: string;
  readonly breedName: string | null;
  readonly primaryGuardianName: string | null;
}
export interface PatientSearchInput {
  q: string;
  page: number;
  status: "active" | "inactive" | "all";
  sort: "name" | "recent";
}
export interface PatientSearchResult {
  readonly items: PatientSearchRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly canReadGuardians: boolean;
}
/** Read only; text and paging context never enter URLs or browser storage. */
export async function searchPatients(
  input: PatientSearchInput,
  signal?: AbortSignal
): Promise<PatientSearchResult> {
  const response = await fetch("/api/patients/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw await parseError(response);
  return response.json() as Promise<PatientSearchResult>;
}

export interface PatientIdentity {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly speciesName: string;
  readonly primaryGuardianName: string | null;
}

/** Read-only POST keeps confidential search terms out of URLs and history. */
export function lookupPatients(
  input: { readonly q: string } | { readonly ids: readonly string[] },
  signal?: AbortSignal
): Promise<PatientIdentity[]> {
  return fetch("/api/patients/lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
    ...(signal !== undefined && { signal }),
  }).then(async (response) => {
    if (!response.ok) throw await parseError(response);
    return response.json() as Promise<PatientIdentity[]>;
  });
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
      return "Iniciá sesión para ver pacientes.";
    case "FORBIDDEN":
      return "No tenés permiso para gestionar pacientes.";
    case "FEATURE_NOT_ENTITLED":
      return "El módulo veterinario no está habilitado para esta organización.";
    case "NOT_FOUND":
      return "No encontramos el paciente.";
    default:
      return error.message;
  }
}
