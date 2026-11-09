import { expect, test, type Locator, type Page } from "@playwright/test";
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
 * NOT covered here: NCE-001's "anular una venta facturada emite la nota de crédito". It needs the
 * sale's factura electrónica APPROVED, and the worker's assembly refuses to build a DE without the
 * tenant's signing certificate (uploaded only through the API; its screen is DEC-095 delivery 3) and
 * its CSC (no route writes it). The lane does not fake either with SQL.
 */
const POINT = "001";
const SPARE_POINT = "999";

/** A fresh 8-digit timbrado number (`^0*[1-9][0-9]*$`, length 8) per run and offset. */
function timbradoNumber(offset: number): string {
  return String(10_000_000 + ((Date.now() + offset) % 89_999_000));
}

interface Establishment {
  readonly id: string;
  readonly code: string;
}
interface Range {
  readonly id: string;
  readonly timbradoNumber: string;
  readonly documentType: number;
  readonly status: string;
}

function section(page: Page, name: string): Locator {
  return page.getByRole("region", { name });
}

async function retireRow(page: Page, row: Locator, timbrado: string): Promise<void> {
  await row.getByRole("button", { name: "Retirar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `¿Retirar el timbrado ${timbrado}?` });
  const confirm = dialog.getByRole("button", { name: "Retirar timbrado", exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Motivo").fill("Reemplazado por la prueba e2e");
  await confirm.click();
  await expect(page.getByText(`Se retiró el timbrado ${timbrado}.`, { exact: true })).toBeVisible();
}

async function createRange(
  page: Page,
  input: { establishmentId: string; point: string; documentType: string; timbrado: string }
): Promise<void> {
  const ranges = section(page, "Timbrados");
  await ranges.getByRole("button", { name: "Agregar timbrado", exact: true }).click();
  const form = ranges.getByRole("form", { name: "Nuevo timbrado" });
  await form.getByLabel("Establecimiento", { exact: true }).selectOption(input.establishmentId);
  await form.getByLabel("Punto de expedición", { exact: true }).fill(input.point);
  await form.getByLabel("Tipo de documento", { exact: true }).selectOption(input.documentType);
  await form.getByLabel("Número de timbrado", { exact: true }).fill(input.timbrado);
  await form.getByLabel("Inicio de vigencia", { exact: true }).fill("2026-01-01");
  await form.getByLabel("Desde el número", { exact: true }).fill("1");
  await form.getByLabel("Hasta el número", { exact: true }).fill("1000");
  await form.getByRole("button", { name: "Guardar timbrado", exact: true }).click();
  await expect(
    page.getByText(`Se cargó el timbrado ${input.timbrado}.`, { exact: true })
  ).toBeVisible();
}

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
    const profile = section(page, "Perfil del emisor");
    const create = profile.getByRole("button", { name: "Crear perfil fiscal", exact: true });
    const edit = profile.getByRole("button", { name: "Editar perfil", exact: true });
    await expect(create.or(edit)).toBeVisible();
    await ((await create.isVisible()) ? create : edit).click();
    await profile.getByLabel("RUC", { exact: true }).fill("80012345");
    await profile.getByLabel("Dígito verificador", { exact: true }).fill("0");
    await profile.getByLabel("Tipo de contribuyente", { exact: true }).selectOption("2");
    await profile.getByLabel("Razón social", { exact: true }).fill("Clínica Veterinaria Demo S.A.");
    await profile.getByLabel("Tipo de transacción", { exact: true }).selectOption("2");
    await profile.getByLabel("Código de actividad 1", { exact: true }).fill("75000");
    await profile
      .getByLabel("Descripción de actividad 1", { exact: true })
      .fill("Actividades veterinarias");
    await profile.getByRole("button", { name: "Guardar perfil", exact: true }).click();
    await expect(page.getByText("Se guardó el perfil fiscal.", { exact: true })).toBeVisible();
    await expect(profile.getByText("80012345-0", { exact: true })).toBeVisible();

    // Establishment 001: added when absent, otherwise edited.
    const establishments = section(page, "Establecimientos");
    await expect(
      establishments
        .getByTestId("establishment-row")
        .first()
        .or(establishments.getByText("Todavía no hay establecimientos", { exact: true }))
    ).toBeVisible();
    const existing = establishments
      .getByTestId("establishment-row")
      .filter({ has: page.getByText(POINT, { exact: true }) });
    let form: Locator;
    if ((await existing.count()) > 0) {
      await existing.getByRole("button", { name: "Editar", exact: true }).click();
      form = establishments.getByRole("form", { name: `Editar establecimiento ${POINT}` });
    } else {
      await establishments.getByRole("button", { name: "Agregar establecimiento" }).click();
      form = establishments.getByRole("form", { name: "Nuevo establecimiento" });
      await form.getByLabel("Código", { exact: true }).fill(POINT);
    }
    await form.getByLabel("Dirección", { exact: true }).fill("Av. Mcal. López");
    await form.getByLabel("Número de casa", { exact: true }).fill("1234");
    await form.getByLabel("Departamento", { exact: true }).selectOption("1");
    await form.getByLabel("Código de ciudad", { exact: true }).fill("1");
    await form.getByLabel("Ciudad", { exact: true }).fill("Asunción");
    await form.getByLabel("Teléfono", { exact: true }).fill("021600000");
    await form.getByLabel("Correo", { exact: true }).fill("fiscal@demo.newsaas.test");
    await form.getByRole("button", { name: "Guardar establecimiento", exact: true }).click();
    await expect(
      page.getByText(`Se guardó el establecimiento ${POINT}.`, { exact: true })
    ).toBeVisible();
    const establishment = (
      await bff<{ items: Establishment[] }>(request, "GET", "/api/fiscal/establishments")
    ).items.find((item) => item.code === POINT);
    expect(establishment).toBeDefined();
    const establishmentId = establishment?.id ?? "";

    // Converge: retire the ACTIVE ranges an earlier run left at 001-001.
    const rangesSection = section(page, "Timbrados");
    await expect(
      rangesSection
        .getByTestId("range-row")
        .first()
        .or(rangesSection.getByText("Todavía no hay timbrados", { exact: true }))
    ).toBeVisible();
    const stale = (await bff<{ items: Range[] }>(request, "GET", "/api/fiscal/timbrado-ranges"))
      .items;
    for (const range of stale) {
      if (range.status !== "ACTIVE") continue;
      const row = rangesSection
        .getByTestId("range-row")
        .filter({ hasText: `${POINT}-${POINT} · timbrado ${range.timbradoNumber}` });
      if ((await row.count()) === 0) continue;
      await retireRow(page, row, range.timbradoNumber);
    }

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
    const facturaRange = (
      await bff<{ items: Range[] }>(request, "GET", "/api/fiscal/timbrado-ranges")
    ).items.find((range) => range.timbradoNumber === factura && range.documentType === 1);
    expect(facturaRange?.status).toBe("ACTIVE");

    const point = section(page, "Punto de expedición");
    await point.getByLabel("Timbrado activo", { exact: true }).selectOption(facturaRange?.id ?? "");
    await point.getByRole("button", { name: "Declarar punto de expedición", exact: true }).click();
    await expect(
      page.getByText(`Se declaró el punto de expedición ${POINT}-${POINT} (Factura electrónica).`, {
        exact: true,
      })
    ).toBeVisible();
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
