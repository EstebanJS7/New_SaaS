import { expect, test } from "@playwright/test";
import { esPyMoney } from "../support/es-py-format.js";
import {
  addToCartAndCheckout,
  bff,
  createCatalogItem,
  ensureSingleOpenSession,
  receiveStock,
  runTag,
  salesOf,
  sessionMovements,
  signInAsStaff,
  stockOnHand,
  type SaleRecord,
} from "../support/staff.js";

/**
 * Reversal of a completed cash sale ([[SAL-REV-001]]), driven through the built apps.
 *
 * The story's objective is the whole correction: "anular la venta entera, devolver el stock,
 * registrar la devolución de cada pago y sacar el efectivo de la caja". So the spec sells a
 * stock-tracked item for cash through the POS, reverses it from the sale's detail with a reason, and
 * then checks each of those effects where the product exposes it: the reversal card on the detail,
 * the stock balance, the open session's cash movements and the sale's own status.
 */
test.describe("reversing a completed sale", () => {
  test("a cash sale is reversed from its detail: stock returns and the cash leaves the drawer", async ({
    page,
  }) => {
    await signInAsStaff(page);
    const request = page.request;
    const session = await ensureSingleOpenSession(request);
    const item = await createCatalogItem(request, {
      name: `Collar anulación ${runTag()}`,
      kind: "PRODUCT",
      price: "25000.00",
    });
    await receiveStock(request, item, "5");
    expect(await stockOnHand(request, item.id)).toBe(5);
    const movementsBefore = await sessionMovements(request, session.id);

    // Sell one unit for cash, the ordinary way.
    await addToCartAndCheckout(page, item);
    await page.getByRole("button", { name: "Revisar venta", exact: true }).click();
    const review = page.getByRole("dialog", { name: "Revisar y confirmar venta" });
    await review.getByRole("button", { name: "Confirmar venta", exact: true }).click();
    await expect(page.getByText("Venta completada", { exact: true })).toBeVisible();

    const [sale] = await salesOf(request, item.id);
    expect(sale?.status).toBe("COMPLETED");
    const saleId = sale?.id ?? "";
    const total = sale?.total ?? "";
    expect(await stockOnHand(request, item.id)).toBe(4);
    const afterSale = await sessionMovements(request, session.id);
    expect(afterSale.length).toBe(movementsBefore.length + 1);

    // Reverse it from the detail. The confirmation refuses a missing reason.
    await page.goto(`/app/sales/${saleId}`);
    await expect(page.getByText("Venta completada.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Anular venta", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "¿Anular esta venta?" });
    await expect(dialog).toContainText(esPyMoney(total, "PYG"));
    const confirm = dialog.getByRole("button", { name: "Anular venta", exact: true });
    await expect(confirm).toBeDisabled();
    const reason = `Cobro equivocado ${runTag()}`;
    await dialog.getByLabel("Motivo").fill(reason);
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // The detail now shows a cancelled sale and its reversal: when, why, and each refund.
    const record = page.getByTestId("sale-reversal-record");
    await expect(record).toBeVisible();
    await expect(record).toContainText("Venta anulada");
    await expect(record).toContainText(reason);
    await expect(record).toContainText("Efectivo (salió de la caja abierta)");
    await expect(record).toContainText(esPyMoney(total, "PYG"));
    await expect(record.getByTestId("sale-credit-note")).toHaveCount(0);
    await expect(page.getByText("Venta cancelada.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Anular venta", exact: true })).toHaveCount(0);

    // The authoritative reads agree: the sale is CANCELLED, the unit is back on hand, and the
    // open session holds one REFUND of the cash that came in.
    const reread = await bff<SaleRecord>(request, "GET", `/api/sales/${saleId}`);
    expect(reread.status).toBe("CANCELLED");
    expect(await stockOnHand(request, item.id)).toBe(5);
    const afterReversal = await sessionMovements(request, session.id);
    expect(afterReversal.length).toBe(afterSale.length + 1);
    const refunds = afterReversal.filter(
      (movement) => !afterSale.some((earlier) => earlier.id === movement.id)
    );
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.type).toBe("REFUND");
    expect(refunds[0]?.amount).toBe(total);

    const reversal = await bff<{
      reason: string;
      cashSessionId: string | null;
      refunds: { method: string; amount: string }[];
    }>(request, "GET", `/api/sales/${saleId}/reversal`);
    expect(reversal.reason).toBe(reason);
    expect(reversal.cashSessionId).toBe(session.id);
    expect(reversal.refunds).toEqual([expect.objectContaining({ method: "CASH", amount: total })]);

    // A reload reads the same reversal back from the server, not from the page's memory.
    await page.reload();
    await expect(page.getByTestId("sale-reversal-record")).toContainText(reason);
  });
});
