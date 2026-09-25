"use client";

/**
 * Staff agenda API client (EPIC-07 WU4). Every call goes through the
 * authenticated web proxy at `/api/scheduling`, which resolves the tenant from
 * the server-side session cookie — the browser never supplies a tenant id.
 *
 * Data classification: appointment details are CONFIDENTIAL. Only the
 * allowlisted DTO fields mirrored from the WU2/WU3 contract cross this boundary.
 * EPIC-09 WU4 adds the OPTIONAL Catalog SERVICE association: the appointment
 * carries `serviceId` plus a small read-only IDENTITY projection of the linked
 * item (`id`, `name`, `kind`). No price, tax, rate or currency value is read
 * here, and the association never derives the appointment duration.
 */

import type { CatalogItemKind } from "../catalog/catalog-api";

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

/**
 * Read-only IDENTITY projection of the linked Catalog item, mirrored from the
 * WU4 appointment DTO. Deliberately carry-free: it holds the item's id, name and
 * kind only, so no price, tax, rate or currency can reach the agenda and a
 * linked appointment can never become a monetary source. `kind` reuses the
 * catalog client's pinned union instead of re-declaring it.
 */
export interface AppointmentService {
  readonly id: string;
  readonly name: string;
  readonly kind: CatalogItemKind;
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
  /** OPTIONAL Catalog SERVICE reference; `null` means no service is attached. */
  readonly serviceId: string | null;
  /** Identity of the attached service, or `null`; never carries a monetary value. */
  readonly service: AppointmentService | null;
}

/** Agenda filter options: tenant branches plus assignable VETERINARIAN memberships. */
export interface AppointmentOptions {
  readonly branches: readonly { readonly id: string; readonly name: string }[];
  readonly professionals: readonly { readonly membershipId: string }[];
}

/**
 * One local wall-clock availability window for a (professional, branch) pair,
 * mirrored from the `scheduling` settings namespace. `weekday` is 0 (Sunday) to
 * 6 (Saturday) and the bounds are minutes past local midnight in the tenant
 * timezone, so DST conversion is left to the presentation boundary.
 */
export interface SchedulingAvailabilityWindow {
  readonly membershipId: string;
  readonly branchId: string;
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
}

