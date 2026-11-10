import { expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  createRange,
  declareIssuancePoint,
  EMITTER,
  listRanges,
  openFiscalSettings,
  POINT,
  retireActiveRangesAtPoint,
  saveEstablishment,
  saveProfile,
  section,
  timbradoNumber,
} from "./fiscal-settings.js";
import { buildSigningContainer } from "./signing-certificate.js";
import { bff, ensureSingleOpenSession, type SaleRecord } from "./staff.js";

/**
 * The electronic-issuance half of the fiscal specs ([[FISC-019]], [[NCE-001]], [[FISC-021]]): a
 * tenant configured through «Configuración fiscal», a sale whose invoice is confirmed and issued,
 * and the wait for the worker to approve it.
 *
 * Everything goes through public surfaces — the screens, and the staff BFF where the flow has no
 * screen of its own or the spec needs an id. No SQL, and no approval is fabricated: the factura
 * electrónica reaches APPROVED because the worker assembled, signed and submitted it.
 */

/** DEC-057's generic test identifier, with a 32-character alphanumeric value. */
const CSC_ID = "0001";
const CSC_VALUE = "ABCD0000000000000000000000000000";

const TERMINAL_FAILURES = new Set(["REJECTED", "ERROR", "CANCELLED"]);

export interface FiscalDocument {
  readonly id: string;
  readonly status: string;
  readonly lastErrorCode: string | null;
  readonly cdc: string | null;
  readonly hasKude?: boolean;
}

