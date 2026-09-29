import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { expectCrossTenant404 } from "../../test/support/expect-cross-tenant-404.js";
import {
  SEEDED_TAX_RATE_IDS,
  type AuditLogRow,
  type CatalogItemRow,
  type CustomerRow,
  type IsolationDatabase,
  type SaleLineRow,
  type SaleRow,
  type SaleStatusRow,
  type TenantRow,
} from "../../test/support/in-memory-database.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
} from "../../test/support/rbac-fixture.js";
import { SALES_PERMISSIONS } from "./sales.permissions.js";
import { SALE_CUSTOMER_NOT_FOUND_MESSAGE, SALE_NOT_FOUND_MESSAGE } from "./sales.repository.js";
import {
  SALE_CURRENCY_MISMATCH_MESSAGE,
  SALE_NOT_EDITABLE_MESSAGE,
  SALE_TAX_RATE_NOT_FOUND_MESSAGE,
  SALE_UNIT_PRICE_REQUIRED_MESSAGE,
  SALES_FEATURE_NOT_ENTITLED_MESSAGE,
} from "./sales.service.js";
import { SALE_UNSUPPORTED_CURRENCY_MESSAGE } from "./sales.pricing.js";
import { SALES_DTO_SCHEMA_VERSION } from "./sales.zod.js";

interface SaleLineDto {
  id: string;
  catalogItemId: string;
  rateCode: string;
  unitPrice: string;
  quantity: string;
  lineTotal: string;
  taxableBase: string;
  taxAmount: string;
}

interface SaleDto {
  id: string;
  tenantId: string;
  customerId: string | null;
  currency: string;
  status: string;
  lines: SaleLineDto[];
  total: string;
  createdAt: string;
  updatedAt: string;
}

interface ErrorDto {
  error: { code: string; message: string };
}

/** Exact allowlisted key set — any extra key fails these assertions. */
const SALE_RESPONSE_KEYS: readonly string[] = [
  "id",
  "tenantId",
  "customerId",
  "currency",
  "status",
  "lines",
  "total",
  "createdAt",
  "updatedAt",
];

const SALE_LINE_RESPONSE_KEYS: readonly string[] = [
  "id",
  "catalogItemId",
  "rateCode",
  "unitPrice",
  "quantity",
  "lineTotal",
  "taxableBase",
  "taxAmount",
];

/** The full sale matrix an owning role holds; the read-only actor holds one key. */
const ALL_SALES_PERMISSIONS: readonly string[] = [
  SALES_PERMISSIONS.read,
  SALES_PERMISSIONS.create,
  SALES_PERMISSIONS.update,
  SALES_PERMISSIONS.cancel,
];

interface SalesTenant {
  tenant: TenantRow;
  actor: RbacActor;
}

interface SeedSaleOptions {
  status?: SaleStatusRow;
  customerId?: string | null;
  currency?: string;
  lines?: readonly {
    catalogItemId: string;
    rateCode: string;
    unitPrice: string;
    quantity: string;
    lineTotal: string;
    taxableBase: string;
    taxAmount: string;
  }[];
}

interface SalesHttpFixture {
  /** Probing tenant holding the FULL `sales.*` matrix and the entitlement. */
  a: SalesTenant;
  /** Foreign tenant holding the full matrix; owns the rows A must not touch. */
  b: SalesTenant;
  /** Permissioned tenant WITHOUT the `sales` entitlement (FEATURE_NOT_ENTITLED). */
  c: SalesTenant;
  /** Entitled tenant whose `sales.defaultCurrency` is `USD` (unsupported map). */
  unsupported: SalesTenant;
  /** Member of A whose role has NO sale permission (403 probe). */
  noPermission: RbacActor;
  /** Member of A with `sales.read` only: every write is a 403. */
  readOnly: RbacActor;
  createItem(
    owner: SalesTenant,
    overrides?: {
      name?: string;
      taxRateId?: string;
      referencePriceAmount?: string | null;
      referencePriceCurrency?: string | null;
      isActive?: boolean;
    }
  ): CatalogItemRow;
  createCustomer(owner: SalesTenant): CustomerRow;
  /** Fresh sale (with lines) in the given tenant; call per test for isolation. */
  seedSale(owner: SalesTenant, options?: SeedSaleOptions): SaleRow;
}

/**
 * Seeds three isolated tenants (A probe / B foreign / C entitlement-negative)
 * plus a fourth whose default currency is unsupported, a permission-negative
 * actor and a read-only actor in tenant A, plus catalog-item, customer and sale
 * factories. Every factory runs INSIDE its `it`, so no test depends on an id
 * minted by an earlier test.
 */
