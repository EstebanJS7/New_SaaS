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
  type PurchaseRow,
  type PurchaseStatusRow,
  type SupplierRow,
  type TenantRow,
} from "../../test/support/in-memory-database.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
} from "../../test/support/rbac-fixture.js";
import { PURCHASES_PERMISSIONS } from "./purchases.permissions.js";
import {
  PURCHASE_CATALOG_ITEM_NOT_FOUND_MESSAGE,
  PURCHASE_NOT_FOUND_MESSAGE,
  PURCHASE_SUPPLIER_NOT_FOUND_MESSAGE,
} from "./purchases.repository.js";
import { PURCHASE_NOT_EDITABLE_MESSAGE } from "./purchases.service.js";
import { PURCHASES_DTO_SCHEMA_VERSION } from "./purchases.zod.js";

interface PurchaseLineDto {
  id: string;
  catalogItemId: string;
  quantity: string;
  unitCost: string | null;
}

interface PurchaseDto {
  id: string;
  tenantId: string;
  supplierId: string;
  status: string;
  lines: PurchaseLineDto[];
  createdAt: string;
  updatedAt: string;
}

interface ErrorDto {
  error: { code: string; message: string };
}

/** Exact allowlisted key set — any extra key fails these assertions. */
const PURCHASE_RESPONSE_KEYS: readonly string[] = [
  "id",
  "tenantId",
  "supplierId",
  "status",
  "lines",
  "createdAt",
  "updatedAt",
];

const PURCHASE_LINE_RESPONSE_KEYS: readonly string[] = [
  "id",
  "catalogItemId",
  "quantity",
  "unitCost",
];

/** The full purchase matrix an owning role holds; the read-only actor holds one key. */
const ALL_PURCHASES_PERMISSIONS: readonly string[] = [
  PURCHASES_PERMISSIONS.read,
  PURCHASES_PERMISSIONS.create,
  PURCHASES_PERMISSIONS.update,
  PURCHASES_PERMISSIONS.cancel,
];

interface PurchasesTenant {
  tenant: TenantRow;
  actor: RbacActor;
}

interface SeedPurchaseOptions {
  status?: PurchaseStatusRow;
  supplierId?: string;
  lines?: readonly { catalogItemId: string; quantity: string; unitCost?: string | null }[];
}

interface PurchasesHttpFixture {
  /** Probing tenant holding the FULL `purchases.*` matrix. */
  a: PurchasesTenant;
  /** Foreign tenant holding the full matrix; owns the rows A must not touch. */
  b: PurchasesTenant;
  /** Member of A whose role has NO purchase permission (403 probe). */
  noPermission: RbacActor;
  /** Member of A with `purchases.read` only: every write is a 403. */
  readOnly: RbacActor;
  createSupplier(owner: PurchasesTenant, overrides?: { name?: string }): SupplierRow;
  createItem(owner: PurchasesTenant, overrides?: { name?: string }): CatalogItemRow;
  /** Fresh purchase (with lines) in the given tenant; call per test for isolation. */
  seedPurchase(owner: PurchasesTenant, options?: SeedPurchaseOptions): PurchaseRow;
}

/**
 * Seeds two isolated tenants holding the full purchase matrix, a
 * permission-negative actor and a read-only actor in tenant A, plus supplier,
 * catalog-item and purchase factories. Every factory runs INSIDE its `it`, so
 * no test depends on an id minted by an earlier test.
 */
