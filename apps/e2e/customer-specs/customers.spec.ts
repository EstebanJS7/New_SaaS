/// <reference lib="dom" />
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "../../../packages/database/src/generated/index.js";
const url = process.env.CUSTOMER_E2E_DATABASE_URL;
if (!url || !/^\/newsaas_customer_browser_test_[a-f0-9]{32}$/.test(new URL(url).pathname))
  throw Error("Disposable customer database required");
const db = new PrismaClient({ datasources: { db: { url } } });
const tenantId = process.env.CUSTOMER_E2E_TENANT_ID!;
test.afterAll(() => db.$disconnect());
async function login(page: Page, role = "writer") {
  await page.goto("/login");
  await page.locator("#login-email").fill(role + "@customer-e2e.invalid");
  await page.locator("#login-password").fill("customer-e2e-password");
  await page.locator("#login-password").press("Enter");
  await expect(page).toHaveURL(/\/app$/);
  await page.waitForLoadState("load");
}
async function customers(page: Page) {
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Navegación del espacio de trabajo" })
      .getByRole("link", { name: "Clientes", exact: true })
      .click();
  } else
    await page
      .getByRole("complementary", { name: "Navegación principal" })
      .getByRole("link", { name: "Clientes", exact: true })
      .click();
  await expect(page).toHaveURL(/\/app\/customers$/);
}
async function shot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: join(process.env.CUSTOMER_E2E_SHOTS!, name + ".png"),
    fullPage: true,
  });
}
for (const mobile of [false, true]) {
  test(
    (mobile ? "mobile dark" : "desktop light") +
      " — create/edit, contacts, addresses, discard and list context",
    async ({ page }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      await login(page);
      await page.evaluate((dark) => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.dataset.customerDocument = "same";
      }, mobile);
      const name = "Cliente sintético " + randomUUID() + " " + "nombre largo ".repeat(9);
      const seed = await db.customer.create({
        data: { tenantId, kind: "INDIVIDUAL", displayName: name },
      });
      await customers(page);
      await page.getByLabel("Buscar clientes", { exact: true }).fill(name.slice(0, 65));
      await page.getByRole("button", { name: "Buscar", exact: true }).click();
      await page.getByRole("link", { name, exact: true }).click();
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-customer-document", "same");
      if (mobile)
        expect(
          await page
            .getByRole("heading", { name, exact: true })
            .evaluate((node) => node.getBoundingClientRect().width)
        ).toBeGreaterThan(200);
      await page.getByRole("button", { name: "Editar cliente", exact: true }).click();
      await expect(page.getByLabel("Nombre visible", { exact: false })).toHaveValue(name);
      await page.getByLabel("Nombres", { exact: false }).fill("Ana");
      await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
      await expect(page).toHaveURL(new RegExp("/customers/" + seed.id + "$"));
      expect((await db.customer.findUniqueOrThrow({ where: { id: seed.id } })).firstName).toBe(
        "Ana"
      );
      await page
        .getByLabel("Dirección (obligatorio)", { exact: true })
        .fill("Dirección sintética " + "larga ".repeat(25));
      await page.getByLabel("Código de país", { exact: false }).fill("PY");
      await page.getByRole("button", { name: "Agregar dirección", exact: true }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Dirección agregada." })
      ).toBeVisible();
      await page
        .getByLabel("Correo electrónico (obligatorio)", { exact: true })
        .fill("valor-sin-formato-nuevo");
      await page.getByLabel("Contacto principal", { exact: true }).check();
      await page.getByRole("button", { name: "Agregar contacto", exact: true }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Contacto agregado." })
      ).toBeVisible();
      expect(
        await db.customerContact.count({
          where: { customerId: seed.id, value: "valor-sin-formato-nuevo" },
        })
      ).toBe(1);
      await page.getByRole("button", { name: "Desactivar contacto", exact: true }).click();
      const modal = page.getByRole("dialog", { name: "Desactivar contacto", exact: true });
      await expect(modal.getByRole("button", { name: "Volver", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      expect(
        await db.customerContact.count({ where: { customerId: seed.id, isActive: true } })
      ).toBe(1);
      await shot(page, mobile ? "customer-mobile-dark" : "customer-desktop-light");
      const contact = await db.customerContact.findFirstOrThrow({
        where: { customerId: seed.id, isActive: true },
      });
      await page.getByRole("button", { name: "Desactivar contacto", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Desactivar contacto", exact: true })
        .getByRole("button", { name: "Desactivar contacto", exact: true })
        .click();
      await expect(
        page.getByText("Este cliente no tiene contactos registrados.", { exact: true })
      ).toBeVisible();
      expect(
        (await db.customerContact.findUniqueOrThrow({ where: { id: contact.id } })).isActive
      ).toBe(false);
      expect(
        await db.auditLog.count({
          where: { targetId: contact.id, action: "customer_contact.deactivated" },
        })
      ).toBe(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      await page.getByRole("link", { name: "Volver al listado de clientes", exact: true }).click();
      await expect(page.getByLabel("Buscar clientes", { exact: true })).toHaveValue(
        name.slice(0, 65)
      );
      await expect(page.locator("html")).toHaveAttribute("data-customer-document", "same");
      await page.getByRole("link", { name: "Nuevo cliente", exact: true }).click();
      await page.getByRole("button", { name: "Crear cliente", exact: true }).click();
      await expect(page.getByLabel("Nombre visible", { exact: false })).toBeFocused();
      await page.getByLabel("Nombre visible", { exact: false }).fill("Empresa " + randomUUID());
      await page.getByLabel("Tipo de cliente", { exact: true }).selectOption("COMPANY");
      await page.getByLabel("Razón social", { exact: false }).fill("Sociedad sintética");
      await page.getByLabel("RUC", { exact: false }).fill("123-4");
      await shot(page, mobile ? "company-form-mobile-dark" : "company-form-desktop-light");
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
      await page.getByRole("button", { name: "Seguir editando", exact: true }).click();
      await expect(page.getByLabel("Razón social", { exact: false })).toHaveValue(
        "Sociedad sintética"
      );
      await page.getByRole("button", { name: "Crear cliente", exact: true }).click();
      await expect(page.getByRole("heading", { name: /Empresa / })).toBeVisible();
      const company = await db.customer.findFirstOrThrow({
        where: { tenantId, legalName: "Sociedad sintética" },
        orderBy: { createdAt: "desc" },
      });
      expect(company.taxId).toBe("123-4");
    }
  );
}
test("uncertain creation retains values and blocks duplicate after committed response is lost", async ({
  page,
}) => {
  await login(page);
  await customers(page);
  await page.getByRole("link", { name: "Nuevo cliente", exact: true }).click();
  const name = "Respuesta perdida " + randomUUID();
  await page.getByLabel("Nombre visible", { exact: false }).fill(name);
  let posts = 0;
  await page.route("**/api/customers", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Crear cliente", exact: true }).click();
  await expect(page.locator("[data-shell-content]").getByRole("alert")).toContainText(
    "No pudimos confirmar el resultado"
  );
  await expect(page.getByRole("button", { name: "Crear cliente", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Nombre visible", { exact: false })).toHaveValue(name);
  expect(posts).toBe(1);
  expect(await db.customer.count({ where: { tenantId, displayName: name } })).toBe(1);
});
test("reader denial and cross-tenant records produce no writes or exposed identity", async ({
  page,
}) => {
  await login(page, "reader");
  await customers(page);
  await page.getByRole("link", { name: "Nuevo cliente", exact: true }).click();
  const name = "Denegado " + randomUUID();
  await page.getByLabel("Nombre visible", { exact: false }).fill(name);
  await page.getByRole("button", { name: "Crear cliente", exact: true }).click();
  await expect(page.locator("[data-shell-content]").getByRole("alert")).toContainText(
    "No tenés permiso"
  );
  await expect(page.getByRole("button", { name: "Crear cliente", exact: true })).toBeDisabled();
  expect(await db.customer.count({ where: { tenantId, displayName: name } })).toBe(0);
  const other = await db.tenant.create({
    data: { name: "Otro tenant sintético", slug: randomUUID() },
  });
  const foreign = await db.customer.create({
    data: { tenantId: other.id, kind: "INDIVIDUAL", displayName: "Identidad ajena sintética" },
  });
  const response = await page.request.get("/api/customers/" + foreign.id);
  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain(foreign.displayName);
  const change = await page.request.put("/api/customers/" + foreign.id, {
    data: { displayName: "No guardar" },
  });
  expect(change.status()).toBe(403);
  expect((await db.customer.findUniqueOrThrow({ where: { id: foreign.id } })).displayName).toBe(
    foreign.displayName
  );
});

test("writer tenant isolation and anonymous denial preserve records and audit", async ({
  page,
  browser,
}) => {
  await login(page);
  const other = await db.tenant.create({
    data: { name: "Otro tenant sintético", slug: randomUUID() },
  });
  const foreign = await db.customer.create({
    data: { tenantId: other.id, kind: "INDIVIDUAL", displayName: "Cliente ajeno sintético" },
  });
  const before = await db.auditLog.count({ where: { targetId: foreign.id } });
  for (const id of [foreign.id, randomUUID()]) {
    expect((await page.request.get("/api/customers/" + id)).status()).toBe(404);
    expect(
      (
        await page.request.put("/api/customers/" + id, { data: { displayName: "No guardar" } })
      ).status()
    ).toBe(404);
  }
  expect((await db.customer.findUniqueOrThrow({ where: { id: foreign.id } })).displayName).toBe(
    foreign.displayName
  );
  expect(await db.auditLog.count({ where: { targetId: foreign.id } })).toBe(before);
  const anonymous = await browser.newContext({ baseURL: process.env.CUSTOMER_E2E_BASE_URL });
  try {
    expect(
      (
        await anonymous.request.post("/api/customers", {
          data: { kind: "INDIVIDUAL", displayName: "Anónimo sintético" },
        })
      ).status()
    ).toBe(401);
  } finally {
    await anonymous.close();
  }
  expect(await db.customer.count({ where: { tenantId, displayName: "Anónimo sintético" } })).toBe(
    0
  );
});
