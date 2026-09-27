"use client";

/**
 * Staff supplier API client (EPIC-11 PUR-003). Every call goes through the
 * authenticated web proxy at `/api/suppliers`, which resolves the tenant from
 * the server-side session cookie — the browser never supplies a tenant id, and
 * the client is never an authorization authority.
 *
 * Data classification (DEC-011): `name` is INTERNAL, while `legalName`,
 * `taxId`, `email`, `phone` and `address` are CONFIDENTIAL. This module sends
 * and returns those fields and deliberately writes none of them anywhere else:
 * no console call, no error telemetry and no analytics event takes a supplier
 * payload, and only the API's own stable, value-free error copy is surfaced.
 */

/**
 * Allowlisted Supplier DTO mirrored from the SUP-001 read/write contract. Every
 * identity/contact field is nullable because the API stores an omitted optional
 * field as an explicit `NULL`; `name` is never nullable.
 */
export interface Supplier {
  readonly id: string;
  readonly tenantId: string;
  /** Trading name; INTERNAL. */
  readonly name: string;
  /** CONFIDENTIAL nullable identity field. */
  readonly legalName: string | null;
  /** CONFIDENTIAL nullable tax identifier (RUC). */
  readonly taxId: string | null;
  /** CONFIDENTIAL nullable contact field. */
  readonly email: string | null;
  /** CONFIDENTIAL nullable contact field. */
  readonly phone: string | null;
  /** CONFIDENTIAL nullable contact field. */
  readonly address: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Supplier list filters; every field is optional and server-applied.
 *
 * `isActive` IS the status filter: the API's list query accepts exactly
 * `isActive` (a boolean) and validates it with `.strict()`, so a `status`
 * parameter would be a `400` upstream. The API applies NO implicit active-only
 * default, so a caller that wants deactivated suppliers excluded must ask for
 * `isActive: true` explicitly.
 */
export interface SupplierFilters {
  readonly isActive?: boolean;
}

interface ApiErrorEnvelope {
  readonly error: {
    readonly code?: string;
    readonly message?: string;
  };
}

/**
 * Carries the stable API error code so the UI branches on the contract instead
 * of fragile message matching. `message` remains the server-provided text,
 * which the supplier API keeps value-free — a `409` names the conflict and never
 * echoes the submitted identifier.
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
  const response = await fetch(`/api/suppliers${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/suppliers${path}`, {
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
  const response = await fetch(`/api/suppliers${path}`, {
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
function filtersQuery(filters: SupplierFilters): string {
  const params = new URLSearchParams();
  if (filters.isActive !== undefined) params.set("isActive", String(filters.isActive));
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

/**
 * Lists the caller tenant's suppliers, name-ascending. An omitted `isActive`
 * applies NO implicit filter (the API returns active and inactive alike), so
 * the staff list that wants active-only must ask for `isActive: true`.
 */
export function listSuppliers(filters: SupplierFilters = {}): Promise<Supplier[]> {
  return getJson(filtersQuery(filters));
}

export function getSupplier(id: string): Promise<Supplier> {
  return getJson(`/${id}`);
}

export function createSupplier(body: unknown): Promise<Supplier> {
  return postJson("", body);
}

export function updateSupplier(id: string, body: unknown): Promise<Supplier> {
  return putJson(`/${id}`, body);
}

/**
 * Deactivates a supplier through the API's only removal command. There is no
 * delete call and no reactivation: removal is a soft, idempotent transition,
 * and `isActive` is deliberately not an update field.
 */
export function deactivateSupplier(id: string): Promise<Supplier> {
  return postJson(`/${id}/deactivate`, {});
}

/**
 * True when the API refused the write because a present `taxId` already exists
 * in this tenant. `CONFLICT` is the only 409 the supplier API emits, so the
 * caller can present it as an identifier conflict rather than a generic failure.
 */
export function isSupplierConflict(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "CONFLICT";
}

/**
 * True when the API refused the request because the staff role does not hold the
 * `suppliers.*` key the operation needs.
 *
 * This is a UX branch only: it decides which copy a caller renders. The backend
 * check behind it is what actually protects the data, and suppliers are a Core
 * capability with no entitlement gate, so `FORBIDDEN` is the only permission
 * refusal this surface can receive.
 */
export function isSupplierPermissionDenied(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "FORBIDDEN";
}

/**
 * Maps the stable supplier error contract to staff-facing UX copy.
 *
 * These messages are UX-only; the backend still enforces every gate. `CONFLICT`
 * deliberately keeps the API's own stable, value-free conflict copy — naming the
 * duplicate identifier would leak a CONFIDENTIAL value — and any unmapped code
 * falls through to the server message. Suppliers are a Core capability with no
 * entitlement gate, so no entitlement copy exists here.
 */
export function userFacingSupplierError(error: Error): string {
  const code = error instanceof ApiRequestError ? error.code : "";
  switch (code) {
    case "UNAUTHENTICATED":
      return "You must be signed in to view suppliers.";
    case "FORBIDDEN":
      return "You do not have permission to manage suppliers.";
    case "NOT_FOUND":
      return "Supplier not found.";
    default:
      return error.message;
  }
}
