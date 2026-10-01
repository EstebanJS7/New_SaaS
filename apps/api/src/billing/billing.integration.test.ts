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
  type SaleRow,
  type SaleStatusRow,
  type TenantRow,
} from "../../test/support/in-memory-database.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
} from "../../test/support/rbac-fixture.js";
import { RequestContextService } from "../context/request-context.service.js";
import { BILLING_PERMISSIONS } from "./billing.permissions.js";
import { BillingRepository, INVOICE_NOT_FOUND_MESSAGE } from "./billing.repository.js";
import {
  BILLING_FEATURE_NOT_ENTITLED_MESSAGE,
  INVOICE_CUSTOMER_REQUIRED_MESSAGE,
  INVOICE_LINE_DESCRIPTION_TOO_LONG_MESSAGE,
  INVOICE_SALE_ALREADY_INVOICED_MESSAGE,
  INVOICE_SALE_NOT_COMPLETED_MESSAGE,
} from "./billing.service.js";
import { BILLING_DTO_SCHEMA_VERSION } from "./billing.zod.js";

interface InvoiceLineDto {
  id: string;
  catalogItemId: string;
  position: number;
  description: string;
  rateCode: string;
  unitPrice: string;
  quantity: string;
  lineTotal: string;
  taxableBase: string;
  taxAmount: string;
}

interface InvoiceDto {
  id: string;
  saleId: string;
  customerId: string | null;
  currency: string;
  status: string;
  series: string;
  number: number | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lines: InvoiceLineDto[];
  total: string;
  taxTotal: string;
  createdAt: string;
  updatedAt: string;
}

interface ErrorDto {
  error: { code: string; message: string };
}

/** Exact allowlisted key set — any extra key fails these assertions. */
const INVOICE_RESPONSE_KEYS: readonly string[] = [
  "id",
  "saleId",
  "customerId",
  "currency",
  "status",
  "series",
  "number",
  "confirmedAt",
  "cancelledAt",
  "cancelReason",
  "lines",
  "total",
  "taxTotal",
  "createdAt",
  "updatedAt",
];

const INVOICE_LINE_RESPONSE_KEYS: readonly string[] = [
  "id",
  "catalogItemId",
  "position",
  "description",
  "rateCode",
  "unitPrice",
  "quantity",
  "lineTotal",
  "taxableBase",
  "taxAmount",
];

/** The full billing matrix an owning role holds; the read-only actor holds one key. */
const ALL_BILLING_PERMISSIONS: readonly string[] = [
  BILLING_PERMISSIONS.read,
  BILLING_PERMISSIONS.create,
  BILLING_PERMISSIONS.confirm,
  BILLING_PERMISSIONS.cancel,
];