/** One non-recurring block over an absolute UTC range for a professional. */
export interface SchedulingBlock {
  readonly membershipId: string;
  readonly branchId: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

/** The `scheduling` namespace subset the staff-agenda overlay reads. */
export interface SchedulingSettings {
  readonly conflictPolicy: "REJECT" | "ALLOW";
  readonly availability: readonly SchedulingAvailabilityWindow[];
  readonly blocks: readonly SchedulingBlock[];
}

/** Agenda list filters; every field is optional and server-applied. */
export interface AppointmentFilters {
  readonly branchId?: string;
  readonly professionalMembershipId?: string;
  readonly status?: AppointmentStatus;
  readonly serviceId?: string;
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

/**
 * CREATE body: anchors plus a UTC start/end range and an OPTIONAL service.
 * `durationMinutes` is not part of this contract: the span is the explicit
 * caller-supplied `startAt`/`endAt` pair, never derived from a service.
 */
export interface CreateAppointmentInput {
  readonly branchId: string;
  readonly patientId: string;
  readonly professionalMembershipId: string;
  readonly startAt: string;
  readonly endAt: string;
  /** OPTIONAL Catalog SERVICE reference; omitted means no service. */
  readonly serviceId?: string;
}

/**
 * RESCHEDULE body: a UTC start/end range plus the caller's last-read version.
 * `serviceId` is OPTIONAL: omitted leaves the stored reference untouched, while
 * an explicit `null` clears it (the catalog update convention).
 */
export interface RescheduleAppointmentInput {
  readonly startAt: string;
  readonly endAt: string;
  readonly version: number;
  readonly serviceId?: string | null;
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
async function readJson<T>(response: Response): Promise<T> {
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

  return readJson<T>(response);
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
  if (filters.serviceId !== undefined) params.set("serviceId", filters.serviceId);
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

export async function listAppointments(filters: AppointmentFilters = {}): Promise<Appointment[]> {
  return getJson<Appointment[]>(`/appointments${filtersQuery(filters)}`);
}

export async function listAppointmentOptions(): Promise<AppointmentOptions> {
  return getJson<AppointmentOptions>("/appointments/options");
}

/**
 * Runtime shape checks for the `scheduling` settings namespace.
 *
 * These mirror `apps/api/src/settings/registry.ts` (`schedulingSettingsSchema`)
 * WITHOUT adding a runtime dependency: the conflict policy, the two arrays, and
 * every field the overlay mapping reads (plus the numeric ranges and the
 * orderings the API enforces). The point is not to re-implement zod — the API
 * remains the validating writer — but to stop a malformed payload from reaching
 * `settings.availability.filter(...)` or being mapped as if it were valid.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for a string FullCalendar can parse as an absolute instant. */
function isIsoInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isAvailabilityWindow(value: unknown): value is SchedulingAvailabilityWindow {
  if (!isRecord(value)) return false;
  const { membershipId, branchId, weekday, startMinute, endMinute } = value;
  return (
    typeof membershipId === "string" &&
    typeof branchId === "string" &&
    typeof weekday === "number" &&
    Number.isInteger(weekday) &&
    weekday >= 0 &&
    weekday <= 6 &&
    typeof startMinute === "number" &&
    Number.isInteger(startMinute) &&
    startMinute >= 0 &&
    startMinute <= 1439 &&
    typeof endMinute === "number" &&
    Number.isInteger(endMinute) &&
    endMinute >= 1 &&
    endMinute <= 1440 &&
    endMinute > startMinute
  );
}

function isSchedulingBlock(value: unknown): value is SchedulingBlock {
  if (!isRecord(value)) return false;
  const { membershipId, branchId, startsAt, endsAt } = value;
  return (
    typeof membershipId === "string" &&
    typeof branchId === "string" &&
    isIsoInstant(startsAt) &&
    isIsoInstant(endsAt) &&
    Date.parse(endsAt) > Date.parse(startsAt)
  );
}

/** Parses an array of availability windows, or null when any entry is malformed. */
function parseAvailability(value: unknown): SchedulingAvailabilityWindow[] | null {
  if (!Array.isArray(value)) return null;
  const entries: SchedulingAvailabilityWindow[] = [];
  for (const entry of value) {
    if (!isAvailabilityWindow(entry)) return null;
    entries.push(entry);
  }
  return entries;
}

/** Parses an array of one-off blocks, or null when any entry is malformed. */
function parseBlocks(value: unknown): SchedulingBlock[] | null {
  if (!Array.isArray(value)) return null;
  const entries: SchedulingBlock[] = [];
  for (const entry of value) {
    if (!isSchedulingBlock(entry)) return null;
    entries.push(entry);
  }
  return entries;
}

/**
 * Parses the namespace payload, or returns null when it does not match the
 * contract. A malformed ENTRY fails the whole namespace rather than being
 * skipped: dropping a window could make a restricted pair read as unrestricted,
 * which is the one state the overlay must never fabricate. The caller turns a
 * null into the same visible "availability unavailable" state as a failed read.
 */
function parseSchedulingSettings(value: unknown): SchedulingSettings | null {
  if (!isRecord(value)) return null;
  const { conflictPolicy } = value;
  if (conflictPolicy !== "REJECT" && conflictPolicy !== "ALLOW") return null;
  const availability = parseAvailability(value.availability);
  if (availability === null) return null;
  const blocks = parseBlocks(value.blocks);
  if (blocks === null) return null;
  return { conflictPolicy, availability, blocks };
}

/**
 * Reads the whole `scheduling` namespace through the settings proxy.
 *
 * The settings proxy is a separate allowlisted surface (`/api/settings/scheduling`),
 * so this call does not use the `/api/scheduling` prefix. The upstream response
 * envelope is `{ settings: {...} }`; the namespace object is what the overlay
 * consumes. A missing envelope OR a namespace that fails the runtime shape
 * checks is `MALFORMED_RESPONSE` (not a crash in the pure mapping, and not a
 * silently-unrestricted pair): the agenda query goes to its error state and the
 * view shows the non-blocking "availability unavailable" warning.
 */
export async function getSchedulingSettings(): Promise<SchedulingSettings> {
  let response: Response;
  try {
    response = await fetch("/api/settings/scheduling", { cache: "no-store" });
  } catch {
    throw new ApiRequestError(
      "NETWORK_ERROR",
      "Unable to reach the scheduling settings service. Check your connection and try again.",
      0
    );
  }

  const body: unknown = await readJson<unknown>(response);
  const settings = isRecord(body) ? body.settings : undefined;
  const parsed = parseSchedulingSettings(settings);
  if (parsed === null) {
    throw new ApiRequestError(
      "MALFORMED_RESPONSE",
      "The scheduling settings service returned an unreadable response.",
      response.status
    );
  }
  return parsed;
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

/** True when a write hit the overloaded 409 (lifecycle, version, availability or overlap). */
export function isAgendaConflict(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "CONFLICT";
}

/**
 * Maps the stable scheduling error contract to staff-facing UX copy.
 *
 * These messages are UX-only; the backend still enforces every gate, and any
 * unmapped code falls through to the server message.
 *
 * `CONFLICT` is OVERLOADED upstream: the same 409 covers an illegal lifecycle
 * transition or a status that cannot be rescheduled, a stale optimistic version
 * (another writer), a slot that overlaps an active appointment, a slot outside
 * the professional's availability, and a slot inside a one-off block. The
 * envelope's `code` is the contract and the message text is not, so the copy
 * names NO cause and points at the refreshed state instead of asserting one.
 */
export function userFacingAgendaError(error: Error): string {
  const code = error instanceof ApiRequestError ? error.code : "";
  switch (code) {
    case "UNAUTHENTICATED":
      return "You must be signed in to view the agenda.";
    case "FORBIDDEN":
      // Reached by the read AND the write paths: a write 403 is the granular
      // `scheduling.appointment.manage`/`transition` permission, which a staffer
      // can lack while still holding read, so the copy names no specific one.
      return "You do not have permission to perform this action.";
    case "FEATURE_NOT_ENTITLED":
      // The scheduling capability has NO feature-code gate: SchedulingModule
      // imports no EntitlementsModule, `schedulingSettingsDefinition` declares
      // no `requiresFeature`, and no scheduling route throws this code. It is
      // therefore unreachable for this client and is kept only as a defensive
      // mapping for the shared registry. The copy names the tenant's entitlement
      // rather than inventing a gate that scheduling does not have.
      return "The requested feature is not enabled for this tenant.";
    case "NOT_FOUND":
      // The read/write routes 404 on the appointment, but CREATE also 404s on a
      // foreign or unknown branch, patient or professional, so the copy must not
      // assert which anchor is missing.
      return "The appointment, or the branch, patient or professional you selected, could not be found.";
    case "CONFLICT":
      return "The appointment could not be changed because it conflicts with its current state. The latest details are being refreshed; review them and try again.";
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
      // Same as the agenda mapping: the booking-request decision route lives in
      // SchedulingModule, which has no feature-code gate, so this cannot be
      // reached by this client. Kept defensively with copy that invents no gate.
      return "The requested feature is not enabled for this tenant.";
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
