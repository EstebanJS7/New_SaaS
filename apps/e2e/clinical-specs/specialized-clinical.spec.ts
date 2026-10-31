/// <reference lib="dom" />
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "../../../packages/database/src/generated/index.js";

const databaseUrl = process.env.CLINICAL_E2E_DATABASE_URL;
if (
  !databaseUrl ||
  !/^\/newsaas_clinical_browser_test_[a-f0-9]{32}$/.test(new URL(databaseUrl).pathname)
)
  throw Error("Disposable clinical browser database required.");
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const tenantId = process.env.CLINICAL_E2E_TENANT_ID!;
const cases = [
  {
    kind: "treatment",
    path: "treatments",
    name: "tratamiento",
    section: "#patient-treatments",
    label: "Descripción del tratamiento",
    date: "Fecha y hora de administración",
    field: "description",
    dateField: "administeredAt",
    value: "Texto clínico sintético",
    changed: "Corrección sintética",
    table: "clinical_treatment",
  },
  {
    kind: "study",
    path: "studies",
    name: "estudio",
    section: "#patient-studies",
    label: "Tipo de estudio",
    date: "Fecha y hora de realización",
    field: "studyType",
    dateField: "performedAt",
    value: "Estudio sintético",
    changed: "Estudio corregido",
    table: "clinical_study",
  },
  {
    kind: "weight",
    path: "weights",
    name: "peso",
    section: "#patient-weights",
    label: "Peso (kg)",
    date: "Fecha y hora de medición",
    field: "quantity",
    dateField: "measuredAt",
    value: "0,125",
    changed: "12,345",
    table: "clinical_weight",
  },
] as const;
type Case = (typeof cases)[number];
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw Error("Expected clinical DTO");
  return value as Record<string, unknown>;
}
function section(page: Page, c: Case) {
  return page.locator(c.section);
}
async function patient() {
  const species = await db.species.findFirstOrThrow();
  const id = randomUUID(),
    name = "Paciente E2E " + id.slice(0, 8);
  await db.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: { tenantId, kind: "INDIVIDUAL", displayName: "Responsable sintético" },
    });
    await tx.patient.create({
      data: { id, tenantId, speciesId: species.id, name, sex: "UNKNOWN", isActive: false },
    });
    await tx.patientGuardian.create({
      data: { tenantId, patientId: id, customerId: customer.id, isPrimary: true, isActive: true },
    });
    await tx.patient.update({ where: { id }, data: { isActive: true } });
  });
  return { id, name };
}
async function open(page: Page, p: { id: string; name: string }, role = "writer") {
  await page.goto("/login");
  await page.locator("#login-email").fill(role + "@clinical-e2e.invalid");
  await page.locator("#login-password").fill("clinical-e2e-password");
  await page.locator("#login-password").press("Enter");
  await expect(page).toHaveURL(/\/app$/);
  await page.waitForLoadState("load");
  await page.evaluate(() => {
    document.documentElement.dataset.clinicalNavigationProbe = "same-document";
  });
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: "Abrir navegación", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Navegación del espacio de trabajo" })
      .getByRole("link", { name: "Pacientes", exact: true })
      .click();
  } else {
    await page
      .getByRole("complementary", { name: "Navegación principal" })
      .getByRole("link", { name: "Pacientes", exact: true })
      .click();
  }
  await expect(page).toHaveURL(/\/app\/patients$/);
  await page.getByLabel("Buscar pacientes", { exact: true }).fill(p.name);
  const searched = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/patients/search") &&
      response.request().method() === "POST" &&
      object(response.request().postDataJSON()).q === p.name &&
      response.status() === 200
  );
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await searched;
  await expect(page.getByRole("button", { name: "Buscar", exact: true })).toBeEnabled();
  const name = page.getByRole("link", { name: p.name, exact: true });

  await name.click();
  await expect(page).toHaveURL(new RegExp("/patients/" + p.id + "$"));
  await expect(page.locator("html")).toHaveAttribute(
    "data-clinical-navigation-probe",
    "same-document"
  );
}
async function fill(page: Page, c: Case) {
  const s = section(page, c);
  await s.getByRole("button", { name: "Registrar " + c.name, exact: true }).click();
  await s.getByLabel(c.label, { exact: true }).fill(c.value);
  await s.getByLabel(c.date, { exact: true }).fill("2026-10-20T12:00");
  if (c.kind === "study")
    await s.getByLabel("Resultado del estudio (opcional)").fill("Primera línea\nSegunda línea");
  if (c.kind === "treatment")
    await s
      .getByLabel("Contexto del tratamiento (opcional)")
      .fill("Contexto sintético\nSegunda línea");
}
async function review(page: Page, c: Case, correction = false) {
  if (correction)
    await section(page, c)
      .getByLabel("Motivo de la corrección", { exact: true })
      .fill("Motivo sintético");
  await section(page, c)
    .getByRole("button", {
      name: correction ? "Revisar corrección" : "Revisar " + c.name,
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog", { name: new RegExp("Confirmar") })).toBeVisible();
}
async function confirm(page: Page, c: Case) {
  await page
    .getByRole("dialog", { name: new RegExp("Confirmar") })
    .getByRole("button", { name: "Guardar " + c.name, exact: true })
    .click();
}
async function saved(page: Page, c: Case, correction = false) {
  await expect(
    section(page, c).getByText(
      c.kind === "weight"
        ? correction
          ? "Peso corregido."
          : "Peso registrado."
        : c.kind === "study"
          ? correction
            ? "Estudio corregido."
            : "Estudio registrado."
          : correction
            ? "Tratamiento corregido."
            : "Tratamiento registrado.",
      { exact: true }
    )
  ).toBeVisible();
}
async function counts(c: Case, patientId: string) {
  const rows = await db.$queryRawUnsafe<{ id: string; version: number }[]>(
    "SELECT id,version FROM " + c.table + " WHERE patient_id=$1::uuid AND tenant_id=$2::uuid",
    patientId,
    tenantId
  );
  const created = await db.auditLog.count({
    where: {
      tenantId,
      targetType: c.table,
      action: c.table + ".created",
      targetId: { in: rows.map((row) => row.id) },
    },
  });
  const updated = await db.auditLog.count({
    where: {
      tenantId,
      targetType: c.table,
      action: c.table + ".updated",
      targetId: { in: rows.map((row) => row.id) },
    },
  });
  return { rows, created, updated };
}
async function screenshot(page: Page, c: Case, name: string) {
  await section(page, c).screenshot({ path: join(process.env.CLINICAL_E2E_SHOTS!, name + ".png") });
}
async function privacy(page: Page, c: Case) {
  expect(page.url()).not.toContain(encodeURIComponent(c.value));
  const stored = await page.evaluate(() => {
    const values: string[] = [];
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key) values.push(storage.getItem(key) ?? "");
      }
    }
    return values.join(" ");
  });
  expect(stored).not.toContain(c.value);
}
test.afterAll(() => db.$disconnect());
for (const c of cases) {
  test(c.kind + " — desktop create/correct, keyboard and exact data", async ({ page }) => {
    const p = await patient();
    await open(page, p);
    await fill(page, c);
    await review(page, c);
    const dialog = page.getByRole("dialog", { name: new RegExp("Confirmar") });
    await expect(dialog).toContainText("2026");
    await expect(dialog).toContainText("12:00");
    await expect(dialog.getByRole("button", { name: "Volver al formulario" })).toBeFocused();
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await dialog.screenshot({
      path: join(process.env.CLINICAL_E2E_SHOTS!, c.kind + "-desktop-review.png"),
    });
    await confirm(page, c);
    await saved(page, c);
    let state = await counts(c, p.id);
    expect(state.rows).toHaveLength(1);
    expect(state.created).toBe(1);
    const response = await page.request.get(
      "/api/clinical/" + p.id + "/" + c.path + "/" + state.rows[0].id
    );
    expect(response.ok()).toBe(true);
    const detail = object(await response.json());
    expect(detail[c.dateField]).toBe("2026-10-20T15:00:00.000Z");
    if (c.kind === "weight") {
      expect(detail.quantity).toBe("0.125");
      expect(detail.unit).toBe("KG");
      await expect(section(page, c)).toContainText("0,125");
    }
    await section(page, c)
      .getByRole("button", { name: "Corregir " + c.name, exact: true })
      .click();
    await section(page, c).getByLabel(c.label, { exact: true }).fill(c.changed);
    await review(page, c, true);
    await confirm(page, c);
    await saved(page, c, true);
    state = await counts(c, p.id);
    expect(state.updated).toBe(1);
    expect(state.rows[0].version).toBe(2);
    await section(page, c).getByRole("button", { name: "Ver historial", exact: true }).click();
    const history = section(page, c).getByRole("region", { name: "Historial de correcciones" });
    await expect(history).toContainText("Motivo sintético");
    await expect(history).toContainText("Antes");
    await expect(history).toContainText("Después");
    await history.screenshot({
      path: join(process.env.CLINICAL_E2E_SHOTS!, c.kind + "-history-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await history.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await history.screenshot({
      path: join(process.env.CLINICAL_E2E_SHOTS!, c.kind + "-history-mobile.png"),
    });

    await privacy(page, c);
  });
  test(
    c.kind + " — committed response lost, Back/Forward recovery and one audit",
    async ({ page }) => {
      const p = await patient();
      await open(page, p);
      const path = "/api/clinical/" + p.id + "/" + c.path;
      const keys: string[] = [];
      let first = true;
      await page.route("**" + path, async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        const command = object(route.request().postDataJSON());
        keys.push(String(command.idempotencyKey));
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        if (first) {
          first = false;
          await route.abort("failed");
        } else await route.fulfill({ response });
      });
      await fill(page, c);
      await review(page, c);
      await confirm(page, c);
      await expect(page.getByRole("dialog", { name: new RegExp("Confirmar") })).toContainText(
        "Podés reintentar"
      );
      await page.goBack();
      await expect(page).toHaveURL(/\/app\/patients$/);
      await page.goForward();
      const recover = section(page, c).getByRole("button", {
        name: "Recuperar para reintento seguro",
      });
      await expect(recover).toBeVisible();
      await recover.click();
      await expect(section(page, c).getByLabel(c.label, { exact: true })).toBeDisabled();
      await review(page, c);
      await confirm(page, c);
      await saved(page, c);
      expect(keys).toHaveLength(2);
      expect(keys[1]).toBe(keys[0]);
      const state = await counts(c, p.id);
      expect(state.rows).toHaveLength(1);
      expect(state.created).toBe(1);
    }
  );
  test(
    c.kind + " — actual GET→PUT conflict retains copy and reads current state",
    async ({ page }) => {
      const p = await patient();
      await open(page, p);
      await fill(page, c);
      await review(page, c);
      await confirm(page, c);
      await saved(page, c);
      const id = (await counts(c, p.id)).rows[0].id,
        path = "/api/clinical/" + p.id + "/" + c.path + "/" + id;
      await section(page, c)
        .getByRole("button", { name: "Corregir " + c.name, exact: true })
        .click();
      await section(page, c).getByLabel(c.label, { exact: true }).fill(c.changed);
      let injected = false;
      await page.route("**" + path, async (route) => {
        if (route.request().method() !== "GET" || injected) {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        injected = true;
        const body =
          c.kind === "weight"
            ? { quantity: "9.999", unit: "KG", expectedVersion: 1 }
            : { [c.field]: "Cambio remoto sintético", expectedVersion: 1 };
        const remote = await page.request.put(path, { data: body });
        expect(remote.ok()).toBe(true);
        await route.fulfill({ response });
      });
      await review(page, c, true);
      await confirm(page, c);
      const dialog = page.getByRole("dialog", { name: new RegExp("Confirmar") });
      await expect(dialog).toContainText("El registro cambió.");
      await expect(dialog.getByRole("button", { name: "Guardar " + c.name })).toBeDisabled();
      await dialog.getByRole("button", { name: "Volver al formulario" }).click();
      await expect(section(page, c).getByLabel(c.label, { exact: true })).toHaveValue(c.changed);
      await section(page, c).getByRole("button", { name: "Consultar registro actual" }).click();
      await expect(
        section(page, c).getByRole("region", { name: "Conflicto de corrección" })
      ).toContainText(c.kind === "weight" ? "9,999" : "Cambio remoto sintético");
      expect((await counts(c, p.id)).updated).toBe(1);
    }
  );
  test(c.kind + " — mobile Back/Forward, cancel/discard and focus", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const p = await patient();
    await open(page, p);
    await fill(page, c);
    await page.goBack();
    await page.goForward();
    await section(page, c).getByRole("button", { name: "Recuperar cambios" }).click();
    await expect(section(page, c).getByLabel(c.label, { exact: true })).toHaveValue(c.value);
    await screenshot(page, c, c.kind + "-mobile-recovered");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await review(page, c);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await section(page, c).getByRole("button", { name: "Cancelar", exact: true }).click();
    const discard = page.getByRole("dialog", { name: "Descartar cambios del " + c.name });
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "Descartar cambios", exact: true }).click();
    await expect(
      section(page, c).getByRole("button", { name: "Registrar " + c.name, exact: true })
    ).toBeVisible();
    expect((await counts(c, p.id)).rows).toHaveLength(0);
    await privacy(page, c);
  });
}
test("weight — confirmed ID retries only failed unit GET", async ({ page }) => {
  const c = cases[2],
    p = await patient();
  await open(page, p);
  let posts = 0,
    failed = false;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/" + c.path)) posts++;
  });
  await page.route("**/api/clinical/" + p.id + "/weights/*", async (route) => {
    if (route.request().method() === "GET" && !failed) {
      failed = true;
      await route.fulfill({ status: 503, json: { error: { code: "INTERNAL" } } });
    } else await route.continue();
  });
  await fill(page, c);
  await review(page, c);
  await confirm(page, c);
  await expect(page.getByRole("dialog", { name: new RegExp("Confirmar") })).toContainText(
    "solo se reintentará su lectura"
  );
  await confirm(page, c);
  await saved(page, c);
  expect(posts).toBe(1);
  expect((await counts(c, p.id)).created).toBe(1);
});
test("session expiry hides recovery and re-login does not restore the old document", async ({
  page,
}) => {
  const c = cases[0],
    p = await patient();
  await open(page, p);
  await fill(page, c);
  await page.goBack();
  await page.context().clearCookies();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Tu sesión terminó" }).or(page.locator("#login-email"))
  ).toBeVisible();
  await expect(page.getByText(c.value, { exact: true })).toHaveCount(0);
  await open(page, p);
  await expect(section(page, c).getByRole("button", { name: /Recuperar/ })).toHaveCount(0);
  expect((await counts(c, p.id)).rows).toHaveLength(0);
});
test("backend rejects a reader's creation and keeps its working copy without writes", async ({
  page,
}) => {
  const c = cases[1],
    p = await patient();
  await open(page, p, "reader");
  await fill(page, c);
  await review(page, c);
  await confirm(page, c);
  await expect(page.getByRole("dialog", { name: new RegExp("Confirmar") })).toContainText(
    "No tenés permiso"
  );
  expect((await counts(c, p.id)).rows).toHaveLength(0);
});

