"use client";

/**
 * Staff clinical API client (EPIC-06 WU4). Every call goes through the
 * authenticated web proxy at `/api/clinical`, which resolves the tenant from the
 * server-side session cookie — the browser never supplies a tenant id.
 *
 * Data classification: encounter content is CONFIDENTIAL. `internalNotes` is
 * staff-only; any non-staff surface MUST project it through
 * {@link toClientSafeEncounter} so the field never leaves the staff workspace.
 */

export type ClinicalEncounterStatus = "DRAFT" | "CLOSED";

/** Allowlisted staff ClinicalEncounter DTO mirrored from the WU2A/WU3 contract. */
export interface ClinicalEncounter {
  readonly id: string;
  readonly tenantId: string;
  readonly patientId: string;
  readonly status: ClinicalEncounterStatus;
  readonly version: number;
  readonly reasonForVisit: string | null;
  readonly anamnesis: string | null;
  readonly diagnosis: string | null;
  readonly treatmentPlan: string | null;
  readonly internalNotes: string | null;
  readonly clientSummary: string | null;
  readonly amendsEncounterId: string | null;
  readonly amendmentReason: string | null;
  readonly closedAt: string | null;
  readonly closedByUserProfileId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Client-safe encounter view: the staff DTO minus the staff-only internal notes. */
export type ClientSafeClinicalEncounter = Omit<ClinicalEncounter, "internalNotes">;

/**
 * Strips the staff-only `internalNotes` field, returning a new object and never
 * mutating the input. Any surface that is not the authenticated staff workspace
 * (notably a future Portal view) MUST build its payload through this mapper.
 */
export function toClientSafeEncounter(encounter: ClinicalEncounter): ClientSafeClinicalEncounter {
  const { internalNotes: _internalNotes, ...clientSafe } = encounter;
  return clientSafe;
}

/** Free-form encounter content shared by create and autosave. */
export interface ClinicalEncounterContent {
  reasonForVisit: string | null;
  anamnesis: string | null;
  diagnosis: string | null;
  treatmentPlan: string | null;
  internalNotes: string | null;
  clientSummary: string | null;
}

/** CREATE body: every content field is optional; omitted fields persist null. */
export type CreateEncounterInput = Partial<ClinicalEncounterContent>;

/** AUTOSAVE body: content plus the version the caller last read. */
export type UpdateDraftInput = ClinicalEncounterContent & { readonly version: number };

/** AMEND body: a required reason plus an optional content override. */
export interface AmendEncounterInput {
  readonly reason: string;
  readonly idempotencyKey?: string;
  readonly content?: Partial<ClinicalEncounterContent>;
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

/** Canonical UUID shape required by the upstream clinical route params. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates a route identifier and returns its encoded form. A malformed or
 * empty id is a caller bug, so it is rejected before any path is built or any
 * request is sent; the rejection is an {@link ApiRequestError} so callers have a
 * single stable error type. Ids are UUID-only, so encoding is a safe no-op.
 */
function encodeIdentifier(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new ApiRequestError("INVALID_IDENTIFIER", `Invalid ${label}.`, 0);
  }
  return encodeURIComponent(value);
}

/** Reads a stable code/message pair from an unknown JSON error payload. */
function readErrorEnvelope(body: unknown): { code?: unknown; message?: unknown } | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  return error;
}

/**
 * Normalizes any failed response into an {@link ApiRequestError}. Invalid,
 * `null` and non-envelope JSON all fall back to `UNKNOWN` instead of throwing a
 * `TypeError` from property access on a non-object payload.
 */
async function parseError(response: Response): Promise<ApiRequestError> {
  const body: unknown = await response.json().catch(() => undefined);
  const envelope = readErrorEnvelope(body);
  return new ApiRequestError(
    typeof envelope?.code === "string" ? envelope.code : "UNKNOWN",
    typeof envelope?.message === "string"
      ? envelope.message
      : `Request failed (${response.status})`,
    response.status
  );
}

/**
 * Performs the proxy request. A rejected `fetch` (network failure or a
 * CORS/abort rejection) becomes a stable `NETWORK_ERROR` instead of leaking the
 * runtime `TypeError`, and an unreadable success body becomes
 * `MALFORMED_RESPONSE`.
 */
async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/clinical${path}`, init);
  } catch {
    throw new ApiRequestError(
      "NETWORK_ERROR",
      "Unable to reach the clinical service. Check your connection and try again.",
      0
    );
  }

  if (!response.ok) {
    throw await parseError(response);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiRequestError(
      "MALFORMED_RESPONSE",
      "The clinical service returned an unreadable response.",
      response.status
    );
  }
}

async function getJson<T>(path: string): Promise<T> {
  return requestJson<T>(path, { cache: "no-store" });
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function encounterBase(patientId: string): string {
  return `/${encodeIdentifier(patientId, "patient id")}/encounters`;
}

export async function listEncounters(patientId: string): Promise<ClinicalEncounter[]> {
  return getJson<ClinicalEncounter[]>(encounterBase(patientId));
}

export async function getEncounter(patientId: string, id: string): Promise<ClinicalEncounter> {
  return getJson<ClinicalEncounter>(
    `${encounterBase(patientId)}/${encodeIdentifier(id, "encounter id")}`
  );
}

export async function createEncounter(
  patientId: string,
  body: CreateEncounterInput = {}
): Promise<ClinicalEncounter> {
  return postJson<ClinicalEncounter>(encounterBase(patientId), body);
}

export async function updateDraft(
  patientId: string,
  id: string,
  input: UpdateDraftInput
): Promise<ClinicalEncounter> {
  return putJson<ClinicalEncounter>(
    `${encounterBase(patientId)}/${encodeIdentifier(id, "encounter id")}`,
    input
  );
}

/** Version-guarded DRAFT -> CLOSED transition; a stale version is a 409. */
export async function closeEncounter(
  patientId: string,
  id: string,
  version: number
): Promise<ClinicalEncounter> {
  return postJson<ClinicalEncounter>(
    `${encounterBase(patientId)}/${encodeIdentifier(id, "encounter id")}/close`,
    { version }
  );
}

export async function amendEncounter(
  patientId: string,
  id: string,
  input: AmendEncounterInput
): Promise<ClinicalEncounter> {
  return postJson<ClinicalEncounter>(
    `${encounterBase(patientId)}/${encodeIdentifier(id, "encounter id")}/amendments`,
    input
  );
}

/** True when the failure is a permission or entitlement denial (UX-only). */
export function isClinicalPermissionDenied(error: Error): boolean {
  if (!(error instanceof ApiRequestError)) return false;
  return (
    error.code === "FORBIDDEN" ||
    error.code === "FEATURE_NOT_ENTITLED" ||
    error.code === "UNAUTHENTICATED"
  );
}

/** True when an optimistic-concurrency or lifecycle write lost the race. */
export function isClinicalConflict(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "CONFLICT";
}

/**
 * Maps the stable `clinical.*` error contract to staff-facing UX copy.
 *
 * These messages are UX-only; the backend still enforces every gate, and any
 * unmapped code falls through to the server message.
 */
export function userFacingClinicalError(error: Error): string {
  const code = error instanceof ApiRequestError ? error.code : "";
  switch (code) {
    case "UNAUTHENTICATED":
      return "You must be signed in to view clinical records.";
    case "FORBIDDEN":
      return "You do not have permission to manage clinical records.";
    case "FEATURE_NOT_ENTITLED":
      return "The veterinary module is not enabled for this tenant.";
    case "NOT_FOUND":
      return "Clinical record not found.";
    default:
      return error.message;
  }
}
