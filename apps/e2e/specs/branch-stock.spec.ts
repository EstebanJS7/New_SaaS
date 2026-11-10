import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { bff, createCatalogItem, runTag, signInAsStaff } from "../support/staff.js";
import { DEMO } from "./fixtures.js";

/**
 * Stock per branch, purchases and transfers ([[MB-003]], third delivery of [[DEC-094]]), driven in
 * a browser. The story's pending gate: "prueba en navegador".
 *
 * With one active branch, neither the purchase form nor the Stock screen offers a branch choice or
 * a transfer. With a second branch where the owner works, a purchase created on the real form asks
 * which branch receives it, the detail shows that branch, and receiving it adds stock THERE only.
 * Comercio › Stock lists one balance per (item, branch) with «Todas» by default and a filter per
 * branch; a transfer moves the quantity from one branch to the other, and a transfer larger than
 * the origin's stock is refused with the API's sentence and changes no balance.
 *
 * Preparation (the second branch, the owner's assignment, the catalog item, the supplier) goes
 * through the BFF, the same proxy and permission checks the browser uses; the Branches screens
 * themselves belong to MB-001's browser gate, not to this spec. The lane's database outlives a run, so names carry a
 * per-run tag, balances are read for this run's item only, and the assignment and the branch are
 * undone at the end. An interrupted run's branch is deactivated first, for the same reason.
 */

/** The demo seed's only branch, from `packages/database/src/demo-seed.ts`. */
const BASELINE_BRANCH_NAME = "Demo Main Branch";
/** This spec's branch names; the prefix is how an interrupted run's leftovers are recognized. */
const BRANCH_PREFIX = "Sucursal stock e2e ";

/** `apps/api/src/inventory/inventory.service.ts` — the sentence the API answers. */
const TRANSFER_INSUFFICIENT_STOCK_MESSAGE =
  "No hay stock suficiente en la sucursal de origen para transferir esa cantidad.";

/** The screen's own alerts; Next's route announcer is also `role="alert"` and always empty. */
const SCREEN_ALERT = '[role="alert"]:not(#__next-route-announcer__)';

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

interface StockBalance {
  readonly catalogItemId: string;
  readonly branchId: string;
  readonly branchName: string | null;
  readonly quantity: string;
}

