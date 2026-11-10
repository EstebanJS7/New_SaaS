import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { esPyDecimal } from "../support/es-py-format.js";
import { bff, createCatalogItem, runTag, signInAsStaff } from "../support/staff.js";
import { DEMO } from "./fixtures.js";

/**
 * The branch filter on reports ([[MB-004]], last delivery of [[DEC-094]]), driven in a browser.
 * The story's pending gate: "prueba en navegador".
 *
 * The Stock report is the one that shows the filter's own rule: "Filtrado por sucursal, una
 * transferencia es entrada o salida real; en «Todas» no cuenta." This run receives 10 units of its
 * own item in a second branch and transfers 4 to the clinic's main branch. Then, on the real
 * report screen:
 *
 * - «Todas las sucursales» is the default and shows 10 in, nothing out: the transfer is internal.
 * - The second branch shows 6 on hand, 10 in and 4 out; the main branch 4 on hand and 4 in.
 * - Each screen agrees with the same report read through the BFF, which with a branch names it.
 * - The CSV exported with a branch carries that branch's numbers, under the same filename as the
 *   unfiltered export ("el nombre del archivo no cambia").
 * - A deactivated branch stays in the filter as «(inactiva)» and still answers its history.
 * - A veterinary report offers no branch filter.
 *
 * Preparation goes through the BFF, the same proxy and permission checks the browser uses; the
 * purchase, stock and branch screens belong to MB-001 and MB-003's own browser gates. The lane's
 * database outlives a run, so names carry a per-run tag, rows are read for this run's item only,
 * and the owner's assignment and the branch are undone at the end. An interrupted run's branch is
 * deactivated first, for the same reason.
 */

/** The demo seed's only branch, from `packages/database/src/demo-seed.ts`. */
const BASELINE_BRANCH_NAME = "Demo Main Branch";
/** This spec's branch names; the prefix is how an interrupted run's leftovers are recognized. */
const BRANCH_PREFIX = "Sucursal informes e2e ";
/** The period every read in this spec uses; the receipt and the transfer happen today. */
const PERIOD = "today";
/** The documented header row of `stock`'s CSV (`report-export.definitions.ts`). */
const STOCK_CSV_HEADER = "catalogItemId,name,kind,quantity,inbound,outbound,net";
const STOCK_CSV_FILENAME = /^stock-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/;

interface Branch {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
}

interface StaffMember {
  readonly membershipId: string;
  readonly email: string;
  readonly branchIds: readonly string[];
}

/** The four figures of one item's Stock row. */
interface StockFigures {
  readonly quantity: string;
  readonly inbound: string;
  readonly outbound: string;
  readonly net: string;
}

interface StockReport {
  readonly branch?: { readonly id: string; readonly name: string };
  readonly rows: readonly (StockFigures & { readonly catalogItemId: string })[];
}

async function listBranches(request: APIRequestContext): Promise<Branch[]> {
  return (await bff<{ branches: Branch[] }>(request, "GET", "/api/branches")).branches;
}

async function assignBranches(
  request: APIRequestContext,
  membershipId: string,
  branchIds: readonly string[]
): Promise<void> {
  const response = await request.put(`/api/memberships/${membershipId}/branches`, {
    data: { branchIds },
  });
  expect(
    response.ok(),
    `Assigning branches answered ${String(response.status())}: ${await response.text()}`
  ).toBe(true);
}

/** A run that died can leave its own ACTIVE branch behind; this deactivates only those. */
async function clearInterruptedRun(request: APIRequestContext): Promise<void> {
  const leftovers = (await listBranches(request)).filter(
    (branch) => branch.isActive && branch.name.startsWith(BRANCH_PREFIX)
  );
  for (const branch of leftovers) {
    await bff(request, "POST", `/api/branches/${branch.id}/deactivate`, {});
  }
}

/** This run's item row in the Stock report as the BFF answers it, and the branch it names. */
async function apiStock(
  request: APIRequestContext,
  itemId: string,
  branchId: string | null
): Promise<{ readonly branchName: string | null; readonly figures: StockFigures | null }> {
  const query = branchId === null ? "" : `&branchId=${branchId}`;
  const report = await bff<StockReport>(
    request,
    "GET",
    `/api/reports/stock?preset=${PERIOD}${query}`
  );
  const row = report.rows.find((candidate) => candidate.catalogItemId === itemId);
  return {
    branchName: report.branch?.name ?? null,
    figures:
      row === undefined
        ? null
        : { quantity: row.quantity, inbound: row.inbound, outbound: row.outbound, net: row.net },
  };
}