function seedPurchasesHttp(db: IsolationDatabase): PurchasesHttpFixture {
  const suffix = randomUUID().slice(0, 8);

  function seedTenant(letter: string, keys: readonly string[]): PurchasesTenant {
    const label = letter.toUpperCase();
    const tenant = db.prisma.tenant.create({
      data: { slug: `purchases-${letter}-${suffix}`, name: `Purchases ${label}` },
    });
    const role = seedRoleWithKeys(
      db,
      `PURCHASES_${label}_${suffix}`,
      `Purchases ${label} (fixture)`,
      [...keys]
    );
    const actor = seedRbacActor(db, {
      email: `purchases-${letter}-${suffix}@isolation.test`,
      tenantId: tenant.id,
      roleId: role.role.id,
    });
    return { tenant, actor };
  }

  const a = seedTenant("a", ALL_PURCHASES_PERMISSIONS);
  const b = seedTenant("b", ALL_PURCHASES_PERMISSIONS);

  const noPermissionRole = seedRoleWithKeys(
    db,
    `PURCHASES_NONE_${suffix}`,
    "Purchases none (fixture)",
    []
  );
  const noPermission = seedRbacActor(db, {
    email: `purchases-none-${suffix}@isolation.test`,
    tenantId: a.tenant.id,
    roleId: noPermissionRole.role.id,
  });

  const readOnlyRole = seedRoleWithKeys(
    db,
    `PURCHASES_READ_${suffix}`,
    "Purchases read only (fixture)",
    [PURCHASES_PERMISSIONS.read]
  );
  const readOnly = seedRbacActor(db, {
    email: `purchases-read-${suffix}@isolation.test`,
    tenantId: a.tenant.id,
    roleId: readOnlyRole.role.id,
  });

  const createSupplier: PurchasesHttpFixture["createSupplier"] = (owner, overrides = {}) =>
    db.prisma.supplier.create({
      data: {
        tenantId: owner.tenant.id,
        name: overrides.name ?? `Supplier ${randomUUID().slice(0, 8)}`,
      },
    });

  const createItem: PurchasesHttpFixture["createItem"] = (owner, overrides = {}) =>
    db.prisma.catalogItem.create({
      data: {
        tenantId: owner.tenant.id,
        kind: "SUPPLY",
        name: overrides.name ?? `Item ${randomUUID().slice(0, 8)}`,
        taxRateId: SEEDED_TAX_RATE_IDS.EXEMPT,
        tracksStock: true,
        isActive: true,
      },
    });

  const seedPurchase: PurchasesHttpFixture["seedPurchase"] = (owner, options = {}) => {
    const supplierId = options.supplierId ?? createSupplier(owner).id;
    const lines = options.lines ?? [{ catalogItemId: createItem(owner).id, quantity: "1.000" }];
    return db.prisma.purchase.create({
      data: {
        tenantId: owner.tenant.id,
        supplierId,
        status: options.status ?? "DRAFT",
        lines: {
          create: lines.map((line) => ({
            catalogItemId: line.catalogItemId,
            quantity: line.quantity,
            unitCost: line.unitCost ?? null,
          })),
        },
      },
    });
  };

  return { a, b, noPermission, readOnly, createSupplier, createItem, seedPurchase };
}

/** A valid create/update body; overrides let a test break exactly one rule. */
function purchaseBody(
  supplierId: string,
  lines: readonly Record<string, unknown>[]
): Record<string, unknown> {
  return { supplierId, lines };
}

/** One valid line; `extra` breaks exactly one rule. */
function line(
  catalogItemId: string,
  quantity: unknown = "1",
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { catalogItemId, quantity, ...extra };
}

/** Every audit row targeting one purchase — the per-mutation row count. */
function auditsForTarget(booted: BootedTestApp, targetId: string): AuditLogRow[] {
  return [...booted.db.tables.audits.values()].filter((row) => row.targetId === targetId);
}

function changedFieldsOf(row: AuditLogRow): unknown[] | undefined {
  const value = row.metadata.changedFields;
  return Array.isArray(value) ? value : undefined;
}

/** Row count of every in-memory table — the "is the draft path inert?" probe. */
function tableSizes(db: IsolationDatabase): Record<string, number> {
  return Object.fromEntries(Object.entries(db.tables).map(([name, table]) => [name, table.size]));
}

/**
 * EPIC-11 PUR-001 purchase draft surface over the REAL guard chain
 * (Auth → Tenancy → RBAC) and the shared in-memory boundary, which snapshots
 * and restores its tables on a thrown transaction — so "persists nothing" is
 * proven, not assumed.
 */
