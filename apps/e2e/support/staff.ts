import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { DEMO } from "../specs/fixtures.js";

/**
 * The staff half of the lane's shared setup: signing in through the real login page, and the few
 * reads and preparatory commands a sales flow needs before the surface under test can be driven.
 *
 * Every call goes through the BFF (`/api/...`) with the page's own cookie jar — the same proxy, the
 * same tenant resolution and the same permission checks the browser uses. Nothing here writes the
 * database directly: the demo seed creates no catalog item, no stock and no cash register, so a
 * spec that sells has to create them the way a clinic would, and a run leaves only ordinary history
 * behind.
 */

/** A value unique to this run and call, for names the product requires to be unique. */
export function runTag(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Signs in through the login page and waits for the shell. */
export async function signInAsStaff(
  page: Page,
  email: string = DEMO.staffEmail,
  password: string = DEMO.staffPassword
): Promise<void> {
  await page.goto("/login");
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

/** One BFF call that must succeed; a failure reports the status and the body the BFF answered. */
export async function bff<T>(
  request: APIRequestContext,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<T> {
  const response =
    method === "GET"
      ? await request.get(path, { headers })
      : await request.post(path, { data: body ?? {}, headers });
  if (!response.ok()) {
    throw new Error(`${method} ${path} answered ${response.status()}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

interface TaxRate {
  readonly id: string;
  readonly code: string;
}

export interface CatalogItem {
  readonly id: string;
  readonly name: string;
}

/** Creates an active catalog item priced in PYG, taxed at IVA 10 %. */
export async function createCatalogItem(
  request: APIRequestContext,
  input: { readonly name: string; readonly kind: "PRODUCT" | "SERVICE"; readonly price: string }
): Promise<CatalogItem> {
  const rates = await bff<TaxRate[]>(request, "GET", "/api/catalog/tax-rates");
  const iva10 = rates.find((rate) => rate.code === "IVA_10");
  if (iva10 === undefined) throw new Error("The reference seed has no IVA_10 tax rate.");
  return bff<CatalogItem>(request, "POST", "/api/catalog", {
    kind: input.kind,
    name: input.name,
    taxRateId: iva10.id,
    referencePriceAmount: input.price,
    referencePriceCurrency: "PYG",
  });
}

/**
 * Puts stock on hand the way a clinic does: a purchase from a supplier, received. The BFF offers
 * no adjustment command, and the received purchase is the ledger's ordinary input.
 */
export async function receiveStock(
  request: APIRequestContext,
  item: CatalogItem,
  quantity: string
): Promise<void> {
  const supplier = await bff<{ id: string }>(request, "POST", "/api/suppliers", {
    name: `Proveedor ${item.name}`,
  });
  const purchase = await bff<{ id: string }>(request, "POST", "/api/purchases", {
    supplierId: supplier.id,
    lines: [{ catalogItemId: item.id, quantity, unitCost: "1000.00" }],
  });
  await bff(request, "POST", `/api/purchases/${purchase.id}/receive`, {});
}

/** The on-hand quantity of one item, as the API's balance reports it (`"0"` when there is none). */
export async function stockOnHand(request: APIRequestContext, itemId: string): Promise<number> {
  const balances = await bff<{ catalogItemId: string; quantity: string }[]>(
    request,
    "GET",
    "/api/inventory/stock"
  );
  return balances
    .filter((balance) => balance.catalogItemId === itemId)
    .reduce((sum, balance) => sum + Number(balance.quantity), 0);
}

export interface CashSession {
  readonly id: string;
  readonly registerId: string;
  readonly status: string;
  readonly openingAmount: string;
}

export interface CashMovement {
  readonly id: string;
  readonly sessionId: string;
  readonly type: string;
  readonly direction: string | null;
  readonly amount: string;
}

export async function openSessions(request: APIRequestContext): Promise<CashSession[]> {
  return bff<CashSession[]>(request, "GET", "/api/cash/sessions?status=OPEN");
}

/** Closes an open session with whatever was counted; a difference is allowed and recorded. */
export async function closeSession(request: APIRequestContext, sessionId: string): Promise<void> {
  await bff(request, "POST", `/api/cash/sessions/${sessionId}/close`, { countedAmount: "0" });
}

/**
 * Exactly ONE open cash session at the demo clinic's only branch, which is what a cash payment and a
 * cash refund require: none is "abrí una caja", two is "más de una caja abierta" and both refuse.
 * The lane's database outlives a run, so extra sessions an earlier run left open are closed here.
 */
export async function ensureSingleOpenSession(request: APIRequestContext): Promise<CashSession> {
  const open = await openSessions(request);
  for (const extra of open.slice(1)) await closeSession(request, extra.id);
  if (open[0] !== undefined) return open[0];
  const register = await bff<{ id: string }>(request, "POST", "/api/cash/registers", {
    name: `Caja e2e ${runTag()}`,
  });
  return bff<CashSession>(request, "POST", "/api/cash/sessions", {
    registerId: register.id,
    openingAmount: "100000.00",
  });
}

export async function sessionMovements(
  request: APIRequestContext,
  sessionId: string
): Promise<CashMovement[]> {
  return bff<CashMovement[]>(request, "GET", `/api/cash/movements?sessionId=${sessionId}`);
}

export interface SaleRecord {
  readonly id: string;
  readonly status: string;
  readonly total: string;
  readonly currency: string;
  readonly lines: readonly { readonly catalogItemId: string }[];
}

/** Every sale, in any status, that sells this item — the way a spec counts what a flow created. */
export async function salesOf(request: APIRequestContext, itemId: string): Promise<SaleRecord[]> {
  const sales = await bff<SaleRecord[]>(request, "GET", "/api/sales");
  return sales.filter((sale) => sale.lines.some((line) => line.catalogItemId === itemId));
}

/**
 * Opens the POS, adds one catalog item to the cart and creates the draft, waiting until the payment
 * step is on screen.
 */
export async function addToCartAndCheckout(page: Page, item: CatalogItem): Promise<void> {
  await page.goto("/app/sales");
  await page.getByLabel("Nombre del artículo", { exact: true }).fill(item.name);
  await page.getByRole("button", { name: "Agregar a la venta", exact: true }).click();
  await page.getByRole("button", { name: "Continuar al pago", exact: true }).click();
  await expect(page.getByRole("button", { name: "Revisar venta", exact: true })).toBeVisible();
}