/** Retires, through the screen, every ACTIVE row of one secret section. */
async function retireActiveSecrets(page: Page, title: string, dialogName: string): Promise<void> {
  const region = section(page, title);
  const loaded = region
    .getByRole("list", { name: `${title}: metadatos` })
    .or(region.getByText(/^Todavía no hay/));
  await expect(loaded).toBeVisible();
  const retire = region.getByRole("button", { name: "Retirar", exact: true });
  while ((await retire.count()) > 0) {
    const before = await retire.count();
    await retire.first().click();
    const dialog = page.getByRole("dialog", { name: dialogName });
    await dialog.getByLabel("Motivo").fill("Reemplazado por la prueba e2e");
    await dialog.getByRole("button", { name: "Retirar material", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(retire).toHaveCount(before - 1);
  }
}

/**
 * «Configuración fiscal», all through the screen: profile, establishment, a factura range (type 1)
 * and a nota de crédito range (type 5), the issuance point, the tenant's IVA classification, a
 * signing certificate generated now for the profile's RUC (uploaded as multipart through the
 * screen) and a CSC, both for the TEST environment the worker runs in.
 *
 * The lane's database outlives a run, so it converges: ACTIVE certificates and CSCs an earlier run
 * left are retired through the screen first — they were encrypted under that run's master key,
 * which this run does not hold — and the ranges are fresh each time.
 */
export async function configureElectronicIssuance(page: Page): Promise<void> {
  await openFiscalSettings(page);
  await retireActiveSecrets(page, "Certificado de firma", "¿Retirar el certificado?");
  await retireActiveSecrets(page, "CSC", "¿Retirar el CSC?");
  await saveProfile(page);
  const establishmentId = await saveEstablishment(page);
  await retireActiveRangesAtPoint(page);
  const factura = timbradoNumber(11);
  const notaCredito = timbradoNumber(12);
  await createRange(page, {
    establishmentId,
    point: POINT,
    documentType: "1",
    timbrado: factura,
  });
  await createRange(page, {
    establishmentId,
    point: POINT,
    documentType: "5",
    timbrado: notaCredito,
  });
  const facturaRange = (await listRanges(page)).find(
    (range) => range.timbradoNumber === factura && range.documentType === 1
  );
  expect(facturaRange?.status).toBe("ACTIVE");
  await declareIssuancePoint(page, facturaRange?.id ?? "");
  await expect(
    section(page, "Punto de expedición").getByTestId("credit-note-range-warning")
  ).toHaveCount(0);

  const taxes = section(page, "Clasificación tributaria");
  const classify = taxes.getByRole("form", { name: "Declarar clasificación tributaria" });
  await classify.getByLabel("Alícuota", { exact: true }).selectOption("IVA_10");
  await classify.getByLabel("Tratamiento fiscal", { exact: true }).selectOption("GRAVADO_IVA");
  await classify.getByRole("button", { name: "Guardar clasificación", exact: true }).click();
  await expect(
    page.getByText("Se guardó la clasificación tributaria.", { exact: true })
  ).toBeVisible();

  const container = buildSigningContainer(EMITTER.ruc, EMITTER.checkDigit);
  const certificate = section(page, "Certificado de firma");
  const upload = certificate.getByRole("form", { name: "Subir certificado" });
  await upload.getByLabel("Ambiente", { exact: true }).selectOption("TEST");
  await upload.getByLabel("Archivo PKCS#12", { exact: true }).setInputFiles({
    name: "certificado-e2e.p12",
    mimeType: "application/x-pkcs12",
    buffer: container.file,
  });
  await upload.getByLabel("Contraseña del certificado", { exact: true }).fill(container.password);
  await upload.getByRole("button", { name: "Subir certificado", exact: true }).click();
  await expect(certificate.getByText("Se guardó el certificado de firma.")).toBeVisible();
  await expect(
    certificate.getByRole("listitem").filter({ hasText: "Pruebas · Activo" })
  ).toHaveCount(1);

  const csc = section(page, "CSC");
  const load = csc.getByRole("form", { name: "Cargar CSC" });
  await load.getByLabel("Ambiente", { exact: true }).selectOption("TEST");
  await load.getByLabel("Identificador CSC", { exact: true }).fill(CSC_ID);
  await load.getByLabel("Valor del CSC", { exact: true }).fill(CSC_VALUE);
  await load.getByRole("button", { name: "Cargar CSC", exact: true }).click();
  await expect(csc.getByText("Se guardó el CSC.")).toBeVisible();
  await expect(
    csc.getByRole("listitem").filter({ hasText: `${CSC_ID} · Pruebas · Activo` })
  ).toHaveCount(1);
}

/** A service item with the IVA 10 rate and the SIFEN unit the DE needs. */
export async function createFiscalServiceItem(
  request: APIRequestContext,
  name: string
): Promise<{ id: string }> {
  const rates = await bff<{ id: string; code: string }[]>(request, "GET", "/api/catalog/tax-rates");
  const iva10 = rates.find((rate) => rate.code === "IVA_10");
  expect(iva10).toBeDefined();
  return bff<{ id: string }>(request, "POST", "/api/catalog", {
    kind: "SERVICE",
    name,
    taxRateId: iva10?.id,
    referencePriceAmount: "110000.00",
    referencePriceCurrency: "PYG",
    unitOfMeasureCode: "77",
  });
}

/** Polls the fiscal document through the BFF until it leaves the pipeline. */
export async function waitForApproval(
  page: Page,
  id: string,
  workerOutput: () => string
): Promise<FiscalDocument> {
  let last: FiscalDocument | undefined;
  const settled = expect
    .poll(
      async () => {
        last = await bff<FiscalDocument>(page.request, "GET", `/api/fiscal/fiscal-documents/${id}`);
        if (TERMINAL_FAILURES.has(last.status)) {
          throw new Error(
            `The fiscal document ended ${last.status} (${last.lastErrorCode ?? "no code"}).`
          );
        }
        return last.status;
      },
      { timeout: 60_000, intervals: [500, 1_000, 2_000] }
    )
    .toBe("APPROVED");
  try {
    await settled;
  } catch (error) {
    // A document stuck in the pipeline is diagnosed by what the worker printed, not by its status.
    throw new Error(`${(error as Error).message}\n\nWorker output:\n${workerOutput()}`);
  }
  if (last === undefined) throw new Error("The fiscal document was never read.");
  return last;
}

/**
 * A cash sale of one item to `customerId`, its invoice confirmed and its factura electrónica
 * issued; resolves once the worker has approved it.
 */
export async function sellAndApprove(
  page: Page,
  args: {
    readonly customerId: string;
    readonly itemId: string;
    readonly workerOutput: () => string;
  }
): Promise<{ sale: SaleRecord; invoiceId: string; approved: FiscalDocument }> {
  const request = page.request;
  await ensureSingleOpenSession(request);
  const draft = await bff<SaleRecord>(request, "POST", "/api/sales", {
    customerId: args.customerId,
    lines: [{ catalogItemId: args.itemId, quantity: "1" }],
  });
  const sale = await bff<SaleRecord>(request, "POST", `/api/sales/${draft.id}/complete`, {
    payments: [{ method: "CASH", amount: draft.total }],
  });
  expect(sale.status).toBe("COMPLETED");
  const invoice = await bff<{ id: string }>(request, "POST", "/api/billing/invoices", {
    saleId: sale.id,
  });
  const confirmed = await bff<{ status: string }>(
    request,
    "POST",
    `/api/billing/invoices/${invoice.id}/confirm`,
    {}
  );
  expect(confirmed.status).toBe("CONFIRMED");
  const issued = await bff<FiscalDocument>(request, "POST", "/api/fiscal/fiscal-documents", {
    invoiceId: invoice.id,
  });
  const approved = await waitForApproval(page, issued.id, args.workerOutput);
  expect(approved.cdc).toMatch(/^\d{44}$/);
  return { sale, invoiceId: invoice.id, approved };
}
