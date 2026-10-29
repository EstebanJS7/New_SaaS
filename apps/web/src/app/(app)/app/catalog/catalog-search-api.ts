export interface CatalogSearchInput {
  q: string;
  page: number;
  status: "active" | "inactive" | "all";
  kind: "all" | "PRODUCT" | "SERVICE" | "MEDICATION" | "SUPPLY";
  sort: "name" | "recent";
}
export interface CatalogSearchRow {
  id: string;
  name: string;
  kind: "PRODUCT" | "SERVICE" | "MEDICATION" | "SUPPLY";
  isActive: boolean;
  taxRateName: string;
  referencePriceAmount: string | null;
  referencePriceCurrency: string | null;
}
export interface CatalogSearchResult {
  items: CatalogSearchRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export class CatalogSearchError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(code);
  }
}
export function userFacingCatalogSearchError(error: Error): string {
  if (error instanceof CatalogSearchError) {
    if (error.code === "FEATURE_NOT_ENTITLED")
      return "El catálogo no está habilitado para esta organización.";
    if (error.code === "UNAUTHENTICATED" || error.status === 401)
      return "Iniciá sesión para ver los artículos del catálogo.";
    if (error.code === "FORBIDDEN" || error.status === 403)
      return "No tenés permiso para ver los artículos del catálogo.";
    if (error.code === "VALIDATION_FAILED")
      return "Revisá la búsqueda y los filtros e intentá de nuevo.";
  }
  return "No pudimos completar la búsqueda. Revisá la conexión y volvé a intentar.";
}
/** Confidential input in POST body only; cancellation protects newer results. */
export async function searchCatalog(
  input: CatalogSearchInput,
  signal?: AbortSignal
): Promise<CatalogSearchResult> {
  const response = await fetch("/api/catalog/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const error =
      typeof payload === "object" && payload !== null && "error" in payload ? payload.error : null;
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "INTERNAL";
    throw new CatalogSearchError(code, response.status);
  }
  return (await response.json()) as CatalogSearchResult;
}
