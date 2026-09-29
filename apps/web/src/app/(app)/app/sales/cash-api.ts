"use client";

/**
 * Staff POS cash client (EPIC-12 POS-004 E1). Every call goes through the
 * authenticated web proxy at `/api/cash`, which resolves the tenant from the
 * server-side session cookie — the browser never supplies a tenant id, and this
 * client is never an authorization authority. The session opener is likewise
 * server-resolved: no helper here sends an opener, a status or a register
 * balance, because none of them is caller-owned.
 *
 * Data classification (PRD §41): the register name, the session status and the
 * opening amount are INTERNAL. This module sends and returns those fields and
 * deliberately writes none of them anywhere else: no console call, no error
 * telemetry and no analytics event takes a cash payload, and only the API's own
 * stable, value-free error copy is surfaced.
 *
 * This is the EPIC-12 slice of the cash surface: the register list, the register
 * create, the session list and the session open. Session close, the
 * expected/counted difference, the remaining movement kinds and the cash
 * reversal belong to EPIC-13 (DEC-020) and have no helper here.
 *
 * Money never becomes a JavaScript number. `openingAmount` arrives as an exact
 * fixed-scale decimal string and is rendered by the sibling
 * `formatWireAmount` in `./sales-api`, which groups digits textually.
 *
 * Like the EPIC-11 sibling clients, this module declares its own
 * `ApiRequestError` so it stays independently testable: a cash refusal is
 * classified by this module's predicates, never by a sale predicate.
 */

/** Lifecycle values pinned by the `cash_session_status` enum (PRD §20, POS-002). */
export type CashSessionStatus = "OPEN" | "CLOSED";

/** Runtime mirror of the session-status union, pinned so the enum cannot drift. */
export const CASH_SESSION_STATUSES = [
  "OPEN",
  "CLOSED",
] as const satisfies readonly CashSessionStatus[];

/**
 * The `cash_register.name` upper bound (the `VARCHAR(200)` column and its
 * migration CHECK). Mirrored so the surface can bound the field before the API
 * rejects it with the stable `400`.
 */
export const CASH_REGISTER_NAME_MAX_LENGTH = 200;

/**
 * One allowlisted cash register: the drawer a session is opened against. There is
 * no balance field — a register's expected amount is derived from the immutable
 * movement ledger and never mutated directly (PRD §20).
 */
