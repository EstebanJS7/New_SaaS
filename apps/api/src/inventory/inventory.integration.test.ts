import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { expectCrossTenant404 } from "../../test/support/expect-cross-tenant-404.js";
import {
  SEEDED_TAX_RATE_IDS,
  type AuditLogRow,
  type CatalogItemRow,
  type IsolationDatabase,
  type StockBalanceRow,
  type StockMovementRow,
  type TenantRow,
} from "../../test/support/in-memory-database.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
} from "../../test/support/rbac-fixture.js";
import { INVENTORY_PERMISSIONS } from "./inventory.permissions.js";
import { stockSerializationLockKey } from "./inventory.repository.js";
import { INVENTORY_DTO_SCHEMA_VERSION } from "./inventory.zod.js";

interface StockItemProjectionDto {
  name: string;
  kind: "PRODUCT" | "SERVICE" | "MEDICATION" | "SUPPLY";
}

interface StockBalanceDto {
  id: string;
  tenantId: string;
  catalogItemId: string;
  item: StockItemProjectionDto;
  quantity: string;
  createdAt: string;
  updatedAt: string;
}

interface StockMovementDto {
  id: string;
  tenantId: string;
  catalogItemId: string;
  type: "ADJUSTMENT";
  quantity: string;
  reason: string;
  reversesMovementId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ErrorDto {
  error: { code: string; message: string };
}

/** Exact allowlisted key sets — any extra key fails these assertions. */
const STOCK_BALANCE_RESPONSE_KEYS: readonly string[] = [
  "id",
  "tenantId",
  "catalogItemId",
  "item",
  "quantity",
  "createdAt",
  "updatedAt",
];

const STOCK_MOVEMENT_RESPONSE_KEYS: readonly string[] = [
  "id",
  "tenantId",
  "catalogItemId",
  "type",
  "quantity",
  "reason",
  "reversesMovementId",
  "createdAt",
  "updatedAt",
];

/** The item projection deliberately repeats no identifier. */
const STOCK_ITEM_PROJECTION_KEYS: readonly string[] = ["name", "kind"];

/** The full inventory matrix an owning role holds; a read-only actor holds one key. */
const ALL_INVENTORY_PERMISSIONS: readonly string[] = [
  INVENTORY_PERMISSIONS.read,
  INVENTORY_PERMISSIONS.adjust,
];

interface InventoryTenant {
  tenant: TenantRow;
  actor: RbacActor;
}

interface InventoryHttpFixture {
  /** Probing tenant holding the FULL `inventory.stock.*` matrix. */
  a: InventoryTenant;
  /** Foreign tenant holding the full matrix; owns the rows A must not touch. */
  b: InventoryTenant;
  /** Member of A whose role has NO inventory permission (403 probe). */
  noPermission: RbacActor;
  /** Member of A with `inventory.stock.read` only: the adjustment is a 403. */
  readOnly: RbacActor;
  /** Fresh catalog item in the given tenant; call per test for order independence. */
  createItem(
    owner: InventoryTenant,
    overrides?: Partial<Pick<CatalogItemRow, "kind" | "isActive" | "tracksStock">> & {
      name?: string;
    }
  ): CatalogItemRow;
}

/**
 * Seeds two isolated tenants holding the full inventory matrix, a
 * permission-negative actor and a read-only actor in tenant A, plus item
 * factories. ITEMS are the only seeded stock input: no movement or balance is
 * pre-seeded, so every ledger row in these tests comes from the command under
 * test.
 */
function seedInventoryHttp(db: IsolationDatabase): InventoryHttpFixture {
  const suffix = randomUUID().slice(0, 8);

  function seedTenant(letter: string, keys: readonly string[]): InventoryTenant {
    const label = letter.toUpperCase();
    const tenant = db.prisma.tenant.create({
      data: { slug: `inventory-${letter}-${suffix}`, name: `Inventory ${label}` },
    });
    const role = seedRoleWithKeys(
      db,
      `INVENTORY_${label}_${suffix}`,
      `Inventory ${label} (fixture)`,
      [...keys]
    );
    const actor = seedRbacActor(db, {
      email: `inventory-${letter}-${suffix}@isolation.test`,
      tenantId: tenant.id,
      roleId: role.role.id,
    });
    return { tenant, actor };
  }

  const a = seedTenant("a", ALL_INVENTORY_PERMISSIONS);
  const b = seedTenant("b", ALL_INVENTORY_PERMISSIONS);

  const noPermissionRole = seedRoleWithKeys(
    db,
    `INVENTORY_NONE_${suffix}`,
    "Inventory none (fixture)",
    []
  );
  const noPermission = seedRbacActor(db, {
    email: `inventory-none-${suffix}@isolation.test`,
    tenantId: a.tenant.id,
    roleId: noPermissionRole.role.id,
  });

  const readOnlyRole = seedRoleWithKeys(
    db,
    `INVENTORY_READ_${suffix}`,
    "Inventory read only (fixture)",
    [INVENTORY_PERMISSIONS.read]
  );
  const readOnly = seedRbacActor(db, {
    email: `inventory-read-${suffix}@isolation.test`,
    tenantId: a.tenant.id,
    roleId: readOnlyRole.role.id,
  });

  return {
    a,
    b,
    noPermission,
    readOnly,
    createItem: (owner, overrides = {}) =>
      db.prisma.catalogItem.create({
        data: {
          tenantId: owner.tenant.id,
          kind: overrides.kind ?? "PRODUCT",
          name: overrides.name ?? `Item ${randomUUID().slice(0, 8)}`,
          taxRateId: SEEDED_TAX_RATE_IDS.IVA_10,
          referencePriceAmount: null,
          referencePriceCurrency: null,
          isActive: overrides.isActive ?? true,
          tracksStock: overrides.tracksStock ?? true,
        },
      }),
  };
}

/** A valid adjustment body; overrides let a test break exactly one rule. */
function adjustmentBody(
  catalogItemId: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    catalogItemId,
    quantity: "10.000",
    reason: "Opening count",
    ...overrides,
  };
}