/** This run's item row as the report screen shows it, formatted the way the staff surface does. */
async function screenStock(page: Page, itemName: string): Promise<StockFigures> {
  const row = page.getByTestId("report-row").filter({ hasText: itemName });
  await expect(row).toHaveCount(1);
  const cell = (key: keyof StockFigures) => row.getByTestId(`report-cell-${key}`).innerText();
  return {
    quantity: await cell("quantity"),
    inbound: await cell("inbound"),
    outbound: await cell("outbound"),
    net: await cell("net"),
  };
}

function present(figures: StockFigures | null): StockFigures {
  if (figures === null) throw new Error("This run's item has no row in the Stock report.");
  return figures;
}

function formatted(figures: StockFigures): StockFigures {
  return {
    quantity: esPyDecimal(figures.quantity),
    inbound: esPyDecimal(figures.inbound),
    outbound: esPyDecimal(figures.outbound),
    net: esPyDecimal(figures.net),
  };
}

/** Clicks «Exportar CSV» and returns the file's name and its row for this run's item. */
async function exportStock(
  page: Page,
  itemId: string
): Promise<{ readonly filename: string; readonly header: string; readonly row: string }> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("report-export").click();
  const download = await downloadPromise;
  const path = await download.path();
  if (path === null) throw new Error("The download had no local path; the lane cannot read it.");
  const lines = (await readFile(path, "utf8")).split("\n");
  return {
    filename: download.suggestedFilename(),
    header: lines[0] ?? "",
    row: lines.find((line) => line.startsWith(`${itemId},`)) ?? "",
  };
}

