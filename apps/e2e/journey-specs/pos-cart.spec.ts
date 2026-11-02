/// <reference lib="dom" />
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "../../../packages/database/src/generated/index.js";
const url = process.env.JOURNEY_E2E_DATABASE_URL;
if (!url || !/^\/newsaas_journey_browser_test_[a-f0-9]{32}$/.test(new URL(url).pathname))
  throw Error("Disposable journey database required");
const db = new PrismaClient({ datasources: { db: { url } } });
const tenantId = process.env.JOURNEY_E2E_TENANT_ID!;
test.afterAll(() => db.$disconnect());

async function prepare(page: Page, reader = false) {
  // Synthetic preparation only; commands under test use the BFF/API.
  const suffix = randomUUID();
  const tax = await db.taxRate.findUniqueOrThrow({ where: { code: "IVA_10" } });
  const item = await db.catalogItem.create({
    data: {
      tenantId,
      taxRateId: tax.id,
      kind: "SERVICE",
      tracksStock: false,
      name: "Servicio carrito " + suffix,
      referencePriceAmount: "123456.78",
      referencePriceCurrency: "PYG",
    },
  });
  const customer = await db.customer.create({
    data: {
      tenantId,
      kind: "INDIVIDUAL",
      displayName: "Cliente carrito " + suffix,
    },
  });
  await page.goto("/login");
  await page.locator("#login-email").fill((reader ? "reader" : "writer") + "@journey-e2e.invalid");
  await page.locator("#login-password").fill("journey-e2e-password");
  await page.locator("#login-password").press("Enter");
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app/sales");
  await page.getByLabel("Nombre del artículo", { exact: true }).fill(item.name);
  await page.getByRole("button", { name: "Agregar a la venta", exact: true }).click();
  await page.getByLabel("Cliente (opcional)", { exact: true }).selectOption(customer.id);
  await page.getByRole("textbox", { name: "Cantidad", exact: true }).fill("2,125");
  await page.getByLabel("Precio unitario aplicado", { exact: true }).fill("123456,78");
  return { item, customer };
}
async function counts() {
  return {
    sales: await db.sale.count({ where: { tenantId } }),
    created: await db.auditLog.count({ where: { tenantId, action: "sale.created" } }),
    payments: await db.payment.count({ where: { tenantId } }),
    stock: await db.stockMovement.count({ where: { tenantId } }),
    cash: await db.cashMovement.count({ where: { tenantId } }),
  };
}
const send = (page: Page) => page.getByRole("button", { name: "Continuar al pago", exact: true });

