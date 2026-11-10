import { expect, test } from "@playwright/test";
import {
  configureElectronicIssuance,
  createFiscalServiceItem,
  sellAndApprove,
} from "../support/fiscal-issuance.js";
import { POINT } from "../support/fiscal-settings.js";
import { startFiscalWorker, type FiscalWorker } from "../support/fiscal-worker.js";
import { bff, runTag, signInAsStaff } from "../support/staff.js";

/**
 * The Nota de Crédito Electrónica a reversal issues ([[NCE-001]]), driven end to end through the
 * built apps, with the fiscal worker and the FAKE SIFEN provider ([[FISC-019]], [[FISC-020]]).
 *
 * Everything goes through public surfaces — the screens, and the staff BFF where the flow has no
 * screen of its own or the spec needs an id. No SQL, and no approval is fabricated: the factura
 * electrónica reaches APPROVED because the worker assembled, signed and submitted it.
 *
 * 1. «Configuración fiscal»: profile, establishment, a factura range (type 1) and a nota de crédito
 *    range (type 5), the issuance point, the tenant's IVA classification, a signing certificate
 *    generated now for the profile's RUC (uploaded as multipart through the screen) and a CSC, both
 *    for the TEST environment the worker runs in.
 * 2. A customer with a declared fiscal operation type and a catalog item with a SIFEN unit.
 * 3. A cash sale, its invoice confirmed and its fiscal document issued; the spec waits for APPROVED.
 * 4. The sale is reversed from its detail and the detail shows the credit note: its number, and its
 *    fiscal status once the worker has processed it too.
 *
 * The lane's database outlives a run, so the spec converges: ACTIVE certificates and CSCs an earlier
 * run left are retired through the screen first — they were encrypted under that run's master key,
 * which this run does not hold — and the ranges are fresh each time.
 */

interface Reversal {
  readonly creditNote: {
    readonly number: string;
    readonly fiscalStatus: string | null;
  } | null;
}

let fiscalWorker: FiscalWorker | undefined;

test.beforeAll(() => {
  fiscalWorker = startFiscalWorker();
});

test.afterAll(async () => {
  await fiscalWorker?.stop();
});

test.describe("electronic credit note", () => {
  test("reversing a sale whose factura electrónica was approved issues the nota de crédito", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await signInAsStaff(page);
    const request = page.request;

    // 1. Fiscal settings, all through the screen.
    await configureElectronicIssuance(page);

    // 2. The receptor and the item, each with the declaration the DE needs.
    const tag = runTag();
    const customer = await bff<{ id: string }>(request, "POST", "/api/customers", {
      kind: "INDIVIDUAL",
      displayName: `Cliente NC ${tag}`,
      firstName: "Cliente",
      lastName: `NC ${tag}`,
      documentNumber: String(1_000_000 + (Date.now() % 8_000_000)),
      fiscalOperationType: "B2C",
    });
    const item = await createFiscalServiceItem(request, `Consulta NC ${tag}`);

    // 3. A cash sale, its invoice confirmed, its factura electrónica issued and approved.
    const { sale } = await sellAndApprove(page, {
      customerId: customer.id,
      itemId: item.id,
      workerOutput: () => fiscalWorker?.output() ?? "(not started)",
    });

    // 4. The reversal, from the sale's detail, issues the nota de crédito.
    await page.goto(`/app/sales/${sale.id}`);
    await page.getByRole("button", { name: "Anular venta", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "¿Anular esta venta?" });
    const reason = `Devolución e2e ${tag}`;
    await dialog.getByLabel("Motivo").fill(reason);
    await dialog.getByRole("button", { name: "Anular venta", exact: true }).click();

    const record = page.getByTestId("sale-reversal-record");
    await expect(record).toContainText(reason);
    const note = record.getByTestId("sale-credit-note");
    await expect(note).toContainText("Nota de crédito electrónica");
    await expect(note).toContainText(new RegExp(`N° ${POINT}-${POINT}-\\d+`));

    const reversal = await bff<Reversal>(request, "GET", `/api/sales/${sale.id}/reversal`);
    const number = reversal.creditNote?.number ?? "";
    expect(number).toMatch(new RegExp(`^${POINT}-${POINT}-\\d+$`));
    await expect(note).toContainText(`N° ${number}`);

    // The note goes through the same pipeline; a reload reads its fiscal status from the server.
    await expect(async () => {
      await page.reload();
      await expect(page.getByTestId("sale-credit-note")).toContainText("Aprobada por SIFEN", {
        timeout: 2_000,
      });
    }).toPass({ timeout: 60_000, intervals: [1_000, 2_000] });
    const settled = await bff<Reversal>(request, "GET", `/api/sales/${sale.id}/reversal`);
    expect(settled.creditNote).toEqual({ ...reversal.creditNote, fiscalStatus: "APPROVED" });
  });
});
