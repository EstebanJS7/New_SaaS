import { expect, test } from "@playwright/test";
import { DEMO } from "./fixtures.js";

/**
 * The tenant portal, driven by a real browser.
 *
 * The portal is a SECOND identity with its own cookie, its own BFF hop and its own gate, and it is
 * where [[TD-049]] lived: a proxy that answered 500 for a body the handler read. Nothing in the
 * repository drove it end to end.
 */
test.describe("the portal sign-in surface", () => {
  test("signs in, lands on the tenant home, and the pet list has the holder's pets", async ({
    page,
  }) => {
    await page.goto(`/${DEMO.tenantSlug}/login`);
    await expect(page.locator("#portal-login-email")).toBeVisible();

    await page.fill("#portal-login-email", DEMO.portalEmail);
    await page.fill("#portal-login-password", DEMO.portalPassword);
    await page.getByRole("button", { name: "Sign in" }).click();

    // The portal session is a different cookie from the staff one, relayed by a different BFF hop.
    await expect(page).toHaveURL(new RegExp(`/${DEMO.tenantSlug}$`));

    await page.getByTestId("portal-nav").getByRole("link", { name: "Pets" }).click();
    await expect(page).toHaveURL(new RegExp(`/${DEMO.tenantSlug}/pets$`));
    // Rows, not an empty state: an empty list renders just as successfully as a working one.
    await expect(page.getByTestId("portal-pet-link").first()).toBeVisible();
    await expect(page.getByText(DEMO.portalPetName)).toBeVisible();
  });

  test("submits with the Enter key, like the staff form it was modelled on", async ({ page }) => {
    await page.goto(`/${DEMO.tenantSlug}/login`);
    await page.fill("#portal-login-email", DEMO.portalEmail);
    await page.fill("#portal-login-password", DEMO.portalPassword);

    await page.locator("#portal-login-password").press("Enter");

    await expect(page).toHaveURL(new RegExp(`/${DEMO.tenantSlug}$`));
  });

  test("sends a visitor with no session to the sign-in page, keeping the tenant", async ({
    page,
  }) => {
    // No sign-in first: this page's whole job without a session is to refuse.
    await page.goto(`/${DEMO.tenantSlug}/pets`);

    await expect(page).toHaveURL(new RegExp(`/${DEMO.tenantSlug}/login$`));
    await expect(page.locator("#portal-login-email")).toBeVisible();
  });

  test("keeps staff and portal sessions apart: a staff cookie is not a portal session", async ({
    page,
  }) => {
    // Sign in as STAFF, then ask for a portal page. The two identities share a browser and nothing
    // else; a portal page that accepted a staff session would be the identity boundary failing.
    await page.goto("/login");
    await page.fill("#login-email", DEMO.staffEmail);
    await page.fill("#login-password", DEMO.staffPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);

    await page.goto(`/${DEMO.tenantSlug}/pets`);

    await expect(page).toHaveURL(new RegExp(`/${DEMO.tenantSlug}/login$`));
  });
});