test("weight — unspecified legacy unit stays unknown after date-only correction", async ({
  page,
}) => {
  const c = cases[2],
    p = await patient();
  const row = await db.clinicalWeight.create({
    data: {
      tenantId,
      patientId: p.id,
      quantity: "12.345",
      unit: null,
      measuredAt: new Date("2026-10-20T15:00:42.123Z"),
    },
  });
  await open(page, p);
  await section(page, c)
    .getByRole("button", { name: /Ver registro de peso/ })
    .click();
  await expect(section(page, c)).toContainText("Unidad no especificada");
  await section(page, c).getByRole("button", { name: "Corregir peso", exact: true }).click();
  await section(page, c).getByLabel(c.date, { exact: true }).fill("2026-10-21T12:00");
  await review(page, c, true);
  await confirm(page, c);
  await saved(page, c, true);
  const detail = object(
    await (await page.request.get("/api/clinical/" + p.id + "/weights/" + row.id)).json()
  );
  expect(detail.unit).toBeNull();
  expect(detail.quantity).toBe("12.345");
  expect(detail.measuredAt).toBe("2026-10-21T15:00:00.000Z");
  expect(detail.version).toBe(2);
  expect((await counts(c, p.id)).updated).toBe(1);
});

test("reader — clinical read does not grant history access", async ({ page }) => {
  const p = await patient();
  const row = await db.clinicalWeight.create({
    data: {
      tenantId,
      patientId: p.id,
      quantity: "0.125",
      measuredAt: new Date("2026-10-20T15:00:00.000Z"),
      unit: "KG",
    },
  });
  await open(page, p, "reader");
  const weights = section(page, cases[2]);
  await weights.getByRole("button", { name: /Ver registro de peso/ }).click();
  await expect(weights.getByRole("button", { name: "Ver historial", exact: true })).toHaveCount(0);
  const response = await page.request.post(
    "/api/clinical/" + p.id + "/weights/" + row.id + "/history/search",
    { data: {} }
  );
  expect(response.status()).toBe(403);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
});

