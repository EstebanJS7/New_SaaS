import { expect, type Locator, type Page } from "@playwright/test";
import { bff } from "./staff.js";

/**
 * The «Configuración fiscal» screen's steps ([[FISC-018]]), shared by the specs that configure a
 * tenant for electronic issuance. Every step drives the screen; the BFF is read only to learn ids
 * the screen does not print.
 *
 * The lane's database outlives a run, so each step converges rather than assumes: the profile is
 * created or edited, the establishment is added or edited, and ACTIVE ranges at the point are
 * retired before fresh ones are loaded.
 */

/** The emitter the lane configures. The signing certificate must carry the same RUC. */
export const EMITTER = { ruc: "80012345", checkDigit: "0" } as const;
/** Establishment and expedition point code the lane issues from. */
export const POINT = "001";

export interface Establishment {
  readonly id: string;
  readonly code: string;
}
export interface Range {
  readonly id: string;
  readonly timbradoNumber: string;
  readonly documentType: number;
  readonly expeditionPoint?: string;
  readonly status: string;
}

/** A fresh 8-digit timbrado number (`^0*[1-9][0-9]*$`, length 8) per run and offset. */
export function timbradoNumber(offset: number): string {
  return String(10_000_000 + ((Date.now() + offset) % 89_999_000));
}

export function section(page: Page, name: string): Locator {
  return page.getByRole("region", { name });
}

export async function openFiscalSettings(page: Page): Promise<void> {
  await page.goto("/app/settings/fiscal");
  await expect(page.getByRole("heading", { name: "Configuración fiscal", level: 1 })).toBeVisible();
}

/** Profile: created when absent, otherwise edited and saved whole. */
export async function saveProfile(page: Page): Promise<void> {
  const profile = section(page, "Perfil del emisor");
  const create = profile.getByRole("button", { name: "Crear perfil fiscal", exact: true });
  const edit = profile.getByRole("button", { name: "Editar perfil", exact: true });
  await expect(create.or(edit)).toBeVisible();
  await ((await create.isVisible()) ? create : edit).click();
  await profile.getByLabel("RUC", { exact: true }).fill(EMITTER.ruc);
  await profile.getByLabel("Dígito verificador", { exact: true }).fill(EMITTER.checkDigit);
  await profile.getByLabel("Tipo de contribuyente", { exact: true }).selectOption("2");
  await profile.getByLabel("Razón social", { exact: true }).fill("Clínica Veterinaria Demo S.A.");
  await profile.getByLabel("Tipo de transacción", { exact: true }).selectOption("2");
  await profile.getByLabel("Código de actividad 1", { exact: true }).fill("75000");
  await profile
    .getByLabel("Descripción de actividad 1", { exact: true })
    .fill("Actividades veterinarias");
  await profile.getByRole("button", { name: "Guardar perfil", exact: true }).click();
  await expect(page.getByText("Se guardó el perfil fiscal.", { exact: true })).toBeVisible();
  await expect(
    profile.getByText(`${EMITTER.ruc}-${EMITTER.checkDigit}`, { exact: true })
  ).toBeVisible();
}

/** Establishment {@link POINT}: added when absent, otherwise edited. Returns its id. */
export async function saveEstablishment(page: Page): Promise<string> {
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
    await bff<{ items: Establishment[] }>(page.request, "GET", "/api/fiscal/establishments")
  ).items.find((item) => item.code === POINT);
  expect(establishment).toBeDefined();
  return establishment?.id ?? "";
}

export async function listRanges(page: Page): Promise<Range[]> {
  return (await bff<{ items: Range[] }>(page.request, "GET", "/api/fiscal/timbrado-ranges")).items;
}

export async function retireRow(page: Page, row: Locator, timbrado: string): Promise<void> {
  await row.getByRole("button", { name: "Retirar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `¿Retirar el timbrado ${timbrado}?` });
  const confirm = dialog.getByRole("button", { name: "Retirar timbrado", exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Motivo").fill("Reemplazado por la prueba e2e");
  await confirm.click();
  await expect(page.getByText(`Se retiró el timbrado ${timbrado}.`, { exact: true })).toBeVisible();
}

/** Retires, through the screen, every ACTIVE range an earlier run left at {@link POINT}-{@link POINT}. */
export async function retireActiveRangesAtPoint(page: Page): Promise<void> {
  const rangesSection = section(page, "Timbrados");
  await expect(
    rangesSection
      .getByTestId("range-row")
      .first()
      .or(rangesSection.getByText("Todavía no hay timbrados", { exact: true }))
  ).toBeVisible();
  for (const range of await listRanges(page)) {
    if (range.status !== "ACTIVE") continue;
    const row = rangesSection
      .getByTestId("range-row")
      .filter({ hasText: `${POINT}-${POINT} · timbrado ${range.timbradoNumber}` });
    if ((await row.count()) === 0) continue;
    await retireRow(page, row, range.timbradoNumber);
  }
}

export async function createRange(
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

/** Declares {@link POINT}-{@link POINT} against the given factura range, through the screen. */
export async function declareIssuancePoint(page: Page, facturaRangeId: string): Promise<void> {
  const point = section(page, "Punto de expedición");
  await point.getByLabel("Timbrado activo", { exact: true }).selectOption(facturaRangeId);
  await point.getByRole("button", { name: "Declarar punto de expedición", exact: true }).click();
  await expect(
    page.getByText(`Se declaró el punto de expedición ${POINT}-${POINT} (Factura electrónica).`, {
      exact: true,
    })
  ).toBeVisible();
}
