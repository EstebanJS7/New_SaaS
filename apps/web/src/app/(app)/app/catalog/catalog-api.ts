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
  /**
   * Opt-in low-stock threshold as an exact fixed-scale (3 decimals) quantity
   * string, or `null` when the item is NOT monitored (DEC-065). `null` means
   * "no threshold", never zero. Optional here because this mirror is the
   * SUBSET of the DTO the staff UI consumes (it also omits `tracksStock`), so a
   * caller that does not read the threshold is not forced to model it.
   */
  readonly lowStockThreshold?: string | null;
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

/** Stable status/code plus an explicit uncertain outcome for catalog commands. */
export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly uncertain = false
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function parseError(response: Response, mutation = false): Promise<ApiRequestError> {
  const body: unknown = await response.json().catch(() => null);
  const envelope = typeof body === "object" && body !== null && "error" in body ? body.error : null;
  const fallback: Record<number, string> = {
    400: "VALIDATION_FAILED",
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
  };
  const code =
    typeof envelope === "object" &&
    envelope !== null &&
    "code" in envelope &&
    typeof envelope.code === "string"
      ? envelope.code
      : (fallback[response.status] ?? "UNKNOWN");
  return new ApiRequestError(
    code,
    "Solicitud de catálogo rechazada.",
    response.status,
    mutation && (response.status >= 500 || response.status === 408)
  );
}
async function request<T>(
  path: string,
  method: "GET" | "POST" | "PUT",
  body?: unknown
): Promise<T> {
  const mutation = method !== "GET";
  let response: Response;
  try {
    response = await fetch(`/api/catalog${path}`, {
      ...(mutation && {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      cache: "no-store",
    });
  } catch {
    throw new ApiRequestError("NETWORK_ERROR", "Conexión no disponible.", 0, mutation);
  }
  if (!response.ok) throw await parseError(response, mutation);
  const payload: unknown = await response.json().catch(() => null);
  if (
    payload === null ||
    typeof payload !== "object" ||
    (mutation && (!("id" in payload) || typeof payload.id !== "string" || !payload.id))
  )
    throw new ApiRequestError(
      "MALFORMED_RESPONSE",
      "Respuesta no confirmada.",
      response.status,
      mutation
    );
  return payload as T;
}
const getJson = <T>(path: string) => request<T>(path, "GET");
const postJson = <T>(path: string, body: unknown) => request<T>(path, "POST", body);
const putJson = <T>(path: string, body: unknown) => request<T>(path, "PUT", body);

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

/** UX-only; arbitrary server messages never reach the rendered surface. */
export function userFacingCatalogError(error: unknown): string {
  if (error instanceof ApiRequestError && error.uncertain)
    return "No pudimos confirmar el resultado. Revisá el artículo antes de repetir la operación; no volveremos a enviarla automáticamente.";
  const code = error instanceof ApiRequestError ? error.code : "";
  switch (code) {
    case "UNAUTHENTICATED":
      return "Iniciá sesión para ver el catálogo.";
    case "FORBIDDEN":
      return "No tenés permiso para gestionar artículos del catálogo.";
    case "FEATURE_NOT_ENTITLED":
      return "El catálogo no está habilitado para esta organización.";
    case "NOT_FOUND":
      return "No encontramos el artículo del catálogo.";
    case "VALIDATION_FAILED":
      return "Revisá los campos y sus límites antes de guardar.";
    case "CONFLICT":
      return "El artículo no admite este cambio. Revisá su estado actual.";
    default:
      return "No pudimos completar la solicitud del catálogo. Revisá la conexión y volvé a intentar.";
  }
}
export function catalogWriteBlocked(error: unknown): boolean {
  return (
    error instanceof ApiRequestError && (error.uncertain || [401, 403, 404].includes(error.status))
  );
}