test.describe("branch filter on reports", () => {
  test("the Stock report filters by branch on screen and in the CSV, counts transfers only per branch, keeps a deactivated branch, and veterinary reports have no filter", async ({
    page,
  }) => {
    await signInAsStaff(page);
    const request = page.request;
    await clearInterruptedRun(request);

    const tag = runTag();
    const branchName = `${BRANCH_PREFIX}${tag}`;
    const item = await createCatalogItem(request, {
      name: `Insumo de informe ${tag}`,
      kind: "PRODUCT",
      price: "15000.00",
    });
    const supplier = await bff<{ id: string }>(request, "POST", "/api/suppliers", {
      name: `Proveedor de informe ${tag}`,
    });

    const activeBranches = (await listBranches(request)).filter((branch) => branch.isActive);
    expect(activeBranches).toHaveLength(1);
    const [baselineBranch] = activeBranches;
    if (baselineBranch === undefined) throw new Error("The demo clinic has no active branch.");
    expect(baselineBranch.name).toBe(BASELINE_BRANCH_NAME);

    const owner = (
      await bff<{ members: StaffMember[] }>(request, "GET", "/api/memberships/directory")
    ).members.find((member) => member.email === DEMO.staffEmail);
    if (owner === undefined) throw new Error("The demo owner is not in the directory.");
    expect(owner.branchIds).toEqual([baselineBranch.id]);

    let branchId: string | undefined;
    let ownerAssigned = false;
    let branchActive = false;

    try {
      // --- Preparation: 10 received in the new branch, 4 transferred to the main one ---------
      branchId = (
        await bff<{ branch: Branch }>(request, "POST", "/api/branches", {
          name: branchName,
          address: `Av. informes e2e ${tag}`,
        })
      ).branch.id;
      branchActive = true;
      await assignBranches(request, owner.membershipId, [baselineBranch.id, branchId]);
      ownerAssigned = true;
      const purchase = await bff<{ id: string }>(request, "POST", "/api/purchases", {
        supplierId: supplier.id,
        branchId,
        lines: [{ catalogItemId: item.id, quantity: "10", unitCost: "1000.00" }],
      });
      await bff(request, "POST", `/api/purchases/${purchase.id}/receive`, {});
      await bff(request, "POST", "/api/inventory/stock/transfers", {
        catalogItemId: item.id,
        fromBranchId: branchId,
        toBranchId: baselineBranch.id,
        quantity: "4",
        reason: `Reposición de informe ${tag}`,
      });

      // --- The API's own answers: a transfer is internal in «Todas», real per branch ---------
      const all = await apiStock(request, item.id, null);
      expect(all).toEqual({
        branchName: null,
        figures: { quantity: "10.000", inbound: "10.000", outbound: "0.000", net: "10.000" },
      });
      const inBranch = await apiStock(request, item.id, branchId);
      expect(inBranch).toEqual({
        branchName,
        figures: { quantity: "6.000", inbound: "10.000", outbound: "4.000", net: "6.000" },
      });
      const inBaseline = await apiStock(request, item.id, baselineBranch.id);
      expect(inBaseline).toEqual({
        branchName: BASELINE_BRANCH_NAME,
        figures: { quantity: "4.000", inbound: "4.000", outbound: "0.000", net: "4.000" },
      });

      // --- The report screen: «Todas las sucursales» by default ------------------------------
      await page.goto("/app/reports/stock");
      await page.getByLabel("Período", { exact: true }).selectOption(PERIOD);
      const filter = page.getByLabel("Sucursal", { exact: true });
      await expect(filter).toHaveValue("");
      await expect(filter.locator("option:checked")).toHaveText("Todas las sucursales");
      await expect(page.getByTestId("report-export")).toHaveAttribute(
        "href",
        `/api/reports/stock/export?preset=${PERIOD}`
      );
      await expect
        .poll(() => screenStock(page, item.name))
        .toEqual(formatted(present(all.figures)));
      const unfiltered = await exportStock(page, item.id);
      expect(unfiltered.filename).toMatch(STOCK_CSV_FILENAME);
      expect(unfiltered.header).toBe(STOCK_CSV_HEADER);
      expect(unfiltered.row).toBe(`${item.id},${item.name},PRODUCT,10.000,10.000,0.000,10.000`);

      // --- One branch: the screen, the export link and the CSV follow it ---------------------
      await filter.selectOption({ label: branchName });
      await expect(page.getByTestId("report-export")).toHaveAttribute(
        "href",
        `/api/reports/stock/export?preset=${PERIOD}&branchId=${branchId}`
      );
      await expect
        .poll(() => screenStock(page, item.name))
        .toEqual(formatted(present(inBranch.figures)));
      const filtered = await exportStock(page, item.id);
      expect(filtered.filename).toBe(unfiltered.filename);
      expect(filtered.header).toBe(STOCK_CSV_HEADER);
      expect(filtered.row).toBe(`${item.id},${item.name},PRODUCT,6.000,10.000,4.000,6.000`);

      await filter.selectOption({ label: BASELINE_BRANCH_NAME });
      await expect
        .poll(() => screenStock(page, item.name))
        .toEqual(formatted(present(inBaseline.figures)));

      // --- A deactivated branch keeps its history in the filter ------------------------------
      await assignBranches(request, owner.membershipId, [baselineBranch.id]);
      ownerAssigned = false;
      await bff(request, "POST", `/api/branches/${branchId}/deactivate`, {});
      branchActive = false;
      await page.reload();
      await page.getByLabel("Período", { exact: true }).selectOption(PERIOD);
      await filter.selectOption({ label: `${branchName} (inactiva)` });
      await expect
        .poll(() => screenStock(page, item.name))
        .toEqual(formatted(present(inBranch.figures)));
      expect(await apiStock(request, item.id, branchId)).toEqual(inBranch);
    } finally {
      // Undo only what this run created, through the same public routes the browser uses.
      if (ownerAssigned) await assignBranches(request, owner.membershipId, [baselineBranch.id]);
      if (branchId !== undefined && branchActive) {
        await bff(request, "POST", `/api/branches/${branchId}/deactivate`, {});
      }
    }

    // --- A veterinary report has no branch filter -------------------------------------------
    await page.goto("/app/reports/consultations");
    await expect(page.getByLabel("Período", { exact: true })).toBeVisible();
    await expect(page.locator("#report-branch")).toHaveCount(0);

    // The lane is back where it started: one active branch, one workplace.
    expect((await listBranches(request)).filter((branch) => branch.isActive)).toHaveLength(1);
  });
});