function seedSalesHttp(db: IsolationDatabase): SalesHttpFixture {
  const suffix = randomUUID().slice(0, 8);
  const salesFeature = db.prisma.featureCode.create({ data: { code: "sales" } });

  function seedTenant(
    letter: string,
    options: { entitled: boolean; keys: readonly string[] }
  ): SalesTenant {
    const label = letter.toUpperCase();
    const tenant = db.prisma.tenant.create({
      data: { slug: `sales-${letter}-${suffix}`, name: `Sales ${label}` },
    });
    const role = seedRoleWithKeys(db, `SALES_${label}_${suffix}`, `Sales ${label} (fixture)`, [
      ...options.keys,
    ]);
    const actor = seedRbacActor(db, {
      email: `sales-${letter}-${suffix}@isolation.test`,
      tenantId: tenant.id,
      roleId: role.role.id,
    });
    if (options.entitled) {
      db.prisma.tenantEntitlement.create({
        data: { tenantId: tenant.id, featureCodeId: salesFeature.id },
      });
    }
    return { tenant, actor };
  }

  const a = seedTenant("a", { entitled: true, keys: ALL_SALES_PERMISSIONS });
  const b = seedTenant("b", { entitled: true, keys: ALL_SALES_PERMISSIONS });
  const c = seedTenant("c", { entitled: false, keys: ALL_SALES_PERMISSIONS });
  const unsupported = seedTenant("d", { entitled: true, keys: ALL_SALES_PERMISSIONS });

  // The settings schema accepts any ISO-4217 code, but the pricing map supports
  // only PYG; USD is a valid setting that must fail the sale with a stable 400
  // instead of rounding with a guessed exponent.
  db.prisma.tenantSettingNamespace.upsert({
    where: { tenantId_namespace: { tenantId: unsupported.tenant.id, namespace: "sales" } },
    create: {
      tenantId: unsupported.tenant.id,
      namespace: "sales",
      schemaVersion: 1,
      data: { defaultCurrency: "USD", requireCustomerForInvoice: false },
    },
    update: {
      schemaVersion: 1,
      data: { defaultCurrency: "USD", requireCustomerForInvoice: false },
    },
  });

  const noPermissionRole = seedRoleWithKeys(db, `SALES_NONE_${suffix}`, "Sales none (fixture)", []);
  const noPermission = seedRbacActor(db, {
    email: `sales-none-${suffix}@isolation.test`,
    tenantId: a.tenant.id,
    roleId: noPermissionRole.role.id,
  });

  const readOnlyRole = seedRoleWithKeys(db, `SALES_READ_${suffix}`, "Sales read only (fixture)", [
    SALES_PERMISSIONS.read,
  ]);
  const readOnly = seedRbacActor(db, {
    email: `sales-read-${suffix}@isolation.test`,
    tenantId: a.tenant.id,
    roleId: readOnlyRole.role.id,
  });

  const createItem: SalesHttpFixture["createItem"] = (owner, overrides = {}) =>
    db.prisma.catalogItem.create({
      data: {
        tenantId: owner.tenant.id,
        kind: "SUPPLY",
        name: overrides.name ?? `Item ${randomUUID().slice(0, 8)}`,
        taxRateId: overrides.taxRateId ?? SEEDED_TAX_RATE_IDS.EXEMPT,
        referencePriceAmount: overrides.referencePriceAmount,
        referencePriceCurrency: overrides.referencePriceCurrency,
        isActive: overrides.isActive ?? true,
      },
    });

  const createCustomer: SalesHttpFixture["createCustomer"] = (owner) =>
    db.prisma.customer.create({
      data: {
        tenantId: owner.tenant.id,
        kind: "INDIVIDUAL",
        displayName: `Customer ${randomUUID().slice(0, 8)}`,
        legalName: null,
        taxId: null,
        firstName: null,
        lastName: null,
        documentNumber: null,
        isActive: true,
      },
    });

  const seedSale: SalesHttpFixture["seedSale"] = (owner, options = {}) => {
    const lines = options.lines ?? [
      {
        catalogItemId: createItem(owner).id,
        rateCode: "EXEMPT",
        unitPrice: "1000.00",
        quantity: "1.000",
        lineTotal: "1000.00",
        taxableBase: "1000.00",
        taxAmount: "0.00",
      },
    ];
    return db.prisma.sale.create({
      data: {
        tenantId: owner.tenant.id,
        customerId: options.customerId ?? null,
        currency: options.currency ?? "PYG",
        status: options.status ?? "DRAFT",
        lines: { create: lines },
      },
    });
  };

  return { a, b, c, unsupported, noPermission, readOnly, createItem, createCustomer, seedSale };
}

/** A valid create/update body; `extra` lets a test break exactly one rule. */
function saleBody(
  lines: readonly Record<string, unknown>[],
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { lines, ...extra };
}

/** One valid line; `extra` breaks exactly one rule. */
function line(
  catalogItemId: string,
  quantity: unknown = "1",
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { catalogItemId, quantity, ...extra };
}

