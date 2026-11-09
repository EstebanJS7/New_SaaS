import { expect, test, type Locator, type Page } from "@playwright/test";
import { esPyMoney } from "../support/es-py-format.js";
import {
  addToCartAndCheckout,
  bff,
  createCatalogItem,
  runTag,
  salesOf,
  signInAsStaff,
  type SaleRecord,
} from "../support/staff.js";

/**
 * The payment detail the factura electrónica needs ([[PAY-DET-001]]), taken at the POS.
 *
 * The story's browser criterion: "al elegir Tarjeta, QR, Cheque u Otro aparecen los campos;
 * «Revisar venta» no se habilita hasta completarlos; la revisión muestra el detalle." Each method is
 * tried alone on a payment that already equals the total, so the only thing keeping «Revisar venta»
 * disabled is the missing detail. Then one sale is paid with all four, reviewed, and completed.
 *
 * What the spec can read back: the request the page sent (the detail exactly as entered), the
 * API's 201 with one payment per method, and the sale COMPLETED. The stored detail itself is
 * read by no endpoint the BFF exposes — the fiscal assembly is its only reader — so the proof that
 * it was persisted is that the database's insert guard, which refuses a card, QR, cheque or
 * "other" payment without its detail, let these rows in.
 */
const TOTAL = "40000.00";

function payment(page: Page, index: number): Record<string, Locator> {
  const n = index + 1;
  return {
    method: page.getByLabel(`Medio de pago ${n}`, { exact: true }),
    amount: page.getByLabel(`Importe del pago ${n}`, { exact: true }),
  };
}

