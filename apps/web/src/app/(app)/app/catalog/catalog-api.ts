"use client";

/**
 * Staff catalog API client (EPIC-09 WU3 B1). Every call goes through the
 * authenticated web proxy at `/api/catalog`, which resolves the tenant from the
 * server-side session cookie — the browser never supplies a tenant id, and the
 * client is never an authorization authority.
 *
 * Data classification: catalog configuration is INTERNAL. Only the allowlisted
 * DTO fields mirrored from the WU2 contract cross this boundary, and the
 * reference price travels as an exact decimal STRING so no float and no
 * arithmetic enter the UI (the `ClinicalWeight.quantity` rule).
 */

/** Item kinds pinned by the `catalog_item_kind` database enum (PRD §15). */
export type CatalogItemKind = "PRODUCT" | "SERVICE" | "MEDICATION" | "SUPPLY";

/** Runtime mirror of the kind union, pinned so the enum cannot drift. */
export const CATALOG_ITEM_KINDS = [
  "PRODUCT",
  "SERVICE",
  "MEDICATION",
  "SUPPLY",
] as const satisfies readonly CatalogItemKind[];

/** Reference-price currencies the API accepts (PRD §1: PYG plus USD only). */
export type CatalogReferencePriceCurrency = "PYG" | "USD";

/** Runtime mirror of the accepted currency list; PYG is the offered default. */
export const CATALOG_REFERENCE_PRICE_CURRENCIES = [
  "PYG",
  "USD",
] as const satisfies readonly CatalogReferencePriceCurrency[];

/**
 * Read-only projection of the item's selected GLOBAL rate. The item already
 * carries `taxRateId`, so the nested projection repeats no identifier.
 */
export interface TaxRateProjection {
  readonly code: string;
  readonly name: string;
  readonly rate: string;
}

/** One row of the GLOBAL tax-rate list every tenant reads identically. */
export interface TaxRate {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly rate: string;
}

/** Allowlisted CatalogItem DTO mirrored from the WU2 read/write contract. */
export interface CatalogItem {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: CatalogItemKind;
  readonly name: string;
  readonly taxRateId: string;
  readonly taxRate: TaxRateProjection;
  readonly referencePriceAmount: string | null;
  readonly referencePriceCurrency: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Item list filters; every field is optional and server-applied.
 *
 * `isActive` IS the status filter: the API's list query accepts exactly `kind`
 * and `isActive` (a boolean) and validates it with `.strict()`, so a `status`
 * parameter would be a `400` upstream. The client maps the UI's status intent
 * onto the one key the contract defines instead of inventing another.
 */
export interface CatalogItemFilters {
  readonly kind?: CatalogItemKind;
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

async function parseError(response: Response): Promise<ApiRequestError> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorEnvelope;
  return new ApiRequestError(
    body.error?.code ?? "UNKNOWN",
    body.error?.message ?? `Request failed (${response.status})`,
    response.status
  );
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api/catalog${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/catalog${path}`, {
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
  const response = await fetch(`/api/catalog${path}`, {
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
function filtersQuery(filters: CatalogItemFilters): string {
  const params = new URLSearchParams();
  if (filters.kind !== undefined) params.set("kind", filters.kind);
  if (filters.isActive !== undefined) params.set("isActive", String(filters.isActive));
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

/**
 * Lists the caller tenant's items. An omitted `isActive` applies NO implicit
 * filter (the API returns active and inactive alike), so the staff list that
 * wants active-only must ask for `isActive: true` explicitly.
 */
export function listCatalogItems(filters: CatalogItemFilters = {}): Promise<CatalogItem[]> {
  return getJson(filtersQuery(filters));
}

export function getCatalogItem(id: string): Promise<CatalogItem> {
  return getJson(`/${id}`);
}

/** Reads the GLOBAL seeded rate list; the catalog form selects from it. */
export function listTaxRates(): Promise<TaxRate[]> {
  return getJson("/tax-rates");
}

export function createCatalogItem(body: unknown): Promise<CatalogItem> {
  return postJson("", body);
}

export function updateCatalogItem(id: string, body: unknown): Promise<CatalogItem> {
  return putJson(`/${id}`, body);
}

/**
 * Deactivates an item through the API's only removal command. There is no
 * delete call: removal is a soft, idempotent transition.
 */
export function deactivateCatalogItem(id: string): Promise<CatalogItem> {
  return postJson(`/${id}/deactivate`, {});
}

/**
 * Maps the stable catalog error contract to staff-facing UX copy.
 *
 * These messages are UX-only; the backend still enforces every gate, and any
 * unmapped code falls through to the server message.
 */
export function userFacingCatalogError(error: Error): string {
  const code = error instanceof ApiRequestError ? error.code : "";
  switch (code) {
    case "UNAUTHENTICATED":
      return "You must be signed in to view the catalog.";
    case "FORBIDDEN":
      return "You do not have permission to manage catalog items.";
    case "FEATURE_NOT_ENTITLED":
      return "The catalog is not enabled for this tenant.";
    case "NOT_FOUND":
      return "Catalog item not found.";
    default:
      return error.message;
  }
}
