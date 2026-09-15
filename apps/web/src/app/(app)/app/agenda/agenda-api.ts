"use client";

/**
 * Staff agenda API client (EPIC-07 WU4). Every call goes through the
 * authenticated web proxy at `/api/scheduling`, which resolves the tenant from
 * the server-side session cookie — the browser never supplies a tenant id.
 *
 * Data classification: appointment details are CONFIDENTIAL. Only the
 * allowlisted DTO fields mirrored from the WU2/WU3 contract cross this boundary;
 * there is no service/Catalog field and no internal linkage.
 */

/** Appointment lifecycle states, pinned by the EPIC-07 spec. */
export type AppointmentStatus =
  "SCHEDULED" | "CONFIRMED" | "ARRIVED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

/** Runtime mirror of the status union, pinned so the enum cannot drift. */
export const APPOINTMENT_STATUSES = [
  "SCHEDULED",
  "CONFIRMED",
  "ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const satisfies readonly AppointmentStatus[];

/** Named lifecycle commands. There is deliberately no generic status route. */
export const TRANSITION_COMMANDS = [
  "confirm",
  "arrive",
  "start",
  "complete",
  "cancel",
  "no-show",
] as const;

export type TransitionCommand = (typeof TRANSITION_COMMANDS)[number];

/** Allowed lifecycle edges, mirrored from the API transition table (UX-only). */
const ALLOWED_TRANSITIONS: Readonly<Record<AppointmentStatus, readonly TransitionCommand[]>> = {
  SCHEDULED: ["confirm", "cancel"],
  CONFIRMED: ["arrive", "cancel", "no-show"],
  ARRIVED: ["start", "no-show"],
  IN_PROGRESS: ["complete"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

/** Returns the lifecycle commands legal from the given status (UX affordances only). */
export function allowedTransitions(status: AppointmentStatus): readonly TransitionCommand[] {
  return ALLOWED_TRANSITIONS[status];
}

/** Allowlisted staff Appointment DTO mirrored from the WU2D/WU3 contract. */
export interface Appointment {
  readonly id: string;
  readonly tenantId: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly professionalMembershipId: string;
  readonly status: AppointmentStatus;
  readonly startAt: string;
  readonly endAt: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Agenda filter options: tenant branches plus assignable VETERINARIAN memberships. */
export interface AppointmentOptions {
  readonly branches: readonly { readonly id: string; readonly name: string }[];
  readonly professionals: readonly { readonly membershipId: string }[];
}

/** Agenda list filters; every field is optional and server-applied. */
export interface AppointmentFilters {
  readonly branchId?: string;
  readonly professionalMembershipId?: string;
  readonly status?: AppointmentStatus;
}

/** CREATE body: anchors plus a UTC start/end range. */
export interface CreateAppointmentInput {
  readonly branchId: string;
  readonly patientId: string;
  readonly professionalMembershipId: string;
  readonly startAt: string;
  readonly endAt: string;
}

/** RESCHEDULE body: a UTC start/end range plus the caller's last-read version. */
export interface RescheduleAppointmentInput {
  readonly startAt: string;
  readonly endAt: string;
  readonly version: number;
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

/** Canonical UUID shape required by the upstream appointment route params. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates a route identifier and returns its encoded form. A malformed or
 * empty id is a caller bug, so it is rejected before any path is built or any
 * request is sent; the rejection is an {@link ApiRequestError} so callers have a
 * single stable error type.
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
 * Performs the proxy request. A rejected `fetch` becomes a stable
 * `NETWORK_ERROR` instead of leaking the runtime `TypeError`, and an unreadable
 * success body becomes `MALFORMED_RESPONSE`.
 */
async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/scheduling${path}`, init);
  } catch {
    throw new ApiRequestError(
      "NETWORK_ERROR",
      "Unable to reach the scheduling service. Check your connection and try again.",
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
      "The scheduling service returned an unreadable response.",
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

/** Builds the agenda list query string from the defined filters only. */
function filtersQuery(filters: AppointmentFilters): string {
  const params = new URLSearchParams();
  if (filters.branchId !== undefined) params.set("branchId", filters.branchId);
  if (filters.professionalMembershipId !== undefined) {
    params.set("professionalMembershipId", filters.professionalMembershipId);
  }
  if (filters.status !== undefined) params.set("status", filters.status);
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

export async function listAppointments(filters: AppointmentFilters = {}): Promise<Appointment[]> {
  return getJson<Appointment[]>(`/appointments${filtersQuery(filters)}`);
}

export async function listAppointmentOptions(): Promise<AppointmentOptions> {
  return getJson<AppointmentOptions>("/appointments/options");
}

/** Reads one appointment; used to refresh the client after a version conflict. */
export async function getAppointment(id: string): Promise<Appointment> {
  return getJson<Appointment>(`/appointments/${encodeIdentifier(id, "appointment id")}`);
}

export async function createAppointment(input: CreateAppointmentInput): Promise<Appointment> {
  return postJson<Appointment>("/appointments", input);
}

/** Version-guarded reschedule; a stale `version` is a 409 CONFLICT. */
export async function rescheduleAppointment(
  id: string,
  input: RescheduleAppointmentInput
): Promise<Appointment> {
  return putJson<Appointment>(`/appointments/${encodeIdentifier(id, "appointment id")}`, input);
}

/** Runs one named lifecycle command; illegal edges are a 409 CONFLICT. */
export async function transitionAppointment(
  id: string,
  command: TransitionCommand
): Promise<Appointment> {
  return postJson<Appointment>(
    `/appointments/${encodeIdentifier(id, "appointment id")}/${command}`,
    {}
  );
}

/** True when the failure is a permission or entitlement denial (UX-only). */
export function isAgendaPermissionDenied(error: Error): boolean {
  if (!(error instanceof ApiRequestError)) return false;
  return (
    error.code === "FORBIDDEN" ||
    error.code === "FEATURE_NOT_ENTITLED" ||
    error.code === "UNAUTHENTICATED"
  );
}

/** True when an optimistic-concurrency or overlap write lost the race. */
export function isAgendaConflict(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "CONFLICT";
}

/**
 * Maps the stable scheduling error contract to staff-facing UX copy.
 *
 * These messages are UX-only; the backend still enforces every gate, and any
 * unmapped code falls through to the server message.
 */
export function userFacingAgendaError(error: Error): string {
  const code = error instanceof ApiRequestError ? error.code : "";
  switch (code) {
    case "UNAUTHENTICATED":
      return "You must be signed in to view the agenda.";
    case "FORBIDDEN":
      return "You do not have permission to view the agenda.";
    case "FEATURE_NOT_ENTITLED":
      return "The veterinary module is not enabled for this tenant.";
    case "NOT_FOUND":
      return "Appointment not found.";
    case "CONFLICT":
      return "That time overlaps another appointment or falls outside availability.";
    case "VALIDATION_FAILED":
      return "Check the appointment details and try again.";
    default:
      return error.message;
  }
}
