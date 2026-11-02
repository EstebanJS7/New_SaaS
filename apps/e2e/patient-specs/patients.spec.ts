/// <reference lib="dom" />
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "../../../packages/database/src/generated/index.js";
const url = process.env.PATIENT_E2E_DATABASE_URL;
if (!url || !/^\/newsaas_patient_browser_test_[a-f0-9]{32}$/.test(new URL(url).pathname))
  throw Error("Disposable patient database required");
const db = new PrismaClient({ datasources: { db: { url } } });
const tenantId = process.env.PATIENT_E2E_TENANT_ID!;
test.afterAll(() => db.$disconnect());
async function login(page: Page, role = "writer") {
  await page.goto("/login");
  await page.locator("#login-email").fill(role + "@patient-e2e.invalid");
  await page.locator("#login-password").fill("patient-e2e-password");
  await page.locator("#login-password").press("Enter");
  await expect(page).toHaveURL(/\/app$/);
  await page.waitForLoadState("load");
}
async function patients(page: Page) {
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Navegación del espacio de trabajo" })
      .getByRole("link", { name: "Pacientes", exact: true })
      .click();
  } else
    await page
      .getByRole("complementary", { name: "Navegación principal" })
      .getByRole("link", { name: "Pacientes", exact: true })
      .click();
  await expect(page).toHaveURL(/\/app\/patients$/);
}
async function references() {
  const species = await db.species.findFirstOrThrow({
    include: { breeds: true },
    orderBy: { code: "asc" },
  });
  const customer = await db.customer.create({
    data: { tenantId, kind: "INDIVIDUAL", displayName: "Responsable sintético " + randomUUID() },
  });
  return { species, customer };
}
async function fill(page: Page, name: string, speciesId: string, customerId?: string) {
  await page.getByLabel("Nombre (obligatorio)", { exact: true }).fill(name);
  await page.getByLabel("Especie (obligatorio)", { exact: true }).selectOption(speciesId);
  if (customerId)
    await page.getByLabel("Responsable principal", { exact: false }).selectOption(customerId);
}
async function shot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: join(process.env.PATIENT_E2E_SHOTS!, name + ".png"),
    fullPage: true,
  });
}
for (const mobile of [false, true])
  test(
    (mobile ? "mobile dark" : "desktop light") +
      " — active create, edit, guardian swap, discard and list context",
    async ({ page }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      await login(page);
      await page.evaluate((dark) => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.dataset.patientDocument = "same";
      }, mobile);
      const { species, customer } = await references();
      const name = ("Paciente sintético " + randomUUID() + " " + "nombre largo ".repeat(8)).trim();
      const secondary = await db.customer.create({
        data: { tenantId, kind: "INDIVIDUAL", displayName: "Segundo responsable " + randomUUID() },
      });
      await patients(page);
      await page.getByRole("link", { name: "Nuevo paciente", exact: true }).click();
      await page.getByRole("button", { name: "Crear paciente", exact: true }).click();
      await expect(page.getByLabel("Nombre (obligatorio)")).toBeFocused();
      await fill(page, name, species.id, customer.id);
      await page.getByLabel("Fecha de nacimiento", { exact: false }).fill("2020-05-01");
      if (species.breeds[0])
        await page.getByLabel("Raza (opcional)").selectOption(species.breeds[0].id);
      await shot(page, mobile ? "patient-form-mobile-dark" : "patient-form-desktop-light");
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
      const discard = page.getByRole("dialog", { name: "¿Descartar los cambios sin guardar?" });
      await expect(discard.getByRole("button", { name: "Seguir editando" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByLabel("Nombre (obligatorio)")).toHaveValue(name);
      await page.getByRole("button", { name: "Crear paciente", exact: true }).click();
      await expect(page).toHaveURL(/\/patients\/[a-f0-9-]{36}$/);
      const record = await db.patient.findFirstOrThrow({ where: { tenantId, name } });
      expect(record.birthDate?.toISOString()).toBe("2020-05-01T00:00:00.000Z");
      expect(
        await db.patientGuardian.count({
          where: { patientId: record.id, isActive: true, isPrimary: true },
        })
      ).toBe(1);
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
      await expect(page.getByText("Nacimiento: 1 may. 2020", { exact: true })).toBeVisible();
      if (mobile)
        expect(
          await page
            .getByRole("heading", { name, exact: true })
            .evaluate((node) => node.getBoundingClientRect().width)
        ).toBeGreaterThan(180);
      await page.getByRole("button", { name: "Editar", exact: true }).click();
      await page.getByLabel("Fecha de nacimiento", { exact: false }).fill("");
      await page.getByLabel("Raza (opcional)").selectOption("");
      await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
      await expect(page).toHaveURL(new RegExp("/patients/" + record.id + "$"));
      const updated = await db.patient.findUniqueOrThrow({ where: { id: record.id } });
      expect(updated.birthDate).toBeNull();
      expect(updated.breedId).toBeNull();
      await page.getByRole("link", { name: "Volver a pacientes", exact: true }).click();
      await page.getByLabel("Buscar pacientes", { exact: true }).fill(name.slice(0, 65));
      await page.getByRole("button", { name: "Buscar", exact: true }).click();
      await page.getByRole("link", { name, exact: true }).click();
      await page
        .getByRole("combobox", { name: "Cliente a vincular", exact: true })
        .selectOption(secondary.id);
      await page.getByRole("button", { name: "Vincular responsable", exact: true }).click();
      await expect(page.getByText("Responsable vinculado.", { exact: true })).toBeVisible();
      const secondaryRow = page.getByRole("group", {
        name: "Responsable " + secondary.displayName,
        exact: true,
      });
      await secondaryRow.getByRole("button", { name: "Marcar principal" }).click();
      await expect(secondaryRow.getByText("Principal", { exact: true })).toBeVisible();
      expect(
        await db.patientGuardian.count({
          where: { patientId: record.id, isPrimary: true, isActive: true },
        })
      ).toBe(1);
      const oldRow = page.getByRole("group", {
        name: "Responsable " + customer.displayName,
        exact: true,
      });
      await oldRow.getByRole("button", { name: "Desactivar", exact: true }).click();
      const modal = page.getByRole("dialog", { name: "Desvincular responsable", exact: true });
      await expect(modal.getByRole("button", { name: "Volver", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      expect(
        await db.patientGuardian.count({ where: { patientId: record.id, isActive: true } })
      ).toBe(2);
      await oldRow.getByRole("button", { name: "Desactivar", exact: true }).click();
      await modal.getByRole("button", { name: "Desvincular", exact: true }).click();
      await expect(oldRow).toHaveCount(0);
      const link = await db.patientGuardian.findFirstOrThrow({
        where: { patientId: record.id, customerId: customer.id },
      });
      expect(link.isActive).toBe(false);
      expect(
        await db.auditLog.count({
          where: { targetId: link.id, action: "patient_guardian.deactivated" },
        })
      ).toBe(1);
      await shot(page, mobile ? "patient-detail-mobile-dark" : "patient-detail-desktop-light");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      await page.getByRole("link", { name: "Volver a pacientes", exact: true }).click();
      await expect(page.getByLabel("Buscar pacientes", { exact: true })).toHaveValue(
        name.slice(0, 65)
      );
      await expect(page.locator("html")).toHaveAttribute("data-patient-document", "same");
    }
  );
test("lost create acknowledgement retains and blocks the form after one real commit", async ({
  page,
}) => {
  await login(page);
  const { species, customer } = await references();
  await patients(page);
  await page.getByRole("link", { name: "Nuevo paciente", exact: true }).click();
  const name = "Respuesta perdida " + randomUUID();
  await fill(page, name, species.id, customer.id);
  let posts = 0;
  await page.route("**/api/patients", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Crear paciente", exact: true }).click();
  await expect(page.locator("[data-shell-content]").getByRole("alert")).toContainText(
    "No pudimos confirmar el resultado"
  );
  await expect(page.getByRole("button", { name: "Crear paciente" })).toBeDisabled();
  await expect(page.getByLabel("Nombre (obligatorio)")).toHaveValue(name);
  expect(posts).toBe(1);
  expect(await db.patient.count({ where: { tenantId, name } })).toBe(1);
});
test("reader cannot create or manage guardians and forbidden commands have zero effects", async ({
  page,
}) => {
  await login(page, "reader");
  const { species, customer } = await references();
  await patients(page);
  await page.getByRole("link", { name: "Nuevo paciente", exact: true }).click();
  const name = "Denegado " + randomUUID();
  await fill(page, name, species.id, customer.id);
  await page.getByRole("button", { name: "Crear paciente", exact: true }).click();
  await expect(page.locator("[data-shell-content]").getByRole("alert")).toContainText(
    "No tenés permiso"
  );
  await expect(page.getByRole("button", { name: "Crear paciente" })).toBeDisabled();
  expect(await db.patient.count({ where: { tenantId, name } })).toBe(0);
  const seed = await db.patient.create({
    data: {
      tenantId,
      speciesId: species.id,
      name: "Inactivo sintético",
      sex: "UNKNOWN",
      isActive: false,
    },
  });
  const before = await db.auditLog.count({ where: { targetId: seed.id } });
  expect(
    (await page.request.put("/api/patients/" + seed.id, { data: { name: "No guardar" } })).status()
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/patients/" + seed.id + "/guardians", {
        data: { customerId: customer.id },
      })
    ).status()
  ).toBe(403);
  expect(await db.patientGuardian.count({ where: { patientId: seed.id } })).toBe(0);
  expect(await db.auditLog.count({ where: { targetId: seed.id } })).toBe(before);
});
test("writer rejects invalid commands, cross-tenant identities and anonymous writes without effects", async ({
  page,
  browser,
}) => {
  await login(page);
  const { species, customer } = await references();
  const other = await db.tenant.create({
    data: { name: "Otro tenant sintético", slug: randomUUID() },
  });
  const foreign = await db.patient.create({
    data: {
      tenantId: other.id,
      speciesId: species.id,
      name: "Identidad ajena sintética",
      sex: "UNKNOWN",
      isActive: false,
    },
  });
  const before = await db.auditLog.count({ where: { targetId: foreign.id } });
  for (const id of [foreign.id, randomUUID()]) {
    const response = await page.request.get("/api/patients/" + id);
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain(foreign.name);
    expect(
      (await page.request.put("/api/patients/" + id, { data: { name: "No guardar" } })).status()
    ).toBe(404);
  }
  const invalid = "Sin responsable " + randomUUID();
  expect(
    (
      await page.request.post("/api/patients", {
        data: { name: invalid, speciesId: species.id, sex: "UNKNOWN" },
      })
    ).status()
  ).toBe(400);
  expect(await db.patient.count({ where: { tenantId, name: invalid } })).toBe(0);
  const local = await db.patient.create({
    data: {
      tenantId,
      speciesId: species.id,
      name: "Reactivación sintética",
      sex: "UNKNOWN",
      isActive: false,
    },
  });
  expect(
    (await page.request.put("/api/patients/" + local.id, { data: { isActive: true } })).status()
  ).toBe(409);
  expect((await db.patient.findUniqueOrThrow({ where: { id: local.id } })).isActive).toBe(false);
  expect(await db.auditLog.count({ where: { targetId: local.id } })).toBe(0);
  expect(
    (
      await page.request.put("/api/patients/" + local.id, {
        data: { isActive: true, primaryGuardianCustomerId: customer.id },
      })
    ).status()
  ).toBe(200);
  expect(
    await db.patientGuardian.count({
      where: { patientId: local.id, isActive: true, isPrimary: true },
    })
  ).toBe(1);
  expect((await db.patient.findUniqueOrThrow({ where: { id: foreign.id } })).name).toBe(
    foreign.name
  );
  expect(await db.auditLog.count({ where: { targetId: foreign.id } })).toBe(before);
  const anonymous = await browser.newContext({ baseURL: process.env.PATIENT_E2E_BASE_URL });
  try {
    expect(
      (
        await anonymous.request.post("/api/patients", {
          data: { name: "Anonimo", speciesId: species.id, sex: "UNKNOWN", isActive: false },
        })
      ).status()
    ).toBe(401);
  } finally {
    await anonymous.close();
  }
  expect(await db.patient.count({ where: { tenantId, name: "Anonimo" } })).toBe(0);
});

test("patient-only reader cannot disclose guardian names or populate the customer picker", async ({
  page,
}) => {
  await login(page, "restricted");
  const { species, customer } = await references();
  const seed = await db.$transaction(async (tx) => {
    const patient = await tx.patient.create({
      data: {
        tenantId,
        speciesId: species.id,
        name: "Lectura limitada " + randomUUID(),
        sex: "UNKNOWN",
        isActive: true,
      },
    });
    await tx.patientGuardian.create({
      data: {
        tenantId,
        patientId: patient.id,
        customerId: customer.id,
        isPrimary: true,
        isActive: true,
        position: 0,
      },
    });
    return patient;
  });
  const result = await page.request.post("/api/patients/search", {
    data: { q: seed.name, page: 1, status: "active", sort: "name" },
  });
  expect(result.status()).toBe(200);
  const body: unknown = await result.json();
  expect(body).toMatchObject({
    canReadGuardians: false,
    items: [{ id: seed.id, primaryGuardianName: null }],
  });
  await patients(page);
  await page.getByLabel("Buscar pacientes", { exact: true }).fill(seed.name);
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByRole("link", { name: seed.name, exact: true }).click();
  await expect(page.getByRole("heading", { name: seed.name })).toBeVisible();
  await expect(
    page.getByText("No tenés permiso para realizar esta acción sobre clientes.", { exact: true })
  ).toBeVisible();
  expect(await page.getByRole("button", { name: "Vincular responsable" }).count()).toBe(0);
  await expect(page.getByText(customer.displayName, { exact: true })).toHaveCount(0);
});
