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

/** Stable status/code plus an explicit uncertain outcome for identity commands. */
export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly uncertain = false
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function parseError(response: Response, mutation = false): Promise<ApiRequestError> {
  const body: unknown = await response.json().catch(() => null);
  const envelope = typeof body === "object" && body !== null && "error" in body ? body.error : null;
  const fallback: Record<number, string> = {
    400: "VALIDATION_FAILED",
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
  };
  const code =
    typeof envelope === "object" &&
    envelope !== null &&
    "code" in envelope &&
    typeof envelope.code === "string"
      ? envelope.code
      : (fallback[response.status] ?? "UNKNOWN");
  return new ApiRequestError(
    code,
    "Solicitud de pacientes rechazada.",
    response.status,
    mutation && (response.status >= 500 || response.status === 408)
  );
}
async function request<T>(
  path: string,
  method: "GET" | "POST" | "PUT",
  body?: unknown
): Promise<T> {
  const mutation = method !== "GET";
  let response: Response;
  try {
    response = await fetch(`/api/patients${path}`, {
      ...(mutation && {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      cache: "no-store",
    });
  } catch {
    throw new ApiRequestError("NETWORK_ERROR", "Conexión no disponible.", 0, mutation);
  }
  if (!response.ok) throw await parseError(response, mutation);
  const payload: unknown = await response.json().catch(() => null);
  if (
    payload === null ||
    typeof payload !== "object" ||
    (mutation && (!("id" in payload) || typeof payload.id !== "string" || !payload.id))
  )
    throw new ApiRequestError(
      "MALFORMED_RESPONSE",
      "Respuesta no confirmada.",
      response.status,
      mutation
    );
  return payload as T;
}
const getJson = <T>(path: string) => request<T>(path, "GET");
const postJson = <T>(path: string, body: unknown) => request<T>(path, "POST", body);
const putJson = <T>(path: string, body: unknown) => request<T>(path, "PUT", body);

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

/** UX-only; never render arbitrary server or transport messages. */
export function userFacingPatientError(error: unknown): string {
  if (error instanceof ApiRequestError && error.uncertain)
    return "No pudimos confirmar el resultado. Revisá el registro antes de repetir la operación; no volveremos a enviarla automáticamente.";
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
    case "VALIDATION_FAILED":
      return "Revisá los campos y sus límites antes de guardar.";
    case "CONFLICT":
      return "El cambio no es compatible con el estado actual. Un paciente activo debe conservar un responsable principal activo.";
    default:
      return "No pudimos completar la solicitud de pacientes. Revisá la conexión y volvé a intentar.";
  }
}
export function patientWriteBlocked(error: unknown): boolean {
  return (
    error instanceof ApiRequestError && (error.uncertain || [401, 403, 404].includes(error.status))
  );
}
