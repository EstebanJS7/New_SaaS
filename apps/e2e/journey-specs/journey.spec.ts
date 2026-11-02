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
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw Error("Expected object");
  return value as Record<string, unknown>;
}
async function fixture(tid = tenantId) {
  const suffix = randomUUID();
  const species = await db.species.findFirstOrThrow();
  const tax = await db.taxRate.findUniqueOrThrow({ where: { code: "IVA_10" } });
  const professional = await db.userProfile.create({
    data: {
      email: "vet-" + suffix + "@journey.invalid",
      status: "ACTIVE",
      displayName: "Profesional sintético " + "nombre extenso ".repeat(7),
    },
  });
  const role = await db.role.findUniqueOrThrow({ where: { code: "VETERINARIAN" } });
  const membership = await db.tenantMembership.create({
    data: { tenantId: tid, userProfileId: professional.id, roleId: role.id, status: "ACTIVE" },
  });
  const branch = await db.branch.create({
    data: { tenantId: tid, name: "Sucursal sintética " + suffix.slice(0, 8) },
  });
  const service = await db.catalogItem.create({
    data: {
      tenantId: tid,
      taxRateId: tax.id,
      kind: "SERVICE",
      name: ("Servicio sintético " + suffix + " " + "nombre largo ".repeat(6)).trim(),
      tracksStock: false,
      referencePriceAmount: "123456.78",
      referencePriceCurrency: "PYG",
    },
  });
  const patient = await db.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: { tenantId: tid, kind: "INDIVIDUAL", displayName: "Responsable sintético " + suffix },
    });
    const patient = await tx.patient.create({
      data: {
        tenantId: tid,
        speciesId: species.id,
        name: "Paciente recorrido " + suffix,
        sex: "UNKNOWN",
        isActive: false,
      },
    });
    await tx.patientGuardian.create({
      data: {
        tenantId: tid,
        patientId: patient.id,
        customerId: customer.id,
        isActive: true,
        isPrimary: true,
      },
    });
    return tx.patient.update({ where: { id: patient.id }, data: { isActive: true } });
  });
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const startAt = new Date(day + "T15:00:00.000Z");
  const appointment = await db.appointment.create({
    data: {
      tenantId: tid,
      patientId: patient.id,
      branchId: branch.id,
      professionalMembershipId: membership.id,
      serviceId: service.id,
      status: "IN_PROGRESS",
      startAt,
      endAt: new Date(startAt.getTime() + 30 * 60 * 1000),
    },
  });
  const encounter = await db.clinicalEncounter.create({
    data: {
      tenantId: tid,
      patientId: patient.id,
      status: "CLOSED",
      closedAt: new Date(),
      closedByUserProfileId: professional.id,
      reasonForVisit: "Atención sintética " + suffix,
      diagnosis: "Contenido sintético inmutable",
      internalNotes: "Nota privada sintética",
    },
  });
  return { patient, appointment, encounter, service };
}
async function snapshot() {
  return {
    sales: await db.sale.count({ where: { tenantId } }),
    encounters: await db.clinicalEncounter.count({ where: { tenantId } }),
    payments: await db.payment.count({ where: { tenantId } }),
    stock: await db.stockMovement.count({ where: { tenantId } }),
    cash: await db.cashMovement.count({ where: { tenantId } }),
    appointmentLinks: await db.clinicalAppointmentLink.count({ where: { tenantId } }),
    saleLinks: await db.clinicalSaleLink.count({ where: { tenantId } }),
    audit: await db.auditLog.count({
      where: {
        tenantId,
        OR: [
          { action: { startsWith: "clinical." } },
          { action: { startsWith: "sale." } },
          { action: { startsWith: "appointment." } },
        ],
      },
    }),
  };
}
async function login(page: Page, role = "writer") {
  await page.goto("/login");
  await page.locator("#login-email").fill(role + "@journey-e2e.invalid");
  await page.locator("#login-password").fill("journey-e2e-password");
  await page.locator("#login-password").press("Enter");
  await expect(page).toHaveURL(/\/app$/);
  await page.waitForLoadState("load");
}
async function agenda(page: Page) {
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Navegación del espacio de trabajo" })
      .getByRole("link", { name: "Agenda", exact: true })
      .click();
  } else
    await page
      .getByRole("complementary", { name: "Navegación principal" })
      .getByRole("link", { name: "Agenda", exact: true })
      .click();
  await expect(page).toHaveURL(/\/app\/agenda$/);
  await page.getByRole("button", { name: "Lista", exact: true }).click();
}
async function shot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: join(process.env.JOURNEY_E2E_SHOTS!, name + ".png"),
    fullPage: true,
  });
}
for (const mobile of [false, true])
  test(
    (mobile ? "mobile dark" : "desktop light") +
      " — agenda to care to POS and exact return, explicit associations only",
    async ({ page }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      const f = await fixture();
      await login(page);
      await page.evaluate((dark) => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.dataset.journeyDocument = "same";
      }, mobile);
      const initial = await snapshot();
      await agenda(page);
      const row = page.getByRole("listitem").filter({ hasText: f.patient.name });
      await row.getByRole("button", { name: "Gestionar", exact: true }).click();
      await page
        .getByRole("link", { name: "Abrir ficha de " + f.patient.name, exact: true })
        .click();
      await expect(page).toHaveURL(
        new RegExp("/patients/" + f.patient.id + "\\?appointment=" + f.appointment.id)
      );
      await page.getByRole("button", { name: new RegExp(f.encounter.reasonForVisit!) }).click();
      await expect(
        page.getByRole("region", { name: "Consulta cerrada", exact: true })
      ).toBeVisible();
      expect(await snapshot()).toEqual(initial);
      const links = page.getByRole("region", { name: "Vínculos de atención", exact: true });
      await links
        .getByRole("button", { name: "Vincular esta consulta a la cita de origen", exact: true })
        .click();
      let modal = page.getByRole("dialog", { name: "Confirmar vínculo", exact: true });
      await expect(modal.getByRole("button", { name: "Volver", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      expect(
        await db.clinicalAppointmentLink.count({ where: { encounterId: f.encounter.id } })
      ).toBe(0);
      await links
        .getByRole("button", { name: "Vincular esta consulta a la cita de origen", exact: true })
        .click();
      await modal.getByRole("button", { name: "Confirmar vínculo", exact: true }).click();
      await expect(
        links.getByText("Cita vinculada #" + f.appointment.id.slice(0, 8), { exact: true })
      ).toBeVisible();
      // Synthetic change before the POS read verifies that agenda is not a monetary source.
      await db.catalogItem.update({
        where: { id: f.service.id },
        data: { referencePriceAmount: "45678.90" },
      });
      const beforePOS = await snapshot();
      await page.getByRole("link", { name: "Ir al punto de venta", exact: true }).click();
      await expect(page).toHaveURL(
        new RegExp(
          "/app/sales\\?patient=" +
            f.patient.id +
            "&encounter=" +
            f.encounter.id +
            "&appointment=" +
            f.appointment.id
        )
      );
      await expect(page.getByRole("region", { name: "Contexto de la cita" })).toBeVisible();
      const back = page.getByRole("link", { name: "Volver a esta consulta", exact: true });
      await expect(back).toHaveAttribute(
        "href",
        `/app/patients/${f.patient.id}?encounter=${f.encounter.id}&appointment=${f.appointment.id}#patient-clinical`
      );
      expect(await snapshot()).toEqual(beforePOS);
      await shot(page, mobile ? "journey-pos-mobile-dark" : "journey-pos-desktop-light");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      await back.click();
      await expect(page).toHaveURL(
        new RegExp("/patients/" + f.patient.id + "\\?encounter=" + f.encounter.id)
      );
      await expect(
        page.getByRole("region", { name: "Consulta cerrada", exact: true })
      ).toBeVisible();
      expect(await snapshot()).toEqual(beforePOS);
      await expect(page.locator("html")).toHaveAttribute("data-journey-document", "same");
      await page.getByRole("link", { name: "Ir al punto de venta", exact: true }).click();
      await page
        .getByRole("button", { name: "Agregar servicio agendado al carrito", exact: true })
        .click();
      await expect(page.getByLabel("Precio unitario aplicado", { exact: true })).toHaveValue(
        "45678,90"
      );
      expect(await snapshot()).toEqual(beforePOS);
      const created = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/sales") &&
          response.request().method() === "POST" &&
          response.status() === 201
      );
      await page.getByRole("button", { name: "Continuar al pago", exact: true }).click();
      const payload = object(await (await created).json());
      const saleId = payload.id;
      if (typeof saleId !== "string") throw Error("Expected created sale ID");
      await expect(page.getByRole("button", { name: "Revisar venta", exact: true })).toBeVisible();
      expect((await db.sale.findUniqueOrThrow({ where: { id: saleId } })).status).toBe("DRAFT");
      expect(await db.clinicalSaleLink.count({ where: { saleId } })).toBe(0);
      const posLinks = page.getByRole("region", { name: "Vínculos de atención", exact: true });
      await posLinks
        .getByRole("button", { name: "Vincular esta venta a la consulta", exact: true })
        .click();
      modal = page.getByRole("dialog", { name: "Confirmar vínculo", exact: true });
      await modal.getByRole("button", { name: "Volver", exact: true }).click();
      expect(await db.clinicalSaleLink.count({ where: { saleId } })).toBe(0);
      await posLinks
        .getByRole("button", { name: "Vincular esta venta a la consulta", exact: true })
        .click();
      await modal.getByRole("button", { name: "Confirmar vínculo", exact: true }).click();
      await expect(
        posLinks.getByRole("link", { name: "Abrir venta #" + saleId.slice(0, 8), exact: true })
      ).toBeVisible();
      const linked = await db.clinicalSaleLink.findUniqueOrThrow({
        where: { tenantId_saleId: { tenantId, saleId } },
      });
      expect(linked.encounterId).toBe(f.encounter.id);
      expect(
        await db.auditLog.count({ where: { targetId: linked.id, action: "clinical.sale_linked" } })
      ).toBe(1);
      const replay = await page.request.post(
        `/api/clinical/${f.patient.id}/encounters/${f.encounter.id}/links/sale`,
        { data: { saleId } }
      );
      expect(replay.ok()).toBe(true);
      expect(
        await db.auditLog.count({ where: { targetId: linked.id, action: "clinical.sale_linked" } })
      ).toBe(1);
      const after = await snapshot();
      expect(after.sales).toBe(beforePOS.sales + 1);
      expect(after.payments).toBe(beforePOS.payments);
      expect(after.stock).toBe(beforePOS.stock);
      expect(after.cash).toBe(beforePOS.cash);
      expect(
        (await db.appointment.findUniqueOrThrow({ where: { id: f.appointment.id } })).status
      ).toBe("IN_PROGRESS");
      expect(
        await db.clinicalEncounter.findUniqueOrThrow({ where: { id: f.encounter.id } })
      ).toEqual(f.encounter);
      const stable = await snapshot();
      await page.getByRole("link", { name: "Volver a esta consulta", exact: true }).click();
      await page
        .getByRole("dialog", { name: "¿Salir del punto de venta?", exact: true })
        .getByRole("button", { name: "Salir y descartar copia local", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "Consulta cerrada", exact: true })
      ).toBeVisible();
      expect(await snapshot()).toEqual(stable);
    }
  );
