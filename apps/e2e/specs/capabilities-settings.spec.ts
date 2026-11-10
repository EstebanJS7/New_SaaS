import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { WEB_BASE_URL } from "./fixtures.js";
import { startMailWorker, type MailWorker } from "../support/mail-worker.js";
import { staffSessionHeader, withRolePermissions } from "../support/rbac.js";
import { runTag, signInAsStaff } from "../support/staff.js";
import { inviteAndActivate, suspendMember } from "../support/team.js";
import { provisionClinic } from "../support/tenant.js";

/**
 * [[CFG-001]] «Sin el permiso de una sección, la sección no se ofrece; sin el feature, la sección no
 * se ofrece», live in the real browser against the built apps, on top of the capabilities the staff
 * web loads ([[UX-037]]). `capabilities.spec.ts` already shows a role with NO settings key; this spec
 * shows the two partial cases the seed alone cannot:
 *
 * 1. A role holding exactly ONE settings key. No seeded role does, so the demo owner gives the
 *    RECEPTIONIST role its own set plus `scheduling.settings.manage` through the API's audited
 *    override command, and restores the exact original set in a `finally` (support/rbac.ts).
 * 2. A clinic WITHOUT the `sales` and `portal` features. The demo tenant holds every feature, so a
 *    second clinic is provisioned on every run with the repository's own command (support/tenant.ts).
 */
const PASSWORD = "settings-gating-lane-password";
const ROLE = "RECEPTIONIST";
const ONE_KEY = "scheduling.settings.manage";
/** Every feature code of the reference seed except `sales` and `portal`. */
const FEATURES_WITHOUT_SALES_AND_PORTAL = [
  "veterinary",
  "inventory",
  "purchases",
  "cash",
  "billing",
  "fiscal",
  "whatsapp",
  "multi_branch",
  "advanced_reports",
  "custom_branding",
] as const;
type Namespace = "sales" | "portal" | "notifications" | "scheduling";

type Settings = Record<string, unknown>;

function section(page: Page, namespace: Namespace): Locator {
  return page.getByTestId(`settings-section-${namespace}`);
}

async function navLabels(page: Page): Promise<string[]> {
  const entries = page.getByRole("navigation", { name: "Principal" }).getByTestId("nav-entry");
  await expect(entries.first()).toBeVisible();
  return (await entries.allInnerTexts()).map((text) => text.trim());
}

async function openGeneral(page: Page): Promise<void> {
  await page.goto("/app/settings/general");
  await expect(page.getByRole("heading", { name: "General", level: 1 })).toBeVisible();
}

async function readScheduling(request: APIRequestContext): Promise<Settings> {
  const response = await request.get("/api/settings/scheduling");
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { settings: Settings }).settings;
}

test.describe("tenant settings gated live by permission and feature", () => {
  let mail: MailWorker;

  test.beforeAll(async () => {
    mail = await startMailWorker();
  });

  test.afterAll(async () => {
    await mail?.stop();
  });

  test("a role with one settings key is offered and saves only that section", async ({
    page,
    browser,
  }) => {
    const tag = runTag();
    await signInAsStaff(page);
    const ownerApi = await staffSessionHeader(page.context());
    const receptionist = await inviteAndActivate(page.request, browser, mail, {
      displayName: `Recepción ${tag}`,
      email: `reception+e2e-${tag}@demo.newsaas.test`,
      roleCode: ROLE,
      password: PASSWORD,
    });
    const originalScheduling = await readScheduling(page.request);
    try {
      await withRolePermissions(page.request, ownerApi, ROLE, [ONE_KEY], async () => {
        const limited = await browser.newContext();
        try {
          const member = await limited.newPage();
          await signInAsStaff(member, receptionist.email, receptionist.password);

          // The member's own capabilities carry the one granted settings key and no other.
          const caps = (await (
            await member.request.get("/api/memberships/me/capabilities")
          ).json()) as { permissions: string[] };
          expect(caps.permissions).toContain(ONE_KEY);
          for (const key of [
            "sales.settings.manage",
            "portal.settings.manage",
            "notifications.settings.manage",
          ]) {
            expect(caps.permissions).not.toContain(key);
          }

          // «General» is in the nav, and the screen offers ONLY the Agenda section.
          expect(await navLabels(member)).toContain("General");
          await openGeneral(member);
          await expect(section(member, "scheduling")).toBeVisible();
          for (const hidden of ["sales", "portal", "notifications"] as const) {
            await expect(section(member, hidden)).toHaveCount(0);
          }
          await expect(member.getByTestId(/^settings-section-/)).toHaveCount(1);

          // Saving the Agenda section works with that one key.
          const wasAllow = originalScheduling.conflictPolicy === "ALLOW";
          const radio = wasAllow ? /^No permitir turnos/ : /^Permitir turnos/;
          const agenda = section(member, "scheduling");
          await agenda.getByRole("radio", { name: radio }).check();
          await agenda.getByRole("button", { name: "Guardar", exact: true }).click();
          await expect(
            agenda.getByRole("status").filter({ hasText: "Se guardaron los cambios." })
          ).toBeVisible();
          expect(await readScheduling(member.request)).toEqual({
            ...originalScheduling,
            conflictPolicy: wasAllow ? "REJECT" : "ALLOW",
          });
        } finally {
          await limited.close();
        }
      });
    } finally {
      // The owner writes the demo clinic's scheduling settings back exactly, then closes the
      // clinic to the member; the role itself was restored (and compared) by withRolePermissions.
      const restore = await page.request.put("/api/settings/scheduling", {
        data: originalScheduling,
      });
      expect(restore.status(), await restore.text()).toBe(200);
      expect(await readScheduling(page.request)).toEqual(originalScheduling);
      await suspendMember(page.request, receptionist.membershipId);
    }
  });

  test("a clinic without sales and portal is offered neither section nor the POS", async ({
    page,
    browser,
  }) => {
    const tag = runTag();
    const owner = await provisionClinic(browser, {
      slug: `e2e-sin-ventas-${tag}`,
      name: `Clínica sin ventas ${tag}`,
      ownerEmail: `owner+e2e-${tag}@sin-ventas.newsaas.test`,
      ownerName: `Dueña ${tag}`,
      features: FEATURES_WITHOUT_SALES_AND_PORTAL,
      webUrl: WEB_BASE_URL,
      password: PASSWORD,
    });
    await signInAsStaff(page, owner.email, owner.password);

    // The web's view of the new clinic: every settings key (OWNER), but no sales or portal.
    const caps = (await (await page.request.get("/api/memberships/me/capabilities")).json()) as {
      permissions: string[];
      features: string[];
    };
    expect(caps.features).toEqual([...FEATURES_WITHOUT_SALES_AND_PORTAL].sort());
    expect(caps.permissions).toEqual(
      expect.arrayContaining([
        "sales.settings.manage",
        "portal.settings.manage",
        "notifications.settings.manage",
        "scheduling.settings.manage",
        "sales.read",
        "sales.create",
      ])
    );

    // No «POS» in the nav, even with every sales permission.
    const labels = await navLabels(page);
    expect(labels).toContain("General");
    expect(labels).not.toContain("POS");

    // «General» offers Notificaciones and Agenda, never Ventas or Portal.
    await openGeneral(page);
    await expect(section(page, "notifications")).toBeVisible();
    await expect(section(page, "scheduling")).toBeVisible();
    await expect(section(page, "sales")).toHaveCount(0);
    await expect(section(page, "portal")).toHaveCount(0);
    await expect(page.getByTestId(/^settings-section-/)).toHaveCount(2);
  });
});
