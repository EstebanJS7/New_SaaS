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

/** `GET /portal/me` — the holder's server-derived identity probe. */
export function getPortalMe(): Promise<PortalMe> {
  return getJson("/me");
}

/** `GET /portal/pets` — the pets linked to the authenticated holder. */
export function listPortalPets(): Promise<PortalPet[]> {
  return getJson("/pets");
}

/** `GET /portal/pets/:id` — detail, with the client-safe clinical block. */
export function getPortalPet(id: string): Promise<PortalPetDetail> {
  return getJson(`/pets/${id}`);
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
 * Maps the stable portal error contract to holder-facing UX copy.
 *
 * Unlike the staff mapper this NEVER falls back to the server message: an
 * unmapped failure shows a fixed generic sentence, so no internal text and no
 * implementation detail (status codes, upstream error strings) can leak into
 * the portal. The `NOT_FOUND` copy deliberately does not pick a cause — the API
 * masks a pet that is not the holder's as the same 404 it returns for a pet
 * that does not exist, so the UI says both may be true rather than asserting
 * one of them.
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
    default:
      return "Something went wrong. Please try again.";
  }
}