/** Every ledger row of one tenant — the per-command persistence probe. */
function movementsOf(booted: BootedTestApp, tenantId: string): StockMovementRow[] {
  return [...booted.db.tables.stockMovements.values()].filter((row) => row.tenantId === tenantId);
}

/** Every projection row of one tenant. */
function balancesOf(booted: BootedTestApp, tenantId: string): StockBalanceRow[] {
  return [...booted.db.tables.stockBalances.values()].filter((row) => row.tenantId === tenantId);
}

/** Every audit row targeting one movement — the per-command row count. */
function auditsForTarget(booted: BootedTestApp, targetId: string): AuditLogRow[] {
  return [...booted.db.tables.audits.values()].filter((row) => row.targetId === targetId);
}

/** The `changedFields` audit metadata, read defensively from the JSON payload. */
function changedFieldsOf(row: AuditLogRow): unknown[] | undefined {
  const value = row.metadata.changedFields;
  return Array.isArray(value) ? value : undefined;
}

/** The single stored balance of one item, or undefined when it has none. */
function storedBalance(booted: BootedTestApp, catalogItemId: string): StockBalanceRow | undefined {
  return [...booted.db.tables.stockBalances.values()].find(
    (row) => row.catalogItemId === catalogItemId
  );
}

/**
 * EPIC-10 W2 inventory stock surface: the signed adjustment command and the
 * balance/movement reads over the REAL guard chain (Auth → Tenancy → RBAC) and
 * the shared in-memory boundary, which snapshots and restores its tables on a
 * thrown transaction — so "persists nothing" is proven, not assumed. Every
 * factory runs INSIDE its `it`, so no test depends on an id minted by an
 * earlier test.
 */