async function manualDraft(page: Page, c: Case) {
  await section(page, c).getByRole("button", { name: "Guardar borrador", exact: true }).click();
  await expect(section(page, c)).toContainText("Borrador guardado en el servidor");
}
async function reloadDrafts(page: Page, c: Case) {
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page.reload();
  await section(page, c).getByRole("button", { name: "Borradores guardados", exact: true }).click();
  await expect(section(page, c)).toContainText("un borrador guardado");
}
for (const c of cases) {
  test(`${c.kind} — manual draft survives real document reload`, async ({ page }) => {
    const p = await patient();
    await open(page, p);
    await fill(page, c);
    await manualDraft(page, c);
    expect((await counts(c, p.id)).created).toBe(0);
    await reloadDrafts(page, c);
    await section(page, c).getByRole("button", { name: "Recuperar cambios", exact: true }).click();
    await expect(section(page, c).getByLabel(c.label, { exact: true })).toHaveValue(c.value);
    await section(page, c).screenshot({
      path: join(process.env.CLINICAL_E2E_SHOTS!, c.kind + "-draft-reload-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await section(page, c).screenshot({
      path: join(process.env.CLINICAL_E2E_SHOTS!, c.kind + "-draft-reload-mobile.png"),
    });
    await review(page, c);
    await confirm(page, c);
    await saved(page, c);
    expect((await counts(c, p.id)).created).toBe(1);
    const drafts = object(
      await (
        await page.request.post(`/api/clinical/${p.id}/drafts/search`, { data: { kind: c.kind } })
      ).json()
    );
    expect(drafts.items).toEqual([]);
  });
  test(`${c.kind} — lost durable creation response replays the same command after reload`, async ({
    page,
  }) => {
    const p = await patient();
    await open(page, p);
    await fill(page, c);
    await manualDraft(page, c);
    let lost = false;
    const bodies: string[] = [];
    await page.route(`**/api/clinical/${p.id}/drafts/*/submit`, async (route) => {
      bodies.push(route.request().postData()!);
      if (!lost) {
        lost = true;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await review(page, c);
    await confirm(page, c);
    await expect(section(page, c)).toContainText("Podés reintentar con la misma clave");
    await reloadDrafts(page, c);
    await section(page, c)
      .getByRole("button", { name: "Recuperar para reintento seguro", exact: true })
      .click();
    await review(page, c);
    await confirm(page, c);
    await saved(page, c);
    expect((await counts(c, p.id)).created).toBe(1);
    // Weight discovers the authoritative receipt ID on reload and uses GET only.
    if (c.kind === "weight") expect(bodies).toHaveLength(1);
    else {
      expect(bodies).toHaveLength(2);
      expect(object(JSON.parse(bodies[0]))).toEqual(object(JSON.parse(bodies[1])));
    }
  });
}
test("treatment — uncertain durable correction remains blocked after reload", async ({ page }) => {
  const c = cases[0],
    p = await patient();
  await open(page, p);
  await fill(page, c);
  await review(page, c);
  await confirm(page, c);
  await saved(page, c);
  await section(page, c).getByRole("button", { name: "Corregir tratamiento", exact: true }).click();
  await section(page, c).getByLabel(c.label, { exact: true }).fill(c.changed);
  await section(page, c)
    .getByLabel("Motivo de la corrección", { exact: true })
    .fill("Motivo durable sintético");
  await manualDraft(page, c);
  await page.route(`**/api/clinical/${p.id}/drafts/*/submit`, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort("failed");
  });
  await review(page, c, true);
  await confirm(page, c);
  await expect(section(page, c)).toContainText("No pudimos confirmar si se guardó");
  await reloadDrafts(page, c);
  await expect(section(page, c)).toContainText("El reenvío está bloqueado");
  await expect(section(page, c).getByRole("button", { name: /Recuperar/ })).toHaveCount(0);
  expect((await counts(c, p.id)).updated).toBe(1);
});
test("weight — durable receipt makes a failed post-commit projection GET-only after reload", async ({
  page,
}) => {
  const c = cases[2],
    p = await patient();
  await open(page, p);
  await fill(page, c);
  await manualDraft(page, c);
  let failed = false,
    submits = 0;
  page.on("request", (request) => {
    if (request.url().includes(`/clinical/${p.id}/drafts/`) && request.url().endsWith("/submit"))
      submits++;
  });
  await page.route(`**/api/clinical/${p.id}/weights/*`, async (route) => {
    if (route.request().method() === "GET" && !failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":{"code":"INTERNAL"}}',
      });
    } else await route.continue();
  });
  await review(page, c);
  await confirm(page, c);
  await expect(section(page, c)).toContainText("Podés reintentar con la misma clave");
  await reloadDrafts(page, c);
  await section(page, c)
    .getByRole("button", { name: "Recuperar para reintento seguro", exact: true })
    .click();
  await review(page, c);
  await confirm(page, c);
  await saved(page, c);
  expect(submits).toBe(1);
  expect((await counts(c, p.id)).created).toBe(1);
});
