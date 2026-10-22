import { expect, test } from "@playwright/test";
import { DEMO } from "./fixtures.js";

/**
 * The clinical record entry surface ([[REP-010]]), driven by a real browser:
 * record a vaccination with a due date, see it listed, correct that date, and
 * REMOVE it so the row states there is no due date.
 *
 * **THIS SPEC'S FIRST EXECUTION WAS A FAILURE, AND THAT IS WHY IT READS THE WAY IT
 * DOES.** It was written in an environment where Docker is unavailable, so it could
 * only be checked statically. Its first real run was in CI on PR #145, where it
 * timed out on a `fill` because the labels and the display format it asserted were
 * the ones the surface had BEFORE the browser-zone defect was fixed: the date fields
 * became `<input type="date">` and the row renderer became a plain calendar date,
 * and this file still drove a `datetime-local` control and expected a wall-clock
 * time. Nothing in the earlier static checks could have caught that.
 *
 * **SCOPE.** This spec covers the two record kinds [[REP-010]] added —
 * vaccinations and deworming — and nothing else. Treatments, studies and weights
 * have API routes but NO staff UI: they remain API-only ([[TD-055]], narrowed to
 * three kinds by [[DEC-067]]). Nothing below should be read as coverage of
 * recording a treatment, a study or a weight, because a staff member cannot
 * record one through the product yet.
 *
 * Why this flow belongs in a browser at all: the surfaces it crosses are exactly
 * the ones no component test can prove. The session cookie is set by the API and
 * relayed by the BFF, the records reach the API through the authenticated
 * `/api/clinical` proxy, `nextDueAt` crosses three JSON hops (calendar date → the
 * noon-UTC wire form → API → the row's date), and the row only appears if the list
 * invalidation actually refetches. Every one of those can render perfectly in jsdom
 * and fail in the built product.
 */

/**
 * The demo patient this lane opens, from the demo seed's `buildDemoPatients`
 * ("Bobby"). Written here for the same reason `fixtures.ts` duplicates the
 * seed's other values: the seed is a SCRIPT rather than part of a package's
 * public surface, so a renamed fixture fails loudly at the first navigation
 * instead of silently testing something else.
 */
const DEMO_PATIENT_NAME = "Bobby";

test.describe("the clinical record entry surface", () => {
  test("records a vaccination with a due date, corrects it, and removes it", async ({ page }) => {
    // The seed creates no vaccination for this patient, and this lane never
    // cleans up after itself (clinical records are append-only, and the lane
    // runs against a demo database). The name therefore carries this run's
    // clock, and every assertion is scoped to the row this test created instead
    // of assuming the list arrived empty.
    const vaccineName = `Rabies (lane ${Date.now()})`;
    // Whole calendar dates, which is what a `date` field accepts and what the
    // surface stores. Deliberately not near a month or year boundary, so a
    // failure here is about the conversion and not about date arithmetic.
    const administeredAt = "2026-11-01";
    const recordedDueAt = "2027-11-01";
    const correctedDueAt = "2027-03-01";

    await page.goto("/login");
    await page.fill("#login-email", DEMO.staffEmail);
    await page.fill("#login-password", DEMO.staffPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);

    // Reached the way staff reach it: the nav, then the patient list, then the
    // patient. The clinical section is per-patient and has no route of its own
    // (DEC-067 decided that deliberately: no new page, no new route).
    await page.getByRole("link", { name: "Patients" }).click();
    await expect(page).toHaveURL(/\/app\/patients$/);
    await page.getByRole("link", { name: DEMO_PATIENT_NAME }).click();
    await expect(page).toHaveURL(/\/app\/patients\/[0-9a-f-]{36}$/);

    const vaccinations = page.getByTestId("vaccination-records");
    await expect(vaccinations).toBeVisible();
    // The second kind this Story added, present and independent of the first.
    await expect(page.getByTestId("deworming-records")).toBeVisible();

    // CREATE — a due date entered as a calendar date. The surface pins it to noon
    // UTC on the wire, which is what keeps the tenant-local day equal to the day
    // typed even when the browser's zone is not the tenant's.
    await vaccinations.getByRole("button", { name: "Record vaccination" }).click();
    await vaccinations.getByLabel("Vaccine").fill(vaccineName);
    await vaccinations.getByLabel("Administered on").fill(administeredAt);
    await vaccinations.getByLabel("Next dose due (optional)").fill(recordedDueAt);
    await vaccinations.getByRole("button", { name: "Save vaccination" }).click();

    // The notice is a live status region, and the row exists only if the list
    // invalidation refetched from the API: a form that writes and never shows
    // the row passes every component test that stubs the refetch.
    await expect(vaccinations.getByRole("status")).toHaveText("Vaccination recorded.");
    const row = vaccinations.getByRole("listitem").filter({ hasText: vaccineName });
    await expect(row).toBeVisible();
    // The row shows the date the staff member typed, as a date. This is the
    // assertion that would have caught the browser-zone defect: an instant
    // converted through the wrong zone renders the PREVIOUS day here.
    await expect(row.getByText(administeredAt)).toBeVisible();
    await expect(row.getByText(recordedDueAt)).toBeVisible();

    // CORRECT — the due date changes and the administered instant does not.
    await row.getByRole("button", { name: "Correct" }).click();
    await vaccinations.getByLabel("Next dose due (optional)").fill(correctedDueAt);
    await vaccinations.getByRole("button", { name: "Save changes" }).click();

    await expect(vaccinations.getByRole("status")).toHaveText("Vaccination corrected.");
    await expect(row.getByText(correctedDueAt)).toBeVisible();
    // The administered date is NOT part of a correction of the due date.
    await expect(row.getByText(administeredAt)).toBeVisible();

    // CLEAR — an explicit removal, not a blank. [[DEC-065]] made NULL a real
    // state ("no due date recorded"), and the upcoming/overdue reports omit the
    // row rather than deriving a date nobody entered. A surface that could only
    // REPLACE a wrong due date would reintroduce, in the UI, exactly the defect
    // the API was fixed to avoid.
    await row.getByRole("button", { name: "Correct" }).click();
    await vaccinations.getByRole("button", { name: "Clear due date" }).click();

    await expect(vaccinations.getByRole("status")).toHaveText("Due date removed.");
    await expect(row.getByText("No due date recorded")).toBeVisible();
    await expect(row.getByText(correctedDueAt)).toHaveCount(0);
  });
});
