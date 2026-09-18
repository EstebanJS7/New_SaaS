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

/**
 * Portal booking-request lifecycle states mirrored from the WU4B staff DTO.
 * A request is demand, not a booking: it does not occupy the slot until staff
 * approve it into an appointment.
 */
export type BookingRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

/** Allowlisted staff BookingRequest DTO mirrored from the WU4B contract. */
export interface BookingRequest {
  readonly id: string;
  readonly patientId: string;
  readonly status: BookingRequestStatus;
  readonly startAt: string;
  readonly endAt: string;
}

/**
 * APPROVE body: the two anchors staff choose plus an OPTIONAL concrete slot.
 * `startAt`/`endAt` are all-or-nothing (both or neither); the API rejects a
 * half-supplied override. No other field is accepted — the patient comes from
 * the stored request and a smuggled field is a 400.
 */
export interface ApproveBookingRequestInput {
  readonly branchId: string;
  readonly professionalMembershipId: string;
  readonly startAt?: string;
  readonly endAt?: string;
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

/**
 * Lists the tenant's booking requests, including their status. The agenda shows
 * the PENDING subset as a demand layer; decided requests are still returned by
 * the contract and filtered in the view.
 */
export async function listBookingRequests(): Promise<BookingRequest[]> {
  return getJson<BookingRequest[]>("/booking-requests");
}

/**
 * Promotes one PENDING request to exactly one appointment. The optional override
 * is all-or-nothing, so a half-supplied pair never leaves the browser.
 */
export async function approveBookingRequest(
  id: string,
  input: ApproveBookingRequestInput
): Promise<Appointment> {
  return postJson<Appointment>(
    `/booking-requests/${encodeIdentifier(id, "booking request id")}/approve`,
    input
  );
}

/** Rejects one PENDING request; no appointment is created. */
export async function rejectBookingRequest(id: string): Promise<BookingRequest> {
  return postJson<BookingRequest>(
    `/booking-requests/${encodeIdentifier(id, "booking request id")}/reject`,
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

/**
 * Maps the stable scheduling error contract to staff-facing UX copy for a
 * booking-request DECISION.
 *
 * `CONFLICT` is OVERLOADED upstream: the same 409 covers a slot outside
 * availability, inside a one-off block, already overlapping an active
 * appointment, a request that is no longer PENDING (a concurrent decision), and
 * a revoked guardian link. The envelope's `code` is the stable contract and the
 * message text is not, so the copy deliberately names the plausible causes
 * WITHOUT asserting one and says the state is being refreshed. The refresh (see
 * the agenda's `refreshAfterDecisionConflict`) is what resolves the ambiguity;
 * do not "improve" this into a specific slot claim — it would be false for the
 * already-decided case, where the request is no longer pending at all. The other
 * codes are single-cause and their copy stays specific.
 */
export function userFacingBookingRequestError(error: Error): string {
  const code = error instanceof ApiRequestError ? error.code : "";
  switch (code) {
    case "UNAUTHENTICATED":
      return "You must be signed in to decide booking requests.";
    case "FORBIDDEN":
      return "You do not have permission to decide booking requests.";
    case "FEATURE_NOT_ENTITLED":
      return "The veterinary module is not enabled for this tenant.";
    case "NOT_FOUND":
      // The API masks a foreign or non-visible branch or professional with the
      // same status, so this must not claim the request itself is missing.
      return "The booking request, or the branch or professional you selected, could not be found.";
    case "CONFLICT":
      return "The request could not be decided as it stands: the slot may no longer be free, or the request may already have been decided. The latest state is being refreshed.";
    case "VALIDATION_FAILED":
      return "Check the branch, professional and slot and try again.";
    default:
      return error.message;
  }
}
