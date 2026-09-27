"use client";

/**
 * Staff purchase API client (EPIC-11 PUR-003). Every call goes through the
 * authenticated web proxy at `/api/purchases`, which resolves the tenant from
 * the server-side session cookie — the browser never supplies a tenant id, and
 * the client is never an authorization authority.
 *
 * Data classification (DEC-012/DEC-013): the supplier reference, the status, the
 * line quantities and the optional informational unit cost are INTERNAL. This
 * module sends and returns those fields and deliberately writes none of them
 * anywhere else: no console call, no error telemetry and no analytics event
 * takes a purchase payload, and only the API's own stable, value-free error copy
 * is surfaced.
 *
 * The lifecycle is server-owned: no call in this module sends a `status`, and
 * the transitions are the API's own explicit commands (`cancel`, `receive`).
 * There is no delete call anywhere on this surface.
 */

/** Lifecycle values pinned by the `purchase_status` enum (PRD §17, DEC-012). */
export type PurchaseStatus = "DRAFT" | "RECEIVED" | "CANCELLED";

/** Runtime mirror of the status union, pinned so the enum cannot drift. */
export const PURCHASE_STATUSES = [
  "DRAFT",
  "RECEIVED",
  "CANCELLED",
] as const satisfies readonly PurchaseStatus[];

/** One allowlisted purchase line mirrored from the read contract. */
export interface PurchaseLine {
  readonly id: string;
  readonly catalogItemId: string;
  /** Exact fixed-scale (3 decimals) positive decimal string, e.g. `"2.000"`. */
  readonly quantity: string;
  /** Exact fixed-scale (2 decimals) non-negative decimal string, or `null`. */
  readonly unitCost: string | null;
}

/**
 * Allowlisted Purchase DTO mirrored from the read/write contract. There is
 * deliberately no number, code, total or tax field (DEC-013/DEC-018), so the
 * surface identifies a purchase by its supplier, creation date and a short id
 * fragment.
 */