interface BillingTenant {
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

interface BillingHttpFixture {
  /** Probing tenant holding the FULL `billing.*` matrix and the entitlement. */
  a: BillingTenant;
  /** Foreign tenant holding the full matrix; owns the rows A must not touch. */
  b: BillingTenant;
  /** Permissioned tenant WITHOUT the `billing` entitlement (FEATURE_NOT_ENTITLED). */
  c: BillingTenant;
  /** Entitled tenant whose `sales.requireCustomerForInvoice` is `true`. */
  requiresCustomer: BillingTenant;
  /** Member of A whose role has NO billing permission (403 probe). */
  noPermission: RbacActor;
  /** Member of A with `billing.read` only: the create route is a 403. */
  readOnly: RbacActor;
  createItem(
    owner: BillingTenant,
    overrides?: { name?: string; taxRateId?: string }
  ): CatalogItemRow;
  createCustomer(owner: BillingTenant): CustomerRow;
  /** Fresh sale (with lines) in the given tenant; call per test for isolation. */
  seedSale(owner: BillingTenant, options?: SeedSaleOptions): SaleRow;
}

/**
 * Seeds three isolated tenants (A probe / B foreign / C entitlement-negative)
 * plus a fourth that requires a customer before invoicing, a permission-negative
 * actor and a read-only actor in tenant A, plus catalog-item, customer and sale
 * factories. Every factory runs INSIDE its `it`, so no test depends on an id
 * minted by an earlier test.
 */
function seedBillingHttp(db: IsolationDatabase): BillingHttpFixture {
  const suffix = randomUUID().slice(0, 8);
  const billingFeature = db.prisma.featureCode.create({ data: { code: "billing" } });

  function seedTenant(
    letter: string,
    options: { entitled: boolean; keys: readonly string[] }
  ): BillingTenant {
    const label = letter.toUpperCase();
    const tenant = db.prisma.tenant.create({
      data: { slug: `billing-${letter}-${suffix}`, name: `Billing ${label}` },
    });
    const role = seedRoleWithKeys(db, `BILLING_${label}_${suffix}`, `Billing ${label} (fixture)`, [
      ...options.keys,
    ]);
    const actor = seedRbacActor(db, {
      email: `billing-${letter}-${suffix}@isolation.test`,
      tenantId: tenant.id,
      roleId: role.role.id,
    });
    if (options.entitled) {
      db.prisma.tenantEntitlement.create({
        data: { tenantId: tenant.id, featureCodeId: billingFeature.id },
      });
    }
    return { tenant, actor };
  }

  const a = seedTenant("a", { entitled: true, keys: ALL_BILLING_PERMISSIONS });
  const b = seedTenant("b", { entitled: true, keys: ALL_BILLING_PERMISSIONS });
  const c = seedTenant("c", { entitled: false, keys: ALL_BILLING_PERMISSIONS });
  const requiresCustomer = seedTenant("d", { entitled: true, keys: ALL_BILLING_PERMISSIONS });

  // The typed `sales` namespace is the FIRST consumer of the gate here
  // (DEC-038): the invoice create must read it through TenantSettingsService.
  db.prisma.tenantSettingNamespace.upsert({
    where: {
      tenantId_namespace: { tenantId: requiresCustomer.tenant.id, namespace: "sales" },
    },
    create: {
      tenantId: requiresCustomer.tenant.id,
      namespace: "sales",
      schemaVersion: 1,
      data: { defaultCurrency: "PYG", requireCustomerForInvoice: true },
    },
    update: {
      schemaVersion: 1,
      data: { defaultCurrency: "PYG", requireCustomerForInvoice: true },
    },
  });

  const noPermissionRole = seedRoleWithKeys(db, `BILLING_NONE_${suffix}`, "Billing none", []);
  const noPermission = seedRbacActor(db, {
    email: `billing-none-${suffix}@isolation.test`,
    tenantId: a.tenant.id,
    roleId: noPermissionRole.role.id,
  });

  const readOnlyRole = seedRoleWithKeys(db, `BILLING_READ_${suffix}`, "Billing read only", [
    BILLING_PERMISSIONS.read,
  ]);
  const readOnly = seedRbacActor(db, {
    email: `billing-read-${suffix}@isolation.test`,
    tenantId: a.tenant.id,
    roleId: readOnlyRole.role.id,
  });

  const createItem: BillingHttpFixture["createItem"] = (owner, overrides = {}) =>
    db.prisma.catalogItem.create({
      data: {
        tenantId: owner.tenant.id,
        kind: "SUPPLY",
        name: overrides.name ?? `Item ${randomUUID().slice(0, 8)}`,
        taxRateId: overrides.taxRateId ?? SEEDED_TAX_RATE_IDS.EXEMPT,
        referencePriceAmount: null,
        referencePriceCurrency: null,
        isActive: true,
      },
    });

  const createCustomer: BillingHttpFixture["createCustomer"] = (owner) =>
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

  const seedSale: BillingHttpFixture["seedSale"] = (owner, options = {}) => {
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
        status: options.status ?? "COMPLETED",
        lines: { create: lines },
      },
    });
  };

  return {
    a,
    b,
    c,
    requiresCustomer,
    noPermission,
    readOnly,
    createItem,
    createCustomer,
    seedSale,
  };
}

/** Every audit row targeting one invoice — the per-mutation row count. */
function auditsForTarget(booted: BootedTestApp, targetId: string): AuditLogRow[] {
  return [...booted.db.tables.audits.values()].filter((row) => row.targetId === targetId);
}