interface Purchase {
  readonly id: string;
  readonly status: string;
  readonly branchId: string;
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

/** This run's item balances as `{ branchName: quantity }`, optionally filtered by branch. */
async function itemBalances(
  request: APIRequestContext,
  itemId: string,
  branchId?: string
): Promise<Record<string, string>> {
  const query = branchId === undefined ? "" : `?branchId=${branchId}`;
  const balances = await bff<StockBalance[]>(request, "GET", `/api/inventory/stock${query}`);
  return Object.fromEntries(
    balances
      .filter((balance) => balance.catalogItemId === itemId)
      .map((balance) => [balance.branchName ?? balance.branchId, balance.quantity])
  );
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

/** The balance rows the Stock screen shows for one item, as `[branchName, quantity]`. */
async function screenRows(page: Page, itemName: string): Promise<string[][]> {
  const rows = page.getByRole("row").filter({ hasText: itemName });
  await expect(rows.first()).toBeVisible();
  const result: string[][] = [];
  for (const row of await rows.all()) {
    const cells = await row.getByRole("cell").allInnerTexts();
    result.push([cells[1] ?? "", cells[2] ?? ""]);
  }
  return result.sort((left, right) => (left[0] ?? "").localeCompare(right[0] ?? "", "es"));
}

test.describe("stock per branch, purchases and transfers", () => {
  test("a purchase is received in its branch, the Stock screen filters by branch, and a transfer moves stock while an oversized one is refused", async ({
    page,
  }) => {
    await signInAsStaff(page);
    const request = page.request;
    await clearInterruptedRun(request);

    const tag = runTag();
    const branchName = `${BRANCH_PREFIX}${tag}`;
    const item = await createCatalogItem(request, {
      name: `Alimento de sucursal ${tag}`,
      kind: "PRODUCT",
      price: "30000.00",
    });
    const supplier = await bff<{ id: string; name: string }>(request, "POST", "/api/suppliers", {
      name: `Proveedor de sucursal ${tag}`,
    });

    const baselineBranches = (await listBranches(request)).filter((branch) => branch.isActive);
    expect(baselineBranches).toHaveLength(1);
    const [baselineBranch] = baselineBranches;
    if (baselineBranch === undefined) throw new Error("The demo clinic has no active branch.");
    expect(baselineBranch.name).toBe(BASELINE_BRANCH_NAME);

    const owner = (
      await bff<{ members: StaffMember[] }>(request, "GET", "/api/memberships/directory")
    ).members.find((member) => member.email === DEMO.staffEmail);
    if (owner === undefined) throw new Error("The demo owner is not in the directory.");
    expect(owner.branchIds).toEqual([baselineBranch.id]);

    // --- With one active branch there is nothing to choose and nothing to transfer ----------
    await page.goto("/app/purchases/new");
    await expect(page.getByLabel("Proveedor")).toBeVisible();
    await expect(page.locator("#purchase-branch")).toHaveCount(0);
    await page.getByRole("link", { name: "Stock" }).click();
    await expect(page).toHaveURL(/\/app\/inventory$/);
    await expect(page.getByText("Stock por sucursal")).toBeVisible();
    await expect(page.getByText("Transferir entre sucursales")).toHaveCount(0);

    let branchId: string | undefined;
    let ownerAssigned = false;

    try {
      const created = await bff<{ branch: Branch }>(request, "POST", "/api/branches", {
        name: branchName,
        address: `Av. stock e2e ${tag}`,
      });
      branchId = created.branch.id;
      await assignBranches(request, owner.membershipId, [baselineBranch.id, branchId]);
      ownerAssigned = true;

      // --- The purchase asks which branch receives it, and the detail shows that branch -------
      await page.goto("/app/purchases/new");
      await page.getByLabel("Proveedor").selectOption({ label: supplier.name });
      const branchSelect = page.getByLabel("Sucursal", { exact: true });
      await expect(branchSelect).toBeVisible();
      await branchSelect.selectOption({ label: branchName });
      await page.getByLabel("Artículo 1").selectOption({ label: item.name });
      await page.getByLabel("Cantidad").fill("10");
      await page.getByLabel("Costo unitario").fill("1000");
      await page.getByRole("button", { name: "Crear compra" }).click();
      await expect(page).toHaveURL(/\/app\/purchases\/[0-9a-f-]+\/edit$/);
      const purchaseId = /\/app\/purchases\/([0-9a-f-]+)\/edit$/.exec(page.url())?.[1];
      if (purchaseId === undefined) throw new Error("The new purchase's id is not in the URL.");

      const draft = await bff<Purchase>(request, "GET", `/api/purchases/${purchaseId}`);
      expect(draft).toMatchObject({ status: "DRAFT", branchId });

      await page.goto(`/app/purchases/${purchaseId}`);
      const branchRow = page.getByText("Sucursal", { exact: true }).locator("..");
      await expect(branchRow).toContainText(branchName);
      await page.getByRole("button", { name: "Recibir compra" }).click();
      const confirm = page.getByRole("dialog", { name: "Recibir compra" });
      await confirm.getByRole("button", { name: "Recibir compra" }).click();
      await expect(page.getByText("Recepción registrada", { exact: true })).toBeVisible();

      const received = await bff<Purchase>(request, "GET", `/api/purchases/${purchaseId}`);
      expect(received).toMatchObject({ status: "RECEIVED", branchId });
      // The stock entered the receiving branch only.
      expect(await itemBalances(request, item.id)).toEqual({ [branchName]: "10.000" });

      // --- Comercio › Stock: «Todas» by default, then one branch ------------------------------
      await page.goto("/app/inventory");
      const filter = page.getByLabel("Sucursal", { exact: true });
      await expect(filter).toHaveValue("");
      await expect(filter.locator("option:checked")).toHaveText("Todas");
      expect(await screenRows(page, item.name)).toEqual([[branchName, "10.000"]]);

      // --- A transfer moves stock from the new branch to the baseline -------------------------
      await expect(page.getByText("Transferir entre sucursales")).toBeVisible();
      await page.getByLabel("Desde").selectOption({ label: branchName });
      await page.getByLabel("Hacia").selectOption({ label: BASELINE_BRANCH_NAME });
      await page.getByLabel("Ítem").selectOption({ label: item.name });
      await page.getByLabel("Cantidad").fill("4");
      await page.getByLabel("Motivo").fill(`Reposición e2e ${tag}`);
      await page.getByRole("button", { name: "Transferir", exact: true }).click();
      await expect(page.getByRole("status")).toHaveText("Transferencia registrada.");

      const afterTransfer = { [BASELINE_BRANCH_NAME]: "4.000", [branchName]: "6.000" };
      expect(await itemBalances(request, item.id)).toEqual(afterTransfer);
      await expect
        .poll(() => screenRows(page, item.name))
        .toEqual([
          [BASELINE_BRANCH_NAME, "4.000"],
          [branchName, "6.000"],
        ]);

      await filter.selectOption({ label: branchName });
      await expect.poll(() => screenRows(page, item.name)).toEqual([[branchName, "6.000"]]);
      expect(await itemBalances(request, item.id, branchId)).toEqual({ [branchName]: "6.000" });

      await filter.selectOption({ label: BASELINE_BRANCH_NAME });
      await expect
        .poll(() => screenRows(page, item.name))
        .toEqual([[BASELINE_BRANCH_NAME, "4.000"]]);

      // --- A transfer above the origin's stock is refused and changes nothing -----------------
      await filter.selectOption({ label: "Todas" });
      await page.getByLabel("Desde").selectOption({ label: branchName });
      await page.getByLabel("Hacia").selectOption({ label: BASELINE_BRANCH_NAME });
      await page.getByLabel("Ítem").selectOption({ label: item.name });
      await page.getByLabel("Cantidad").fill("50");
      await page.getByLabel("Motivo").fill(`Exceso e2e ${tag}`);
      await page.getByRole("button", { name: "Transferir", exact: true }).click();
      await expect(page.locator(SCREEN_ALERT)).toHaveText(TRANSFER_INSUFFICIENT_STOCK_MESSAGE);
      expect(await itemBalances(request, item.id)).toEqual(afterTransfer);
      expect(await screenRows(page, item.name)).toEqual([
        [BASELINE_BRANCH_NAME, "4.000"],
        [branchName, "6.000"],
      ]);
    } finally {
      // Undo only what this run created, through the same public routes the browser uses.
      if (ownerAssigned) await assignBranches(request, owner.membershipId, [baselineBranch.id]);
      if (branchId !== undefined) {
        const deactivated = await bff<{ branch: Branch }>(
          request,
          "POST",
          `/api/branches/${branchId}/deactivate`,
          {}
        );
        expect(deactivated.branch.isActive).toBe(false);
      }
    }

    // The lane is back where it started: one active branch, one workplace.
    expect((await listBranches(request)).filter((branch) => branch.isActive)).toHaveLength(1);
  });
});
