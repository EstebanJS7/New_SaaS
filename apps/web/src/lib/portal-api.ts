"use client";

/**
 * Browser-side client for the isolated portal read surface.
 *
 * Every call goes through the same-origin proxy at `/api/portal/*` (the ONLY
 * browser-facing entry to the private `/portal/*` API); the proxy forwards the
 * portal session cookie server-side, so this module never handles a token. The
 * DTOs mirror the allowlisted API projections: no `tenantId` echo, no
 * `internalNotes`, and no staff clinical free text.
 */

export type PortalPetSex = "MALE" | "FEMALE" | "UNKNOWN";

export type PortalEncounterStatus = "DRAFT" | "CLOSED";

/** Server-derived portal identity; no tenant echo and no email. */
export interface PortalIdentity {
  readonly portalAccessId: string;
  readonly customerId: string;
}

/** `GET /portal/me` response. */
export interface PortalMe {
  readonly portal: PortalIdentity;
  readonly requestId: string;
}

/** Holder-owned pet identity; species/breed remain stable ids. */
export interface PortalPet {
  readonly id: string;
  readonly name: string;
  readonly speciesId: string;
  readonly breedId: string | null;
  readonly sex: PortalPetSex;
  readonly birthDate: string | null;
  readonly isActive: boolean;
}

/** Client-safe clinical summary; only `clientSummary` is exposed. */
export interface PortalClinicalSummary {
  readonly id: string;
  readonly status: PortalEncounterStatus;
  readonly clientSummary: string;
  readonly closedAt: string | null;
}

/** Vaccination history entry. */
export interface PortalVaccination {
  readonly id: string;
  readonly vaccine: string;
  readonly administeredAt: string;
}

/** `GET /portal/pets/:id` response: identity plus the allowlisted clinical block. */
export interface PortalPetDetail extends PortalPet {
  readonly clinical: {
    readonly encounters: readonly PortalClinicalSummary[];
    readonly vaccinations: readonly PortalVaccination[];
  };
}

/** Mirrors the `appointment_status` database enum (the full lifecycle). */
export type PortalAppointmentStatus =
  "SCHEDULED" | "CONFIRMED" | "ARRIVED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

/**
 * `GET /portal/appointments` entry: the allowlisted appointment plus the pet
 * name the API resolves server-side. Carrying the name here is what lets the
 * appointments page drop its own pets read and in-memory join.
 */
export interface PortalAppointment {
  readonly id: string;
  readonly patientId: string;
  readonly patientName: string;
  readonly status: PortalAppointmentStatus;
  readonly startAt: string;
  readonly endAt: string;
  /**
   * Optimistic-concurrency guard the read exposes and the move command
   * REQUIRES (DEC-007 A2d). Without it the reschedule cannot succeed, so it is
   * carried on the row the holder sees rather than re-fetched at submit time.
   */
  readonly version: number;
}

/**
 * `GET /portal/appointments` response: the clinic zone that names each row's
 * day, plus the holder's own appointments, earliest first.
 */
export interface PortalAppointmentList {
  readonly timeZone: string;
  readonly appointments: readonly PortalAppointment[];
}

/** One free slot offered by `GET /portal/availability` — times only, no identity. */
export interface PortalAvailabilitySlot {
  readonly startAt: string;
  readonly endAt: string;
}

/** `GET /portal/availability` response: exactly the allowlisted projection. */
export interface PortalAvailability {
  readonly date: string;
  readonly timeZone: string;
  readonly durationMinutes: number;
  readonly stepMinutes: number;
  readonly slots: readonly PortalAvailabilitySlot[];
}

/**
 * Availability query. The proxy boundary accepts these THREE keys and nothing
 * else — an extra key is refused with a 404 before it ever reaches the API, so
 * this client must never add one. `stepMinutes` is always sent (equal to
 * `durationMinutes`) so the offered slots tile the day without overlapping.
 */
export interface PortalAvailabilityQuery {
  readonly date: string;
  readonly durationMinutes: number;
  readonly stepMinutes: number;
}

/** Mirrors the `portal_booking_request_status` database enum. */
export type PortalBookingRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

/** `POST /portal/pets/:id/bookings` response: created id plus lifecycle status. */
export interface PortalBookingRequest {
  readonly id: string;
  readonly patientId: string;
  readonly status: PortalBookingRequestStatus;
  readonly startAt: string;
  readonly endAt: string;
}