export interface CashRegister {
  readonly id: string;
  /** Operator-facing drawer name, non-empty and bounded to 1..200 characters. */
  readonly name: string;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One allowlisted cash session. `openedByMembershipId` is the opener the API
 * resolved from the authenticated request context, never caller input (DEC-020),
 * and `openingAmount` is the required opening float at the exact
 * `Decimal(14, 2)` wire scale.
 */
export interface CashSession {
  readonly id: string;
  readonly registerId: string;
  readonly status: CashSessionStatus;
  readonly openedAt: string;
  readonly openedByMembershipId: string;
  /** Exact fixed-scale (2 decimals) non-negative literal, e.g. `"0.00"`. */
  readonly openingAmount: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Register-create payload. `name` is the only field: the tenant is
 * server-resolved, `isActive` defaults to true server-side, and there is no
 * `branchId` because the schema has no Branch dimension (DEC-020). The proxy
 * refuses any other key before the request leaves the web tier.
 */
export interface CreateCashRegisterInput {
  readonly name: string;
}

/**
 * Session-open payload: the in-tenant register to open and the required opening
 * float as an exact fixed-scale (2 decimals) non-negative decimal string.
 * `status`, `tenantId`, `openedByMembershipId`, `currency` and `branchId` are all
 * server-owned or non-existent and are refused by the proxy.
 */
export interface OpenCashSessionInput {
  readonly registerId: string;
  /** Exact fixed-scale (2 decimals) non-negative literal; `"0.00"` is allowed. */
  readonly openingAmount: string;
}

/**
 * Session list filters; the only field is optional and server-applied.
 *
 * `status` IS the lifecycle filter: the API's session query accepts exactly
 * `status` (one enum value) and validates it with `.strict()`, so any other key
 * would be a `400` upstream. The API applies NO implicit open-only default, so a
 * caller that wants the open session must ask for it explicitly.
 */
export interface CashSessionFilters {
  readonly status?: CashSessionStatus;
}

interface ApiErrorEnvelope {
  readonly error: {
    readonly code?: string;
    readonly message?: string;
  };
}

/**
 * Carries the stable API error code so the UI branches on the contract instead
 * of fragile message matching of its own invention. `message` remains the
 * server-provided text, which the cash API keeps value-free — the register-name
 * `409` never echoes the name back.
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
  const response = await fetch(`/api/cash${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/cash${path}`, {
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

/** Lists the caller tenant's registers, newest first. Takes no filter or query. */
export function listCashRegisters(): Promise<CashRegister[]> {
  return getJson("/registers");
}

/**
 * Creates an in-tenant register. The name is unique per tenant, so a second
 * create with the same name is the stable `409` produced by the unique index —
 * never a silent rename.
 */
export function createCashRegister(input: CreateCashRegisterInput): Promise<CashRegister> {
  return postJson("/registers", input);
}

/**
 * Lists the caller tenant's sessions, newest first. An omitted `status` applies
 * NO implicit open-only filter, so the counter view that needs the open session
 * must ask for `OPEN`.
 */
export function listCashSessions(filters: CashSessionFilters = {}): Promise<CashSession[]> {
  const params = new URLSearchParams();
  if (filters.status !== undefined) params.set("status", filters.status);
  const query = params.toString();
  return getJson(`/sessions${query.length > 0 ? `?${query}` : ""}`);
}

/**
 * Opens one session for an in-tenant register with the required opening float.
 * A register may hold at most one `OPEN` session (the partial unique index), so a
 * second open is the stable `409` — there is no close helper in this slice, and
 * the surface must not present this outcome as a retryable failure of the same
 * intent.
 */
export function openCashSession(input: OpenCashSessionInput): Promise<CashSession> {
  return postJson("/sessions", input);
}

/**
 * Stable, value-free error copy the cash API emits, duplicated from
 * `apps/api/src/cash/cash.service.ts` and `cash.repository.ts` for the same
 * reason the sale client duplicates its own: the web tier cannot import from the
 * API package, and each string names a condition rather than echoing a value.
 */
export const CASH_FEATURE_NOT_ENTITLED_MESSAGE = "Cash features are not enabled for this tenant.";
export const CASH_REGISTER_NAME_CONFLICT_MESSAGE =
  "A cash register with this name already exists in this tenant.";
export const CASH_SESSION_ALREADY_OPEN_MESSAGE = "This cash register already has an open session.";
export const CASH_REGISTER_NOT_FOUND_MESSAGE = "Cash register was not found.";
export const CASH_SESSION_NOT_FOUND_MESSAGE = "Cash session was not found.";

/**
 * True when the API refused the request because the staff role does not hold the
 * `cash.*` key the operation needs. A UX branch only: the backend check behind it
 * is what actually protects the data, and it runs BEFORE this one (the
 * entitlement first, the permission second).
 */
export function isCashPermissionDenied(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "FORBIDDEN";
}

/**
 * True when the tenant lacks the `cash` entitlement. Distinct from
 * {@link isCashPermissionDenied}: the capability is not enabled for the tenant,
 * which is not a problem with the operator's role.
 */
export function isCashNotEntitled(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "FEATURE_NOT_ENTITLED";
}

/**
 * True when the API answered the shared `404` — a foreign-tenant register or
 * session id is byte-equivalent to an unknown one, so the UI must not
 * distinguish them.
 */
export function isCashNotFound(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "NOT_FOUND";
}

/** True when the API refused the request with any stable `409 CONFLICT`. */
export function isCashConflict(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "CONFLICT";
}

/**
 * True when the register create was refused because the tenant already holds a
 * register with that name. The message never echoes the name back.
 */
export function isCashRegisterNameConflict(error: Error): boolean {
  return error instanceof ApiRequestError && error.message === CASH_REGISTER_NAME_CONFLICT_MESSAGE;
}

/**
 * True when the session open was refused because that register already has an
 * `OPEN` session. The rule is the database's partial unique index, so the
 * condition is a real state of the tenant rather than a validation mistake.
 */
export function isCashSessionAlreadyOpen(error: Error): boolean {
  return error instanceof ApiRequestError && error.message === CASH_SESSION_ALREADY_OPEN_MESSAGE;
}

/**
 * True when the request never reached the API: a fetch rejection or any other
 * non-`ApiRequestError` failure. Rendered as a transport error so it is never
 * conflated with a refusal the API actually produced.
 */
export function isCashTransportError(error: Error): boolean {
  return !(error instanceof ApiRequestError);
}

/**
 * Maps the stable cash error contract to staff-facing UX copy.
 *
 * These messages are UX-only; the backend still enforces every gate. Every
 * unmapped code falls through to the server message — which the cash API keeps
 * value-free — instead of inventing a cause, and a bare transport failure gets
 * its own copy rather than a raw browser string.
 */
export function userFacingCashError(error: Error): string {
  if (!(error instanceof ApiRequestError)) {
    return "The request could not reach the server. Check your connection and try again.";
  }
  switch (error.code) {
    case "UNAUTHENTICATED":
      return "You must be signed in to use the cash register.";
    case "FORBIDDEN":
      return "You do not have permission to manage cash registers.";
    case "FEATURE_NOT_ENTITLED":
      return "Cash features are not enabled for this tenant.";
    case "NOT_FOUND":
      return "Cash register or session not found.";
    default:
      return error.message;
  }
}