for (const mobile of [false, true])
  test(
    (mobile ? "mobile dark" : "desktop light") +
      " — committed creation with lost response stays locked, exact copy and one audit",
    async ({ page }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      const { item, customer } = await prepare(page);
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle("dark", dark),
        mobile
      );
      const before = await counts();
      let posts = 0;
      let confirmedId: string | undefined;
      await page.route("**/api/sales", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        posts++;
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        const body: unknown = await response.json();
        if (
          typeof body !== "object" ||
          body === null ||
          !("id" in body) ||
          typeof body.id !== "string"
        )
          throw Error("Expected server receipt");
        confirmedId = body.id;
        await route.abort("connectionreset");
      });
      await send(page).click();
      await expect(page.getByTestId("create-error")).toContainText("carrito bloqueado");
      await expect(send(page)).toBeDisabled();
      await expect(page.getByLabel("Precio unitario aplicado", { exact: true })).toHaveValue(
        "123456,78"
      );
      await expect(page.getByRole("textbox", { name: "Cantidad", exact: true })).toHaveValue(
        "2,125"
      );
      await expect(page.getByLabel("Cliente (opcional)", { exact: true })).toHaveValue(customer.id);
      await expect(page.getByLabel("Cliente (opcional)", { exact: true })).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Iniciar otra venta", exact: true })
      ).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Revisar venta", exact: true })).toHaveCount(0);
      await send(page).evaluate((button: HTMLButtonElement) => button.click());
      expect(posts).toBe(1);
      expect(confirmedId).toBeDefined();
      const sale = await db.sale.findUniqueOrThrow({
        where: { id: confirmedId! },
        include: { lines: true },
      });
      expect(sale.status).toBe("DRAFT");
      expect(sale.customerId).toBe(customer.id);
      expect(sale.lines[0].catalogItemId).toBe(item.id);
      expect(sale.lines[0].quantity.toFixed(3)).toBe("2.125");
      expect(sale.lines[0].unitPrice.toFixed(2)).toBe("123456.78");
      expect(await counts()).toEqual({
        ...before,
        sales: before.sales + 1,
        created: before.created + 1,
      });
      await page.getByRole("link", { name: "Listado de ventas", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "¿Salir del punto de venta?", exact: true });
      await expect(dialog).toContainText("no cancela ni confirma");
      await expect(
        dialog.getByRole("button", { name: "Permanecer en el POS", exact: true })
      ).toBeFocused();
      await page.screenshot({
        path: join(
          process.env.JOURNEY_E2E_SHOTS!,
          mobile ? "pos-uncertain-mobile-dark.png" : "pos-uncertain-desktop-light.png"
        ),
        fullPage: true,
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(send(page)).toBeDisabled();
      await page.getByRole("link", { name: "Listado de ventas", exact: true }).click();
      await dialog
        .getByRole("button", { name: "Salir y descartar copia local", exact: true })
        .click();
      await expect(page).toHaveURL(/\/app\/sales\/history$/);
      expect(posts).toBe(1);
      expect(await counts()).toEqual({
        ...before,
        sales: before.sales + 1,
        created: before.created + 1,
      });
    }
  );

test("pending command prevents link exit until a real receipt arrives", async ({ page }) => {
  await prepare(page);
  const before = await counts();
  let posts = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/sales", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    await gate;
    await route.continue();
  });
  try {
    await send(page).click();
    await expect(page.getByRole("button", { name: "Creando venta…", exact: true })).toBeDisabled();
    await page.getByRole("link", { name: "Listado de ventas", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Hay una operación pendiente", exact: true });
    await expect(
      dialog.getByRole("button", { name: "Salir y descartar copia local", exact: true })
    ).toBeDisabled();
    expect(await counts()).toEqual(before);
  } finally {
    release();
  }
  await expect(page.getByRole("button", { name: "Revisar venta", exact: true })).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "¿Salir del punto de venta?", exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Permanecer en el POS", exact: true }).click();
  expect(posts).toBe(1);
  expect(await counts()).toEqual({
    ...before,
    sales: before.sales + 1,
    created: before.created + 1,
  });
});

test("local cart cancellation and confirmed discard perform no commands", async ({ page }) => {
  const { customer } = await prepare(page);
  const before = await counts();
  await page.getByRole("link", { name: "Listado de ventas", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "¿Salir del punto de venta?", exact: true });
  await dialog.getByRole("button", { name: "Permanecer en el POS", exact: true }).click();
  await expect(page.getByLabel("Cliente (opcional)", { exact: true })).toHaveValue(customer.id);
  await expect(page.getByLabel("Precio unitario aplicado", { exact: true })).toHaveValue(
    "123456,78"
  );
  await page.getByRole("link", { name: "Listado de ventas", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "¿Salir del punto de venta?", exact: true });
  await dialog.getByRole("button", { name: "Salir y descartar copia local", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/sales\/history$/);
  expect(await counts()).toEqual(before);
});

test("real permission rejection keeps checkout blocked without effects", async ({ page }) => {
  await prepare(page, true);
  const before = await counts();
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/sales") && r.request().method() === "POST"
  );
  await send(page).click();
  expect((await response).status()).toBe(403);
  await expect(page.getByTestId("create-error")).toContainText(
    "No tenés permiso para gestionar ventas."
  );
  await expect(send(page)).toBeDisabled();
  expect(await counts()).toEqual(before);
});