/** Every audit row targeting one sale — the per-mutation row count. */
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

/** Exact minor-unit integer of a fixed-scale (2 decimals) PYG money string. */
function minorUnits(value: string): bigint {
  return BigInt(value.replace(".", ""));
}

/**
 * EPIC-12 POS-001 sale draft surface over the REAL guard chain
 * (Auth → Tenancy → RBAC) and the shared in-memory boundary, which snapshots and
 * restores its tables on a thrown transaction — so "persists nothing" is proven,
 * not assumed.
 */
describe("Sales HTTP boundary (EPIC-12 POS-001)", () => {
  let booted: BootedTestApp;
  let fixture: SalesHttpFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedSalesHttp(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  it("requires sales.read on every read route and appends nothing when denied", async () => {
    const sale = fixture.seedSale(fixture.a);
    const auditsBefore = booted.db.tables.audits.size;

    for (const path of ["/sales", `/sales/${sale.id}`]) {
      const response = await supertest(booted.app.getHttpServer())
        .get(path)
        .set("Cookie", fixture.noPermission.cookie)
        .expect(403);
      expect((response.body as ErrorDto).error.code, path).toBe("FORBIDDEN");
    }

    // `sales.read` alone reads both routes.
    for (const path of ["/sales", `/sales/${sale.id}`]) {
      await supertest(booted.app.getHttpServer())
        .get(path)
        .set("Cookie", fixture.readOnly.cookie)
        .expect(200);
    }

    // Reads are never audited.
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
  });

  it("requires the matching sale permission on every write route and persists nothing when denied", async () => {
    const sale = fixture.seedSale(fixture.a);
    const item = fixture.createItem(fixture.a, { referencePriceAmount: "1000.00" });

    const cases = [
      {
        label: SALES_PERMISSIONS.create,
        method: "post" as const,
        path: "/sales",
        body: saleBody([line(item.id)]),
      },
      {
        label: SALES_PERMISSIONS.update,
        method: "put" as const,
        path: `/sales/${sale.id}`,
        body: saleBody([line(item.id)]),
      },
      {
        label: SALES_PERMISSIONS.cancel,
        method: "post" as const,
        path: `/sales/${sale.id}/cancel`,
        body: undefined,
      },
    ];

    const sizesBefore = tableSizes(booted.db);

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

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("rejects a route of each kind when the tenant lacks the sales entitlement", async () => {
    const sale = fixture.seedSale(fixture.a);
    const item = fixture.createItem(fixture.a, { referencePriceAmount: "1000.00" });

    const cases = [
      { method: "get" as const, path: "/sales" },
      { method: "get" as const, path: `/sales/${sale.id}` },
      { method: "post" as const, path: "/sales", body: saleBody([line(item.id)]) },
      { method: "put" as const, path: `/sales/${sale.id}`, body: saleBody([line(item.id)]) },
      { method: "post" as const, path: `/sales/${sale.id}/cancel` },
    ];

    const sizesBefore = tableSizes(booted.db);
    for (const scenario of cases) {
      const request = supertest(booted.app.getHttpServer())
        [scenario.method](scenario.path)
        .set("Cookie", fixture.c.actor.cookie);
      const response = await (
        scenario.body === undefined ? request : request.send(scenario.body)
      ).expect(403);
      expect((response.body as ErrorDto).error.code, scenario.path).toBe("FEATURE_NOT_ENTITLED");
      expect((response.body as ErrorDto).error.message, scenario.path).toBe(
        SALES_FEATURE_NOT_ENTITLED_MESSAGE
      );
    }

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("creates a DRAFT with its lines, co-commits one audit row and returns the allowlisted DTO", async () => {
    const taxed = fixture.createItem(fixture.a, {
      taxRateId: SEEDED_TAX_RATE_IDS.IVA_10,
      referencePriceAmount: "1000.00",
      referencePriceCurrency: "PYG",
    });
    const exempt = fixture.createItem(fixture.a, { taxRateId: SEEDED_TAX_RATE_IDS.EXEMPT });
    const customer = fixture.createCustomer(fixture.a);
    const auditsBefore = booted.db.tables.audits.size;

    const response = await supertest(booted.app.getHttpServer())
      .post("/sales")
      .set("Cookie", fixture.a.actor.cookie)
      .send(
        saleBody([line(taxed.id, "1"), line(exempt.id, "2.500", { unitPrice: "500.00" })], {
          customerId: customer.id,
        })
      )
      .expect(201);

    const body = response.body as SaleDto;
    expect(Object.keys(body).sort()).toEqual([...SALE_RESPONSE_KEYS].sort());
    expect(body.tenantId).toBe(fixture.a.tenant.id);
    expect(body.customerId).toBe(customer.id);
    expect(body.currency).toBe("PYG");
    expect(body.status).toBe("DRAFT");
    expect(body.lines).toHaveLength(2);

    for (const projection of body.lines) {
      expect(Object.keys(projection).sort()).toEqual([...SALE_LINE_RESPONSE_KEYS].sort());
    }

    const taxedLine = body.lines.find((row) => row.catalogItemId === taxed.id);
    expect(taxedLine?.rateCode).toBe("IVA_10");
    expect(taxedLine?.unitPrice).toBe("1000.00");
    expect(taxedLine?.quantity).toBe("1.000");
    expect(taxedLine?.lineTotal).toBe("1000.00");
    expect(taxedLine?.taxableBase).toBe("909.00");
    expect(taxedLine?.taxAmount).toBe("91.00");

    const exemptLine = body.lines.find((row) => row.catalogItemId === exempt.id);
    expect(exemptLine?.rateCode).toBe("EXEMPT");
    expect(exemptLine?.unitPrice).toBe("500.00");
    expect(exemptLine?.quantity).toBe("2.500");
    expect(exemptLine?.lineTotal).toBe("1250.00");
    expect(exemptLine?.taxableBase).toBe("1250.00");
    expect(exemptLine?.taxAmount).toBe("0.00");

    // The total is the sum of the line totals (no total column, DEC-021).
    expect(body.total).toBe("2250.00");

    expect(booted.db.tables.audits.size).toBe(auditsBefore + 1);
    const rows = auditsForTarget(booted, body.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("sale.created");
    expect(rows[0].targetType).toBe("sale");
    expect(rows[0].tenantId).toBe(fixture.a.tenant.id);
    expect(rows[0].metadata.schemaVersion).toBe(SALES_DTO_SCHEMA_VERSION);
    expect(changedFieldsOf(rows[0])).toEqual(["customerId", "currency", "lines"]);

    // Field NAMES only: no identifier or stored value reaches the trail.
    const serializedMeta = JSON.stringify(rows[0].metadata);
    expect(serializedMeta).not.toContain(taxed.id);
    expect(serializedMeta).not.toContain("1000.00");
    expect(serializedMeta).not.toContain(customer.id);
  });

  it("reconciles a DRAFT line set by catalog item: added, changed and removed lines", async () => {
    const kept = fixture.createItem(fixture.a, { referencePriceAmount: "100.00" });
    const removed = fixture.createItem(fixture.a);
    const added = fixture.createItem(fixture.a);

    const created = await supertest(booted.app.getHttpServer())
      .post("/sales")
      .set("Cookie", fixture.a.actor.cookie)
      .send(
        saleBody([
          line(kept.id, "1", { unitPrice: "100.00" }),
          line(removed.id, "1", { unitPrice: "200.00" }),
        ])
      )
      .expect(201);
    const createdBody = created.body as SaleDto;
    const keptLineId = createdBody.lines.find((row) => row.catalogItemId === kept.id)?.id;

    const auditsBefore = booted.db.tables.audits.size;
    const updated = await supertest(booted.app.getHttpServer())
      .put(`/sales/${createdBody.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send(
        saleBody([
          line(kept.id, "3", { unitPrice: "150.00" }),
          line(added.id, "1", { unitPrice: "50.00" }),
        ])
      )
      .expect(200);

    const body = updated.body as SaleDto;
    expect(body.lines).toHaveLength(2);
    const keptAfter = body.lines.find((row) => row.catalogItemId === kept.id);
    // A matched line is updated IN PLACE: its id is preserved.
    expect(keptAfter?.id).toBe(keptLineId);
    expect(keptAfter?.unitPrice).toBe("150.00");
    expect(keptAfter?.quantity).toBe("3.000");
    expect(body.lines.some((row) => row.catalogItemId === removed.id)).toBe(false);
    expect(body.lines.some((row) => row.catalogItemId === added.id)).toBe(true);

    expect(booted.db.tables.audits.size).toBe(auditsBefore + 1);
    const rows = auditsForTarget(booted, body.id).filter((row) => row.action === "sale.updated");
    expect(rows).toHaveLength(1);
    expect(rows[0].targetType).toBe("sale");
    expect(rows[0].metadata.schemaVersion).toBe(SALES_DTO_SCHEMA_VERSION);
    expect(changedFieldsOf(rows[0])).toEqual(["lines"]);
  });

  it("treats the customer as optional and clears it with an explicit null", async () => {
    const item = fixture.createItem(fixture.a, { referencePriceAmount: "100.00" });

    const walkIn = await supertest(booted.app.getHttpServer())
      .post("/sales")
      .set("Cookie", fixture.a.actor.cookie)
      .send(saleBody([line(item.id)]))
      .expect(201);
    expect((walkIn.body as SaleDto).customerId).toBeNull();

    const customer = fixture.createCustomer(fixture.a);
    const withCustomer = await supertest(booted.app.getHttpServer())
      .post("/sales")
      .set("Cookie", fixture.a.actor.cookie)
      .send(saleBody([line(item.id)], { customerId: customer.id }))
      .expect(201);
    expect((withCustomer.body as SaleDto).customerId).toBe(customer.id);

    const cleared = await supertest(booted.app.getHttpServer())
      .put(`/sales/${(withCustomer.body as SaleDto).id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send(saleBody([line(item.id)], { customerId: null }))
      .expect(200);
    expect((cleared.body as SaleDto).customerId).toBeNull();
  });

  it("masks an unknown and a foreign customer as a byte-equivalent 404 and persists nothing", async () => {
    const item = fixture.createItem(fixture.a, { referencePriceAmount: "100.00" });
    const foreignCustomer = fixture.createCustomer(fixture.b);
    const sizesBefore = tableSizes(booted.db);

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      method: "POST",
      nonexistentUrl: "/sales",
      foreignUrl: "/sales",
      body: saleBody([line(item.id)], { customerId: randomUUID() }),
      foreignBody: saleBody([line(item.id)], { customerId: foreignCustomer.id }),
      forbiddenIdentifiers: [foreignCustomer.id, fixture.b.tenant.id],
    });

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("cancels a DRAFT sale, keeps it readable and co-commits one audit row", async () => {
    const sale = fixture.seedSale(fixture.a);
    const auditsBefore = booted.db.tables.audits.size;

    const cancelled = await supertest(booted.app.getHttpServer())
      .post(`/sales/${sale.id}/cancel`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(201);
    expect((cancelled.body as SaleDto).status).toBe("CANCELLED");

    // Cancellation never deletes the sale or its lines.
    const read = await supertest(booted.app.getHttpServer())
      .get(`/sales/${sale.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const readBody = read.body as SaleDto;
    expect(readBody.status).toBe("CANCELLED");
    expect(readBody.lines).toHaveLength(1);

    expect(booted.db.tables.audits.size).toBe(auditsBefore + 1);
    const rows = auditsForTarget(booted, sale.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("sale.cancelled");
    expect(rows[0].targetType).toBe("sale");
    expect(changedFieldsOf(rows[0])).toEqual(["status"]);
  });

  it("rejects update and cancel of a non-DRAFT sale with the stable 409 and persists nothing", async () => {
    for (const status of ["COMPLETED", "CANCELLED"] as const) {
      const sale = fixture.seedSale(fixture.a, { status });
      const item = fixture.createItem(fixture.a, { referencePriceAmount: "100.00" });
      const sizesBefore = tableSizes(booted.db);

      const updateResponse = await supertest(booted.app.getHttpServer())
        .put(`/sales/${sale.id}`)
        .set("Cookie", fixture.a.actor.cookie)
        .send(saleBody([line(item.id)]))
        .expect(409);
      expect((updateResponse.body as ErrorDto).error.code).toBe("CONFLICT");
      expect((updateResponse.body as ErrorDto).error.message).toBe(SALE_NOT_EDITABLE_MESSAGE);

      const cancelResponse = await supertest(booted.app.getHttpServer())
        .post(`/sales/${sale.id}/cancel`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(409);
      expect((cancelResponse.body as ErrorDto).error.code).toBe("CONFLICT");
      expect((cancelResponse.body as ErrorDto).error.message).toBe(SALE_NOT_EDITABLE_MESSAGE);

      expect(tableSizes(booted.db)).toEqual(sizesBefore);
      expect(booted.db.tables.sales.get(sale.id)?.status).toBe(status);
      expect(auditsForTarget(booted, sale.id)).toHaveLength(0);
    }
  });

  it("rejects every invalid create body and persists nothing", async () => {
    const item = fixture.createItem(fixture.a, { referencePriceAmount: "100.00" });
    const sizesBefore = tableSizes(booted.db);

    const rejected: [string, Record<string, unknown>][] = [
      ["missing lines", {}],
      ["empty lines", saleBody([])],
      ["non-uuid item", saleBody([line("not-a-uuid")])],
      ["duplicate catalog item", saleBody([line(item.id), line(item.id)])],
      ["zero quantity", saleBody([line(item.id, "0")])],
      ["negative quantity", saleBody([line(item.id, "-1")])],
      ["float quantity", saleBody([line(item.id, 1.5)])],
      ["unknown key", saleBody([line(item.id)], { discount: "10" })],
      ["tenantId", saleBody([line(item.id)], { tenantId: randomUUID() })],
      ["status", saleBody([line(item.id)], { status: "COMPLETED" })],
      ["currency", saleBody([line(item.id)], { currency: "USD" })],
      ["total", saleBody([line(item.id)], { total: "0.00" })],
      ["number", saleBody([line(item.id)], { number: "S-1" })],
      ["discount percentage", saleBody([line(item.id)], { discountPercent: "5" })],
      ["line unknown key", saleBody([line(item.id, "1", { lineTotal: "1.00" })])],
    ];

    for (const [label, body] of rejected) {
      const response = await supertest(booted.app.getHttpServer())
        .post("/sales")
        .set("Cookie", fixture.a.actor.cookie)
        .send(body)
        .expect(400);
      expect((response.body as ErrorDto).error.code, label).toBe("VALIDATION_FAILED");
    }

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("rejects every invalid update body and list query and persists nothing", async () => {
    const sale = fixture.seedSale(fixture.a);
    const item = fixture.createItem(fixture.a, { referencePriceAmount: "100.00" });
    const sizesBefore = tableSizes(booted.db);

    const rejected: [string, Record<string, unknown>][] = [
      ["missing lines", {}],
      ["empty lines", saleBody([])],
      ["duplicate catalog item", saleBody([line(item.id), line(item.id)])],
      ["tenantId", saleBody([line(item.id)], { tenantId: randomUUID() })],
      ["status", saleBody([line(item.id)], { status: "CANCELLED" })],
      ["currency", saleBody([line(item.id)], { currency: "USD" })],
      ["total", saleBody([line(item.id)], { total: "0.00" })],
      ["discount", saleBody([line(item.id)], { discountAmount: "5.00" })],
    ];

    for (const [label, body] of rejected) {
      const response = await supertest(booted.app.getHttpServer())
        .put(`/sales/${sale.id}`)
        .set("Cookie", fixture.a.actor.cookie)
        .send(body)
        .expect(400);
      expect((response.body as ErrorDto).error.code, label).toBe("VALIDATION_FAILED");
    }

    // The list query is strict too: an unknown key or a bogus status is a 400.
    for (const query of ["?status=OPEN", "?tenantId=" + randomUUID()]) {
      const response = await supertest(booted.app.getHttpServer())
        .get(`/sales${query}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(400);
      expect((response.body as ErrorDto).error.code, query).toBe("VALIDATION_FAILED");
    }

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("computes tax-included PYG lines half-up at the minor unit and keeps base + tax === total", async () => {
    const taxed = fixture.createItem(fixture.a, {
      taxRateId: SEEDED_TAX_RATE_IDS.IVA_10,
      referencePriceAmount: "1100.00",
      referencePriceCurrency: "PYG",
    });
    const exempt = fixture.createItem(fixture.a, {
      taxRateId: SEEDED_TAX_RATE_IDS.EXEMPT,
      referencePriceAmount: "500.00",
      referencePriceCurrency: "PYG",
    });

    const response = await supertest(booted.app.getHttpServer())
      .post("/sales")
      .set("Cookie", fixture.a.actor.cookie)
      .send(saleBody([line(taxed.id, "1"), line(exempt.id, "1")]))
      .expect(201);

    const body = response.body as SaleDto;
    const taxedLine = body.lines.find((row) => row.catalogItemId === taxed.id);
    const exemptLine = body.lines.find((row) => row.catalogItemId === exempt.id);

    // PYG has zero minor units: 1100 / 1.1 = 1000 exactly.
    expect(taxedLine?.lineTotal).toBe("1100.00");
    expect(taxedLine?.taxableBase).toBe("1000.00");
    expect(taxedLine?.taxAmount).toBe("100.00");

    // A zero-rate EXEMPT line carries no tax: base === line total.
    expect(exemptLine?.taxableBase).toBe(exemptLine?.lineTotal);
    expect(exemptLine?.taxAmount).toBe("0.00");

    // Base + tax === line total EXACTLY, checked in integer minor units.
    for (const row of body.lines) {
      expect(minorUnits(row.taxableBase) + minorUnits(row.taxAmount)).toBe(
        minorUnits(row.lineTotal)
      );
    }
    expect(minorUnits(body.total)).toBe(
      body.lines.reduce((sum, row) => sum + minorUnits(row.lineTotal), 0n)
    );
  });

  it("applies the operator price override and can sell an item with no reference price", async () => {
    const priced = fixture.createItem(fixture.a, {
      taxRateId: SEEDED_TAX_RATE_IDS.EXEMPT,
      referencePriceAmount: "1000.00",
      referencePriceCurrency: "PYG",
    });
    const priceless = fixture.createItem(fixture.a, { taxRateId: SEEDED_TAX_RATE_IDS.EXEMPT });

    const overridden = await supertest(booted.app.getHttpServer())
      .post("/sales")
      .set("Cookie", fixture.a.actor.cookie)
      .send(saleBody([line(priced.id, "1", { unitPrice: "1200.00" })]))
      .expect(201);
    const overriddenLine = (overridden.body as SaleDto).lines[0];
    expect(overriddenLine.unitPrice).toBe("1200.00");
    expect(overriddenLine.lineTotal).toBe("1200.00");

    const manual = await supertest(booted.app.getHttpServer())
      .post("/sales")
      .set("Cookie", fixture.a.actor.cookie)
      .send(saleBody([line(priceless.id, "2", { unitPrice: "500.00" })]))
      .expect(201);
    const manualLine = (manual.body as SaleDto).lines[0];
    expect(manualLine.unitPrice).toBe("500.00");
    expect(manualLine.lineTotal).toBe("1000.00");

    // No override AND no usable reference price is the stable 400.
    const sizesBefore = tableSizes(booted.db);
    const missing = await supertest(booted.app.getHttpServer())
      .post("/sales")
      .set("Cookie", fixture.a.actor.cookie)
      .send(saleBody([line(priceless.id, "1")]))
      .expect(400);
    expect((missing.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
    expect((missing.body as ErrorDto).error.message).toBe(SALE_UNIT_PRICE_REQUIRED_MESSAGE);
    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("resolves the currency from the tenant setting and rejects a cross-currency item", async () => {
    const pygItem = fixture.createItem(fixture.a, {
      taxRateId: SEEDED_TAX_RATE_IDS.EXEMPT,
      referencePriceAmount: "100.00",
      referencePriceCurrency: "PYG",
    });

    const created = await supertest(booted.app.getHttpServer())
      .post("/sales")
      .set("Cookie", fixture.a.actor.cookie)
      .send(saleBody([line(pygItem.id)]))
      .expect(201);
    // The tenant setting (default PYG) is the ONLY currency source.
    expect((created.body as SaleDto).currency).toBe("PYG");

    const usdItem = fixture.createItem(fixture.a, {
      taxRateId: SEEDED_TAX_RATE_IDS.EXEMPT,
      referencePriceAmount: "100.00",
      referencePriceCurrency: "USD",
    });
    const sizesBefore = tableSizes(booted.db);
    const mismatched = await supertest(booted.app.getHttpServer())
      .post("/sales")
      .set("Cookie", fixture.a.actor.cookie)
      .send(saleBody([line(usdItem.id)]))
      .expect(400);
    expect((mismatched.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
    expect((mismatched.body as ErrorDto).error.message).toBe(SALE_CURRENCY_MISMATCH_MESSAGE);
    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("fails an unsupported tenant defaultCurrency with a stable 400 instead of mis-rounding", async () => {
    const item = fixture.createItem(fixture.unsupported, {
      taxRateId: SEEDED_TAX_RATE_IDS.EXEMPT,
      referencePriceAmount: "100.00",
      referencePriceCurrency: "USD",
    });
    const sizesBefore = tableSizes(booted.db);

    const response = await supertest(booted.app.getHttpServer())
      .post("/sales")
      .set("Cookie", fixture.unsupported.actor.cookie)
      .send(saleBody([line(item.id, "1", { unitPrice: "100.00" })]))
      .expect(400);
    expect((response.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
    expect((response.body as ErrorDto).error.message).toBe(SALE_UNSUPPORTED_CURRENCY_MESSAGE);
    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("rejects a line whose catalog item cannot resolve its tax rate", async () => {
    // The catalog reference makes this unrepresentable in real PostgreSQL; the
    // in-memory fake cannot enforce the FK, so the service rejects it first.
    const orphan = fixture.createItem(fixture.a, {
      taxRateId: randomUUID(),
      referencePriceAmount: "100.00",
      referencePriceCurrency: "PYG",
    });
    const sizesBefore = tableSizes(booted.db);

    const response = await supertest(booted.app.getHttpServer())
      .post("/sales")
      .set("Cookie", fixture.a.actor.cookie)
      .send(saleBody([line(orphan.id)]))
      .expect(400);
    expect((response.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
    expect((response.body as ErrorDto).error.message).toBe(SALE_TAX_RATE_NOT_FOUND_MESSAGE);
    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("lists the caller tenant's sales newest-first with an optional status filter", async () => {
    const first = fixture.seedSale(fixture.a);
    const second = fixture.seedSale(fixture.a, { status: "CANCELLED" });

    const all = await supertest(booted.app.getHttpServer())
      .get("/sales")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const ids = (all.body as SaleDto[]).map((row) => row.id);
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);

    const cancelled = await supertest(booted.app.getHttpServer())
      .get("/sales?status=CANCELLED")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    for (const row of cancelled.body as SaleDto[]) {
      expect(row.status).toBe("CANCELLED");
    }
  });

  it("masks a foreign sale as a byte-equivalent 404 on read, update and cancel", async () => {
    const foreign = fixture.seedSale(fixture.b);
    const item = fixture.createItem(fixture.a, { referencePriceAmount: "100.00" });
    const forbidden = [foreign.id, fixture.b.tenant.id];

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      nonexistentUrl: `/sales/${randomUUID()}`,
      foreignUrl: `/sales/${foreign.id}`,
      forbiddenIdentifiers: forbidden,
    });

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      method: "PUT",
      body: saleBody([line(item.id)]),
      nonexistentUrl: `/sales/${randomUUID()}`,
      foreignUrl: `/sales/${foreign.id}`,
      forbiddenIdentifiers: forbidden,
    });

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      method: "POST",
      nonexistentUrl: `/sales/${randomUUID()}/cancel`,
      foreignUrl: `/sales/${foreign.id}/cancel`,
      forbiddenIdentifiers: forbidden,
    });
  });

  it("returns the same shared 404 message for the sale resource in every verb", async () => {
    const item = fixture.createItem(fixture.a, { referencePriceAmount: "100.00" });
    const missingId = randomUUID();

    const getResponse = await supertest(booted.app.getHttpServer())
      .get(`/sales/${missingId}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(404);
    const putResponse = await supertest(booted.app.getHttpServer())
      .put(`/sales/${missingId}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send(saleBody([line(item.id)]))
      .expect(404);
    const cancelResponse = await supertest(booted.app.getHttpServer())
      .post(`/sales/${missingId}/cancel`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(404);

    for (const response of [getResponse, putResponse, cancelResponse]) {
      expect((response.body as ErrorDto).error.code).toBe("NOT_FOUND");
      expect((response.body as ErrorDto).error.message).toBe(SALE_NOT_FOUND_MESSAGE);
    }
    // The customer-reference constant is a distinct, stable message.
    expect(SALE_CUSTOMER_NOT_FOUND_MESSAGE).not.toBe(SALE_NOT_FOUND_MESSAGE);
  });

  it("exposes no PATCH or DELETE route anywhere on the sale surface", async () => {
    const sale = fixture.seedSale(fixture.a);
    const sizesBefore = tableSizes(booted.db);

    for (const [method, path] of [
      ["delete", `/sales/${sale.id}`],
      ["patch", `/sales/${sale.id}`],
      ["delete", "/sales"],
      ["patch", "/sales"],
    ] as const) {
      await supertest(booted.app.getHttpServer())
        [method](path)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(404);
    }

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
    expect(booted.db.tables.sales.has(sale.id)).toBe(true);
  });

  it("keeps the draft path INERT: no stock, balance, cash, payment or other row is created", async () => {
    const item = fixture.createItem(fixture.a, { referencePriceAmount: "1000.00" });
    const sizesBefore = tableSizes(booted.db);

    const created = await supertest(booted.app.getHttpServer())
      .post("/sales")
      .set("Cookie", fixture.a.actor.cookie)
      .send(saleBody([line(item.id, "5")]))
      .expect(201);
    const saleId = (created.body as SaleDto).id;

    await supertest(booted.app.getHttpServer())
      .put(`/sales/${saleId}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send(saleBody([line(item.id, "6")]))
      .expect(200);

    await supertest(booted.app.getHttpServer())
      .post(`/sales/${saleId}/cancel`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(201);

    const sizesAfter = tableSizes(booted.db);
    const changedTables = Object.keys(sizesAfter)
      .filter((name) => sizesAfter[name] !== sizesBefore[name])
      .sort();

    // The ONLY tables a draft operation may touch: the aggregate and its lines
    // plus the co-committed audit trail. No `stock_movement`, no
    // `stock_balance`, no cash row, no payment row and no invoice/fiscal row is
    // written by a DRAFT operation.
    expect(changedTables).toEqual(["audits", "saleLines", "sales"]);
    expect(sizesAfter.stockMovements).toBe(sizesBefore.stockMovements);
    expect(sizesAfter.stockBalances).toBe(sizesBefore.stockBalances);

    // No number is allocated either (DEC-027).
    const stored = booted.db.tables.sales.get(saleId);
    expect(stored && "number" in stored).toBe(false);
    expect(Object.keys(created.body as SaleDto)).not.toContain("number");
  });

  it("returns the stored line snapshot through the DTO without exposing a Prisma model", async () => {
    const sale = fixture.seedSale(fixture.a);
    const read = await supertest(booted.app.getHttpServer())
      .get(`/sales/${sale.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const body = read.body as SaleDto;
    const storedLines = booted.db.tables.saleLines;
    const lineIds = [...storedLines.values()]
      .filter((row: SaleLineRow) => row.saleId === sale.id)
      .map((row: SaleLineRow) => row.id);
    expect(body.lines.map((row) => row.id).sort()).toEqual(lineIds.sort());
    expect(Object.keys(body).sort()).toEqual([...SALE_RESPONSE_KEYS].sort());
  });
});