/**
 * One of the holder's OWN booking requests: the lifecycle status plus the pet
 * name the API resolves server-side, so the client never joins or prints an id.
 */
export interface PortalBookingSummary {
  readonly id: string;
  readonly patientId: string;
  readonly patientName: string;
  readonly status: PortalBookingRequestStatus;
  readonly startAt: string;
  readonly endAt: string;
}

/**
 * `GET /portal/bookings` response: the clinic zone plus the holder's own
 * requests, oldest start first.
 */
export interface PortalBookingList {
  readonly timeZone: string;
  readonly bookings: readonly PortalBookingSummary[];
}

/** Submission payload: the chosen slot's two ISO instants and nothing else. */
export interface CreatePortalBookingInput {
  readonly startAt: string;
  readonly endAt: string;
}

/**
 * Reschedule payload: the chosen slot's two ISO instants PLUS the `version` the
 * appointment read exposed. All three are required by the API's `.strict()`
 * DTO; the version is what makes the move an optimistic compare-and-set rather
 * than a blind overwrite.
 */
export interface ReschedulePortalAppointmentInput {
  readonly startAt: string;
  readonly endAt: string;
  readonly version: number;
}

/**
 * Allowlisted address projection the profile read/write returns: the holder's
 * user-facing address fields only. `line1` is nullable here because the DB
 * column is, but the WRITE contract still requires it whenever an address is
 * supplied (see `PortalProfileAddressInput`).
 */
export interface PortalProfileAddress {
  readonly label: string | null;
  readonly line1: string | null;
  readonly line2: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string | null;
}

/** `GET`/`PUT /portal/profile` response: the holder's own phone and address. */
export interface PortalProfile {
  readonly phone: string | null;
  readonly address: PortalProfileAddress | null;
}

/**
 * Address payload for `PUT /portal/profile`. `line1` is REQUIRED whenever an
 * address is sent (the API's `.strict()` schema enforces it); every other field
 * is optional and, when absent, the API leaves the stored value untouched.
 */
export interface PortalProfileAddressInput {
  readonly label?: string;
  readonly line1: string;
  readonly line2?: string;
  readonly city?: string;
  readonly state?: string;
  readonly postalCode?: string;
  readonly countryCode?: string;
}

/**
 * `PUT /portal/profile` payload. The API requires at least one of `phone` or
 * `address` and rejects every other key (`email`, `displayName`, `kind`,
 * `taxId`, `customerId`, ...) with a 400 VALIDATION_FAILED, so this surface can
 * only ever write the two holder-owned values.
 */
export interface UpdatePortalProfileInput {
  readonly phone?: string;
  readonly address?: PortalProfileAddressInput;
}

interface ApiErrorEnvelope {
  readonly error: {
    readonly code?: string;
    readonly message?: string;
  };
}

/**
 * Carries the stable API error code so the UI branches on the contract instead
 * of fragile message matching. `message` remains the server-provided text and
 * is never rendered directly — see `userFacingPortalError`.
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
  const response = await fetch(`/api/portal${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/portal${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/portal${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

/** `GET /portal/me` — the holder's server-derived identity probe. */
export function getPortalMe(): Promise<PortalMe> {
  return getJson("/me");
}

/**
 * `GET /portal/profile` — the holder's own phone and address. This is the
 * profile READ only, NOT an identity probe: `getPortalMe` stays the identity
 * read, so the two are never conflated.
 */
export function getPortalProfile(): Promise<PortalProfile> {
  return getJson("/profile");
}

/**
 * `PUT /portal/profile` — writes the holder's own phone and/or address. The
 * body is forwarded exactly as given, so the API's `.strict()` schema sees only
 * the keys this contract allows and never an extra one.
 */
export function updatePortalProfile(input: UpdatePortalProfileInput): Promise<PortalProfile> {
  return putJson("/profile", input);
}

/** `GET /portal/pets` — the pets linked to the authenticated holder. */
export function listPortalPets(): Promise<PortalPet[]> {
  return getJson("/pets");
}

/** `GET /portal/pets/:id` — detail, with the client-safe clinical block. */
export function getPortalPet(id: string): Promise<PortalPetDetail> {
  return getJson(`/pets/${id}`);
}

/** `GET /portal/appointments` — the holder's own appointments, earliest first. */
export function listPortalAppointments(): Promise<PortalAppointmentList> {
  return getJson("/appointments");
}