function changedFieldsOf(row: AuditLogRow): unknown[] | undefined {
  const value = row.metadata.changedFields;
  return Array.isArray(value) ? value : undefined;
}

/** Row count of every in-memory table — the "did this rejection persist anything?" probe. */
function tableSizes(db: IsolationDatabase): Record<string, number> {
  return Object.fromEntries(Object.entries(db.tables).map(([name, table]) => [name, table.size]));
}

/** A fixed-scale money literal: exactly two decimals, never a float. */
const MONEY_LITERAL = /^\d+\.\d{2}$/;
/** A fixed-scale quantity literal: exactly three decimals, never a float. */
const QUANTITY_LITERAL = /^\d+\.\d{3}$/;

describe("Billing HTTP boundary — invoice creation (EPIC-14 BILL-002)", () => {
  let booted: BootedTestApp;
  let fixture: BillingHttpFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedBillingHttp(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  it("requires billing.create and the billing entitlement, persisting nothing when denied", async () => {
    const sale = fixture.seedSale(fixture.a);
    const sizesBefore = tableSizes(booted.db);

    // A member without `billing.create` is denied by the guard chain.
    const forbidden = await supertest(booted.app.getHttpServer())
      .post("/invoices")
      .set("Cookie", fixture.readOnly.cookie)
      .send({ saleId: sale.id })
      .expect(403);
    expect((forbidden.body as ErrorDto).error.code).toBe("FORBIDDEN");

    const ungranted = await supertest(booted.app.getHttpServer())
      .post("/invoices")
      .set("Cookie", fixture.noPermission.cookie)
      .send({ saleId: sale.id })
      .expect(403);
    expect((ungranted.body as ErrorDto).error.code).toBe("FORBIDDEN");

    // A tenant with every key but no `billing` entitlement is gated FIRST.
    const unentitled = await supertest(booted.app.getHttpServer())
      .post("/invoices")
      .set("Cookie", fixture.c.actor.cookie)
      .send({ saleId: sale.id })
      .expect(403);
    expect((unentitled.body as ErrorDto).error.code).toBe("FEATURE_NOT_ENTITLED");
    expect((unentitled.body as ErrorDto).error.message).toBe(BILLING_FEATURE_NOT_ENTITLED_MESSAGE);

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("creates a DRAFT invoice copying the frozen sale lines verbatim, with no number and series A", async () => {
    const taxed = fixture.createItem(fixture.a, { taxRateId: SEEDED_TAX_RATE_IDS.IVA_10 });
    const exempt = fixture.createItem(fixture.a);
    const customer = fixture.createCustomer(fixture.a);
    const sale = fixture.seedSale(fixture.a, {
      customerId: customer.id,
      lines: [
        {
          catalogItemId: taxed.id,
          rateCode: "IVA_10",
          unitPrice: "1000.00",
          quantity: "1.000",
          lineTotal: "1000.00",
          taxableBase: "909.00",
          taxAmount: "91.00",
        },
        {
          catalogItemId: exempt.id,
          rateCode: "EXEMPT",
          unitPrice: "500.00",
          quantity: "2.500",
          lineTotal: "1250.00",
          taxableBase: "1250.00",
          taxAmount: "0.00",
        },
      ],
    });
    const auditsBefore = booted.db.tables.audits.size;

    const response = await supertest(booted.app.getHttpServer())
      .post("/invoices")
      .set("Cookie", fixture.a.actor.cookie)
      .send({ saleId: sale.id })
      .expect(201);

    const body = response.body as InvoiceDto;
    // The allowlisted DTO carries NO `tenantId` key (the cash precedent).
    expect(Object.keys(body).sort()).toEqual([...INVOICE_RESPONSE_KEYS].sort());
    expect("tenantId" in body).toBe(false);

    expect(body.saleId).toBe(sale.id);
    expect(body.customerId).toBe(customer.id);
    expect(body.currency).toBe("PYG");
    expect(body.status).toBe("DRAFT");
    expect(body.series).toBe("A");
    // Creation writes NO number: allocation belongs to confirmation (DEC-039).
    expect(body.number).toBeNull();
    expect(body.confirmedAt).toBeNull();
    expect(body.cancelledAt).toBeNull();
    expect(body.cancelReason).toBeNull();
    expect(body.lines).toHaveLength(2);

    // The lines copy the frozen SaleLine values VERBATIM, in 0-based position
    // order, and `description` is the source catalog item's name.
    const itemNames = new Map([
      [taxed.id, taxed.name],
      [exempt.id, exempt.name],
    ]);
    body.lines.forEach((line, index) => {
      expect(Object.keys(line).sort()).toEqual([...INVOICE_LINE_RESPONSE_KEYS].sort());
      expect(line.position).toBe(index);

      const source = sale.lines.find((row) => row.catalogItemId === line.catalogItemId);
      expect(source, `no frozen sale line for ${line.catalogItemId}`).toBeDefined();
      expect(line.rateCode).toBe(source?.rateCode);
      expect(line.unitPrice).toBe(source?.unitPrice);
      expect(line.quantity).toBe(source?.quantity);
      expect(line.lineTotal).toBe(source?.lineTotal);
      expect(line.taxableBase).toBe(source?.taxableBase);
      expect(line.taxAmount).toBe(source?.taxAmount);
      expect(line.description).toBe(itemNames.get(line.catalogItemId));

      // Exact fixed-scale literals, never floats.
      expect(line.unitPrice).toMatch(MONEY_LITERAL);
      expect(line.quantity).toMatch(QUANTITY_LITERAL);
      expect(line.lineTotal).toMatch(MONEY_LITERAL);
      expect(line.taxableBase).toMatch(MONEY_LITERAL);
      expect(line.taxAmount).toMatch(MONEY_LITERAL);
    });

    // `total` and `taxTotal` are projections of the invoice's OWN frozen lines.
    expect(body.total).toBe("2250.00");
    expect(body.taxTotal).toBe("91.00");
    expect(body.total).toMatch(MONEY_LITERAL);
    expect(body.taxTotal).toMatch(MONEY_LITERAL);

    // The stored row is a DRAFT with the database-default series and no number.
    const stored = booted.db.tables.invoices.get(body.id);
    expect(stored?.status).toBe("DRAFT");
    expect(stored?.series).toBe("A");
    expect(stored?.number).toBeNull();
    expect(booted.db.tables.invoiceLines.size).toBeGreaterThanOrEqual(2);

    // Exactly ONE audit row, co-committed, carrying field NAMES only.
    expect(booted.db.tables.audits.size).toBe(auditsBefore + 1);
    const rows = auditsForTarget(booted, body.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("invoice.created");
    expect(rows[0].targetType).toBe("invoice");
    expect(rows[0].tenantId).toBe(fixture.a.tenant.id);
    expect(rows[0].actorUserProfileId).toBe(fixture.a.actor.profile.id);
    expect(rows[0].metadata.schemaVersion).toBe(BILLING_DTO_SCHEMA_VERSION);
    expect(changedFieldsOf(rows[0])).toEqual(["saleId", "customerId", "currency", "lines"]);

    const serializedMeta = JSON.stringify(rows[0].metadata);
    expect(serializedMeta).not.toContain(sale.id);
    expect(serializedMeta).not.toContain(customer.id);
    expect(serializedMeta).not.toContain(taxed.name);
    expect(serializedMeta).not.toContain("1000.00");
  });

  it("rejects an over-long line description without truncating and persists nothing", async () => {
    const tooLong = fixture.createItem(fixture.a, { name: "n".repeat(201) });
    const sale = fixture.seedSale(fixture.a, {
      lines: [
        {
          catalogItemId: tooLong.id,
          rateCode: "EXEMPT",
          unitPrice: "1000.00",
          quantity: "1.000",
          lineTotal: "1000.00",
          taxableBase: "1000.00",
          taxAmount: "0.00",
        },
      ],
    });
    const sizesBefore = tableSizes(booted.db);

    const response = await supertest(booted.app.getHttpServer())
      .post("/invoices")
      .set("Cookie", fixture.a.actor.cookie)
      .send({ saleId: sale.id })
      .expect(409);

    expect((response.body as ErrorDto).error.code).toBe("CONFLICT");
    expect((response.body as ErrorDto).error.message).toBe(
      INVOICE_LINE_DESCRIPTION_TOO_LONG_MESSAGE
    );
    expect(tableSizes(booted.db)).toEqual(sizesBefore);

    // A description of exactly the column width is still admitted.
    const exact = fixture.createItem(fixture.a, { name: "n".repeat(200) });
    const exactSale = fixture.seedSale(fixture.a, {
      lines: [
        {
          catalogItemId: exact.id,
          rateCode: "EXEMPT",
          unitPrice: "1000.00",
          quantity: "1.000",
          lineTotal: "1000.00",
          taxableBase: "1000.00",
          taxAmount: "0.00",
        },
      ],
    });
    const admitted = await supertest(booted.app.getHttpServer())
      .post("/invoices")
      .set("Cookie", fixture.a.actor.cookie)
      .send({ saleId: exactSale.id })
      .expect(201);
    expect((admitted.body as InvoiceDto).lines[0].description).toHaveLength(200);
  });

  it("masks an unknown and a foreign sale as a byte-equivalent 404 and persists nothing", async () => {
    const foreignSale = fixture.seedSale(fixture.b);
    const sizesBefore = tableSizes(booted.db);

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      method: "POST",
      nonexistentUrl: "/invoices",
      foreignUrl: "/invoices",
      body: { saleId: randomUUID() },
      foreignBody: { saleId: foreignSale.id },
      forbiddenIdentifiers: [foreignSale.id, fixture.b.tenant.id],
    });

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
    // The shared sale 404 is the sale surface's OWN message, byte-identical.
    const probe = await supertest(booted.app.getHttpServer())
      .post("/invoices")
      .set("Cookie", fixture.a.actor.cookie)
      .send({ saleId: foreignSale.id })
      .expect(404);
    expect((probe.body as ErrorDto).error.message).toBe("Sale was not found.");
  });

  it("rejects a DRAFT and a CANCELLED sale as the stable 409 and persists nothing", async () => {
    const draft = fixture.seedSale(fixture.a, { status: "DRAFT" });
    const cancelled = fixture.seedSale(fixture.a, { status: "CANCELLED" });
    const sizesBefore = tableSizes(booted.db);

    for (const sale of [draft, cancelled]) {
      const response = await supertest(booted.app.getHttpServer())
        .post("/invoices")
        .set("Cookie", fixture.a.actor.cookie)
        .send({ saleId: sale.id })
        .expect(409);
      expect((response.body as ErrorDto).error.code).toBe("CONFLICT");
      expect((response.body as ErrorDto).error.message).toBe(INVOICE_SALE_NOT_COMPLETED_MESSAGE);
    }

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("admits one live invoice per sale, rejects a second, and frees the sale after cancellation", async () => {
    const item = fixture.createItem(fixture.a);
    const sale = fixture.seedSale(fixture.a, {
      lines: [
        {
          catalogItemId: item.id,
          rateCode: "EXEMPT",
          unitPrice: "1000.00",
          quantity: "1.000",
          lineTotal: "1000.00",
          taxableBase: "1000.00",
          taxAmount: "0.00",
        },
      ],
    });

    await supertest(booted.app.getHttpServer())
      .post("/invoices")
      .set("Cookie", fixture.a.actor.cookie)
      .send({ saleId: sale.id })
      .expect(201);

    const sizesBefore = tableSizes(booted.db);
    const conflict = await supertest(booted.app.getHttpServer())
      .post("/invoices")
      .set("Cookie", fixture.a.actor.cookie)
      .send({ saleId: sale.id })
      .expect(409);
    expect((conflict.body as ErrorDto).error.code).toBe("CONFLICT");
    expect((conflict.body as ErrorDto).error.message).toBe(INVOICE_SALE_ALREADY_INVOICED_MESSAGE);
    // No residue: the refused second creation wrote nothing at all.
    expect(tableSizes(booted.db)).toEqual(sizesBefore);

    // A CANCELLED invoice falls outside the PARTIAL unique index, so its sale
    // is admitted again as a corrected replacement (DEC-043).
    const releasedSale = fixture.seedSale(fixture.a);
    booted.db.prisma.invoice.create({
      data: {
        tenantId: fixture.a.tenant.id,
        saleId: releasedSale.id,
        customerId: null,
        currency: "PYG",
        status: "CANCELLED",
        series: "A",
        number: null,
        cancelledAt: new Date(),
        cancelReason: "Corrected",
        lines: { create: [] },
      },
    });

    const replacement = await supertest(booted.app.getHttpServer())
      .post("/invoices")
      .set("Cookie", fixture.a.actor.cookie)
      .send({ saleId: releasedSale.id })
      .expect(201);
    expect((replacement.body as InvoiceDto).status).toBe("DRAFT");
    const invoicesForSale = [...booted.db.tables.invoices.values()].filter(
      (row) => row.saleId === releasedSale.id
    );
    expect(invoicesForSale).toHaveLength(2);
  });

  it("gates a walk-in sale on the typed sales.requireCustomerForInvoice setting", async () => {
    // Tenant A has no stored namespace: the registry default (`false`) applies.
    const defaultSale = fixture.seedSale(fixture.a, { customerId: null });
    const defaulted = await supertest(booted.app.getHttpServer())
      .post("/invoices")
      .set("Cookie", fixture.a.actor.cookie)
      .send({ saleId: defaultSale.id })
      .expect(201);
    expect((defaulted.body as InvoiceDto).customerId).toBeNull();

    // Tenant D requires a customer; a walk-in sale is the stable 409.
    const walkIn = fixture.seedSale(fixture.requiresCustomer, { customerId: null });
    const sizesBefore = tableSizes(booted.db);
    const rejected = await supertest(booted.app.getHttpServer())
      .post("/invoices")
      .set("Cookie", fixture.requiresCustomer.actor.cookie)
      .send({ saleId: walkIn.id })
      .expect(409);
    expect((rejected.body as ErrorDto).error.code).toBe("CONFLICT");
    expect((rejected.body as ErrorDto).error.message).toBe(INVOICE_CUSTOMER_REQUIRED_MESSAGE);
    expect(tableSizes(booted.db)).toEqual(sizesBefore);

    // …and the same tenant invoices a sale that does carry a customer.
    const customer = fixture.createCustomer(fixture.requiresCustomer);
    const withCustomer = fixture.seedSale(fixture.requiresCustomer, { customerId: customer.id });
    const admitted = await supertest(booted.app.getHttpServer())
      .post("/invoices")
      .set("Cookie", fixture.requiresCustomer.actor.cookie)
      .send({ saleId: withCustomer.id })
      .expect(201);
    expect((admitted.body as InvoiceDto).customerId).toBe(customer.id);
  });

  it("rejects every invalid create body and persists nothing", async () => {
    const sale = fixture.seedSale(fixture.a);
    const sizesBefore = tableSizes(booted.db);

    for (const body of [
      {},
      { saleId: "not-a-uuid" },
      { saleId: sale.id, tenantId: fixture.a.tenant.id },
      { saleId: sale.id, status: "CONFIRMED" },
      { saleId: sale.id, lines: [] },
    ]) {
      const response = await supertest(booted.app.getHttpServer())
        .post("/invoices")
        .set("Cookie", fixture.a.actor.cookie)
        .send(body)
        .expect(400);
      expect((response.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
    }

    // `tenantId` is never accepted from the body, so it can never re-scope.
    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("exposes no read, PATCH or DELETE route on this slice's invoice surface", async () => {
    const sale = fixture.seedSale(fixture.a);
    const created = await supertest(booted.app.getHttpServer())
      .post("/invoices")
      .set("Cookie", fixture.a.actor.cookie)
      .send({ saleId: sale.id })
      .expect(201);
    const invoiceId = (created.body as InvoiceDto).id;
    const sizesBefore = tableSizes(booted.db);

    for (const [method, path] of [
      ["get", "/invoices"],
      ["get", `/invoices/${invoiceId}`],
      ["patch", `/invoices/${invoiceId}`],
      ["delete", `/invoices/${invoiceId}`],
      ["patch", "/invoices"],
      ["delete", "/invoices"],
    ] as const) {
      await supertest(booted.app.getHttpServer())
        [method](path)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(404);
    }

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("returns the shared invoice 404 message from the repository constant", () => {
    // Byte-equivalence by construction: one constant backs every invoice 404.
    expect(INVOICE_NOT_FOUND_MESSAGE).toBe("Invoice was not found.");
  });
});

/**
 * The repository read the W3 routes will use is exercised here through its REAL
 * caller, because a fake capability can only be called faithful once the code
 * that depends on it exists (the R3-1 advisory). This proves the in-memory
 * `invoice.findFirst` honours the tenant predicate and the position-ordered
 * `lines` include the repository actually asks for, and that the ONE shared
 * invoice 404 message masks a foreign id exactly like an unknown one.
 */
describe("Billing repository — tenant-scoped invoice read (R3-1 fidelity)", () => {
  let booted: BootedTestApp;
  let fixture: BillingHttpFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedBillingHttp(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  it("reads one in-tenant invoice with its lines in position order and masks a foreign id", async () => {
    const ownItem = fixture.createItem(fixture.a);
    const ownSale = fixture.seedSale(fixture.a);

    // Lines inserted OUT of position order: the read must still return the
    // document's frozen reading order, not the relation's insertion order.
    const stored = booted.db.prisma.invoice.create({
      data: {
        tenantId: fixture.a.tenant.id,
        saleId: ownSale.id,
        customerId: null,
        currency: "PYG",
        lines: {
          create: [
            {
              catalogItemId: ownItem.id,
              position: 2,
              description: "third",
              rateCode: "EXEMPT",
              unitPrice: "3.00",
              quantity: "1.000",
              lineTotal: "3.00",
              taxableBase: "3.00",
              taxAmount: "0.00",
            },
            {
              catalogItemId: ownItem.id,
              position: 0,
              description: "first",
              rateCode: "EXEMPT",
              unitPrice: "1.00",
              quantity: "1.000",
              lineTotal: "1.00",
              taxableBase: "1.00",
              taxAmount: "0.00",
            },
            {
              catalogItemId: ownItem.id,
              position: 1,
              description: "second",
              rateCode: "EXEMPT",
              unitPrice: "2.00",
              quantity: "1.000",
              lineTotal: "2.00",
              taxableBase: "2.00",
              taxAmount: "0.00",
            },
          ],
        },
      },
    });
    const foreignSale = fixture.seedSale(fixture.b);
    const foreign = booted.db.prisma.invoice.create({
      data: {
        tenantId: fixture.b.tenant.id,
        saleId: foreignSale.id,
        customerId: null,
        currency: "PYG",
        lines: { create: [] },
      },
    });

    const repository = booted.app.get(BillingRepository);
    const context = booted.app.get(RequestContextService);

    await context.run("billing-repository-read", async () => {
      context.setTenantMembership({
        tenantId: fixture.a.tenant.id,
        membershipId: randomUUID(),
        roleId: randomUUID(),
        roleCode: "OWNER",
      });

      const row = await repository.findById(stored.id);
      expect(row.lines.map((line) => line.position)).toEqual([0, 1, 2]);
      expect(row.lines.map((line) => line.description)).toEqual(["first", "second", "third"]);

      // A FOREIGN invoice is masked with the SAME message as an unknown one.
      await expect(repository.findById(foreign.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: INVOICE_NOT_FOUND_MESSAGE,
      });
      await expect(repository.findById(randomUUID())).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: INVOICE_NOT_FOUND_MESSAGE,
      });
    });
  });

  it("refuses an unscoped invoice header read instead of answering across tenants", () => {
    // The fake fails loudly rather than silently returning a foreign row for a
    // predicate that omitted the tenant — a tenant-isolation defect an
    // integration suite must never mirror.
    expect(() => booted.db.prisma.invoice.findFirst({ where: { status: "DRAFT" } })).toThrow(
      /tenantId predicate/
    );
  });
});