describe("Purchases HTTP boundary (EPIC-11 PUR-001)", () => {
  let booted: BootedTestApp;
  let fixture: PurchasesHttpFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedPurchasesHttp(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  it("requires purchases.read on every read route and appends nothing when denied", async () => {
    const purchase = fixture.seedPurchase(fixture.a);
    const auditsBefore = booted.db.tables.audits.size;

    for (const path of ["/purchases", `/purchases/${purchase.id}`]) {
      const response = await supertest(booted.app.getHttpServer())
        .get(path)
        .set("Cookie", fixture.noPermission.cookie)
        .expect(403);
      expect((response.body as ErrorDto).error.code, path).toBe("FORBIDDEN");
    }

    // `purchases.read` alone reads both routes.
    for (const path of ["/purchases", `/purchases/${purchase.id}`]) {
      await supertest(booted.app.getHttpServer())
        .get(path)
        .set("Cookie", fixture.readOnly.cookie)
        .expect(200);
    }

    // Reads are never audited.
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
  });

  it("requires the matching purchase permission on every write route and persists nothing when denied", async () => {
    const purchase = fixture.seedPurchase(fixture.a);
    const item = fixture.createItem(fixture.a);
    const supplier = fixture.createSupplier(fixture.a);

    const cases = [
      {
        label: PURCHASES_PERMISSIONS.create,
        method: "post" as const,
        path: "/purchases",
        body: purchaseBody(supplier.id, [line(item.id)]),
      },
      {
        label: PURCHASES_PERMISSIONS.update,
        method: "put" as const,
        path: `/purchases/${purchase.id}`,
        body: purchaseBody(supplier.id, [line(item.id)]),
      },
      {
        label: PURCHASES_PERMISSIONS.cancel,
        method: "post" as const,
        path: `/purchases/${purchase.id}/cancel`,
        body: undefined,
      },
    ];

    const sizesBefore = tableSizes(booted.db);

    // Both a read-only member and a member with no purchase key at all are denied.
    for (const actor of [fixture.readOnly, fixture.noPermission]) {
      for (const scenario of cases) {
        const request = supertest(booted.app.getHttpServer())
          [scenario.method](scenario.path)
          .set("Cookie", actor.cookie);
        const response = await (
          scenario.body === undefined ? request : request.send(scenario.body)
        ).expect(403);
        expect((response.body as ErrorDto).error.code, scenario.label).toBe("FORBIDDEN");
      }
    }

    // A denied write reaches no data access AND no audit append.
    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("creates a DRAFT with its lines, co-commits one audit row and returns the allowlisted DTO", async () => {
    const supplier = fixture.createSupplier(fixture.a);
    const first = fixture.createItem(fixture.a);
    const second = fixture.createItem(fixture.a);
    const auditsBefore = booted.db.tables.audits.size;

    const response = await supertest(booted.app.getHttpServer())
      .post("/purchases")
      .set("Cookie", fixture.a.actor.cookie)
      .send(
        purchaseBody(supplier.id, [
          line(first.id, "2", { unitCost: "10.5" }),
          line(second.id, "1.250"),
        ])
      )
      .expect(201);

    const body = response.body as PurchaseDto;
    expect(Object.keys(body).sort()).toEqual([...PURCHASE_RESPONSE_KEYS].sort());
    expect(body.tenantId).toBe(fixture.a.tenant.id);
    expect(body.supplierId).toBe(supplier.id);
    expect(body.status).toBe("DRAFT");
    expect(body.lines).toHaveLength(2);

    // Decimal projections are FIXED-SCALE exact strings: padded, never floats.
    for (const projection of body.lines) {
      expect(Object.keys(projection).sort()).toEqual([...PURCHASE_LINE_RESPONSE_KEYS].sort());
    }
    const firstLine = body.lines.find((row) => row.catalogItemId === first.id);
    expect(firstLine?.quantity).toBe("2.000");
    expect(firstLine?.unitCost).toBe("10.50");
    const secondLine = body.lines.find((row) => row.catalogItemId === second.id);
    expect(secondLine?.quantity).toBe("1.250");
    expect(secondLine?.unitCost).toBeNull();

    expect(booted.db.tables.audits.size).toBe(auditsBefore + 1);
    const rows = auditsForTarget(booted, body.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("purchase.created");
    expect(rows[0].targetType).toBe("purchase");
    expect(rows[0].tenantId).toBe(fixture.a.tenant.id);
    expect(rows[0].metadata.schemaVersion).toBe(PURCHASES_DTO_SCHEMA_VERSION);
    expect(changedFieldsOf(rows[0])).toEqual(["supplierId", "lines"]);

    // Field NAMES only: no identifier or stored value reaches the trail.
    const serializedMeta = JSON.stringify(rows[0].metadata);
    expect(serializedMeta).not.toContain(first.id);
    expect(serializedMeta).not.toContain("2.000");
    expect(serializedMeta).not.toContain("10.50");
  });

  it("rejects every invalid create and persists nothing", async () => {
    const supplier = fixture.createSupplier(fixture.a);
    const item = fixture.createItem(fixture.a);
    const sizesBefore = tableSizes(booted.db);

    const rejected: [string, Record<string, unknown>][] = [
      ["missing supplier", { lines: [line(item.id)] }],
      ["non-uuid supplier", purchaseBody("not-a-uuid", [line(item.id)])],
      ["missing lines", { supplierId: supplier.id }],
      ["empty lines", purchaseBody(supplier.id, [])],
      ["duplicate catalog item", purchaseBody(supplier.id, [line(item.id), line(item.id)])],
      ["zero quantity", purchaseBody(supplier.id, [line(item.id, "0")])],
      ["zero spelled 0.000", purchaseBody(supplier.id, [line(item.id, "0.000")])],
      ["negative quantity", purchaseBody(supplier.id, [line(item.id, "-1")])],
      ["malformed quantity", purchaseBody(supplier.id, [line(item.id, "1.2.3")])],
      ["four-decimal quantity", purchaseBody(supplier.id, [line(item.id, "1.0000")])],
      ["float quantity", purchaseBody(supplier.id, [line(item.id, 1.5)])],
      ["eight-digit quantity", purchaseBody(supplier.id, [line(item.id, "10000000")])],
      ["negative unit cost", purchaseBody(supplier.id, [line(item.id, "1", { unitCost: "-1" })])],
      [
        "three-decimal unit cost",
        purchaseBody(supplier.id, [line(item.id, "1", { unitCost: "1.234" })]),
      ],
      ["float unit cost", purchaseBody(supplier.id, [line(item.id, "1", { unitCost: 2.5 })])],
      ["non-uuid catalog item", purchaseBody(supplier.id, [line("not-a-uuid")])],
      ["unknown line key", purchaseBody(supplier.id, [line(item.id, "1", { cost: "1" })])],
      ["client tenant", { ...purchaseBody(supplier.id, [line(item.id)]), tenantId: randomUUID() }],
      ["client status", { ...purchaseBody(supplier.id, [line(item.id)]), status: "RECEIVED" }],
      ["unknown top-level key", { ...purchaseBody(supplier.id, [line(item.id)]), number: "P-1" }],
    ];

    for (const [label, body] of rejected) {
      const response = await supertest(booted.app.getHttpServer())
        .post("/purchases")
        .set("Cookie", fixture.a.actor.cookie)
        .send(body)
        .expect(400);
      expect((response.body as ErrorDto).error.code, label).toBe("VALIDATION_FAILED");
    }

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("rejects every invalid update and persists nothing", async () => {
    const purchase = fixture.seedPurchase(fixture.a);
    const supplier = fixture.createSupplier(fixture.a);
    const item = fixture.createItem(fixture.a);
    const sizesBefore = tableSizes(booted.db);

    const rejected: [string, Record<string, unknown>][] = [
      ["missing lines", { supplierId: supplier.id }],
      ["empty lines", purchaseBody(supplier.id, [])],
      ["duplicate catalog item", purchaseBody(supplier.id, [line(item.id), line(item.id)])],
      ["zero quantity", purchaseBody(supplier.id, [line(item.id, "0.000")])],
      ["negative quantity", purchaseBody(supplier.id, [line(item.id, "-2")])],
      ["float quantity", purchaseBody(supplier.id, [line(item.id, 2)])],
      ["negative unit cost", purchaseBody(supplier.id, [line(item.id, "1", { unitCost: "-0.5" })])],
      ["client tenant", { ...purchaseBody(supplier.id, [line(item.id)]), tenantId: randomUUID() }],
      ["client status", { ...purchaseBody(supplier.id, [line(item.id)]), status: "CANCELLED" }],
      ["unknown key", { ...purchaseBody(supplier.id, [line(item.id)]), lines2: [] }],
    ];

    for (const [label, body] of rejected) {
      const response = await supertest(booted.app.getHttpServer())
        .put(`/purchases/${purchase.id}`)
        .set("Cookie", fixture.a.actor.cookie)
        .send(body)
        .expect(400);
      expect((response.body as ErrorDto).error.code, label).toBe("VALIDATION_FAILED");
    }

    // A malformed id is a 400 too, and cannot reach the row.
    const malformed = await supertest(booted.app.getHttpServer())
      .put("/purchases/not-a-uuid")
      .set("Cookie", fixture.a.actor.cookie)
      .send(purchaseBody(supplier.id, [line(item.id)]))
      .expect(400);
    expect((malformed.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");

    expect(tableSizes(booted.db)).toEqual(sizesBefore);

    const stored = booted.db.tables.purchases.get(purchase.id);
    expect(stored?.supplierId).toBe(purchase.supplierId);
    expect(stored?.status).toBe("DRAFT");
    expect(auditsForTarget(booted, purchase.id)).toHaveLength(0);
  });

  it("masks an unknown and a cross-tenant purchase id as the same 404 on read, update and cancel", async () => {
    const foreign = fixture.seedPurchase(fixture.b);
    const supplier = fixture.createSupplier(fixture.a);
    const item = fixture.createItem(fixture.a);
    const sizesBefore = tableSizes(booted.db);

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      method: "GET",
      nonexistentUrl: `/purchases/${randomUUID()}`,
      foreignUrl: `/purchases/${foreign.id}`,
      forbiddenIdentifiers: [foreign.id, fixture.b.tenant.id, foreign.supplierId],
    });

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      method: "PUT",
      nonexistentUrl: `/purchases/${randomUUID()}`,
      foreignUrl: `/purchases/${foreign.id}`,
      body: purchaseBody(supplier.id, [line(item.id, "5")]),
      forbiddenIdentifiers: [foreign.id, fixture.b.tenant.id, foreign.supplierId],
    });

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      method: "POST",
      nonexistentUrl: `/purchases/${randomUUID()}/cancel`,
      foreignUrl: `/purchases/${foreign.id}/cancel`,
      forbiddenIdentifiers: [foreign.id, fixture.b.tenant.id, foreign.supplierId],
    });

    // The foreign draft is untouched: same supplier, same status, same lines.
    expect(tableSizes(booted.db)).toEqual(sizesBefore);
    const stored = booted.db.tables.purchases.get(foreign.id);
    expect(stored?.supplierId).toBe(foreign.supplierId);
    expect(stored?.status).toBe("DRAFT");
    expect(auditsForTarget(booted, foreign.id)).toHaveLength(0);
  });

  it("rejects an unknown and a foreign supplier reference with the shared 404 and persists nothing", async () => {
    const zeroAudits = booted.db.tables.audits.size;
    const sizesBefore = tableSizes(booted.db);
    const item = fixture.createItem(fixture.a);
    const foreignSupplier = fixture.createSupplier(fixture.b);

    for (const supplierId of [randomUUID(), foreignSupplier.id]) {
      const response = await supertest(booted.app.getHttpServer())
        .post("/purchases")
        .set("Cookie", fixture.a.actor.cookie)
        .send(purchaseBody(supplierId, [line(item.id)]))
        .expect(404);
      const body = response.body as ErrorDto;
      expect(body.error.code).toBe("NOT_FOUND");
      expect(body.error.message).toBe(PURCHASE_SUPPLIER_NOT_FOUND_MESSAGE);
    }

    // The UPDATE path resolves the same reference through the same seam.
    const purchase = fixture.seedPurchase(fixture.a);
    const updateSizes = tableSizes(booted.db);
    const updateResponse = await supertest(booted.app.getHttpServer())
      .put(`/purchases/${purchase.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send(purchaseBody(foreignSupplier.id, [line(item.id)]))
      .expect(404);
    expect((updateResponse.body as ErrorDto).error.message).toBe(
      PURCHASE_SUPPLIER_NOT_FOUND_MESSAGE
    );

    expect(tableSizes(booted.db)).toEqual(updateSizes);
    expect(booted.db.tables.audits.size).toBe(zeroAudits);
    expect(tableSizes(booted.db).purchases).toBe(sizesBefore.purchases + 1);
  });

  it("rejects an unknown and a foreign catalog-item reference with the shared 404 and persists nothing", async () => {
    const supplier = fixture.createSupplier(fixture.a);
    const ownItem = fixture.createItem(fixture.a);
    const foreignItem = fixture.createItem(fixture.b);
    const sizesBefore = tableSizes(booted.db);

    for (const catalogItemId of [randomUUID(), foreignItem.id]) {
      const response = await supertest(booted.app.getHttpServer())
        .post("/purchases")
        .set("Cookie", fixture.a.actor.cookie)
        .send(purchaseBody(supplier.id, [line(ownItem.id), line(catalogItemId)]))
        .expect(404);
      const body = response.body as ErrorDto;
      expect(body.error.code).toBe("NOT_FOUND");
      expect(body.error.message).toBe(PURCHASE_CATALOG_ITEM_NOT_FOUND_MESSAGE);
    }

    // The UPDATE path resolves the same reference through the same seam and
    // leaves the existing draft line set untouched.
    const draft = fixture.seedPurchase(fixture.a, {
      lines: [{ catalogItemId: ownItem.id, quantity: "1.000" }],
    });
    const beforeLines = [...booted.db.tables.purchaseLines.values()].filter(
      (row) => row.purchaseId === draft.id
    );
    const updateSizes = tableSizes(booted.db);

    const updateResponse = await supertest(booted.app.getHttpServer())
      .put(`/purchases/${draft.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send(purchaseBody(supplier.id, [line(foreignItem.id)]))
      .expect(404);
    expect((updateResponse.body as ErrorDto).error.message).toBe(
      PURCHASE_CATALOG_ITEM_NOT_FOUND_MESSAGE
    );

    expect(tableSizes(booted.db)).toEqual(updateSizes);
    expect(
      [...booted.db.tables.purchaseLines.values()].filter((row) => row.purchaseId === draft.id)
    ).toEqual(beforeLines);
    expect(auditsForTarget(booted, draft.id)).toHaveLength(0);
    expect(tableSizes(booted.db).purchases).toBe(sizesBefore.purchases + 1);
  });

  it("guards the DRAFT-only mutability: 409 on update and cancel of a RECEIVED and of a CANCELLED purchase", async () => {
    const supplier = fixture.createSupplier(fixture.a);
    const item = fixture.createItem(fixture.a);

    for (const status of ["RECEIVED", "CANCELLED"] as const) {
      const purchase = fixture.seedPurchase(fixture.a, {
        status,
        lines: [{ catalogItemId: item.id, quantity: "3.000", unitCost: "9.99" }],
      });
      const sizesBefore = tableSizes(booted.db);

      const updateResponse = await supertest(booted.app.getHttpServer())
        .put(`/purchases/${purchase.id}`)
        .set("Cookie", fixture.a.actor.cookie)
        .send(purchaseBody(supplier.id, [line(item.id, "9")]))
        .expect(409);
      expect((updateResponse.body as ErrorDto).error.code).toBe("CONFLICT");
      expect((updateResponse.body as ErrorDto).error.message).toBe(PURCHASE_NOT_EDITABLE_MESSAGE);

      const cancelResponse = await supertest(booted.app.getHttpServer())
        .post(`/purchases/${purchase.id}/cancel`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(409);
      expect((cancelResponse.body as ErrorDto).error.code).toBe("CONFLICT");
      expect((cancelResponse.body as ErrorDto).error.message).toBe(PURCHASE_NOT_EDITABLE_MESSAGE);

      // Nothing persisted: status, header and line set are exactly as seeded,
      // and no audit row exists for either rejection.
      expect(tableSizes(booted.db)).toEqual(sizesBefore);
      expect(booted.db.tables.purchases.get(purchase.id)?.status).toBe(status);
      expect(booted.db.tables.purchases.get(purchase.id)?.supplierId).toBe(purchase.supplierId);
      expect(auditsForTarget(booted, purchase.id)).toHaveLength(0);
      const storedLine = [...booted.db.tables.purchaseLines.values()].find(
        (row) => row.purchaseId === purchase.id
      );
      expect(storedLine?.quantity).toBe("3.000");
      expect(storedLine?.unitCost).toBe("9.99");
    }
  });

  it("cancels a DRAFT, keeps it readable and rejects a second cancel", async () => {
    const supplier = fixture.createSupplier(fixture.a);
    const item = fixture.createItem(fixture.a);

    const created = await supertest(booted.app.getHttpServer())
      .post("/purchases")
      .set("Cookie", fixture.a.actor.cookie)
      .send(purchaseBody(supplier.id, [line(item.id, "4.5")]))
      .expect(201);
    const purchaseId = (created.body as PurchaseDto).id;

    const cancelled = await supertest(booted.app.getHttpServer())
      .post(`/purchases/${purchaseId}/cancel`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(201);
    const body = cancelled.body as PurchaseDto;
    expect(body.id).toBe(purchaseId);
    expect(body.status).toBe("CANCELLED");
    expect(body.lines).toHaveLength(1);

    const rows = auditsForTarget(booted, purchaseId);
    expect(rows.map((row) => row.action)).toEqual(["purchase.created", "purchase.cancelled"]);
    expect(changedFieldsOf(rows[1])).toEqual(["status"]);

    // Cancellation is a status transition, never a delete: the purchase and its
    // lines remain readable.
    await supertest(booted.app.getHttpServer())
      .get(`/purchases/${purchaseId}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    expect(booted.db.tables.purchases.has(purchaseId)).toBe(true);
    expect(
      [...booted.db.tables.purchaseLines.values()].filter((row) => row.purchaseId === purchaseId)
    ).toHaveLength(1);

    // CANCELLED is terminal: a second cancel persists nothing.
    const auditsAfterCancel = booted.db.tables.audits.size;
    const second = await supertest(booted.app.getHttpServer())
      .post(`/purchases/${purchaseId}/cancel`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(409);
    expect((second.body as ErrorDto).error.message).toBe(PURCHASE_NOT_EDITABLE_MESSAGE);
    expect(booted.db.tables.audits.size).toBe(auditsAfterCancel);
  });

  it("reconciles the line set by catalogItemId: retains, updates, inserts and removes", async () => {
    const supplier = fixture.createSupplier(fixture.a);
    const newSupplier = fixture.createSupplier(fixture.a);
    const retainedItem = fixture.createItem(fixture.a);
    const removedItem = fixture.createItem(fixture.a);
    const insertedItem = fixture.createItem(fixture.a);

    const created = await supertest(booted.app.getHttpServer())
      .post("/purchases")
      .set("Cookie", fixture.a.actor.cookie)
      .send(
        purchaseBody(supplier.id, [
          line(retainedItem.id, "1", { unitCost: "5.00" }),
          line(removedItem.id, "2"),
        ])
      )
      .expect(201);
    const createdBody = created.body as PurchaseDto;
    const retainedLineId = createdBody.lines.find(
      (row) => row.catalogItemId === retainedItem.id
    )?.id;
    expect(retainedLineId).toBeDefined();

    const updated = await supertest(booted.app.getHttpServer())
      .put(`/purchases/${createdBody.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send(purchaseBody(newSupplier.id, [line(retainedItem.id, "7"), line(insertedItem.id, "3")]))
      .expect(200);

    const body = updated.body as PurchaseDto;
    expect(body.supplierId).toBe(newSupplier.id);
    expect(body.id).toBe(createdBody.id);
    // The removed item is gone; the two submitted items are present, exactly once.
    expect(body.lines.map((row) => row.catalogItemId).sort()).toEqual(
      [retainedItem.id, insertedItem.id].sort()
    );

    // The retained line was UPDATED IN PLACE: its identity survives.
    const retainedLine = body.lines.find((row) => row.catalogItemId === retainedItem.id);
    expect(retainedLine?.id).toBe(retainedLineId);
    expect(retainedLine?.quantity).toBe("7.000");
    // The payload is authoritative: an omitted unitCost clears the stored cost.
    expect(retainedLine?.unitCost).toBeNull();

    // The removed item's line row is actually gone from storage.
    const storedCatalogItemIds = [...booted.db.tables.purchaseLines.values()]
      .filter((row) => row.purchaseId === createdBody.id)
      .map((row) => row.catalogItemId)
      .sort();
    expect(storedCatalogItemIds).toEqual([retainedItem.id, insertedItem.id].sort());

    const rows = auditsForTarget(booted, createdBody.id);
    expect(rows.map((row) => row.action)).toEqual(["purchase.created", "purchase.updated"]);
    expect(changedFieldsOf(rows[1])).toEqual(["supplierId", "lines"]);
  });

  it("co-commits exactly one audit row per accepted mutation, with field names only", async () => {
    const supplier = fixture.createSupplier(fixture.a);
    const item = fixture.createItem(fixture.a);

    const created = await supertest(booted.app.getHttpServer())
      .post("/purchases")
      .set("Cookie", fixture.a.actor.cookie)
      .send(purchaseBody(supplier.id, [line(item.id, "6", { unitCost: "12.34" })]))
      .expect(201);
    const purchaseId = (created.body as PurchaseDto).id;

    await supertest(booted.app.getHttpServer())
      .put(`/purchases/${purchaseId}`)
      .set("Cookie", fixture.a.actor.cookie)
      // No `supplierId`: the diff names ONLY the fields the payload supplied.
      .send({ lines: [line(item.id, "8")] })
      .expect(200);

    await supertest(booted.app.getHttpServer())
      .post(`/purchases/${purchaseId}/cancel`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(201);

    const rows = auditsForTarget(booted, purchaseId);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.action)).toEqual([
      "purchase.created",
      "purchase.updated",
      "purchase.cancelled",
    ]);
    expect(rows.map((row) => row.targetType)).toEqual(["purchase", "purchase", "purchase"]);
    expect(rows.map(changedFieldsOf)).toEqual([["supplierId", "lines"], ["lines"], ["status"]]);

    for (const row of rows) {
      expect(row.metadata.schemaVersion).toBe(PURCHASES_DTO_SCHEMA_VERSION);
      const serialized = JSON.stringify(row.metadata);
      // Field NAMES only: no identifier and no stored value reaches the trail.
      expect(serialized, `${row.action} leaked an id`).not.toContain(supplier.id);
      expect(serialized, `${row.action} leaked an id`).not.toContain(item.id);
      expect(serialized, `${row.action} leaked a quantity`).not.toContain("6.000");
      expect(serialized, `${row.action} leaked a cost`).not.toContain("12.34");
    }
  });

  it("lists only the caller tenant's purchases in deterministic order and rejects unknown filters", async () => {
    const supplier = fixture.createSupplier(fixture.a);
    const item = fixture.createItem(fixture.a);

    const draft = fixture.seedPurchase(fixture.a, { status: "DRAFT" });
    const received = fixture.seedPurchase(fixture.a, {
      status: "RECEIVED",
      supplierId: supplier.id,
      lines: [{ catalogItemId: item.id, quantity: "1.000" }],
    });
    const cancelled = fixture.seedPurchase(fixture.a, { status: "CANCELLED" });
    const foreign = fixture.seedPurchase(fixture.b);

    const all = await supertest(booted.app.getHttpServer())
      .get("/purchases")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const body = all.body as PurchaseDto[];
    expect(Object.keys(body[0]).sort()).toEqual([...PURCHASE_RESPONSE_KEYS].sort());
    expect(body.every((row) => row.tenantId === fixture.a.tenant.id)).toBe(true);
    expect(body.map((row) => row.id)).not.toContain(foreign.id);

    // The full tenant list, ordered newest-first with the id tiebreak.
    const expectedIds = [...booted.db.tables.purchases.values()]
      .filter((row) => row.tenantId === fixture.a.tenant.id)
      .sort((left, right) => {
        const byCreated = right.createdAt.getTime() - left.createdAt.getTime();
        return byCreated !== 0 ? byCreated : left.id.localeCompare(right.id);
      })
      .map((row) => row.id);
    expect(body.map((row) => row.id)).toEqual(expectedIds);

    // Every listed purchase carries its lines.
    expect(body.find((row) => row.id === received.id)?.lines).toHaveLength(1);

    // The optional status filter narrows in every direction and has no default.
    const draftOnly = await supertest(booted.app.getHttpServer())
      .get("/purchases?status=DRAFT")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const draftIds = (draftOnly.body as PurchaseDto[]).map((row) => row.id);
    expect(draftIds).toContain(draft.id);
    expect(draftIds).not.toContain(received.id);
    expect(draftIds).not.toContain(cancelled.id);

    // Unknown keys and malformed filter values are rejected, not ignored.
    for (const query of [
      "?limit=10",
      "?supplierId=" + supplier.id,
      "?status=RECEIVING",
      "?DRAFT=",
    ]) {
      const rejected = await supertest(booted.app.getHttpServer())
        .get(`/purchases${query}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(400);
      expect((rejected.body as ErrorDto).error.code, query).toBe("VALIDATION_FAILED");
    }

    // No foreign tenant identifier ever leaks into the caller's list.
    expect(all.text).not.toContain(foreign.id);
    expect(all.text).not.toContain(fixture.b.tenant.id);
  });

  it("exposes no PATCH or DELETE route anywhere on the purchase surface", async () => {
    const purchase = fixture.seedPurchase(fixture.a);
    const sizesBefore = tableSizes(booted.db);

    for (const [method, path] of [
      ["delete", `/purchases/${purchase.id}`],
      ["patch", `/purchases/${purchase.id}`],
      ["delete", "/purchases"],
      ["patch", "/purchases"],
      ["post", `/purchases/${purchase.id}/receive`],
    ] as const) {
      await supertest(booted.app.getHttpServer())
        [method](path)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(404);
    }

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
    expect(booted.db.tables.purchases.has(purchase.id)).toBe(true);
  });

  it("keeps the draft path INERT: no stock, balance, cash, invoice or other row is created", async () => {
    const supplier = fixture.createSupplier(fixture.a);
    const item = fixture.createItem(fixture.a);
    const sizesBefore = tableSizes(booted.db);

    const created = await supertest(booted.app.getHttpServer())
      .post("/purchases")
      .set("Cookie", fixture.a.actor.cookie)
      .send(purchaseBody(supplier.id, [line(item.id, "5")]))
      .expect(201);
    const purchaseId = (created.body as PurchaseDto).id;

    await supertest(booted.app.getHttpServer())
      .put(`/purchases/${purchaseId}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send(purchaseBody(supplier.id, [line(item.id, "6")]))
      .expect(200);

    await supertest(booted.app.getHttpServer())
      .post(`/purchases/${purchaseId}/cancel`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(201);

    const sizesAfter = tableSizes(booted.db);
    const changedTables = Object.keys(sizesAfter)
      .filter((name) => sizesAfter[name] !== sizesBefore[name])
      .sort();

    // The ONLY tables a draft operation may touch: the aggregate and its lines
    // plus the co-committed audit trail. No `stock_movement`, no
    // `stock_balance`, no cash row, no invoice row and no fiscal row exists or
    // is written — receiving is PUR-002.
    expect(changedTables).toEqual(["audits", "purchaseLines", "purchases"]);
    expect(sizesAfter.stockMovements).toBe(0);
    expect(sizesAfter.stockBalances).toBe(0);

    // No number is allocated either (DEC-018): the stored header carries no
    // number/code column and the DTO exposes none.
    const stored = booted.db.tables.purchases.get(purchaseId);
    expect(stored && "number" in stored).toBe(false);
    expect(Object.keys(created.body as PurchaseDto)).not.toContain("number");
  });

  it("returns the same shared 404 message for the purchase resource in every read/write verb", async () => {
    // A contract pin on the shared constant itself: the same text backs the
    // read, the update and the cancel 404, so the three verbs are byte-equivalent
    // by construction rather than by coincidence.
    const supplier = fixture.createSupplier(fixture.a);
    const item = fixture.createItem(fixture.a);
    const missingId = randomUUID();

    const getResponse = await supertest(booted.app.getHttpServer())
      .get(`/purchases/${missingId}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(404);
    const putResponse = await supertest(booted.app.getHttpServer())
      .put(`/purchases/${missingId}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send(purchaseBody(supplier.id, [line(item.id)]))
      .expect(404);
    const cancelResponse = await supertest(booted.app.getHttpServer())
      .post(`/purchases/${missingId}/cancel`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(404);

    for (const response of [getResponse, putResponse, cancelResponse]) {
      expect((response.body as ErrorDto).error.code).toBe("NOT_FOUND");
      expect((response.body as ErrorDto).error.message).toBe(PURCHASE_NOT_FOUND_MESSAGE);
    }
  });
});