describe("Inventory stock HTTP boundary (EPIC-10 W2)", () => {
  let booted: BootedTestApp;
  let fixture: InventoryHttpFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedInventoryHttp(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  it("requires the matching inventory permission on every route and persists nothing when denied", async () => {
    const item = fixture.createItem(fixture.a);
    const movementsBefore = booted.db.tables.stockMovements.size;
    const balancesBefore = booted.db.tables.stockBalances.size;
    const auditsBefore = booted.db.tables.audits.size;

    // No inventory key at all: every route is denied.
    for (const path of ["/inventory/stock", "/inventory/stock/movements"]) {
      const response = await supertest(booted.app.getHttpServer())
        .get(path)
        .set("Cookie", fixture.noPermission.cookie)
        .expect(403);
      expect((response.body as ErrorDto).error.code, path).toBe("FORBIDDEN");
    }
    const deniedAdjust = await supertest(booted.app.getHttpServer())
      .post("/inventory/stock/adjustments")
      .set("Cookie", fixture.noPermission.cookie)
      .send(adjustmentBody(item.id))
      .expect(403);
    expect((deniedAdjust.body as ErrorDto).error.code).toBe("FORBIDDEN");

    // `inventory.stock.read` alone reads but can never adjust.
    for (const path of ["/inventory/stock", "/inventory/stock/movements"]) {
      await supertest(booted.app.getHttpServer())
        .get(path)
        .set("Cookie", fixture.readOnly.cookie)
        .expect(200);
    }
    const readOnlyAdjust = await supertest(booted.app.getHttpServer())
      .post("/inventory/stock/adjustments")
      .set("Cookie", fixture.readOnly.cookie)
      .send(adjustmentBody(item.id))
      .expect(403);
    expect((readOnlyAdjust.body as ErrorDto).error.code).toBe("FORBIDDEN");

    // A denied command reaches no data access AND no audit append.
    expect(booted.db.tables.stockMovements.size).toBe(movementsBefore);
    expect(booted.db.tables.stockBalances.size).toBe(balancesBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
  });

  it("applies a signed adjustment, upserts the balance and co-commits exactly one audit row", async () => {
    const item = fixture.createItem(fixture.a, { name: "Gasa estéril" });

    // A POSITIVE quantity is an input.
    const input = await supertest(booted.app.getHttpServer())
      .post("/inventory/stock/adjustments")
      .set("Cookie", fixture.a.actor.cookie)
      .send(adjustmentBody(item.id, { quantity: "10.000", reason: "Opening count" }))
      .expect(201);

    const inputBody = input.body as StockMovementDto;
    expect(Object.keys(inputBody).sort()).toEqual([...STOCK_MOVEMENT_RESPONSE_KEYS].sort());
    expect(inputBody.tenantId).toBe(fixture.a.tenant.id);
    expect(inputBody.catalogItemId).toBe(item.id);
    expect(inputBody.type).toBe("ADJUSTMENT");
    expect(inputBody.quantity).toBe("10.000");
    expect(inputBody.reason).toBe("Opening count");
    // The reserved compensating link is never populated in this slice.
    expect(inputBody.reversesMovementId).toBeNull();

    // The stored DECIMAL keeps the EXACT value; Prisma's Decimal trims trailing
    // zeros on read, so the raw row reads "10" while the DTO above pads it back
    // to the column scale ("10.000") — the canonical API spelling.
    expect(storedBalance(booted, item.id)?.quantity).toBe("10");

    const rows = auditsForTarget(booted, inputBody.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("stock_movement.created");
    expect(rows[0].targetType).toBe("stock_movement");
    expect(rows[0].tenantId).toBe(fixture.a.tenant.id);
    expect(rows[0].metadata.schemaVersion).toBe(INVENTORY_DTO_SCHEMA_VERSION);
    expect(changedFieldsOf(rows[0])).toEqual(["quantity", "reason"]);
    // Field NAMES only: neither the reason text nor the quantity value reaches
    // the trail.
    const serializedMeta = JSON.stringify(rows[0].metadata);
    expect(serializedMeta).not.toContain("Opening count");
    expect(serializedMeta).not.toContain("10.000");

    // A NEGATIVE quantity is an output and reuses the same projection row.
    const output = await supertest(booted.app.getHttpServer())
      .post("/inventory/stock/adjustments")
      .set("Cookie", fixture.a.actor.cookie)
      .send(adjustmentBody(item.id, { quantity: "-4.000", reason: "Consumo interno" }))
      .expect(201);
    expect((output.body as StockMovementDto).quantity).toBe("-4.000");
    expect(storedBalance(booted, item.id)?.quantity).toBe("6");

    // One row per (tenant, item): two movements, one projection, two audit rows.
    expect(
      movementsOf(booted, fixture.a.tenant.id).filter((row) => row.catalogItemId === item.id)
    ).toHaveLength(2);
    expect(
      balancesOf(booted, fixture.a.tenant.id).filter((row) => row.catalogItemId === item.id)
    ).toHaveLength(1);
    expect(auditsForTarget(booted, inputBody.id)).toHaveLength(1);
  });

  it("enforces the fixed BLOCK policy and persists nothing when the output would go negative", async () => {
    const emptyItem = fixture.createItem(fixture.a, { name: "Sin stock" });
    const movementsBefore = booted.db.tables.stockMovements.size;
    const balancesBefore = booted.db.tables.stockBalances.size;
    const auditsBefore = booted.db.tables.audits.size;

    // No balance at all: even one unit out is rejected.
    const fromZero = await supertest(booted.app.getHttpServer())
      .post("/inventory/stock/adjustments")
      .set("Cookie", fixture.a.actor.cookie)
      .send(adjustmentBody(emptyItem.id, { quantity: "-1.000" }))
      .expect(409);
    expect((fromZero.body as ErrorDto).error.code).toBe("CONFLICT");
    expect(storedBalance(booted, emptyItem.id)).toBeUndefined();
    expect(booted.db.tables.stockMovements.size).toBe(movementsBefore);
    expect(booted.db.tables.stockBalances.size).toBe(balancesBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);

    const item = fixture.createItem(fixture.a, { name: "Propofol 1%" });
    await supertest(booted.app.getHttpServer())
      .post("/inventory/stock/adjustments")
      .set("Cookie", fixture.a.actor.cookie)
      .send(adjustmentBody(item.id, { quantity: "5.000" }))
      .expect(201);
    const auditsAfterInput = booted.db.tables.audits.size;

    // One thousandth past the balance is still negative: rejected, untouched.
    const rejected = await supertest(booted.app.getHttpServer())
      .post("/inventory/stock/adjustments")
      .set("Cookie", fixture.a.actor.cookie)
      .send(adjustmentBody(item.id, { quantity: "-5.001" }))
      .expect(409);
    expect((rejected.body as ErrorDto).error.code).toBe("CONFLICT");
    expect(storedBalance(booted, item.id)?.quantity).toBe("5");
    expect(booted.db.tables.stockMovements.size).toBe(movementsBefore + 1);
    expect(booted.db.tables.audits.size).toBe(auditsAfterInput);

    // Exactly zero is NOT negative: an output down to zero is accepted.
    await supertest(booted.app.getHttpServer())
      .post("/inventory/stock/adjustments")
      .set("Cookie", fixture.a.actor.cookie)
      .send(adjustmentBody(item.id, { quantity: "-5.000", reason: "Ajuste a cero" }))
      .expect(201);
    expect(storedBalance(booted, item.id)?.quantity).toBe("0");
  });

  it("rejects a non-tracking item and an inactive item with a stable CONFLICT and persists nothing", async () => {
    const service = fixture.createItem(fixture.a, {
      kind: "SERVICE",
      tracksStock: false,
      name: "Consulta",
    });
    const inactive = fixture.createItem(fixture.a, { isActive: false, name: "Item inactivo" });
    const movementsBefore = booted.db.tables.stockMovements.size;
    const balancesBefore = booted.db.tables.stockBalances.size;
    const auditsBefore = booted.db.tables.audits.size;

    const notTracked = await supertest(booted.app.getHttpServer())
      .post("/inventory/stock/adjustments")
      .set("Cookie", fixture.a.actor.cookie)
      .send(adjustmentBody(service.id))
      .expect(409);
    expect((notTracked.body as ErrorDto).error.code).toBe("CONFLICT");
    expect((notTracked.body as ErrorDto).error.message).toBe(
      "The catalog item does not track stock."
    );

    const inactiveResponse = await supertest(booted.app.getHttpServer())
      .post("/inventory/stock/adjustments")
      .set("Cookie", fixture.a.actor.cookie)
      .send(adjustmentBody(inactive.id))
      .expect(409);
    expect((inactiveResponse.body as ErrorDto).error.code).toBe("CONFLICT");
    expect((inactiveResponse.body as ErrorDto).error.message).toBe("The catalog item is inactive.");

    expect(booted.db.tables.stockMovements.size).toBe(movementsBefore);
    expect(booted.db.tables.stockBalances.size).toBe(balancesBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
  });

  it("masks a foreign item id as the same 404 as an unknown one on the adjustment command", async () => {
    const foreign = fixture.createItem(fixture.b, { name: "Foreign stocked item" });
    const movementsBefore = booted.db.tables.stockMovements.size;
    const balancesBefore = booted.db.tables.stockBalances.size;
    const auditsBefore = booted.db.tables.audits.size;

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      method: "POST",
      nonexistentUrl: "/inventory/stock/adjustments",
      foreignUrl: "/inventory/stock/adjustments",
      body: adjustmentBody(randomUUID()),
      foreignBody: adjustmentBody(foreign.id),
      forbiddenIdentifiers: [foreign.id, fixture.b.tenant.id],
    });

    expect(booted.db.tables.stockMovements.size).toBe(movementsBefore);
    expect(booted.db.tables.stockBalances.size).toBe(balancesBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
    expect(storedBalance(booted, foreign.id)).toBeUndefined();
  });

  it("masks a foreign item id as the same 404 as an unknown one on the item-filtered movement read", async () => {
    const foreign = fixture.createItem(fixture.b, { name: "Foreign ledger item" });

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      nonexistentUrl: `/inventory/stock/movements?catalogItemId=${randomUUID()}`,
      foreignUrl: `/inventory/stock/movements?catalogItemId=${foreign.id}`,
      forbiddenIdentifiers: [foreign.id, fixture.b.tenant.id],
    });
  });

  it("lists only the caller tenant's balances with the item identity and the exact allowlisted key set", async () => {
    const own = fixture.createItem(fixture.a, { name: "Amoxicilina", kind: "MEDICATION" });
    const other = fixture.createItem(fixture.a, { name: "Gasa", kind: "SUPPLY" });
    const foreign = fixture.createItem(fixture.b, { name: "Foreign balance" });

    await supertest(booted.app.getHttpServer())
      .post("/inventory/stock/adjustments")
      .set("Cookie", fixture.a.actor.cookie)
      .send(adjustmentBody(own.id, { quantity: "12.500", reason: "Conteo" }))
      .expect(201);
    await supertest(booted.app.getHttpServer())
      .post("/inventory/stock/adjustments")
      .set("Cookie", fixture.a.actor.cookie)
      .send(adjustmentBody(other.id, { quantity: "3.000", reason: "Conteo" }))
      .expect(201);
    await supertest(booted.app.getHttpServer())
      .post("/inventory/stock/adjustments")
      .set("Cookie", fixture.b.actor.cookie)
      .send(adjustmentBody(foreign.id, { quantity: "99.000", reason: "Conteo" }))
      .expect(201);

    const response = await supertest(booted.app.getHttpServer())
      .get("/inventory/stock")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const body = response.body as StockBalanceDto[];
    const ids = body.map((row) => row.catalogItemId);
    expect(ids).toContain(own.id);
    expect(ids).toContain(other.id);
    expect(ids).not.toContain(foreign.id);

    const ownBalance = body.find((row) => row.catalogItemId === own.id);
    expect(ownBalance).toBeDefined();
    expect(Object.keys(ownBalance ?? {}).sort()).toEqual([...STOCK_BALANCE_RESPONSE_KEYS].sort());
    expect(Object.keys(ownBalance?.item ?? {}).sort()).toEqual(
      [...STOCK_ITEM_PROJECTION_KEYS].sort()
    );
    // The item identity rides along; no identifier is repeated inside it.
    expect(ownBalance?.item).toEqual({ name: "Amoxicilina", kind: "MEDICATION" });
    // Exact fixed-scale string, never a float and never the trimmed form.
    expect(ownBalance?.quantity).toBe("12.500");
    expect(ownBalance?.tenantId).toBe(fixture.a.tenant.id);

    expect(response.text).not.toContain(foreign.id);
    expect(response.text).not.toContain(fixture.b.tenant.id);
  });

  it("lists the tenant's movement ledger, narrows it by item and keeps the allowlisted key set", async () => {
    const first = fixture.createItem(fixture.a, { name: "Ledger item one" });
    const second = fixture.createItem(fixture.a, { name: "Ledger item two" });
    const foreign = fixture.createItem(fixture.b, { name: "Foreign ledger" });

    for (const [catalogItemId, quantity] of [
      [first.id, "7.000"],
      [first.id, "-2.000"],
      [second.id, "1.500"],
    ] as const) {
      await supertest(booted.app.getHttpServer())
        .post("/inventory/stock/adjustments")
        .set("Cookie", fixture.a.actor.cookie)
        .send(adjustmentBody(catalogItemId, { quantity, reason: "Ledger seed" }))
        .expect(201);
    }
    await supertest(booted.app.getHttpServer())
      .post("/inventory/stock/adjustments")
      .set("Cookie", fixture.b.actor.cookie)
      .send(adjustmentBody(foreign.id, { quantity: "50.000", reason: "Foreign seed" }))
      .expect(201);

    const all = await supertest(booted.app.getHttpServer())
      .get("/inventory/stock/movements")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const allBody = all.body as StockMovementDto[];
    expect(allBody.length).toBe(movementsOf(booted, fixture.a.tenant.id).length);
    expect(allBody.every((row) => row.tenantId === fixture.a.tenant.id)).toBe(true);
    expect(allBody.map((row) => row.id)).not.toContain(
      [...booted.db.tables.stockMovements.values()].find((row) => row.catalogItemId === foreign.id)
        ?.id
    );

    const firstMovement = allBody.find((row) => row.catalogItemId === first.id);
    expect(firstMovement).toBeDefined();
    expect(Object.keys(firstMovement ?? {}).sort()).toEqual(
      [...STOCK_MOVEMENT_RESPONSE_KEYS].sort()
    );
    expect(firstMovement?.type).toBe("ADJUSTMENT");
    // The ledger keeps the SIGN of every entry.
    const firstQuantities = allBody
      .filter((row) => row.catalogItemId === first.id)
      .map((row) => row.quantity);
    expect(firstQuantities).toEqual(expect.arrayContaining(["7.000", "-2.000"]));

    const filtered = await supertest(booted.app.getHttpServer())
      .get(`/inventory/stock/movements?catalogItemId=${first.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const filteredBody = filtered.body as StockMovementDto[];
    expect(filteredBody).toHaveLength(2);
    expect(filteredBody.every((row) => row.catalogItemId === first.id)).toBe(true);

    // Unknown query keys and malformed ids are rejected, not ignored.
    for (const query of ["?limit=10", "?catalogItemId=not-a-uuid", `?itemId=${first.id}`]) {
      const rejected = await supertest(booted.app.getHttpServer())
        .get(`/inventory/stock/movements${query}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(400);
      expect((rejected.body as ErrorDto).error.code, query).toBe("VALIDATION_FAILED");
    }

    expect(all.text).not.toContain(foreign.id);
    expect(all.text).not.toContain(fixture.b.tenant.id);
  });

  it("rejects every invalid adjustment body and persists nothing", async () => {
    const item = fixture.createItem(fixture.a, { name: "Estado estable" });
    const movementsBefore = booted.db.tables.stockMovements.size;
    const balancesBefore = booted.db.tables.stockBalances.size;
    const auditsBefore = booted.db.tables.audits.size;

    const rejected: [string, Record<string, unknown>][] = [
      ["missing catalog item", { quantity: "1.000", reason: "Sin item" }],
      ["null catalog item", adjustmentBody(item.id, { catalogItemId: null })],
      ["malformed catalog item", adjustmentBody(item.id, { catalogItemId: "not-a-uuid" })],
      ["missing quantity", { catalogItemId: item.id, reason: "Sin cantidad" }],
      ["numeric quantity", adjustmentBody(item.id, { quantity: 10 })],
      ["zero quantity", adjustmentBody(item.id, { quantity: "0" })],
      ["zero-scale quantity", adjustmentBody(item.id, { quantity: "0.000" })],
      ["negative zero quantity", adjustmentBody(item.id, { quantity: "-0.00" })],
      ["over-scaled quantity", adjustmentBody(item.id, { quantity: "1.2345" })],
      ["over-wide quantity", adjustmentBody(item.id, { quantity: "12345678" })],
      ["malformed quantity", adjustmentBody(item.id, { quantity: "abc" })],
      ["missing reason", { catalogItemId: item.id, quantity: "1.000" }],
      ["blank reason", adjustmentBody(item.id, { reason: "" })],
      ["whitespace reason", adjustmentBody(item.id, { reason: "   " })],
      ["over-long reason", adjustmentBody(item.id, { reason: "x".repeat(501) })],
      ["client movement type", adjustmentBody(item.id, { type: "ADJUSTMENT" })],
      ["client reversal link", adjustmentBody(item.id, { reversesMovementId: randomUUID() })],
      ["client tenant", adjustmentBody(item.id, { tenantId: randomUUID() })],
    ];

    for (const [label, body] of rejected) {
      const response = await supertest(booted.app.getHttpServer())
        .post("/inventory/stock/adjustments")
        .set("Cookie", fixture.a.actor.cookie)
        .send(body)
        .expect(400);
      expect((response.body as ErrorDto).error.code, label).toBe("VALIDATION_FAILED");
    }

    expect(booted.db.tables.stockMovements.size).toBe(movementsBefore);
    expect(booted.db.tables.stockBalances.size).toBe(balancesBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
  });

  it("exposes no update, patch or delete route on the immutable ledger", async () => {
    const item = fixture.createItem(fixture.a, { name: "Inmutable" });
    const created = await supertest(booted.app.getHttpServer())
      .post("/inventory/stock/adjustments")
      .set("Cookie", fixture.a.actor.cookie)
      .send(adjustmentBody(item.id, { quantity: "2.000" }))
      .expect(201);
    const movementId = (created.body as StockMovementDto).id;
    const movementsBefore = booted.db.tables.stockMovements.size;

    for (const [method, path] of [
      ["put", "/inventory/stock"],
      ["delete", "/inventory/stock"],
      ["put", `/inventory/stock/adjustments/${movementId}`],
      ["patch", `/inventory/stock/movements/${movementId}`],
      ["delete", `/inventory/stock/movements/${movementId}`],
    ] as const) {
      await supertest(booted.app.getHttpServer())
        [method](path)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(404);
    }

    expect(booted.db.tables.stockMovements.size).toBe(movementsBefore);
    expect(booted.db.tables.stockMovements.get(movementId)?.quantity).toBe("2");
  });

  it("serializes the adjustment on the per-item advisory lock BEFORE reading the projection", async () => {
    const item = fixture.createItem(fixture.a, { name: "Locked adjustment" });
    const boundary = booted.db.prisma;
    const originalQueryRaw = boundary.$queryRaw;
    const originalFindFirst = boundary.stockBalance.findFirst;
    const calls: string[] = [];
    const lockKeys: unknown[] = [];

    // Records the SEAM the decision is serialized on. The in-memory boundary
    // models `pg_advisory_xact_lock` as a no-op (a synchronous map cannot
    // interleave), so this test pins the lock's existence, its exact key and its
    // ORDER relative to the projection read; the real interleaving proof is the
    // live-PostgreSQL evidence gate.
    boundary.$queryRaw = (query, ...values) => {
      calls.push(typeof query === "string" ? query : query.join(""));
      lockKeys.push(values[0]);
      return originalQueryRaw(query, ...values);
    };
    boundary.stockBalance.findFirst = (args) => {
      calls.push("stockBalance.findFirst");
      return originalFindFirst(args);
    };

    let lockIndex = -1;
    let balanceReadIndex = -1;
    try {
      await supertest(booted.app.getHttpServer())
        .post("/inventory/stock/adjustments")
        .set("Cookie", fixture.a.actor.cookie)
        .send(adjustmentBody(item.id, { quantity: "3.000" }))
        .expect(201);
      lockIndex = calls.findIndex((text) => text.includes("pg_advisory_xact_lock"));
      balanceReadIndex = calls.indexOf("stockBalance.findFirst");
    } finally {
      boundary.$queryRaw = originalQueryRaw;
      boundary.stockBalance.findFirst = originalFindFirst;
    }

    // Exactly one lock acquisition, keyed to THIS (tenant, item)...
    expect(lockKeys).toHaveLength(1);
    expect(lockKeys[0]).toBe(stockSerializationLockKey(fixture.a.tenant.id, item.id));
    // ...taken BEFORE the balance is read, so the `BLOCK` pre-check and the
    // balance write are one serialized read-modify-write.
    expect(lockIndex).toBeGreaterThan(-1);
    expect(balanceReadIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeLessThan(balanceReadIndex);
  });
});