/**
 * `GET /portal/availability` — the clinic's real free slots for a date and a
 * duration, UNIONed across every in-tenant professional. Times only: the holder
 * sees WHEN, never who.
 */
export function listPortalAvailability(
  query: PortalAvailabilityQuery
): Promise<PortalAvailability> {
  const params = new URLSearchParams({
    date: query.date,
    durationMinutes: String(query.durationMinutes),
    stepMinutes: String(query.stepMinutes),
  });
  return getJson(`/availability?${params.toString()}`);
}

/**
 * `POST /portal/pets/:id/bookings` — submits a PENDING booking request for the
 * chosen slot.
 *
 * DATETIME FORMAT: the response's `startAt`/`endAt` are forwarded EXACTLY as
 * the availability read returned them. The API's write DTO validates with
 * `z.string().datetime({ offset: true })` (`apps/api/src/portal/
 * portal-booking.dto.ts`), which accepts BOTH a `Z`-suffixed UTC instant and an
 * explicit offset (`+00:00`, `-03:00`). The availability read emits
 * `Date.prototype.toISOString()`, i.e. `...Z`, so no conversion is applied
 * because none is required — the two formats are accepted by the same schema.
 * This was verified by parsing `2026-03-10T09:00:00.000Z` through the schema,
 * not assumed from the shapes looking interchangeable.
 */
export function createPortalBooking(
  petId: string,
  input: CreatePortalBookingInput
): Promise<PortalBookingRequest> {
  return postJson(`/pets/${petId}/bookings`, {
    startAt: input.startAt,
    endAt: input.endAt,
  });
}

/**
 * `GET /portal/bookings` — the holder's OWN booking requests, oldest first,
 * each with its resolved pet name. This is the read the booking success screen
 * points at so a PENDING request can be followed up.
 */
export function listPortalBookings(): Promise<PortalBookingList> {
  return getJson("/bookings");
}

/**
 * `POST /portal/bookings/:id/cancel` — withdraws one of the holder's own
 * PENDING requests. The command takes no payload, so the body is the empty
 * object (the proxy forwards a JSON body for every POST and the API ignores
 * it); the updated request is returned.
 */
export function cancelPortalBooking(id: string): Promise<PortalBookingRequest> {
  return postJson(`/bookings/${id}/cancel`, {});
}

/**
 * `POST /portal/appointments/:id/cancel` — cancels one of the holder's own
 * SCHEDULED/CONFIRMED appointments. The shared transition rule rejects every
 * other state with a 409, which is why the UI offers this action only for the
 * two states the command accepts.
 */
export function cancelPortalAppointment(id: string): Promise<PortalAppointment> {
  return postJson(`/appointments/${id}/cancel`, {});
}

/**
 * `PUT /portal/appointments/:id` — moves a holder-owned appointment to the
 * chosen slot. The exact offered instants and the last-read `version` are sent
 * together: the API validates all three and re-checks state, availability,
 * blocks and overlap inside the transaction, so an unavailable slot or a stale
 * version is a 409 that persists nothing.
 */
export function reschedulePortalAppointment(
  id: string,
  input: ReschedulePortalAppointmentInput
): Promise<PortalAppointment> {
  return putJson(`/appointments/${id}`, {
    startAt: input.startAt,
    endAt: input.endAt,
    version: input.version,
  });
}

/** True when the response was refused for lack of portal access/entitlement. */
export function isPortalDeniedError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    (error.code === "FORBIDDEN" || error.code === "FEATURE_NOT_ENTITLED")
  );
}

/** True when the requested resource was masked as not-found. */
export function isPortalNotFoundError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === "NOT_FOUND";
}

/**
 * True when the command's own precondition check failed. Unlike the create
 * path, the cancel/move commands DO evaluate their preconditions, so a 409 is a
 * state the UI may name (already decided, slot no longer free, stale version).
 */
export function isPortalConflictError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === "CONFLICT";
}

/**
 * Maps the stable portal error contract to holder-facing UX copy.
 *
 * Unlike the staff mapper this NEVER falls back to the server message: an
 * unmapped failure shows a fixed generic sentence, so no internal text and no
 * implementation detail (status codes, upstream error strings) can leak into
 * the portal. The `NOT_FOUND` copy deliberately does not pick a cause — the API
 * masks a pet that is not the holder's as the same 404 it returns for a pet
 * that does not exist, so the UI says both may be true rather than asserting
 * one of them. `CONFLICT` is deliberately cause-neutral for a different reason:
 * the create command performs no conflict check today, so a 409 is not a cause
 * this client can name — the copy states no cause rather than a wrong one.
 *
 * These messages are UX-only; the backend still enforces every gate.
 */
