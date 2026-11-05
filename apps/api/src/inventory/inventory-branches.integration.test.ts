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
import { CHOOSE_BRANCH_MESSAGE, NOT_WORKING_AT_BRANCH_MESSAGE } from "../branches/branch-scope.js";
import type { StockBalanceResponse, StockTransferResponse } from "./inventory.dto.js";
import { INVENTORY_PERMISSIONS } from "./inventory.permissions.js";
import {
  STOCK_TRANSFER_CREATED_ACTION,
  TRANSFER_DESTINATION_INVALID_MESSAGE,
  TRANSFER_INSUFFICIENT_STOCK_MESSAGE,
} from "./inventory.service.js";

interface ErrorDto {
  error: { code: string; message: string };
}

/**
 * MB-003 (DEC-094 §10) over the real guard chain and the in-memory boundary:
 * stock is kept per branch, an adjustment happens in a branch the caller works
 * at, and a transfer moves stock between two branches as an OUT/IN pair.
 */
describe("Stock per branch (MB-003)", () => {
  let booted: BootedTestApp;
  let actor: RbacActor;
  let noTransfer: RbacActor;
  let tenantId: string;
  let central: BranchRow;
  let norte: BranchRow;
  let lejana: BranchRow;
  let closed: BranchRow;

  beforeAll(async () => {
    booted = await bootTestApp();
    const db = booted.db;
    const suffix = randomUUID().slice(0, 8);
    const tenant = db.prisma.tenant.create({
      data: { slug: `stock-branches-${suffix}`, name: "Stock branches" },
    });
    tenantId = tenant.id;
    const central0 = [...db.tables.branches.values()].find((row) => row.tenantId === tenantId);
    if (!central0) throw new Error("fixture: the tenant has no first branch");
    central = central0;

    const role = seedRoleWithKeys(db, `STOCK_ALL_${suffix}`, "Stock (fixture)", [
      INVENTORY_PERMISSIONS.read,
      INVENTORY_PERMISSIONS.adjust,
      INVENTORY_PERMISSIONS.transfer,
    ]);
    actor = seedRbacActor(db, {
      email: `stock-${suffix}@isolation.test`,
      tenantId,
      roleId: role.role.id,
    });
    const limited = seedRoleWithKeys(db, `STOCK_NO_TRANSFER_${suffix}`, "No transfer", [
      INVENTORY_PERMISSIONS.read,
      INVENTORY_PERMISSIONS.adjust,
    ]);
    noTransfer = seedRbacActor(db, {
      email: `stock-limited-${suffix}@isolation.test`,
      tenantId,
      roleId: limited.role.id,
    });

    // Branches created AFTER the members: only explicit assignments apply.
    norte = db.prisma.branch.create({ data: { tenantId, name: "Norte" } });
    lejana = db.prisma.branch.create({ data: { tenantId, name: "Lejana" } });
    closed = db.prisma.branch.create({ data: { tenantId, name: "Cerrada", isActive: false } });
    if (!actor.membership) throw new Error("fixture: no membership");
    db.prisma.membershipBranch.create({
      data: { tenantId, membershipId: actor.membership.id, branchId: norte.id },
    });
  });

  afterAll(async () => {
    await booted.close();
  });

  function item(): string {
    return booted.db.prisma.catalogItem.create({
      data: {
        tenantId,
        kind: "PRODUCT",
        name: `Item ${randomUUID().slice(0, 8)}`,
        taxRateId: SEEDED_TAX_RATE_IDS.IVA_10,
        referencePriceAmount: null,
        referencePriceCurrency: null,
        isActive: true,
        tracksStock: true,
      },
    }).id;
  }

  function balanceOf(catalogItemId: string, branchId: string): string | undefined {
    return [...booted.db.tables.stockBalances.values()].find(
      (row) => row.catalogItemId === catalogItemId && row.branchId === branchId
    )?.quantity;
  }

  /** The fake stores balances unscaled ("5"); compare at the API's scale. */
  function balanceAt(catalogItemId: string, branchId: string): string | undefined {
    const raw = balanceOf(catalogItemId, branchId);
    return raw === undefined ? undefined : Number(raw).toFixed(3);
  }

  const post = (path: string, body: Record<string, unknown>, who: RbacActor = actor) =>
    supertest(booted.app.getHttpServer()).post(path).set("Cookie", who.cookie).send(body);

  it("asks which branch to adjust when the caller works at several, and adjusts only that one", async () => {
    const itemId = item();
    const ambiguous = await post("/inventory/stock/adjustments", {
      catalogItemId: itemId,
      quantity: "5.000",
      reason: "Conteo",
    }).expect(400);
    expect((ambiguous.body as ErrorDto).error.message).toBe(CHOOSE_BRANCH_MESSAGE);

    await post("/inventory/stock/adjustments", {
      catalogItemId: itemId,
      quantity: "5.000",
      reason: "Conteo",
      branchId: norte.id,
    }).expect(201);
    expect(balanceAt(itemId, norte.id)).toBe("5.000");
    expect(balanceAt(itemId, central.id)).toBeUndefined();

    const elsewhere = await post("/inventory/stock/adjustments", {
      catalogItemId: itemId,
      quantity: "5.000",
      reason: "Conteo",
      branchId: lejana.id,
    }).expect(400);
    expect((elsewhere.body as ErrorDto).error.message).toBe(NOT_WORKING_AT_BRANCH_MESSAGE);
  });

  it("transfers stock as an OUT/IN pair that moves the balances and audits once", async () => {
    const itemId = item();
    await post("/inventory/stock/adjustments", {
      catalogItemId: itemId,
      quantity: "10.000",
      reason: "Ingreso",
      branchId: central.id,
    }).expect(201);

    const response = await post("/inventory/stock/transfers", {
      catalogItemId: itemId,
      fromBranchId: central.id,
      toBranchId: lejana.id,
      quantity: "4.000",
      reason: "Reposición",
    }).expect(201);

    const body = response.body as StockTransferResponse;
    expect(body.out).toMatchObject({
      type: "TRANSFER_OUT",
      quantity: "-4.000",
      branchId: central.id,
      transferId: body.transferId,
    });
    expect(body.in).toMatchObject({
      type: "TRANSFER_IN",
      quantity: "4.000",
      branchId: lejana.id,
      transferId: body.transferId,
    });
    expect(balanceAt(itemId, central.id)).toBe("6.000");
    expect(balanceAt(itemId, lejana.id)).toBe("4.000");

    const audits = [...booted.db.tables.audits.values()].filter(
      (row) => row.targetId === body.transferId
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe(STOCK_TRANSFER_CREATED_ACTION);
    expect(JSON.stringify(audits[0])).not.toContain("Reposición");
  });

  it("refuses a transfer that would leave the origin below zero, and writes nothing", async () => {
    const itemId = item();
    const movementsBefore = booted.db.tables.stockMovements.size;
    const response = await post("/inventory/stock/transfers", {
      catalogItemId: itemId,
      fromBranchId: norte.id,
      toBranchId: central.id,
      quantity: "1.000",
      reason: "Sin stock",
    }).expect(409);
    expect((response.body as ErrorDto).error.message).toBe(TRANSFER_INSUFFICIENT_STOCK_MESSAGE);
    expect(booted.db.tables.stockMovements.size).toBe(movementsBefore);
  });

  it("refuses an origin the caller does not work at and an inactive destination", async () => {
    const itemId = item();
    const origin = await post("/inventory/stock/transfers", {
      catalogItemId: itemId,
      fromBranchId: lejana.id,
      toBranchId: central.id,
      quantity: "1.000",
      reason: "x",
    }).expect(400);
    expect((origin.body as ErrorDto).error.message).toBe(NOT_WORKING_AT_BRANCH_MESSAGE);

    const destination = await post("/inventory/stock/transfers", {
      catalogItemId: itemId,
      fromBranchId: central.id,
      toBranchId: closed.id,
      quantity: "1.000",
      reason: "x",
    }).expect(400);
    expect((destination.body as ErrorDto).error.message).toBe(TRANSFER_DESTINATION_INVALID_MESSAGE);
  });

  it("validates the body: same branch, negative quantity, unknown key", async () => {
    const itemId = item();
    for (const body of [
      { fromBranchId: central.id, toBranchId: central.id, quantity: "1.000" },
      { fromBranchId: central.id, toBranchId: norte.id, quantity: "-1.000" },
      { fromBranchId: central.id, toBranchId: norte.id, quantity: "1.000", tenantId },
    ]) {
      const response = await post("/inventory/stock/transfers", {
        catalogItemId: itemId,
        reason: "x",
        ...body,
      }).expect(400);
      expect((response.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("requires inventory.stock.transfer", async () => {
    const response = await post(
      "/inventory/stock/transfers",
      {
        catalogItemId: item(),
        fromBranchId: central.id,
        toBranchId: norte.id,
        quantity: "1.000",
        reason: "x",
      },
      noTransfer
    ).expect(403);
    expect((response.body as ErrorDto).error.code).toBe("FORBIDDEN");
  });

  it("lists balances per branch and narrows to one", async () => {
    const itemId = item();
    await post("/inventory/stock/adjustments", {
      catalogItemId: itemId,
      quantity: "3.000",
      reason: "x",
      branchId: norte.id,
    }).expect(201);
    await post("/inventory/stock/adjustments", {
      catalogItemId: itemId,
      quantity: "2.000",
      reason: "x",
      branchId: central.id,
    }).expect(201);

    const all = await supertest(booted.app.getHttpServer())
      .get("/inventory/stock")
      .set("Cookie", actor.cookie)
      .expect(200);
    const rows = (all.body as StockBalanceResponse[]).filter((row) => row.catalogItemId === itemId);
    expect(rows.map((row) => [row.branchName, row.quantity]).sort()).toEqual([
      ["Casa central", "2.000"],
      ["Norte", "3.000"],
    ]);

    const narrowed = await supertest(booted.app.getHttpServer())
      .get(`/inventory/stock?branchId=${norte.id}`)
      .set("Cookie", actor.cookie)
      .expect(200);
    expect(
      (narrowed.body as StockBalanceResponse[]).every((row) => row.branchId === norte.id)
    ).toBe(true);
  });

  it("lists the clinic's active branches by name for the stock screen", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get("/inventory/stock/branches")
      .set("Cookie", noTransfer.cookie)
      .expect(200);
    expect(response.body).toEqual([
      { id: central.id, name: "Casa central" },
      { id: lejana.id, name: "Lejana" },
      { id: norte.id, name: "Norte" },
    ]);
  });
});
