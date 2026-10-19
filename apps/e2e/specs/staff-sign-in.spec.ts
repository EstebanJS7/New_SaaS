import { expect, test } from "@playwright/test";
import { DEMO } from "./fixtures.js";

/**
 * The staff sign-in surface, driven by a real browser against the built apps.
 *
 * This is the flow whose ABSENCE no test could report ([[SHELL-001]]): every layer was internally
 * consistent and the page did not exist. A browser test fails on that immediately, which is the whole
 * argument for this lane.
 */
test.describe("the staff sign-in surface", () => {
  test("signs in, lands on the shell, and a list renders rows from the API", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("#login-email")).toBeVisible();

    await page.fill("#login-email", DEMO.staffEmail);
    await page.fill("#login-password", DEMO.staffPassword);
    await page.getByRole("button", { name: "Sign in" }).click();

    // The cookie is set by the API and relayed by the BFF, and the page cannot see it: landing here
    // proves the whole hop, which is what a component test cannot prove.
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByTestId("nav-sidebar")).toBeVisible();
    await expect(page.getByTestId("topbar")).toBeVisible();

    // A list, reached the way a user reaches it — through the nav — and with DATA, because an empty
    // state renders just as successfully as a working one.
    await page.getByRole("link", { name: "Customers" }).click();
    await expect(page).toHaveURL(/\/app\/customers$/);
    await expect(page.getByRole("link", { name: DEMO.customerName })).toBeVisible();
  });

  test("submits with the Enter key, the way a password manager and every user expect", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.fill("#login-email", DEMO.staffEmail);
    await page.fill("#login-password", DEMO.staffPassword);

    // No button click: the keyboard alone. The form was a `Card` with a `type="button"` and no
    // `<form>` element when this spec was written, so Enter did nothing at all — a gap that renders
    // perfectly, signs in perfectly, and fails every user who does the most ordinary thing.
    await page.locator("#login-password").press("Enter");

    await expect(page).toHaveURL(/\/app$/);
  });

  test("refuses a wrong password without saying which half was wrong", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#login-email", DEMO.staffEmail);
    await page.fill("#login-password", "not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByTestId("login-problem")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
