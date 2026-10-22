import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { DEMO } from "./fixtures.js";

/**
 * The staff reporting surfaces ([[REP-008]]), driven by a real browser: the
 * dashboard at `/app`, one report opened from its own card, that report's period
 * changed, and its CSV exported.
 *
 * **THIS SPEC IS UNRUN.** It was written in an environment where Docker is
 * unavailable, so there are no built apps and no database for this lane: no
 * `next start`, no API, no seeded tenant. It is written against the conventions
 * the other specs in this directory use (`clinical-records.spec.ts`,
 * `staff-sign-in.spec.ts`) and it has been statically checked with this package's
 * `lint` and `typecheck`, but it has never been executed and nothing here claims
 * that it passes. Run it with the lane (see the package README) before treating
 * it as evidence.
 *
 * **WHY A BROWSER.** Every hop below is one no component test can prove: the
 * session cookie is set by the API and relayed by the BFF, the four cards read
 * `/api/reports/...` through the authenticated catch-all proxy, and the CSV
 * arrives with the API's own `content-disposition` relayed by a SECOND BFF route
 * — a filename and a media type that only exist once a real browser saves the
 * file.
 *
 * **WHAT THE SEEDED TENANT CAN AND CANNOT SHOW.** The demo seed creates
 * customers, patients, clinical records and one appointment; it creates **no
 * catalog item, no sale and no cash session**. So on a freshly seeded database
 * the four cards honestly read `0.00`, `0`, `0.00` and "no threshold is set".
 * Rather than hardcode those zeros — which would keep passing while a card was
 * wired to the wrong report — this spec reads the SAME reports through the
 * browser's own session (`page.request` shares the context's cookies) and
 * asserts each card against the API's own answer. Today that answer is the empty
 * tenant; the assertion is what makes the card's provenance real either way.
 *
 * The one run-unique value a reporting flow would need is a period: the CSV's
 * filename is built from the RESOLVED range, so this spec asks for a fixed custom
 * range rather than "last 30 days", which would resolve against the wall clock
 * and make the expected filename different every run.
 */

/** A JSON object narrowed field by field; never a cast to a DTO. */
type JsonObject = Readonly<Record<string, unknown>>;

/**
 * One report, read through the session the page holds.
 *
 * The body is narrowed field by field rather than cast to a DTO: this lane's
 * TypeScript runs with the repository's type-aware lint rules, and `as` on an
 * unvalidated body would be asserting the very thing the test is supposed to
 * check.
 */
async function readReport(request: APIRequestContext, path: string): Promise<JsonObject> {
  const response = await request.get(path);
  expect(response.ok(), `GET ${path} answered ${String(response.status())}`).toBe(true);
  const raw: unknown = await response.json();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`GET ${path} did not answer a JSON object.`);
  }
  return raw as JsonObject;
}

function requireString(source: JsonObject, key: string): string {
  const value = source[key];
  if (typeof value !== "string") {
    throw new Error(`Expected "${key}" to be a string, received ${typeof value}.`);
  }
  return value;
}

function requireNumber(source: JsonObject, key: string): number {
  const value = source[key];
  if (typeof value !== "number") {
    throw new Error(`Expected "${key}" to be a number, received ${typeof value}.`);
  }
  return value;
}

