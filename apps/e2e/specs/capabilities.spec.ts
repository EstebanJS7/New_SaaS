import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { startMailWorker, type MailWorker } from "../support/mail-worker.js";
import { runTag, signInAsStaff } from "../support/staff.js";
import { inviteAndActivate, suspendMember, type InvitedMember } from "../support/team.js";

/**
 * The staff web knows the caller's permissions and the clinic's features ([[UX-037]]), in the real
 * browser against the built apps: "Prueba en navegador con un rol limitado".
 *
 * A NEW veterinarian is invited by the demo owner and activated by mail on every run (see
 * `support/team.ts`), then signs in. The seeded VETERINARIAN role holds no settings key, no
 * `users.membership.manage`, no `branches.manage` and no catalog or customer write key, but it does
 * hold `patients.create` — so the same screens show both sides of the rule. The owner, in the same
 * run, still sees everything the veterinarian does not. At the end the veterinarian is suspended, so
 * the run leaves no extra active member behind.
 *
 * The demo tenant holds every feature code, so only the permission half of the gating is visible
 * here; the feature half is proven in the components.
 */
const PASSWORD = "limited-by-the-lane-password";
const API_BASE_URL = process.env.E2E_API_URL ?? "http://localhost:3001";
const STAFF_SESSION_COOKIE = "ns_staff_session";

/** What the four settings sections of «Configuración › General» need ([[CFG-001]]). */
const SETTINGS_KEYS = [
  "sales.settings.manage",
  "portal.settings.manage",
  "notifications.settings.manage",
  "scheduling.settings.manage",
] as const;

interface Capabilities {
  readonly permissions: string[];
  readonly features: string[];
}

function nav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Principal" });
}

async function navLabels(page: Page): Promise<string[]> {
  const entries = nav(page).getByTestId("nav-entry");
  await expect(entries.first()).toBeVisible();
  return (await entries.allInnerTexts()).map((text) => text.trim());
}

async function capabilitiesOf(page: Page): Promise<Capabilities> {
  const response = await page.request.get("/api/memberships/me/capabilities");
  expect(response.status()).toBe(200);
  return (await response.json()) as Capabilities;
}

/**
 * The API's own view of the session's permissions, read straight from the API with only the
 * session cookie — the route the web proxy deliberately refuses.
 */