export function userFacingPortalError(error: Error): string {
  const code = error instanceof ApiRequestError ? error.code : "";
  switch (code) {
    case "UNAUTHENTICATED":
      return "Your session has ended. Please sign in again.";
    case "FORBIDDEN":
      return "You do not have access to this portal.";
    case "FEATURE_NOT_ENTITLED":
      return "The client portal is not available for this clinic.";
    case "NOT_FOUND":
      return "We could not find that pet. It may not exist, or it may not be linked to your account.";
    case "CONFLICT":
      return "We could not send this request as it stands. Please refresh and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/**
 * Maps the stable portal error contract for the APPOINTMENTS surface.
 *
 * Same contract as `userFacingPortalError` (stable-code mapping, never the
 * server message), with ONE difference: the appointments list is not about a
 * single pet, so a masked not-found names the appointment instead of a pet.
 * The API masks an appointment that is not the holder's as the SAME 404 it
 * returns for one that does not exist, so the copy keeps both possibilities
 * rather than asserting a cause. Every other code delegates unchanged.
 */
export function userFacingPortalAppointmentsError(error: Error): string {
  if (isPortalNotFoundError(error)) {
    return "We could not find that appointment. It may not exist, or it may not be linked to your account.";
  }
  return userFacingPortalError(error);
}

/**
 * Error copy for withdrawing a booking request. Grounded in what the command
 * actually checks: `cancelBookingRequest` is a PENDING compare-and-set, so a
 * 409 means the request was already decided. The 404 copy names the request
 * (never a pet) because this surface is not a single pet, and every other code
 * delegates to the shared mapper.
 */
export function userFacingPortalBookingCancelError(error: Error): string {
  if (isPortalConflictError(error)) {
    return "That request may already have been decided. We refreshed your requests.";
  }
  if (isPortalNotFoundError(error)) {
    return "We could not find that request. It may not exist, or it may not be linked to your account.";
  }
  return userFacingPortalError(error);
}

/**
 * Error copy for cancelling an appointment. The command checks that the current
 * status is SCHEDULED/CONFIRMED and then re-applies that SAME status in a
 * `{ id, tenantId, status }` update — it does NOT compare a version (it only
 * increments one) — so a 409 means the stored status had already moved on when
 * the update matched nothing. Not-found copy reuses the appointment-worded
 * mapper.
 */
export function userFacingPortalAppointmentCancelError(error: Error): string {
  if (isPortalConflictError(error)) {
    return "That appointment may have already changed or may no longer be cancellable. We refreshed your appointments.";
  }
  return userFacingPortalAppointmentsError(error);
}

/**
 * Error copy for moving an appointment. The command re-checks availability,
 * blocks, overlap and the version compare-and-set, so a 409 can honestly name
 * both causes it knows: the slot may be gone, or the appointment may have
 * changed. Not-found copy reuses the appointment-worded mapper.
 */
export function userFacingPortalRescheduleError(error: Error): string {
  if (isPortalConflictError(error)) {
    return "That time may no longer be free, or the appointment may have changed. We refreshed your appointments.";
  }
  return userFacingPortalAppointmentsError(error);
}

/**
 * Maps the stable portal error contract for the PROFILE surface.
 *
 * Same contract as `userFacingPortalError` (stable-code mapping, never the
 * server message), with one difference: the profile read/write masks a profile
 * that cannot be resolved as the SAME 404 whether it is not the holder's or
 * there is nothing to resolve, so the copy keeps both possibilities instead of
 * asserting one (the shared mapper's not-found copy says "pet", which would be
 * wrong here). A `VALIDATION_FAILED` (400) is the API refusing a body it does
 * not accept; the copy says the details were not accepted without echoing which
 * internal rule fired. Every other code delegates unchanged.
 */
export function userFacingPortalProfileError(error: Error): string {
  const code = error instanceof ApiRequestError ? error.code : "";
  switch (code) {
    case "VALIDATION_FAILED":
      return "Some of the details you entered are not accepted. Please check them and try again.";
    case "NOT_FOUND":
      return "We could not find your profile. It may not exist yet, or it may not be linked to your account.";
    default:
      return userFacingPortalError(error);
  }
}
