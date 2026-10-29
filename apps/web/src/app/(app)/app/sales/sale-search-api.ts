import { ApiRequestError, userFacingSaleError, type SaleStatus } from "./sales-api";
export { ApiRequestError, userFacingSaleError };
export interface SaleSearchInput {
  q: string;
  page: number;
  status: "all" | SaleStatus;
  sort: "recent" | "oldest";
}
export interface SaleSearchResult {
  items: {
    id: string;
    status: SaleStatus;
    createdAt: string;
    customerName: string | null;
    hasCustomer: boolean;
  }[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  canReadCustomers: boolean;
}
/** Read-only POST; confidential search text stays in the body. */
export async function searchSales(
  input: SaleSearchInput,
  signal?: AbortSignal
): Promise<SaleSearchResult> {
  const response = await fetch("/api/sales/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiRequestError(
      body?.error?.code ?? "INTERNAL",
      body?.error?.message ?? "No pudimos cargar las ventas.",
      response.status
    );
  }
  return (await response.json()) as SaleSearchResult;
}
