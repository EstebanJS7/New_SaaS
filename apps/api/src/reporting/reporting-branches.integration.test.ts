import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { SEEDED_TAX_RATE_IDS, type BranchRow } from "../../test/support/in-memory-database.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
} from "../../test/support/rbac-fixture.js";
import {
  REPORT_BRANCH_NOT_FOUND_MESSAGE,
  type CashMovementsResponse,
  type CashSessionsResponse,
  type LowStockReportResponse,
  type PurchasesResponse,
  type ReportBranchOptionDto,
  type SalesByPeriodResponse,
  type StockReportResponse,
} from "./reporting.dto.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";

interface ErrorDto {
  error: { code: string; message: string };
}

const PERIOD_QUERY = "from=2026-06-10&to=2026-06-11";
const IN_PERIOD = new Date("2026-06-10T12:00:00.000Z");

/**
 * MB-004 (DEC-094 §11): the commercial, cash, purchase and inventory reports
 * take an optional `branchId`. Without it they answer for the whole clinic
 * («Todas») exactly as before; with it, only that branch — and the response
 * echoes which branch it was.
 */
describe("Reports per branch (MB-004)", () => {
  let booted: BootedTestApp;
  let actor: RbacActor;
  let tenantId: string;
  let central: BranchRow;
  let norte: BranchRow;
  let cerrada: BranchRow;
  let foreignBranchId: string;
  let itemId: string;

  beforeAll(async () => {
    booted = await bootTestApp();
    const db = booted.db;
    const suffix = randomUUID().slice(0, 8);
    const tenant = db.prisma.tenant.create({
      data: { slug: `report-branches-${suffix}`, name: "Report branches" },
    });
    tenantId = tenant.id;
    const role = seedRoleWithKeys(db, `REPORT_BRANCHES_${suffix}`, "Reports", [
      REPORTING_PERMISSIONS.read,
      REPORTING_PERMISSIONS.export,
    ]);
    actor = seedRbacActor(db, {
      email: `report-branches-${suffix}@isolation.test`,
      tenantId,
      roleId: role.role.id,
    });
    const first = [...db.tables.branches.values()].find((row) => row.tenantId === tenantId);
    if (!first) throw new Error("fixture: the tenant has no first branch");
    central = first;
    norte = db.prisma.branch.create({ data: { tenantId, name: "Norte" } });
    cerrada = db.prisma.branch.create({ data: { tenantId, name: "Cerrada", isActive: false } });

    const other = db.prisma.tenant.create({
      data: { slug: `report-branches-other-${suffix}`, name: "Other" },
    });
    const otherBranch = [...db.tables.branches.values()].find((row) => row.tenantId === other.id);
    if (!otherBranch) throw new Error("fixture: the other tenant has no branch");
    foreignBranchId = otherBranch.id;

    // Sales: 100 at the central branch, 250 at Norte.
    for (const [branchId, gross] of [
      [central.id, "100.00"],
      [norte.id, "250.00"],
    ] as const) {
      const sale = db.prisma.sale.create({
        data: {
          tenantId,
          currency: "PYG",
          branchId,
          status: "COMPLETED",
          lines: {
            create: [
              {
                catalogItemId: randomUUID(),
                rateCode: "EXEMPT",
                unitPrice: gross,
                quantity: "1.000",
                lineTotal: gross,
                taxableBase: gross,
                taxAmount: "0.00",
              },
            ],
          },
        },
      });
      db.prisma.sale.updateMany({ where: { id: sale.id }, data: { completedAt: IN_PERIOD } });
    }

    // Cash: one drawer per branch, each with one closed session and one movement.
    for (const [branchId, amount] of [
      [central.id, "10.00"],
      [norte.id, "30.00"],
    ] as const) {
      const register = db.prisma.cashRegister.create({
        data: { tenantId, name: `Caja ${randomUUID().slice(0, 6)}`, branchId },
      });
      const session = db.prisma.cashSession.create({
        data: {
          tenantId,
          registerId: register.id,
          openedByMembershipId: actor.membership?.id ?? randomUUID(),
          openingAmount: "0.00",
        },
      });
      db.prisma.cashSession.updateMany({
        where: { id: session.id, tenantId },
        data: {
          status: "CLOSED",
          closedAt: IN_PERIOD,
          expectedAmount: amount,
          countedAmount: amount,
          differenceAmount: "0.00",
        },
      });
      const movement = db.prisma.cashMovement.create({
        data: {
          tenantId,
          registerId: register.id,
          sessionId: session.id,
          type: "INCOME",
          amount,
        },
      });
      const stored = db.tables.cashMovements.get(movement.id);
      if (stored) stored.createdAt = IN_PERIOD;
    }

    // Purchases: one received into each branch.
    const supplier = db.prisma.supplier.create({ data: { tenantId, name: "Proveedor" } });
    for (const branchId of [central.id, norte.id]) {
      const purchased = db.prisma.catalogItem.create({
        data: {
          tenantId,
          kind: "SUPPLY",
          name: `Insumo ${randomUUID().slice(0, 6)}`,
          taxRateId: SEEDED_TAX_RATE_IDS.EXEMPT,
        },
      });
      const purchase = db.prisma.purchase.create({
        data: {
          tenantId,
          supplierId: supplier.id,
          branchId,
          status: "RECEIVED",
          lines: { create: [{ catalogItemId: purchased.id, quantity: "1.000" }] },
        },
      });
      db.prisma.purchase.updateMany({
        where: { id: purchase.id, tenantId },
        data: { receivedAt: IN_PERIOD },
      });
    }

    // Stock: 4 at the central branch, 2 at Norte, threshold 3. Norte received
    // 2 by transfer from the central branch and 1 by adjustment in the period.
    itemId = db.prisma.catalogItem.create({
      data: {
        tenantId,
        kind: "PRODUCT",
        name: "Pipeta",
        taxRateId: SEEDED_TAX_RATE_IDS.EXEMPT,
        tracksStock: true,
        lowStockThreshold: "3.000",
      },
    }).id;
    for (const [branchId, quantity] of [
      [central.id, "4.000"],
      [norte.id, "2.000"],
    ] as const) {
      db.prisma.stockBalance.upsert({
        where: { tenantId_catalogItemId_branchId: { tenantId, catalogItemId: itemId, branchId } },
        create: { tenantId, catalogItemId: itemId, branchId, quantity },
        update: { quantity },
      });
    }
    const transferId = randomUUID();
    for (const movement of [
      { type: "TRANSFER_OUT", branchId: central.id, quantity: "-2.000", transferId },
      { type: "TRANSFER_IN", branchId: norte.id, quantity: "2.000", transferId },
      { type: "ADJUSTMENT", branchId: norte.id, quantity: "1.000", transferId: null },
    ] as const) {
      const created = db.prisma.stockMovement.create({
        data: { tenantId, catalogItemId: itemId, reason: "x", ...movement },
      });
      const stored = db.tables.stockMovements.get(created.id);
      if (stored) stored.createdAt = IN_PERIOD;
    }
  });

  afterAll(async () => {
    await booted.close();
  });

  const get = (path: string) =>
    supertest(booted.app.getHttpServer()).get(path).set("Cookie", actor.cookie);

  it("lists every branch of the clinic, inactive ones included", async () => {
    const response = await get("/reports/branches").expect(200);
    expect(response.body as ReportBranchOptionDto[]).toEqual([
      { id: central.id, name: "Casa central", isActive: true },
      { id: cerrada.id, name: "Cerrada", isActive: false },
      { id: norte.id, name: "Norte", isActive: true },
    ]);
    await get("/reports/branches?x=1").expect(400);
  });

  it("sales: «Todas» by default with no branch echo, one branch when asked", async () => {
    const all = (await get(`/reports/sales-by-period?${PERIOD_QUERY}`).expect(200))
      .body as SalesByPeriodResponse;
    expect(all.totalGross).toBe("350.00");
    expect(Object.keys(all)).not.toContain("branch");

    const narrowed = (
      await get(`/reports/sales-by-period?${PERIOD_QUERY}&branchId=${norte.id}`).expect(200)
    ).body as SalesByPeriodResponse;
    expect(narrowed.totalGross).toBe("250.00");
    expect(narrowed.saleCount).toBe(1);
    expect(narrowed.branch).toEqual({ id: norte.id, name: "Norte" });
  });

  it("cash: sessions and movements of the branch's own drawers only", async () => {
    const sessions = (
      await get(`/reports/cash-sessions?${PERIOD_QUERY}&branchId=${norte.id}`).expect(200)
    ).body as CashSessionsResponse;
    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0]?.countedAmount).toBe("30.00");

    const movements = (
      await get(`/reports/cash-movements?${PERIOD_QUERY}&branchId=${norte.id}`).expect(200)
    ).body as CashMovementsResponse;
    expect(movements.net).toBe("30.00");

    const allMovements = (await get(`/reports/cash-movements?${PERIOD_QUERY}`).expect(200))
      .body as CashMovementsResponse;
    expect(allMovements.net).toBe("40.00");

    // A branch with no drawer answers an empty report, not the whole clinic.
    const none = (
      await get(`/reports/cash-sessions?${PERIOD_QUERY}&branchId=${cerrada.id}`).expect(200)
    ).body as CashSessionsResponse;
    expect(none.rows).toEqual([]);
  });

  it("purchases: the ones received into the branch", async () => {
    const all = (await get(`/reports/purchases?${PERIOD_QUERY}`).expect(200))
      .body as PurchasesResponse;
    expect(all.rows).toHaveLength(2);
    const narrowed = (
      await get(`/reports/purchases?${PERIOD_QUERY}&branchId=${central.id}`).expect(200)
    ).body as PurchasesResponse;
    expect(narrowed.rows).toHaveLength(1);
    expect(narrowed.branch?.name).toBe("Casa central");
  });

  it("stock: a transfer is a real input of the branch, and nothing for «Todas»", async () => {
    const all = (await get(`/reports/stock?${PERIOD_QUERY}`).expect(200))
      .body as StockReportResponse;
    expect(all.rows.find((row) => row.catalogItemId === itemId)).toMatchObject({
      quantity: "6.000",
      inbound: "1.000",
      outbound: "0.000",
    });

    const norteStock = (
      await get(`/reports/stock?${PERIOD_QUERY}&branchId=${norte.id}`).expect(200)
    ).body as StockReportResponse;
    expect(norteStock.rows.find((row) => row.catalogItemId === itemId)).toMatchObject({
      quantity: "2.000",
      inbound: "3.000",
      outbound: "0.000",
      net: "3.000",
    });

    const centralStock = (
      await get(`/reports/stock?${PERIOD_QUERY}&branchId=${central.id}`).expect(200)
    ).body as StockReportResponse;
    expect(centralStock.rows.find((row) => row.catalogItemId === itemId)).toMatchObject({
      quantity: "4.000",
      inbound: "0.000",
      outbound: "2.000",
    });
  });

  it("low stock: compares the branch's own balance with the item's threshold", async () => {
    const all = (await get("/reports/low-stock").expect(200)).body as LowStockReportResponse;
    expect(all.rows.some((row) => row.catalogItemId === itemId)).toBe(false);

    const norteLow = (await get(`/reports/low-stock?branchId=${norte.id}`).expect(200))
      .body as LowStockReportResponse;
    expect(norteLow.rows.find((row) => row.catalogItemId === itemId)).toMatchObject({
      quantity: "2.000",
      shortfall: "1.000",
    });
    expect(norteLow.branch).toEqual({ id: norte.id, name: "Norte" });

    await get(`/reports/low-stock?branchId=${norte.id}&from=2026-06-10`).expect(400);
  });

  it("refuses another clinic's branch exactly like an unknown one", async () => {
    for (const branchId of [foreignBranchId, randomUUID()]) {
      const response = await get(
        `/reports/sales-by-period?${PERIOD_QUERY}&branchId=${branchId}`
      ).expect(404);
      expect((response.body as ErrorDto).error.message).toBe(REPORT_BRANCH_NOT_FOUND_MESSAGE);
    }
  });

  it("refuses a malformed branch id and a branch on the veterinary reports", async () => {
    await get(`/reports/sales-by-period?${PERIOD_QUERY}&branchId=not-a-uuid`).expect(400);
    await get(`/reports/consultations?${PERIOD_QUERY}&branchId=${norte.id}`).expect(400);
  });

  it("exports the narrowed report and accepts a branch on the low-stock export", async () => {
    const csv = await get(`/reports/purchases/export?${PERIOD_QUERY}&branchId=${norte.id}`).expect(
      200
    );
    // Header plus one data row.
    expect(csv.text.trim().split(/\r?\n/)).toHaveLength(2);

    const low = await get(`/reports/low-stock/export?branchId=${norte.id}`).expect(200);
    expect(low.text).toContain("Pipeta");

    await get(`/reports/consultations/export?${PERIOD_QUERY}&branchId=${norte.id}`).expect(400);
  });
});
