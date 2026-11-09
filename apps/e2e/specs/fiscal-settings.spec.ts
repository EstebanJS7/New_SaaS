import { expect, test } from "@playwright/test";
import {
  createRange,
  declareIssuancePoint,
  listRanges,
  POINT,
  retireActiveRangesAtPoint,
  retireRow,
  saveEstablishment,
  saveProfile,
  section,
  timbradoNumber,
} from "../support/fiscal-settings.js";
import { bff, signInAsStaff } from "../support/staff.js";

/**
 * The fiscal settings screen ([[FISC-018]], [[DEC-095]] delivery 2), driven through the built apps.
 *
 * The story's browser criterion is the configuration path a clinic follows before it can issue:
 * profile → establishment → a factura range (type 1) and a nota de crédito range (type 5) → the
 * issuance point, declared through the screen (FISC-017's route behind the `/api/fiscal` proxy).
 * Along the way it proves the credit-note warning (declared with no type-5 range, cleared once one
 * is loaded) and the retirement with a reason and an explicit confirmation.
 *
 * The lane's database outlives a run, so the spec converges rather than assumes: the profile is
 * created or edited, establishment 001 is added or edited, and ACTIVE ranges an earlier run left at
 * 001-001 are retired first — otherwise the declaration would be the API's "más de un timbrado
 * activo" 409. Each run registers fresh timbrado numbers, which the range identity requires.
 *
 * The steps live in `support/fiscal-settings.ts`, which `electronic-credit-note.spec.ts` reuses to
 * configure the same tenant before it proves NCE-001's "anular una venta facturada emite la nota de
 * crédito".
 */
const SPARE_POINT = "999";

test.describe("fiscal settings screen", () => {
  test("the owner configures profile, establishment, ranges and the issuance point", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInAsStaff(page);
    const request = page.request;

    // The link lives in «Configuración» and leads to the screen.
    await page.getByRole("link", { name: "Configuración fiscal", exact: true }).first().click();
    await expect(page).toHaveURL(/\/app\/settings\/fiscal$/);
    await expect(
      page.getByRole("heading", { name: "Configuración fiscal", level: 1 })
    ).toBeVisible();

    // Profile: created when absent, otherwise edited and saved whole.
    await saveProfile(page);

    // Establishment 001: added when absent, otherwise edited.
    const establishmentId = await saveEstablishment(page);

    // Converge: retire the ACTIVE ranges an earlier run left at 001-001.
    await retireActiveRangesAtPoint(page);
    const rangesSection = section(page, "Timbrados");

    // Retirement with a reason and an explicit confirmation, on a spare range of this run.
    const spare = timbradoNumber(3);
    await createRange(page, {
      establishmentId,
      point: SPARE_POINT,
      documentType: "1",
      timbrado: spare,
    });
    await retireRow(
      page,
      rangesSection.getByTestId("range-row").filter({ hasText: `timbrado ${spare}` }),
      spare
    );
    await expect(
      rangesSection
        .getByTestId("range-row")
        .filter({ hasText: `timbrado ${spare}` })
        .getByText("Retirado", { exact: true })
    ).toBeVisible();

    // The factura range, then the declaration: no credit-note range yet, so the screen warns.
    const factura = timbradoNumber(1);
    await createRange(page, {
      establishmentId,
      point: POINT,
      documentType: "1",
      timbrado: factura,
    });
    const facturaRange = (await listRanges(page)).find(
      (range) => range.timbradoNumber === factura && range.documentType === 1
    );
    expect(facturaRange?.status).toBe("ACTIVE");

    await declareIssuancePoint(page, facturaRange?.id ?? "");
    const point = section(page, "Punto de expedición");
    await expect(
      point.getByText(`${POINT}-${POINT} · Factura electrónica`, { exact: true })
    ).toBeVisible();
    await expect(point.getByTestId("credit-note-range-warning")).toContainText(
      `No hay un timbrado activo de nota de crédito para ${POINT}-${POINT}`
    );

    // The credit-note range clears the warning.
    const notaCredito = timbradoNumber(2);
    await createRange(page, {
      establishmentId,
      point: POINT,
      documentType: "5",
      timbrado: notaCredito,
    });
    await expect(point.getByTestId("credit-note-range-warning")).toHaveCount(0);

    // What the API holds: the declared point, read back through the same proxy.
    const saved = await bff<{
      issuancePoint: {
        establishmentId: string;
        expeditionPoint: string;
        documentType: number;
      } | null;
    }>(request, "GET", "/api/fiscal/emitter-profile");
    expect(saved.issuancePoint).toEqual(
      expect.objectContaining({ establishmentId, expeditionPoint: POINT, documentType: 1 })
    );
  });
});
