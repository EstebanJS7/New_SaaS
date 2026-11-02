/// <reference lib="dom" />
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "../../../packages/database/src/generated/index.js";
const url = process.env.CATALOG_E2E_DATABASE_URL;
if (!url || !/^\/newsaas_catalog_browser_test_[a-f0-9]{32}$/.test(new URL(url).pathname))
  throw Error("Disposable catalog database required");
const db = new PrismaClient({ datasources: { db: { url } } });
const tenantId = process.env.CATALOG_E2E_TENANT_ID!;
test.afterAll(() => db.$disconnect());
async function login(page: Page, role = "writer") {
  await page.goto("/login");
  await page.locator("#login-email").fill(role + "@catalog-e2e.invalid");
  await page.locator("#login-password").fill("catalog-e2e-password");
  await page.locator("#login-password").press("Enter");
  await expect(page).toHaveURL(/\/app$/);
  await page.waitForLoadState("load");
}
async function catalog(page: Page) {
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Navegación del espacio de trabajo" })
      .getByRole("link", { name: "Catálogo", exact: true })
      .click();
  } else
    await page
      .getByRole("complementary", { name: "Navegación principal" })
      .getByRole("link", { name: "Catálogo", exact: true })
      .click();
  await expect(page).toHaveURL(/\/app\/catalog$/);
}
async function rate() {
  return db.taxRate.findUniqueOrThrow({ where: { code: "IVA_10" } });
}
async function fill(page: Page, name: string, taxRateId: string) {
  await page.getByLabel("Nombre (obligatorio)").fill(name);
  await page.getByLabel("Impuesto (obligatorio)").selectOption(taxRateId);
}
async function shot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: join(process.env.CATALOG_E2E_SHOTS!, name + ".png"),
    fullPage: true,
  });
}
for (const mobile of [false, true])
  test(
    (mobile ? "mobile dark" : "desktop light") +
      " — exact price/threshold, edit/clear, discard, context and deactivate",
    async ({ page }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      await login(page);
      await page.evaluate((dark) => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.dataset.catalogDocument = "same";
      }, mobile);
      const tax = await rate();
      const name = ("Artículo sintético " + randomUUID() + " " + "nombre largo ".repeat(8)).trim();
      await catalog(page);
      await page.getByRole("link", { name: "Nuevo artículo", exact: true }).click();
      await page.getByRole("button", { name: "Crear artículo", exact: true }).click();
      await expect(page.getByLabel("Nombre (obligatorio)")).toBeFocused();
      await fill(page, name, tax.id);
      await page.getByLabel("Tipo de artículo", { exact: true }).selectOption("SERVICE");
      await page.getByLabel("Precio de referencia (opcional)").fill("999.999.999.999,99");
      await page.getByLabel("Moneda", { exact: true }).selectOption("USD");
      await page.getByLabel("Umbral de stock bajo (opcional)").fill("9.999.999,999");
      await shot(page, mobile ? "catalog-form-mobile-dark" : "catalog-form-desktop-light");
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
      const discard = page.getByRole("dialog", { name: "¿Descartar los cambios sin guardar?" });
      await expect(discard.getByRole("button", { name: "Seguir editando" })).toBeFocused();
      await page.keyboard.press("Escape");
      expect(await db.catalogItem.count({ where: { tenantId, name } })).toBe(0);
      await page.getByRole("button", { name: "Crear artículo", exact: true }).click();
      await expect(page).toHaveURL(/\/catalog\/[a-f0-9-]{36}\/edit$/);
      const item = await db.catalogItem.findFirstOrThrow({ where: { tenantId, name } });
      expect(item.referencePriceAmount?.toFixed(2)).toBe("999999999999.99");
      expect(item.referencePriceCurrency).toBe("USD");
      expect(item.lowStockThreshold?.toFixed(3)).toBe("9999999.999");
      expect(item.tracksStock).toBe(false);
      await expect(page.getByLabel("Precio de referencia (opcional)")).toHaveValue(
        "999999999999,99"
      );
      await expect(page.getByLabel("Umbral de stock bajo (opcional)")).toHaveValue("9999999,999");
      // Unchanged edit must send no decimal rewrite; exact body is observed at the application boundary.
      const unchanged = page.waitForRequest(
        (request) => request.method() === "PUT" && request.url().endsWith("/api/catalog/" + item.id)
      );
      await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
      expect((await unchanged).postDataJSON()).toEqual({});
      await expect(page).toHaveURL(/\/app\/catalog$/);
      const unchangedRecord = await db.catalogItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(unchangedRecord.updatedAt.toISOString()).toBe(item.updatedAt.toISOString());
      const noopAudits = await db.auditLog.findMany({
        where: { targetId: item.id, action: "catalog_item.updated" },
      });
      expect(noopAudits).toHaveLength(1);
      expect(noopAudits[0]?.metadata).toMatchObject({ changedFields: [] });
      await expect(page).toHaveURL(/\/app\/catalog$/);
      const search = name.slice(0, 65);
      await page.getByLabel("Buscar en el catálogo", { exact: true }).fill(search);
      await page.getByRole("button", { name: "Buscar", exact: true }).click();
      await page.getByRole("link", { name, exact: true }).click();
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
      await expect(page.getByText("999.999.999.999,99 USD", { exact: true })).toBeVisible();
      await expect(page.getByText("9.999.999,999", { exact: true })).toBeVisible();
      if (mobile)
        expect(
          await page
            .getByRole("heading", { name, exact: true })
            .evaluate((node) => node.getBoundingClientRect().width)
        ).toBeGreaterThan(230);
      await shot(page, mobile ? "catalog-detail-mobile-dark" : "catalog-detail-desktop-light");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      await page.getByRole("link", { name: "Editar artículo", exact: true }).click();
      await page.getByLabel("Precio de referencia (opcional)").fill("");
      await page.getByLabel("Umbral de stock bajo (opcional)").fill("");
      await page.getByLabel("Tipo de artículo", { exact: true }).selectOption("SUPPLY");
      await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
      await expect(page).toHaveURL(/\/app\/catalog$/);
      const cleared = await db.catalogItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(cleared.referencePriceAmount).toBeNull();
      expect(cleared.referencePriceCurrency).toBeNull();
      expect(cleared.lowStockThreshold).toBeNull();
      expect(cleared.tracksStock).toBe(false);
      await page.getByRole("link", { name, exact: true }).click();
      await page.getByRole("link", { name: "Editar artículo", exact: true }).click();
      await page.getByLabel("Precio de referencia (opcional)").fill("0,00");
      await page.getByLabel("Moneda", { exact: true }).selectOption("PYG");
      await page.getByLabel("Umbral de stock bajo (opcional)").fill("0,001");
      await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
      await expect(page).toHaveURL(/\/app\/catalog$/);
      const small = await db.catalogItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(small.referencePriceAmount?.toFixed(2)).toBe("0.00");
      expect(small.lowStockThreshold?.toFixed(3)).toBe("0.001");
      await page.getByRole("link", { name, exact: true }).click();
      await page.getByRole("link", { name: "Volver al catálogo", exact: true }).click();
      await expect(page.getByLabel("Buscar en el catálogo", { exact: true })).toHaveValue(search);
      await expect(page.locator("html")).toHaveAttribute("data-catalog-document", "same");
      const row = page
        .locator(".record-row")
        .filter({ has: page.getByRole("link", { name, exact: true }) });
      await row.getByRole("button", { name: "Desactivar", exact: true }).click();
      const modal = page.getByRole("dialog", { name: "Desactivar artículo", exact: true });
      await expect(modal.getByRole("button", { name: "Volver", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      expect((await db.catalogItem.findUniqueOrThrow({ where: { id: item.id } })).isActive).toBe(
        true
      );
      await row.getByRole("button", { name: "Desactivar", exact: true }).click();
      await modal.getByRole("button", { name: "Desactivar artículo", exact: true }).click();
      await expect(row).toHaveCount(0);
      expect((await db.catalogItem.findUniqueOrThrow({ where: { id: item.id } })).isActive).toBe(
        false
      );
      expect(
        await db.auditLog.count({
          where: { targetId: item.id, action: "catalog_item.deactivated" },
        })
      ).toBe(1);
      expect(await db.stockMovement.count({ where: { tenantId } })).toBe(0);
      expect(await db.stockBalance.count({ where: { tenantId } })).toBe(0);
    }
  );
test("lost create acknowledgement keeps and blocks the form after one real commit", async ({
  page,
}) => {
  await login(page);
  const tax = await rate();
  await catalog(page);
  await page.getByRole("link", { name: "Nuevo artículo", exact: true }).click();
  const name = "Respuesta perdida " + randomUUID();
  await fill(page, name, tax.id);
  let posts = 0;
  await page.route("**/api/catalog", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Crear artículo", exact: true }).click();
  await expect(page.locator("[data-shell-content]").getByRole("alert")).toContainText(
    "No pudimos confirmar el resultado"
  );
  await expect(page.getByRole("button", { name: "Crear artículo" })).toBeDisabled();
  await expect(page.getByLabel("Nombre (obligatorio)")).toHaveValue(name);
  expect(posts).toBe(1);
  expect(await db.catalogItem.count({ where: { tenantId, name } })).toBe(1);
});
test("lost edit acknowledgement keeps exact input and never repeats PUT", async ({ page }) => {
  await login(page);
  const tax = await rate();
  const item = await db.catalogItem.create({
    data: { tenantId, taxRateId: tax.id, name: "Editar incierto " + randomUUID(), kind: "PRODUCT" },
  });
  await page.goto("/app/catalog/" + item.id + "/edit");
  await page.getByLabel("Precio de referencia (opcional)").fill("123.456,78");
  let puts = 0;
  await page.route("**/api/catalog/" + item.id, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    puts++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page.locator("[data-shell-content]").getByRole("alert")).toContainText(
    "No pudimos confirmar el resultado"
  );
  await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  await expect(page.getByLabel("Precio de referencia (opcional)")).toHaveValue("123.456,78");
  expect(puts).toBe(1);
  expect(
    (
      await db.catalogItem.findUniqueOrThrow({ where: { id: item.id } })
    ).referencePriceAmount?.toFixed(2)
  ).toBe("123456.78");
});
test("reader sees detail but cannot create, update or deactivate", async ({ page }) => {
  await login(page, "reader");
  const tax = await rate();
  await catalog(page);
  await page.getByRole("link", { name: "Nuevo artículo", exact: true }).click();
  const name = "Denegado " + randomUUID();
  await fill(page, name, tax.id);
  await page.getByRole("button", { name: "Crear artículo", exact: true }).click();
  await expect(page.locator("[data-shell-content]").getByRole("alert")).toContainText(
    "No tenés permiso"
  );
  await expect(page.getByRole("button", { name: "Crear artículo" })).toBeDisabled();
  expect(await db.catalogItem.count({ where: { tenantId, name } })).toBe(0);
  const item = await db.catalogItem.create({
    data: { tenantId, taxRateId: tax.id, name: "Solo lectura " + randomUUID(), kind: "SERVICE" },
  });
  expect((await page.request.get("/api/catalog/" + item.id)).status()).toBe(200);
  expect(
    (await page.request.put("/api/catalog/" + item.id, { data: { name: "No guardar" } })).status()
  ).toBe(403);
  expect(
    (await page.request.post("/api/catalog/" + item.id + "/deactivate", { data: {} })).status()
  ).toBe(403);
  expect((await db.catalogItem.findUniqueOrThrow({ where: { id: item.id } })).name).toBe(item.name);
  expect(await db.auditLog.count({ where: { targetId: item.id } })).toBe(0);
});
test("invalid decimals, foreign records and anonymous writes leave zero effects", async ({
  page,
  browser,
}) => {
  await login(page);
  const tax = await rate();
  const name = "Inválido " + randomUUID();
  const before = await db.auditLog.count({ where: { tenantId } });
  for (const body of [
    { name, kind: "PRODUCT", taxRateId: tax.id, lowStockThreshold: "0.000" },
    {
      name,
      kind: "PRODUCT",
      taxRateId: tax.id,
      referencePriceAmount: "1.001",
      referencePriceCurrency: "PYG",
    },
    { name, kind: "PRODUCT", taxRateId: tax.id, referencePriceAmount: "1.00" },
    { name, kind: "PRODUCT", taxRateId: randomUUID() },
  ])
    expect((await page.request.post("/api/catalog", { data: body })).status()).toBe(400);
  expect(await db.catalogItem.count({ where: { tenantId, name } })).toBe(0);
  expect(await db.auditLog.count({ where: { tenantId } })).toBe(before);
  const other = await db.tenant.create({
    data: { name: "Otro tenant sintético", slug: randomUUID() },
  });
  const foreign = await db.catalogItem.create({
    data: {
      tenantId: other.id,
      taxRateId: tax.id,
      name: "Artículo ajeno sintético",
      kind: "PRODUCT",
    },
  });
  for (const id of [foreign.id, randomUUID()]) {
    const read = await page.request.get("/api/catalog/" + id);
    expect(read.status()).toBe(404);
    expect(await read.text()).not.toContain(foreign.name);
    expect(
      (await page.request.put("/api/catalog/" + id, { data: { name: "No guardar" } })).status()
    ).toBe(404);
    expect(
      (await page.request.post("/api/catalog/" + id + "/deactivate", { data: {} })).status()
    ).toBe(404);
  }
  expect((await db.catalogItem.findUniqueOrThrow({ where: { id: foreign.id } })).isActive).toBe(
    true
  );
  expect(await db.auditLog.count({ where: { targetId: foreign.id } })).toBe(0);
  const anonymous = await browser.newContext({ baseURL: process.env.CATALOG_E2E_BASE_URL });
  try {
    expect(
      (
        await anonymous.request.post("/api/catalog", {
          data: { name: "Anónimo sintético", kind: "PRODUCT", taxRateId: tax.id },
        })
      ).status()
    ).toBe(401);
  } finally {
    await anonymous.close();
  }
  expect(await db.catalogItem.count({ where: { tenantId, name: "Anónimo sintético" } })).toBe(0);
});