function requireObject(source: JsonObject, key: string): JsonObject {
  const value = source[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected "${key}" to be a JSON object.`);
  }
  return value as JsonObject;
}

function rowCount(source: JsonObject): number {
  const rows = source.rows;
  if (!Array.isArray(rows)) {
    throw new Error(`Expected "rows" to be an array.`);
  }
  return rows.length;
}

/** The preset the dashboard opens on, and therefore the one its first read sends. */
const OPENING_PRESET = "last30Days";

/**
 * The custom period this spec exports.
 *
 * Fixed, and deliberately in the past: the filename carries the RESOLVED
 * `<from>-<to>`, so a preset would name a different file on every run. A range
 * the tenant certainly has no data in is also the more useful assertion — an
 * empty period still exports the documented header row.
 */
const EXPORT_FROM = "2026-01-01";
const EXPORT_TO = "2026-01-31";

/** The documented header row of `sales-by-period`'s CSV (REP-007). */
const SALES_CSV_HEADER = "bucketDate,saleCount,net,tax,gross";

test.describe("the staff reporting surfaces", () => {
  test("shows the dashboard's figures, opens a report from its card, changes the period and exports the CSV", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.fill("#login-email", DEMO.staffEmail);
    await page.fill("#login-password", DEMO.staffPassword);
    await page.getByRole("button", { name: "Sign in" }).click();

    // Signing in lands on the dashboard, and the cookie that got here is the one
    // every card's read is authenticated with.
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByTestId("app-dashboard")).toBeVisible();

    // ---- the four cards, each against the API's own answer ------------------

    const salesByPeriod = await readReport(
      page.request,
      `/api/reports/sales-by-period?preset=${OPENING_PRESET}`
    );
    const grossCard = page.getByTestId("dashboard-card-gross");
    // `totalGross` is a fixed-scale decimal STRING and the card prints it
    // verbatim: the assertion is on the API's exact characters, not on a rounded
    // number the surface might have computed.
    await expect(grossCard.getByTestId("dashboard-card-gross-value")).toContainText(
      requireString(salesByPeriod, "totalGross")
    );
    await expect(grossCard).toContainText(requireString(salesByPeriod, "currency"));

    await expect(page.getByTestId("dashboard-card-sales-value")).toContainText(
      String(requireNumber(salesByPeriod, "saleCount"))
    );

    const cashSessions = await readReport(
      page.request,
      `/api/reports/cash-sessions?preset=${OPENING_PRESET}`
    );
    const cashTotals = requireObject(cashSessions, "totals");
    await expect(page.getByTestId("dashboard-card-cash-difference-value")).toContainText(
      requireString(cashTotals, "difference")
    );

    // `low-stock` takes NO query (it is a current-state report), so the correct
    // request is the bare path.
    const lowStock = await readReport(page.request, "/api/reports/low-stock");
    const lowStockCard = page.getByTestId("dashboard-card-low-stock");
    if (lowStock.thresholdsConfigured === false) {
      // The seeded tenant's first-run state ([[DEC-065]]): no catalog item carries
      // a threshold, so the card must EXPLAIN that instead of rendering `0`, which
      // would read as "stock is healthy".
      await expect(
        lowStockCard.getByTestId("dashboard-card-low-stock-not-configured")
      ).toBeVisible();
      await expect(lowStockCard.getByTestId("dashboard-card-low-stock-configure")).toHaveAttribute(
        "href",
        "/app/catalog"
      );
    } else {
      await expect(lowStockCard.getByTestId("dashboard-card-low-stock-value")).toContainText(
        String(rowCount(lowStock))
      );
    }

    // ---- one report, opened from ITS OWN card ------------------------------

    await page.getByTestId("dashboard-card-gross-link").click();
    await expect(page).toHaveURL(/\/app\/reports\/sales-by-period$/);

    // A live region: the table when the period has rows, the explanation when it
    // does not. Either way the surface STATED its answer rather than rendering an
    // empty panel.
    await expect(
      page.getByTestId("report-table").or(page.getByTestId("report-empty-period"))
    ).toBeVisible();

    // ---- its period changed -------------------------------------------------

    await page.getByLabel("Period").selectOption("custom");
    await page.getByLabel("From").fill(EXPORT_FROM);
    await page.getByLabel("To").fill(EXPORT_TO);

    // The export link carries the very query the table is showing, so this is also
    // the surface's own statement that the range was applied.
    await expect(page.getByTestId("report-export")).toHaveAttribute(
      "href",
      `/api/reports/sales-by-period/export?from=${EXPORT_FROM}&to=${EXPORT_TO}`
    );

    // ---- the CSV ------------------------------------------------------------

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("report-export").click();
    const download = await downloadPromise;

    // The filename is the API's, relayed by the export proxy. The `download`
    // attribute is deliberately absent on the link, so a browser that invented a
    // name here would fail this line — which is the whole point of asserting it.
    expect(download.suggestedFilename()).toBe(`sales-by-period-${EXPORT_FROM}-${EXPORT_TO}.csv`);

    const downloadPath = await download.path();
    if (downloadPath === null) {
      throw new Error("The download had no local path; the lane cannot read the CSV.");
    }
    const csv = await readFile(downloadPath, "utf8");
    // The first line of the file, character for character: the documented header
    // row. An empty period is a file with headers and NO data rows, never an empty
    // body — an empty body would be indistinguishable from a failed export.
    expect(csv.split("\n")[0]).toBe(SALES_CSV_HEADER);
  });
});