export interface Purchase {
  readonly id: string;
  readonly tenantId: string;
  readonly supplierId: string;
  readonly status: PurchaseStatus;
  readonly lines: PurchaseLine[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Purchase list filters; every field is optional and server-applied.
 *
 * `status` IS the lifecycle filter: the API's list query accepts exactly `status`
 * (one enum value) and validates it with `.strict()`, so any other key would be a
 * `400` upstream. The API applies NO implicit status default, so a caller that
 * wants a single status must ask for it explicitly.
 */
export interface PurchaseFilters {
  readonly status?: PurchaseStatus;
}

/**
 * Stable, value-free conflict copy the purchase API emits. The messages are
 * constants in the module doc (`docs/05-modules/Purchases.md`), and this client
 * branches on them because all three share the single `CONFLICT` code while
 * describing three different conditions the staff surface must render apart.
 */
export const PURCHASE_NOT_EDITABLE_MESSAGE = "Only a draft purchase can be changed.";
export const PURCHASE_ITEM_INACTIVE_MESSAGE = "The catalog item is inactive.";
export const PURCHASE_ITEM_NOT_TRACKED_MESSAGE = "The catalog item does not track stock.";

interface ApiErrorEnvelope {
  readonly error: {
    readonly code?: string;
    readonly message?: string;
  };
}

/**
 * Carries the stable API error code so the UI branches on the contract instead
 * of fragile message matching of its own invention. `message` remains the
 * server-provided text, which the purchase API keeps value-free — a `409` names
 * the condition and never echoes a stored quantity, cost, supplier or item id.
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
  const response = await fetch(`/api/purchases${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/purchases${path}`, {
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
  const response = await fetch(`/api/purchases${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

/**
 * Builds the list query from the defined filters only, in the order the proxy
 * forwards them. An omitted filter is an absent key, never an empty value, so
 * the proxy and the API both see "no filter" instead of a blank one.
 */
function filtersQuery(filters: PurchaseFilters): string {
  const params = new URLSearchParams();
  if (filters.status !== undefined) params.set("status", filters.status);
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

/**
 * Lists the caller tenant's purchases, newest first. An omitted `status` applies
 * NO implicit filter (the API returns every lifecycle value), so the staff list
 * that wants one status must ask for it.
 */
export function listPurchases(filters: PurchaseFilters = {}): Promise<Purchase[]> {
  return getJson(filtersQuery(filters));
}

export function getPurchase(id: string): Promise<Purchase> {
  return getJson(`/${id}`);
}

export function createPurchase(body: unknown): Promise<Purchase> {
  return postJson("", body);
}

export function updatePurchase(id: string, body: unknown): Promise<Purchase> {
  return putJson(`/${id}`, body);
}

/**
 * Cancels a draft through the API's explicit cancel command. `CANCELLED` is
 * reachable only from `DRAFT`, and cancellation never deletes the purchase or
 * its lines. There is no delete call and no `PATCH`-style status write.
 */
export function cancelPurchase(id: string): Promise<Purchase> {
  return postJson(`/${id}/cancel`, {});
}

/**
 * Receives a draft through the API's explicit receive command — the purchase's
 * ONLY stock effect. The command takes no body field, it is single-shot (a
 * replay or a non-draft purchase is a stable `409`), and it is never retried
 * silently by this module. A rejection persists nothing.
 */
export function receivePurchase(id: string): Promise<Purchase> {
  return postJson(`/${id}/receive`, {});
}

/**
 * True when the API refused the request because the staff role does not hold the
 * `purchases.*` key the operation needs.
 *
 * This is a UX branch only: it decides which copy a caller renders. The backend
 * check behind it is what actually protects the data, and purchases are a Core
 * capability with no entitlement gate, so `FORBIDDEN` is the only permission
 * refusal this surface can receive.
 */
export function isPurchasePermissionDenied(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "FORBIDDEN";
}

/**
 * True when the API answered the shared `404` — a foreign-tenant id is
 * byte-equivalent to an unknown one, so the UI must not distinguish them.
 */
export function isPurchaseNotFound(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "NOT_FOUND";
}

/** True when the API refused the request with any stable `409 CONFLICT`. */
export function isPurchaseConflict(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "CONFLICT";
}

/**
 * True when the refusal is the non-`DRAFT` mutability rule: an edit, cancel or
 * receive of a purchase that is no longer a draft. The condition is terminal —
 * the purchase's status already moved — so the UI must never present it as a
 * transient failure to retry blindly.
 */
export function isPurchaseNotEditableConflict(error: Error): boolean {
  return (
    error instanceof ApiRequestError &&
    error.code === "CONFLICT" &&
    error.message === PURCHASE_NOT_EDITABLE_MESSAGE
  );
}

/**
 * True when a receive was refused because one of its lines references an
 * inactive catalog item. Distinguished from the other `409`s so the surface can
 * explain which line condition blocked the receive.
 */
export function isPurchaseInactiveItemConflict(error: Error): boolean {
  return (
    error instanceof ApiRequestError &&
    error.code === "CONFLICT" &&
    error.message === PURCHASE_ITEM_INACTIVE_MESSAGE
  );
}

/**
 * True when a receive was refused because one of its lines references a catalog
 * item that does not track stock. Distinguished from the other `409`s so the
 * surface can explain which line condition blocked the receive.
 */
export function isPurchaseUntrackedItemConflict(error: Error): boolean {
  return (
    error instanceof ApiRequestError &&
    error.code === "CONFLICT" &&
    error.message === PURCHASE_ITEM_NOT_TRACKED_MESSAGE
  );
}

/**
 * True when the request never reached the API: a fetch rejection or any other
 * non-`ApiRequestError` failure. Rendered as a transport error so it is never
 * conflated with a refusal the API actually produced.
 */
export function isPurchaseTransportError(error: Error): boolean {
  return !(error instanceof ApiRequestError);
}

/**
 * Maps the stable purchase error contract to staff-facing UX copy.
 *
 * These messages are UX-only; the backend still enforces every gate. `CONFLICT`
 * deliberately keeps the API's own stable, value-free conflict copy — calling a
 * transition conflict "conflict" without inventing a cause — and any unmapped
 * code falls through to the server message. A bare transport failure gets its
 * own copy instead of a raw browser string.
 */
export function userFacingPurchaseError(error: Error): string {
  if (!(error instanceof ApiRequestError)) {
    return "The request could not reach the server. Check your connection and try again.";
  }
  switch (error.code) {
    case "UNAUTHENTICATED":
      return "You must be signed in to view purchases.";
    case "FORBIDDEN":
      return "You do not have permission to manage purchases.";
    case "NOT_FOUND":
      return "Purchase not found.";
    default:
      return error.message;
  }
}
