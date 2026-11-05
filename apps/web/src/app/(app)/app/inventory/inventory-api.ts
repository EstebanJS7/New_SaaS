/**
 * MB-003 (DEC-094 §10): the stock screen's client for the allowlisted
 * `/api/inventory` proxy — balances per branch, the clinic's active branches
 * and the transfer command. The API is the authority for permissions and
 * stock rules; this module only shapes requests and Spanish error copy.
 */

export interface StockBalance {
  readonly id: string;
  readonly catalogItemId: string;
  readonly item: { readonly name: string; readonly kind: string };
  readonly branchId: string;
  readonly branchName: string | null;
  /** Fixed-scale decimal literal, e.g. `"12.500"`. */
  readonly quantity: string;
}

export interface StockBranch {
  readonly id: string;
  readonly name: string;
}

export interface StockTransferInput {
  readonly catalogItemId: string;
  readonly fromBranchId: string;
  readonly toBranchId: string;
  readonly quantity: string;
  readonly reason: string;
}

/** Mirrors the API controller's refusal of a malformed transfer body. */
export const INVALID_TRANSFER_BODY_MESSAGE = "Invalid stock transfer body.";

export class InventoryRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string
  ) {
    super(message);
    this.name = "InventoryRequestError";
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  let code: string | null = null;
  let message = `La solicitud falló (${response.status}).`;
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    code = body.error?.code ?? null;
    message = body.error?.message ?? message;
  } catch {
    // A body that is not JSON keeps the generic message.
  }
  throw new InventoryRequestError(response.status, code, message);
}

export async function listStockBalances(branchId: string | null): Promise<StockBalance[]> {
  const query = branchId === null ? "" : `?branchId=${encodeURIComponent(branchId)}`;
  const response = await fetch(`/api/inventory/stock${query}`, { cache: "no-store" });
  return readJson<StockBalance[]>(response);
}

export async function listStockBranches(): Promise<StockBranch[]> {
  const response = await fetch("/api/inventory/stock/branches", { cache: "no-store" });
  return readJson<StockBranch[]>(response);
}

export async function createStockTransfer(input: StockTransferInput): Promise<unknown> {
  const response = await fetch("/api/inventory/stock/transfers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<unknown>(response);
}

/**
 * Spanish copy for a failed request. The API's own branch and stock messages
 * are already Spanish and are shown as they come; validation and permission
 * failures get a fixed sentence.
 */
export function userFacingInventoryError(error: Error): string {
  if (!(error instanceof InventoryRequestError)) {
    return "No se pudo conectar con el servidor. Probá de nuevo.";
  }
  if (error.status === 403) return "No tenés permiso para esta acción de stock.";
  // The body-shape refusal is the API's one English sentence on this route.
  if (error.code === "VALIDATION_FAILED" && error.message === INVALID_TRANSFER_BODY_MESSAGE) {
    return "Revisá los datos: el origen y el destino deben ser distintos y la cantidad, positiva.";
  }
  return error.message;
}