test.describe("payment detail at the POS", () => {
  test("each method shows its fields, review waits for them, and completion sends them", async ({
    page,
  }) => {
    await signInAsStaff(page);
    const item = await createCatalogItem(page.request, {
      name: `Consulta medios ${runTag()}`,
      kind: "SERVICE",
      price: TOTAL,
    });
    await addToCartAndCheckout(page, item);

    const review = page.getByRole("button", { name: "Revisar venta", exact: true });
    const first = payment(page, 0);
    // Cash at the total is complete as it is: no detail fields, review available.
    await expect(first.method).toHaveValue("CASH");
    await expect(first.amount).toHaveValue("40000,00");
    await expect(page.getByLabel("Tipo de tarjeta")).toHaveCount(0);
    await expect(review).toBeEnabled();

    // Tarjeta: type and brand appear; «Otra» adds the brand name.
    await first.method.selectOption({ label: "Tarjeta" });
    await expect(page.getByLabel("Tipo de tarjeta")).toBeVisible();
    await expect(page.getByLabel("Marca de la tarjeta")).toBeVisible();
    await expect(
      page.getByText("Elegí si la tarjeta es de crédito o de débito, y su marca.")
    ).toBeVisible();
    await expect(review).toBeDisabled();
    await page.getByLabel("Tipo de tarjeta").selectOption({ label: "Crédito" });
    await expect(review).toBeDisabled();
    await page.getByLabel("Marca de la tarjeta").selectOption({ label: "Otra" });
    await expect(page.getByLabel("Nombre de la marca")).toBeVisible();
    await expect(review).toBeDisabled();
    await page.getByLabel("Nombre de la marca").fill("Bepsa");
    await expect(review).toBeEnabled();

    // QR: its kind.
    await first.method.selectOption({ label: "QR" });
    await expect(page.getByLabel("Tipo de tarjeta")).toHaveCount(0);
    await expect(page.getByLabel("Tipo de QR")).toBeVisible();
    await expect(review).toBeDisabled();
    await page.getByLabel("Tipo de QR").selectOption({ label: "Billetera electrónica" });
    await expect(review).toBeEnabled();

    // Cheque: number (digits only) and bank.
    await first.method.selectOption({ label: "Cheque" });
    await expect(page.getByLabel("Tipo de QR")).toHaveCount(0);
    await expect(page.getByLabel("Número de cheque")).toBeVisible();
    await expect(page.getByLabel("Banco del cheque")).toBeVisible();
    await expect(review).toBeDisabled();
    await page.getByLabel("Número de cheque").fill("12A");
    await page.getByLabel("Banco del cheque").fill("Banco Continental");
    await expect(review).toBeDisabled();
    await page.getByLabel("Número de cheque").fill("1234567");
    await expect(review).toBeEnabled();

    // Otro: a description.
    await first.method.selectOption({ label: "Otro" });
    await expect(page.getByLabel("Número de cheque")).toHaveCount(0);
    await expect(page.getByLabel("Descripción del medio de pago")).toBeVisible();
    await expect(review).toBeDisabled();
    await page.getByLabel("Descripción del medio de pago").fill("Gif");
    await expect(review).toBeDisabled();
    await page.getByLabel("Descripción del medio de pago").fill("Gift card clínica");
    await expect(review).toBeEnabled();

    // Now one sale paid with the four methods, 10.000 each.
    await first.method.selectOption({ label: "Tarjeta" });
    await first.amount.fill("10.000");
    await page.getByLabel("Marca de la tarjeta").selectOption({ label: "Visa" });
    for (const index of [1, 2, 3]) {
      await page.getByRole("button", { name: "Agregar medio de pago", exact: true }).click();
      await payment(page, index).amount.fill("10.000");
    }
    // A new payment starts as Tarjeta with no detail: review waits for it.
    await expect(review).toBeDisabled();
    await payment(page, 1).method.selectOption({ label: "QR" });
    await page.locator("#payment-1-qr-kind").selectOption({ label: "App del banco" });
    await payment(page, 2).method.selectOption({ label: "Cheque" });
    await page.locator("#payment-2-check-number").fill("7654321");
    await page.locator("#payment-2-check-bank").fill("Banco Itaú");
    await expect(review).toBeDisabled();
    await payment(page, 3).method.selectOption({ label: "Otro" });
    await page.locator("#payment-3-other-description").fill("Vale de regalo");
    await expect(page.getByTestId("payment-sum")).toHaveText(
      `Suma de pagos: ${esPyMoney(TOTAL, "PYG")}.`
    );
    await expect(review).toBeEnabled();

    // The review lists each payment with its detail.
    await review.click();
    const dialog = page.getByRole("dialog", { name: "Revisar y confirmar venta" });
    const tenThousand = esPyMoney("10000.00", "PYG");
    for (const line of [
      "Tarjeta · Crédito Visa · pago 1",
      "QR · App del banco · pago 2",
      "Cheque N° 7654321 · pago 3",
      "Otro · Vale de regalo · pago 4",
    ]) {
      const row = dialog.locator("dl > div").filter({ hasText: line });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(tenThousand);
    }

    const completion = page.waitForResponse(
      (response) =>
        /\/api\/sales\/[0-9a-f-]{36}\/complete$/.test(response.url()) &&
        response.request().method() === "POST"
    );
    await dialog.getByRole("button", { name: "Confirmar venta", exact: true }).click();
    const response = await completion;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON()).toEqual({
      payments: [
        {
          method: "CARD",
          amount: "10000",
          card: { type: "CREDIT", brand: "VISA" },
        },
        { method: "QR", amount: "10000", qrKind: "BANK_APP" },
        { method: "CHECK", amount: "10000", check: { number: "7654321", bank: "Banco Itaú" } },
        { method: "OTHER", amount: "10000", otherDescription: "Vale de regalo" },
      ],
    });
    const completed = (await response.json()) as {
      status: string;
      payments: { method: string; amount: string }[];
    };
    expect(completed.status).toBe("COMPLETED");
    expect(completed.payments.map((paid) => [paid.method, paid.amount]).sort()).toEqual([
      ["CARD", "10000.00"],
      ["CHECK", "10000.00"],
      ["OTHER", "10000.00"],
      ["QR", "10000.00"],
    ]);
    await expect(page.getByText("Venta completada", { exact: true })).toBeVisible();

    const [sale] = await salesOf(page.request, item.id);
    const reread = await bff<SaleRecord>(page.request, "GET", `/api/sales/${sale?.id ?? ""}`);
    expect(reread.status).toBe("COMPLETED");
    expect(reread.total).toBe(TOTAL);
  });
});
