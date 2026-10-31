/// <reference lib="dom" />
import { randomUUID } from "node:crypto";
import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { PrismaClient } from "../../../packages/database/src/generated/index.js";
const url = process.env.CLINICAL_E2E_DATABASE_URL;
if (!url || !/^\/newsaas_clinical_browser_test_[a-f0-9]{32}$/.test(new URL(url).pathname))
  throw Error("Disposable clinical browser database required.");
const db = new PrismaClient({ datasources: { db: { url } } });
test.afterAll(() => db.$disconnect());
test("staff navigation — 50 fresh browser contexts preserve links and document", async ({
  browser,
}, info) => {
  test.setTimeout(360000);
  let page: Page | undefined, context: BrowserContext | undefined;
  let releaseRead: (() => void) | undefined;
  const tenantId = process.env.CLINICAL_E2E_TENANT_ID!,
    id = randomUUID(),
    name = "Navegación sintética " + id.slice(0, 8);
  const species = await db.species.findFirstOrThrow();
  await db.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: { tenantId, kind: "INDIVIDUAL", displayName: "Synthetic navigation guardian" },
    });
    await tx.patient.create({
      data: { id, tenantId, name, speciesId: species.id, sex: "UNKNOWN", isActive: false },
    });
    await tx.patientGuardian.create({
      data: { tenantId, patientId: id, customerId: customer.id, isPrimary: true, isActive: true },
    });
    await tx.patient.update({ where: { id }, data: { isActive: true } });
  });
  let iteration = 0;
  try {
    for (; iteration < 50; iteration++) {
      // Cold contexts reproduce the actual per-test entry, including login and cold router cache.
      // The two tested staff transitions must be real Links, never goto/router refresh.
      if (context) await context.close();
      context = await browser.newContext({
        baseURL: process.env.CLINICAL_E2E_BASE_URL,
        viewport: { width: 1440, height: 1000 },
        timezoneId: "America/Los_Angeles",
      });
      page = await context.newPage();
      await page.goto("/login");
      await page.locator("#login-email").fill("writer@clinical-e2e.invalid");
      await page.locator("#login-password").fill("clinical-e2e-password");
      await page.locator("#login-password").press("Enter");
      await expect(page).toHaveURL(/\/app$/);
      await page.waitForLoadState("load");
      const marker = randomUUID();
      await page.evaluate((value) => {
        document.documentElement.dataset.navigationDocument = value;
      }, marker);
      await page
        .getByRole("complementary", { name: "Navegación principal" })
        .getByRole("link", { name: "Pacientes", exact: true })
        .click();
      await expect(page).toHaveURL(/\/app\/patients$/);
      await page.getByLabel("Buscar pacientes", { exact: true }).fill(name);
      const searched = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/patients/search") &&
          response.request().method() === "POST" &&
          response.request().postData()?.includes(name) === true &&
          response.status() === 200
      );
      await page.getByRole("button", { name: "Buscar", exact: true }).click();
      await searched;
      await expect(page.getByRole("button", { name: "Buscar", exact: true })).toBeEnabled();
      if (iteration === 0) {
        const gate = new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
        await page.route("**/api/patients/" + id, async (route) => {
          await gate;
          await route.continue();
        });
      }
      await page.getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp("/patients/" + id + "$"));
      await expect(page.locator("html")).toHaveAttribute("data-navigation-document", marker);
      if (iteration === 0) {
        await expect(page.getByText("Cargando paciente…", { exact: true })).toBeVisible();
        releaseRead?.();
      }
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
  } catch (error) {
    const scheduler = await page
      ?.evaluate(() => {
        const rootKey = Object.keys(document).find((key) => key.startsWith("__reactContainer$"));
        const fiber = rootKey
          ? (document as unknown as Record<string, unknown>)[rootKey]
          : undefined;
        const root =
          typeof fiber === "object" && fiber !== null && "stateNode" in fiber
            ? fiber.stateNode
            : undefined;
        if (typeof root !== "object" || root === null) return null;
        const values: Record<string, number> = {};
        for (const key of ["pendingLanes", "suspendedLanes", "warmLanes", "pingedLanes"]) {
          const value = (root as Record<string, unknown>)[key];
          if (typeof value === "number") values[key] = value;
        }
        return values;
      })
      .catch(() => null);
    await info.attach("navigation-scheduler", {
      body: JSON.stringify({ completedEntries: iteration, url: page?.url(), scheduler }),
      contentType: "application/json",
    });
    throw error;
  } finally {
    releaseRead?.();
    await context?.close();
  }
});