test("standalone care returns to its exact encounter without an appointment or any write", async ({
  page,
}) => {
  const f = await fixture();
  await login(page);
  await page.goto(`/app/patients/${f.patient.id}?encounter=${f.encounter.id}#patient-clinical`);
  await expect(page.getByRole("region", { name: "Consulta cerrada", exact: true })).toBeVisible();
  const before = await snapshot();
  await page.getByRole("link", { name: "Ir al punto de venta", exact: true }).click();
  await expect(page.getByRole("region", { name: "Contexto de la cita" })).toHaveCount(0);
  await page.getByRole("link", { name: "Volver a esta consulta", exact: true }).click();
  await expect(page.getByRole("region", { name: "Consulta cerrada", exact: true })).toBeVisible();
  expect(await snapshot()).toEqual(before);
});
test("mismatched same-tenant appointment cannot expose another patient's context or suggest service", async ({
  page,
}) => {
  const own = await fixture(),
    other = await fixture();
  await login(page);
  const before = await snapshot();
  const identityReads: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/patients/" + other.patient.id))
      identityReads.push(request.url());
  });
  await page.goto(
    `/app/sales?patient=${own.patient.id}&encounter=${own.encounter.id}&appointment=${other.appointment.id}`
  );
  const context = page.getByRole("region", { name: "Contexto de la cita" });
  await expect(context.getByRole("alert")).toContainText("No pudimos verificar");
  await expect(context.getByText(other.patient.name, { exact: true })).toHaveCount(0);
  await expect(
    context.getByRole("button", { name: "Agregar servicio agendado al carrito" })
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Punto de venta", exact: true })).toBeVisible();
  expect(identityReads).toHaveLength(0);
  expect(await snapshot()).toEqual(before);
});
test("foreign context is 404 without exposing identity or issuing commands", async ({ page }) => {
  const own = await fixture();
  const otherTenant = await db.tenant.create({
    data: { name: "Otro tenant sintético", slug: randomUUID() },
  });
  const foreign = await fixture(otherTenant.id);
  await login(page);
  const before = await snapshot();
  const read = page.waitForResponse((response) =>
    response.url().endsWith("/api/scheduling/appointments/" + foreign.appointment.id)
  );
  await page.goto(
    `/app/sales?patient=${own.patient.id}&encounter=${own.encounter.id}&appointment=${foreign.appointment.id}`
  );
  expect((await read).status()).toBe(404);
  await expect(
    page.getByRole("region", { name: "Contexto de la cita" }).getByRole("alert")
  ).toBeVisible();
  await expect(page.getByText(foreign.patient.name, { exact: true })).toHaveCount(0);
  expect(await snapshot()).toEqual(before);
});
test("reader cannot create an association after an authorized context read", async ({ page }) => {
  const own = await fixture();
  const before = await snapshot();
  await login(page, "reader");
  await page.goto(
    `/app/sales?patient=${own.patient.id}&encounter=${own.encounter.id}&appointment=${own.appointment.id}`
  );
  await page
    .getByRole("button", { name: "Vincular esta consulta a la cita de origen", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "Confirmar vínculo", exact: true });
  await modal.getByRole("button", { name: "Confirmar vínculo", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("No pudimos vincular");
  expect(await db.clinicalAppointmentLink.count({ where: { encounterId: own.encounter.id } })).toBe(
    0
  );
  expect(await snapshot()).toEqual(before);
});
test("explicit GET retry recovers a failed association read without issuing a command", async ({
  page,
}) => {
  const f = await fixture();
  await login(page);
  let reads = 0;
  await page.route(
    `**/api/clinical/${f.patient.id}/encounters/${f.encounter.id}/links`,
    async (route) => {
      if (route.request().method() !== "GET") throw Error("Unexpected mutation");
      reads++;
      if (reads === 1)
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "INTERNAL", message: "PRIVATE synthetic payload" },
          }),
        });
      await route.continue();
    }
  );
  const before = await snapshot();
  await page.goto(`/app/sales?patient=${f.patient.id}&encounter=${f.encounter.id}`);
  const links = page.getByRole("region", { name: "Vínculos de atención", exact: true });
  await expect(links.getByRole("alert")).toBeVisible();
  expect(reads).toBe(1);
  await expect(page.getByText("PRIVATE synthetic payload", { exact: true })).toHaveCount(0);
  await links.getByRole("button", { name: "Volver a leer los vínculos", exact: true }).click();
  await expect(
    links.getByRole("link", { name: "Volver a esta consulta", exact: true })
  ).toBeVisible();
  expect(reads).toBe(2);
  expect(await snapshot()).toEqual(before);
});

test("a catalog item that is no longer a service cannot be suggested as the scheduled service", async ({
  page,
}) => {
  const f = await fixture();
  await db.catalogItem.update({ where: { id: f.service.id }, data: { kind: "PRODUCT" } });
  await login(page);
  const before = await snapshot();
  await page.goto(
    `/app/sales?patient=${f.patient.id}&encounter=${f.encounter.id}&appointment=${f.appointment.id}`
  );
  await page
    .getByRole("button", { name: "Agregar servicio agendado al carrito", exact: true })
    .click();
  await expect(
    page.getByText(
      "El servicio de la cita no está disponible en el catálogo activo. Elegí otro artículo o revisá el catálogo.",
      { exact: true }
    )
  ).toBeVisible();
  await expect(page.getByLabel("Precio unitario aplicado", { exact: true })).toHaveCount(0);
  expect(await snapshot()).toEqual(before);
});