async function apiPermissionsOf(context: BrowserContext): Promise<string[]> {
  const session = (await context.cookies()).find((c) => c.name === STAFF_SESSION_COOKIE);
  if (session === undefined) throw new Error("The signed-in context holds no staff session.");
  const response = await context.request.get(`${API_BASE_URL}/memberships/me/permissions`, {
    headers: { cookie: `${STAFF_SESSION_COOKIE}=${session.value}` },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { permissions: string[] }).permissions;
}

async function openScreen(page: Page, path: string, heading: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
}

/** Everything the limited veterinarian must and must not be offered. */
async function limitedRoleChecks(limited: BrowserContext, member: InvitedMember): Promise<void> {
  const vetPage = await limited.newPage();
  await signInAsStaff(vetPage, member.email, member.password);

  // The web's capabilities are exactly the API's view of this session, and the role is the
  // limited one this spec relies on.
  const caps = await capabilitiesOf(vetPage);
  expect(caps.permissions).toEqual(await apiPermissionsOf(limited));
  expect(caps.permissions).toEqual(expect.arrayContaining(["patients.create", "catalog.read"]));
  for (const key of [
    ...SETTINGS_KEYS,
    "users.membership.manage",
    "branches.manage",
    "catalog.create",
    "customers.create",
  ]) {
    expect(caps.permissions).not.toContain(key);
  }
  expect(caps.features).toEqual(expect.arrayContaining(["veterinary", "sales", "fiscal"]));

  // Nav: every entry follows its read (or manage) permission. The veterinarian keeps what
  // the role reads and loses the settings it cannot manage.
  const vetNav = await navLabels(vetPage);
  for (const hidden of ["General", "Personal", "Sucursales", "Configuración fiscal"]) {
    expect(vetNav).not.toContain(hidden);
  }
  expect(vetNav).toEqual(
    expect.arrayContaining(["Inicio", "Pacientes", "Catálogo", "POS", "Importaciones", "Marca"])
  );

  // Commerce: the catalog reads, but offers no «Nuevo artículo» without `catalog.create`.
  await openScreen(vetPage, "/app/catalog", "Catálogo");
  await expect(vetPage.getByRole("link", { name: "Nuevo artículo" })).toHaveCount(0);

  // Care: the action the role CAN use is offered; the one it cannot is not.
  await openScreen(vetPage, "/app/patients", "Pacientes");
  await expect(vetPage.getByRole("link", { name: "Nuevo paciente" })).toBeVisible();
  await openScreen(vetPage, "/app/customers", "Clientes");
  await expect(vetPage.getByRole("link", { name: "Nuevo cliente" })).toHaveCount(0);

  // A screen whose read permission is missing shows the Spanish no-access state, and the
  // API agrees.
  await openScreen(vetPage, "/app/settings/branches", "Sucursales");
  await expect(vetPage.getByText("No tenés permiso para ver las sucursales")).toBeVisible();
  await openScreen(vetPage, "/app/settings/team", "Personal");
  await expect(vetPage.getByText("No tenés permiso para ver el personal")).toBeVisible();
  await expect(vetPage.getByRole("button", { name: "Invitar persona" })).toHaveCount(0);
  expect((await vetPage.request.get("/api/memberships/directory")).status()).toBe(403);

  // CFG-001, live: without any settings key, «General» offers no section at all.
  await openScreen(vetPage, "/app/settings/general", "General");
  await expect(
    vetPage.getByText("No tenés permiso para cambiar la configuración general")
  ).toBeVisible();
  await expect(vetPage.getByTestId(/^settings-section-/)).toHaveCount(0);
}

/** The owner, in the same run, still sees what the veterinarian did not. */
async function ownerChecks(page: Page): Promise<void> {
  const ownerCaps = await capabilitiesOf(page);
  expect(ownerCaps.permissions).toEqual(await apiPermissionsOf(page.context()));
  expect(ownerCaps.permissions).toEqual(expect.arrayContaining([...SETTINGS_KEYS]));
  const ownerNav = await navLabels(page);
  expect(ownerNav).toEqual(
    expect.arrayContaining(["General", "Personal", "Sucursales", "Catálogo", "Pacientes"])
  );
  await openScreen(page, "/app/catalog", "Catálogo");
  await expect(page.getByRole("link", { name: "Nuevo artículo" })).toBeVisible();
  await openScreen(page, "/app/customers", "Clientes");
  await expect(page.getByRole("link", { name: "Nuevo cliente" })).toBeVisible();
  await openScreen(page, "/app/settings/branches", "Sucursales");
  await expect(page.getByText("No tenés permiso para ver las sucursales")).toHaveCount(0);
  await openScreen(page, "/app/settings/general", "General");
  for (const namespace of ["sales", "portal", "notifications", "scheduling"]) {
    await expect(page.getByTestId(`settings-section-${namespace}`)).toBeVisible();
  }
}

test.describe("caller capabilities in the staff web", () => {
  let mail: MailWorker;

  test.beforeAll(async () => {
    mail = await startMailWorker();
  });

  test.afterAll(async () => {
    await mail?.stop();
  });

  test("a limited role sees only what it can use; the owner still sees everything", async ({
    page,
    browser,
  }) => {
    const tag = runTag();
    await signInAsStaff(page);
    const vet = await inviteAndActivate(page.request, browser, mail, {
      displayName: `Veterinaria ${tag}`,
      email: `vet+e2e-${tag}@demo.newsaas.test`,
      roleCode: "VETERINARIAN",
      password: PASSWORD,
    });
    try {
      const limited = await browser.newContext();
      try {
        await limitedRoleChecks(limited, vet);
      } finally {
        await limited.close();
      }
      await ownerChecks(page);
    } finally {
      // Leave no extra active member behind, pass or fail.
      await suspendMember(page.request, vet.membershipId);
    }
  });
});
