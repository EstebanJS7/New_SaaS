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
  INVOICE_NOT_DRAFT_MESSAGE,
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

  it("exposes no PATCH, PUT or DELETE route on this slice's invoice surface", async () => {
    const sale = fixture.seedSale(fixture.a);
    const created = await supertest(booted.app.getHttpServer())
      .post("/invoices")
      .set("Cookie", fixture.a.actor.cookie)
      .send({ saleId: sale.id })
      .expect(201);
    const invoiceId = (created.body as InvoiceDto).id;
    const sizesBefore = tableSizes(booted.db);

    // W3 ships the two GET reads; the immutability fence is everything that
    // MUTATES an existing document, plus every generic status route.
    await supertest(booted.app.getHttpServer())
      .get("/invoices")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    await supertest(booted.app.getHttpServer())
      .get(`/invoices/${invoiceId}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    // BILL-003 ships the confirm and cancel transitions, so BOTH are now REAL
    // routes proven by their own suites. The immutability fence is everything
    // that still MUTATES an existing document without a dedicated command, plus
    // every generic status route.
    for (const [method, path] of [
      ["patch", `/invoices/${invoiceId}`],
      ["put", `/invoices/${invoiceId}`],
      ["delete", `/invoices/${invoiceId}`],
      ["patch", "/invoices"],
      ["put", "/invoices"],
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
 * The repository seams the BILL-003 commands use are exercised here through
 * their REAL caller shape, because a fake capability can only be called faithful
 * once the code that depends on it exists (the R3-1 advisory). This proves the
 * in-memory `invoice.findFirst` honours the tenant predicate and the
 * position-ordered `lines` include the repository actually asks for, that the
 * ONE shared invoice 404 message masks a foreign id exactly like an unknown one,
 * and that `markCancelled`'s conditional `DRAFT`-or-`CONFIRMED` write returns an
 * affected count (with `0` for a terminal, foreign or unknown id) while writing
 * only the cancellation columns.
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

  it("applies the DRAFT-or-CONFIRMED cancellation gate as an affected count and retains number/confirmedAt", async () => {
    const draftSale = fixture.seedSale(fixture.a);
    const draft = booted.db.prisma.invoice.create({
      data: {
        tenantId: fixture.a.tenant.id,
        saleId: draftSale.id,
        customerId: null,
        currency: "PYG",
        lines: { create: [] },
      },
    });
    // A CONFIRMED row with an allocated number and an original confirmation
    // timestamp: the cancellation must retain BOTH verbatim (DEC-039, DEC-043).
    const confirmedSale = fixture.seedSale(fixture.a);
    const confirmed = booted.db.prisma.invoice.create({
      data: {
        tenantId: fixture.a.tenant.id,
        saleId: confirmedSale.id,
        customerId: null,
        currency: "PYG",
        status: "CONFIRMED",
        series: "A",
        number: 7,
        confirmedAt: new Date("2099-01-01T00:00:00.000Z"),
        lines: { create: [] },
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

    await context.run("billing-repository-cancel", async () => {
      context.setTenantMembership({
        tenantId: fixture.a.tenant.id,
        membershipId: randomUUID(),
        roleId: randomUUID(),
        roleCode: "OWNER",
      });

      // The conditional write affects exactly ONE admissible row and writes the
      // terminal status, the timestamp and the reason — nothing else.
      expect(await repository.markCancelled(confirmed.id, "Issued by mistake")).toBe(1);
      const cancelledConfirmed = booted.db.tables.invoices.get(confirmed.id);
      expect(cancelledConfirmed?.status).toBe("CANCELLED");
      expect(cancelledConfirmed?.cancelReason).toBe("Issued by mistake");
      expect(cancelledConfirmed?.cancelledAt).not.toBeNull();
      // The allocated number and the ORIGINAL confirmation timestamp are kept.
      expect(cancelledConfirmed?.number).toBe(7);
      expect(cancelledConfirmed?.confirmedAt?.toISOString()).toBe("2099-01-01T00:00:00.000Z");

      // A DRAFT needs no number and acquires none.
      expect(await repository.markCancelled(draft.id, "Mistaken customer")).toBe(1);
      expect(booted.db.tables.invoices.get(draft.id)?.status).toBe("CANCELLED");
      expect(booted.db.tables.invoices.get(draft.id)?.number).toBeNull();

      // A terminal `CANCELLED` row is OUTSIDE the gate: ZERO affected rows, which
      // is the lost-race backstop the service maps to the stable `409`.
      expect(await repository.markCancelled(confirmed.id, "Second attempt")).toBe(0);
      expect(booted.db.tables.invoices.get(confirmed.id)?.cancelReason).toBe("Issued by mistake");

      // A FOREIGN id affects ZERO rows: the tenant predicate rides in the write.
      expect(await repository.markCancelled(foreign.id, "Cross-tenant")).toBe(0);
      expect(booted.db.tables.invoices.get(foreign.id)?.status).toBe("DRAFT");
      expect(await repository.markCancelled(randomUUID(), "Unknown")).toBe(0);
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

/**
 * The W3 read surface over the REAL HTTP boundary: the filtered list and the id
 * read, both behind the `billing` entitlement and `billing.read`, with the
 * tenant predicate applied to every query. The ordering, the filter and the
 * cross-tenant mask are asserted here; the live-PostgreSQL block owns the
 * applied-DDL and durable-state evidence.
 */
describe("Billing HTTP boundary — invoice reads (EPIC-14 BILL-002 W3)", () => {
  let booted: BootedTestApp;
  let fixture: BillingHttpFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedBillingHttp(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  /**
   * Pins a stored invoice's `createdAt` (the in-memory `invoice.create` always
   * stamps "now") so the newest-first assertion has a known answer instead of
   * depending on wall-clock ordering between two HTTP calls.
   */
  function pinCreatedAt(invoiceId: string, iso: string): void {
    const row = booted.db.tables.invoices.get(invoiceId);
    if (!row) {
      throw new Error(`stored invoice ${invoiceId} not found`);
    }
    row.createdAt = new Date(iso);
  }

  const postInvoice = (cookie: string, saleId: string) =>
    supertest(booted.app.getHttpServer()).post("/invoices").set("Cookie", cookie).send({ saleId });

  const getInvoices = (cookie: string, query = "") =>
    supertest(booted.app.getHttpServer()).get(`/invoices${query}`).set("Cookie", cookie);

  const getInvoice = (cookie: string, id: string) =>
    supertest(booted.app.getHttpServer()).get(`/invoices/${id}`).set("Cookie", cookie);

  it("lists the tenant's invoices newest-first and honours the status filter in both directions", async () => {
    const first = (
      await postInvoice(fixture.a.actor.cookie, fixture.seedSale(fixture.a).id).expect(201)
    ).body as InvoiceDto;
    const second = (
      await postInvoice(fixture.a.actor.cookie, fixture.seedSale(fixture.a).id).expect(201)
    ).body as InvoiceDto;
    // Far-future stamps: the two drafts head the list whatever else this
    // describe's other cases stored, and their relative order is known.
    pinCreatedAt(first.id, "2100-01-01T00:00:00.000Z");
    pinCreatedAt(second.id, "2100-01-02T00:00:00.000Z");

    // A CONFIRMED invoice cannot be produced over HTTP (BILL-003 owns the
    // transition), so it is seeded directly to exercise the filter in BOTH
    // directions: it must appear under CONFIRMED and never under DRAFT.
    const confirmed = booted.db.prisma.invoice.create({
      data: {
        tenantId: fixture.a.tenant.id,
        saleId: fixture.seedSale(fixture.a).id,
        customerId: null,
        currency: "PYG",
        status: "CONFIRMED",
        series: "A",
        number: 1,
        confirmedAt: new Date(),
        lines: {
          create: [
            {
              catalogItemId: fixture.createItem(fixture.a).id,
              position: 0,
              description: "confirmed line",
              rateCode: "EXEMPT",
              unitPrice: "500.00",
              quantity: "1.000",
              lineTotal: "500.00",
              taxableBase: "500.00",
              taxAmount: "0.00",
            },
          ],
        },
      },
    });
    const auditsBefore = booted.db.tables.audits.size;

    const listed = await getInvoices(fixture.a.actor.cookie).expect(200);
    const list = listed.body as InvoiceDto[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(3);
    // Newest first by `createdAt`: the two pinned drafts lead, in order.
    expect(list[0].id).toBe(second.id);
    expect(list[1].id).toBe(first.id);
    expect(list.map((invoice) => invoice.id)).toContain(confirmed.id);
    for (const invoice of list) {
      // Exact allowlisted key set, and the tenant is never on the wire.
      expect(Object.keys(invoice).sort()).toEqual([...INVOICE_RESPONSE_KEYS].sort());
      expect("tenantId" in invoice).toBe(false);
    }
    expect(listed.text).not.toContain("tenant_id");
    expect(listed.text).not.toContain("invoice_id");

    const drafts = (await getInvoices(fixture.a.actor.cookie, "?status=DRAFT").expect(200))
      .body as InvoiceDto[];
    const draftIds = drafts.map((invoice) => invoice.id);
    expect(draftIds).toContain(first.id);
    expect(draftIds).toContain(second.id);
    expect(draftIds).not.toContain(confirmed.id);
    for (const invoice of drafts) {
      expect(invoice.status).toBe("DRAFT");
    }

    const confirmedList = (
      await getInvoices(fixture.a.actor.cookie, "?status=CONFIRMED").expect(200)
    ).body as InvoiceDto[];
    expect(confirmedList.map((invoice) => invoice.id)).toEqual([confirmed.id]);
    expect(confirmedList[0].number).toBe(1);

    const cancelledList = (
      await getInvoices(fixture.a.actor.cookie, "?status=CANCELLED").expect(200)
    ).body as InvoiceDto[];
    expect(cancelledList).toEqual([]);

    // Four pure reads appended no audit row and wrote no state.
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
    expect(booted.db.tables.invoices.get(confirmed.id)?.status).toBe("CONFIRMED");
  });

  it("returns one invoice with its lines in position order and the id read equals the create response", async () => {
    const item = fixture.createItem(fixture.a);
    const sale = fixture.seedSale(fixture.a);
    // Lines inserted OUT of position order: the read must return the document's
    // frozen reading order, not the relation's insertion order.
    const stored = booted.db.prisma.invoice.create({
      data: {
        tenantId: fixture.a.tenant.id,
        saleId: sale.id,
        customerId: null,
        currency: "PYG",
        lines: {
          create: [
            {
              catalogItemId: item.id,
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
              catalogItemId: item.id,
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
              catalogItemId: item.id,
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

    const response = await getInvoice(fixture.a.actor.cookie, stored.id).expect(200);
    const body = response.body as InvoiceDto;
    expect(Object.keys(body).sort()).toEqual([...INVOICE_RESPONSE_KEYS].sort());
    expect(body.id).toBe(stored.id);
    expect(body.status).toBe("DRAFT");
    expect(body.series).toBe("A");
    // A draft carries NO allocated number (DEC-039).
    expect(body.number).toBeNull();
    expect(body.confirmedAt).toBeNull();
    expect(body.lines.map((line) => line.position)).toEqual([0, 1, 2]);
    expect(body.lines.map((line) => line.description)).toEqual(["first", "second", "third"]);
    for (const line of body.lines) {
      expect(Object.keys(line).sort()).toEqual([...INVOICE_LINE_RESPONSE_KEYS].sort());
    }
    // Totals are projections over the invoice's OWN frozen lines, fixed-scale.
    expect(body.total).toBe("6.00");
    expect(body.taxTotal).toBe("0.00");
    expect(response.text).not.toContain("tenant_id");
    expect(response.text).not.toContain("invoice_id");

    // The create response and the later id read describe the SAME document,
    // byte for byte.
    const createdResponse = await postInvoice(
      fixture.a.actor.cookie,
      fixture.seedSale(fixture.a).id
    ).expect(201);
    const created = createdResponse.body as InvoiceDto;
    const reread = await getInvoice(fixture.a.actor.cookie, created.id).expect(200);
    expect((reread.body as InvoiceDto).id).toBe(created.id);
    expect(reread.text).toBe(createdResponse.text);
  });

  it("masks a foreign and an unknown invoice id as a byte-equivalent 404 and never leaks another tenant's invoice", async () => {
    const foreignSale = fixture.seedSale(fixture.b);
    const foreign = (await postInvoice(fixture.b.actor.cookie, foreignSale.id).expect(201))
      .body as InvoiceDto;
    const sizesBefore = tableSizes(booted.db);

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      method: "GET",
      nonexistentUrl: `/invoices/${randomUUID()}`,
      foreignUrl: `/invoices/${foreign.id}`,
      forbiddenIdentifiers: [
        foreign.id,
        foreign.saleId,
        fixture.b.tenant.id,
        foreign.lines[0].description,
      ],
    });

    // One shared message backs every invoice 404 (byte-equivalence by construction).
    const probe = await getInvoice(fixture.a.actor.cookie, foreign.id).expect(404);
    expect((probe.body as ErrorDto).error.code).toBe("NOT_FOUND");
    expect((probe.body as ErrorDto).error.message).toBe(INVOICE_NOT_FOUND_MESSAGE);

    // Neither tenant's rows moved, and tenant B still reads its OWN invoice.
    expect(tableSizes(booted.db)).toEqual(sizesBefore);
    const foreignRead = await getInvoice(fixture.b.actor.cookie, foreign.id).expect(200);
    expect((foreignRead.body as InvoiceDto).saleId).toBe(foreign.saleId);
  });

  it("requires billing.read on both reads and persists nothing when denied", async () => {
    const invoice = (
      await postInvoice(fixture.a.actor.cookie, fixture.seedSale(fixture.a).id).expect(201)
    ).body as InvoiceDto;
    const sizesBefore = tableSizes(booted.db);

    const deniedList = await getInvoices(fixture.noPermission.cookie).expect(403);
    expect((deniedList.body as ErrorDto).error.code).toBe("FORBIDDEN");
    const deniedRead = await getInvoice(fixture.noPermission.cookie, invoice.id).expect(403);
    expect((deniedRead.body as ErrorDto).error.code).toBe("FORBIDDEN");

    // ONE `billing.read` key is enough for both reads.
    await getInvoices(fixture.readOnly.cookie).expect(200);
    const allowed = await getInvoice(fixture.readOnly.cookie, invoice.id).expect(200);
    expect((allowed.body as InvoiceDto).id).toBe(invoice.id);

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("gates both reads on the billing entitlement before the permission and persists nothing", async () => {
    const sale = fixture.seedSale(fixture.c);
    const sizesBefore = tableSizes(booted.db);

    // Tenant C holds the FULL `billing.*` matrix but no entitlement, so a 403
    // here can only be the entitlement gate — the one asserted FIRST.
    const list = await getInvoices(fixture.c.actor.cookie).expect(403);
    expect((list.body as ErrorDto).error.code).toBe("FEATURE_NOT_ENTITLED");
    expect((list.body as ErrorDto).error.message).toBe(BILLING_FEATURE_NOT_ENTITLED_MESSAGE);

    // An UNKNOWN id is still the entitlement 403, never a 404: the gate runs
    // before any data access.
    const read = await getInvoice(fixture.c.actor.cookie, randomUUID()).expect(403);
    expect((read.body as ErrorDto).error.code).toBe("FEATURE_NOT_ENTITLED");

    const created = await postInvoice(fixture.c.actor.cookie, sale.id).expect(403);
    expect((created.body as ErrorDto).error.code).toBe("FEATURE_NOT_ENTITLED");

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("rejects an unknown, malformed or non-enum list query and a malformed id with the stable 400", async () => {
    const invoice = (
      await postInvoice(fixture.a.actor.cookie, fixture.seedSale(fixture.a).id).expect(201)
    ).body as InvoiceDto;
    const sizesBefore = tableSizes(booted.db);

    for (const query of [
      "?status=BOGUS",
      "?status=draft",
      "?status=",
      "?status=DRAFT&status=CONFIRMED",
      `?tenantId=${fixture.a.tenant.id}`,
      `?saleId=${invoice.saleId}`,
      "?limit=10",
      "?unknown=1",
    ]) {
      const response = await getInvoices(fixture.a.actor.cookie, query).expect(400);
      expect((response.body as ErrorDto).error.code, query).toBe("VALIDATION_FAILED");
    }

    for (const id of ["not-a-uuid", "123", "00000000-0000-0000-0000-00000000000z"]) {
      const response = await getInvoice(fixture.a.actor.cookie, id).expect(400);
      expect((response.body as ErrorDto).error.code, id).toBe("VALIDATION_FAILED");
    }

    // Every rejection persisted nothing and the valid read still answers.
    expect(tableSizes(booted.db)).toEqual(sizesBefore);
    const valid = await getInvoice(fixture.a.actor.cookie, invoice.id).expect(200);
    expect((valid.body as InvoiceDto).id).toBe(invoice.id);
  });

  it("keeps the list tenant-scoped when the other tenant has invoices of its own", async () => {
    const mine = (
      await postInvoice(fixture.a.actor.cookie, fixture.seedSale(fixture.a).id).expect(201)
    ).body as InvoiceDto;
    const foreign = (
      await postInvoice(fixture.b.actor.cookie, fixture.seedSale(fixture.b).id).expect(201)
    ).body as InvoiceDto;

    const mineIds = (
      (await getInvoices(fixture.a.actor.cookie).expect(200)).body as InvoiceDto[]
    ).map((invoice) => invoice.id);
    const foreignIds = (
      (await getInvoices(fixture.b.actor.cookie).expect(200)).body as InvoiceDto[]
    ).map((invoice) => invoice.id);

    expect(mineIds).toContain(mine.id);
    expect(mineIds).not.toContain(foreign.id);
    expect(foreignIds).toContain(foreign.id);
    expect(foreignIds).not.toContain(mine.id);
    // The two result sets are disjoint: no row is visible to both tenants.
    expect(mineIds.filter((id) => foreignIds.includes(id))).toEqual([]);

    // The same holds for the filtered read.
    const foreignDrafts = (
      (await getInvoices(fixture.b.actor.cookie, "?status=DRAFT").expect(200)).body as InvoiceDto[]
    ).map((invoice) => invoice.id);
    expect(foreignDrafts).toContain(foreign.id);
    expect(foreignDrafts).not.toContain(mine.id);
  });
});

/**
 * The W2 confirmation command over the REAL HTTP boundary: the locked read, the
 * atomic number allocation, the conditional `DRAFT -> CONFIRMED` write, the
 * co-committed audit row, the replay-by-state contract and the state gates. The
 * durable allocation and the concurrent-confirm row-lock overlap are
 * live-PostgreSQL evidence owned by BILL-003 W3, so these in-memory cases cover
 * the RESULT shape, the number-skip guard and the no-residue guarantees rather
 * than the serialization itself.
 */
describe("Billing HTTP boundary — invoice confirmation (EPIC-14 BILL-003 W2)", () => {
  let booted: BootedTestApp;
  let fixture: BillingHttpFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedBillingHttp(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  const postInvoice = (cookie: string, saleId: string) =>
    supertest(booted.app.getHttpServer()).post("/invoices").set("Cookie", cookie).send({ saleId });

  const confirmInvoice = (cookie: string, id: string) =>
    supertest(booted.app.getHttpServer()).post(`/invoices/${id}/confirm`).set("Cookie", cookie);

  /** The `(tenant, series)` counter row the confirm transaction advances. */
  function sequenceFor(tenantId: string, series = "A") {
    return [...booted.db.tables.invoiceNumberSequences.values()].find(
      (row) => row.tenantId === tenantId && row.series === series
    );
  }

  async function createDraft(owner: BillingTenant): Promise<InvoiceDto> {
    return (await postInvoice(owner.actor.cookie, fixture.seedSale(owner).id).expect(201))
      .body as InvoiceDto;
  }

  /**
   * The `invoice.confirmed` audit rows for one invoice. The create command
   * co-commits its OWN `invoice.created` row against the same target, so the
   * confirmation assertions filter by action rather than by target alone.
   */
  function confirmedAuditsFor(invoiceId: string): AuditLogRow[] {
    return auditsForTarget(booted, invoiceId).filter((row) => row.action === "invoice.confirmed");
  }

  it("confirms a DRAFT invoice, allocating a positive number and co-committing one audit row", async () => {
    const created = await createDraft(fixture.a);
    const auditsBefore = booted.db.tables.audits.size;

    const response = await confirmInvoice(fixture.a.actor.cookie, created.id).expect(200);
    const body = response.body as InvoiceDto;
    expect(Object.keys(body).sort()).toEqual([...INVOICE_RESPONSE_KEYS].sort());
    expect(body.id).toBe(created.id);
    expect(body.saleId).toBe(created.saleId);
    expect(body.status).toBe("CONFIRMED");
    expect(body.series).toBe("A");
    expect(body.number).not.toBeNull();
    expect(Number.isInteger(body.number)).toBe(true);
    expect(body.number!).toBeGreaterThan(0);
    expect(body.confirmedAt).not.toBeNull();
    expect(body.cancelledAt).toBeNull();
    expect(body.cancelReason).toBeNull();

    // The allocation and the transition committed together, so the response is
    // exactly the STORED document.
    const stored = booted.db.tables.invoices.get(created.id);
    expect(stored?.status).toBe("CONFIRMED");
    expect(stored?.number).toBe(body.number);
    expect(stored?.confirmedAt).not.toBeNull();
    expect(stored?.confirmedAt?.toISOString()).toBe(body.confirmedAt);

    // Exactly ONE audit row for the real transition, ids and field NAMES only.
    expect(booted.db.tables.audits.size).toBe(auditsBefore + 1);
    const rows = confirmedAuditsFor(created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("invoice.confirmed");
    expect(rows[0].targetType).toBe("invoice");
    expect(rows[0].tenantId).toBe(fixture.a.tenant.id);
    expect(rows[0].actorUserProfileId).toBe(fixture.a.actor.profile.id);
    expect(changedFieldsOf(rows[0])).toEqual(["status", "number", "confirmedAt"]);
    expect(rows[0].metadata).toEqual({
      schemaVersion: BILLING_DTO_SCHEMA_VERSION,
      changedFields: ["status", "number", "confirmedAt"],
    });
  });

  it("replays a CONFIRMED invoice with the SAME number, no second audit row and no counter advance", async () => {
    const created = await createDraft(fixture.a);
    const firstResponse = await confirmInvoice(fixture.a.actor.cookie, created.id).expect(200);
    const first = firstResponse.body as InvoiceDto;
    const auditsAfterFirst = booted.db.tables.audits.size;
    const counterAfterFirst = sequenceFor(fixture.a.tenant.id)?.nextValue;
    expect(counterAfterFirst).toBe(first.number! + 1);

    const replay = await confirmInvoice(fixture.a.actor.cookie, created.id).expect(200);
    const body = replay.body as InvoiceDto;
    expect(body.status).toBe("CONFIRMED");
    expect(body.number).toBe(first.number);
    expect(body.confirmedAt).toBe(first.confirmedAt);
    // Byte-identical representation: the replay writes nothing at all.
    expect(replay.text).toBe(firstResponse.text);

    // The number-skip guard: a replay must NOT reach the allocator, so the
    // counter stays where the first confirmation left it.
    expect(sequenceFor(fixture.a.tenant.id)?.nextValue).toBe(counterAfterFirst);
    // …and no second audit row was appended.
    expect(booted.db.tables.audits.size).toBe(auditsAfterFirst);
    expect(confirmedAuditsFor(created.id)).toHaveLength(1);
  });

  it("rejects a CANCELLED invoice with the stable 409 and leaves no residue", async () => {
    const sale = fixture.seedSale(fixture.a);
    const cancelled = booted.db.prisma.invoice.create({
      data: {
        tenantId: fixture.a.tenant.id,
        saleId: sale.id,
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
    const sizesBefore = tableSizes(booted.db);

    const response = await confirmInvoice(fixture.a.actor.cookie, cancelled.id).expect(409);
    expect((response.body as ErrorDto).error.code).toBe("CONFLICT");
    expect((response.body as ErrorDto).error.message).toBe(INVOICE_NOT_DRAFT_MESSAGE);

    // A rejected confirm persists nothing and allocates no number.
    expect(tableSizes(booted.db)).toEqual(sizesBefore);
    expect(booted.db.tables.invoices.get(cancelled.id)?.status).toBe("CANCELLED");
  });

  it("masks a foreign and an unknown invoice id as a byte-equivalent 404 and persists nothing", async () => {
    const foreign = (
      await postInvoice(fixture.b.actor.cookie, fixture.seedSale(fixture.b).id).expect(201)
    ).body as InvoiceDto;
    const sizesBefore = tableSizes(booted.db);

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      method: "POST",
      nonexistentUrl: `/invoices/${randomUUID()}/confirm`,
      foreignUrl: `/invoices/${foreign.id}/confirm`,
      forbiddenIdentifiers: [foreign.id, foreign.saleId, fixture.b.tenant.id],
    });

    // The masked paths are the shared invoice 404, byte-identical by constant.
    const probe = await confirmInvoice(fixture.a.actor.cookie, foreign.id).expect(404);
    expect((probe.body as ErrorDto).error.code).toBe("NOT_FOUND");
    expect((probe.body as ErrorDto).error.message).toBe(INVOICE_NOT_FOUND_MESSAGE);

    // Neither tenant's rows moved: a 404 never allocates and never writes.
    expect(tableSizes(booted.db)).toEqual(sizesBefore);
    expect(booted.db.tables.invoices.get(foreign.id)?.status).toBe("DRAFT");
  });

  it("requires billing.confirm and the billing entitlement, persisting nothing when denied", async () => {
    const draftA = await createDraft(fixture.a);
    // Tenant C is unentitled, so its draft is seeded directly (the create route
    // is itself gated on the entitlement).
    const draftC = booted.db.prisma.invoice.create({
      data: {
        tenantId: fixture.c.tenant.id,
        saleId: fixture.seedSale(fixture.c).id,
        customerId: null,
        currency: "PYG",
        status: "DRAFT",
        series: "A",
        lines: { create: [] },
      },
    });
    const sizesBefore = tableSizes(booted.db);

    // A member of A whose role has NO billing key.
    const none = await confirmInvoice(fixture.noPermission.cookie, draftA.id).expect(403);
    expect((none.body as ErrorDto).error.code).toBe("FORBIDDEN");
    // A member of A with `billing.read` only: confirm is still a 403.
    const readOnly = await confirmInvoice(fixture.readOnly.cookie, draftA.id).expect(403);
    expect((readOnly.body as ErrorDto).error.code).toBe("FORBIDDEN");
    // Tenant C holds the FULL matrix but no entitlement: gated FIRST.
    const unentitled = await confirmInvoice(fixture.c.actor.cookie, draftC.id).expect(403);
    expect((unentitled.body as ErrorDto).error.code).toBe("FEATURE_NOT_ENTITLED");
    expect((unentitled.body as ErrorDto).error.message).toBe(BILLING_FEATURE_NOT_ENTITLED_MESSAGE);

    // …and a malformed id is the stable 400 for a permissioned actor.
    const malformed = await supertest(booted.app.getHttpServer())
      .post("/invoices/not-a-uuid/confirm")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(400);
    expect((malformed.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");

    expect(booted.db.tables.invoices.get(draftA.id)?.status).toBe("DRAFT");
    expect(booted.db.tables.invoices.get(draftC.id)?.status).toBe("DRAFT");
    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("allocates consecutive numbers to two invoices of the same tenant", async () => {
    const first = (
      await confirmInvoice(fixture.a.actor.cookie, (await createDraft(fixture.a)).id).expect(200)
    ).body as InvoiceDto;
    const second = (
      await confirmInvoice(fixture.a.actor.cookie, (await createDraft(fixture.a)).id).expect(200)
    ).body as InvoiceDto;

    expect(first.number).not.toBeNull();
    expect(second.number).toBe(first.number! + 1);
    // The counter now points at the NEXT number to allocate.
    expect(sequenceFor(fixture.a.tenant.id)?.nextValue).toBe(second.number! + 1);
  });
});

/**
 * The W3 cancellation command over the REAL HTTP boundary: the locked read, the
 * `DRAFT`-or-`CONFIRMED` gate, the terminal `CANCELLED` write with the retained
 * number and the original confirmation timestamp, the co-committed audit row
 * and the replay-by-state contract (DEC-041, DEC-043). The in-memory boundary
 * cannot prove the row-lock serialization, so the durable concurrent-confirm
 * overlap and the live cross-tenant/authorization evidence stay
 * live-PostgreSQL-owned (BILL-003 W3).
 */
describe("Billing HTTP boundary — invoice cancellation (EPIC-14 BILL-003 W3)", () => {
  let booted: BootedTestApp;
  let fixture: BillingHttpFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedBillingHttp(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  const DEFAULT_CANCEL_REASON = "Mistaken document";

  const postInvoice = (cookie: string, saleId: string) =>
    supertest(booted.app.getHttpServer()).post("/invoices").set("Cookie", cookie).send({ saleId });

  const confirmInvoice = (cookie: string, id: string) =>
    supertest(booted.app.getHttpServer()).post(`/invoices/${id}/confirm`).set("Cookie", cookie);

  const cancelInvoice = (
    cookie: string,
    id: string,
    body: Record<string, unknown> = { reason: DEFAULT_CANCEL_REASON }
  ) =>
    supertest(booted.app.getHttpServer())
      .post(`/invoices/${id}/cancel`)
      .set("Cookie", cookie)
      .send(body);

  /** Audit rows of ONE action targeting one invoice — the per-mutation count. */
  function auditsWithAction(invoiceId: string, action: string): AuditLogRow[] {
    return auditsForTarget(booted, invoiceId).filter((row) => row.action === action);
  }

  async function createDraft(owner: BillingTenant): Promise<InvoiceDto> {
    return (await postInvoice(owner.actor.cookie, fixture.seedSale(owner).id).expect(201))
      .body as InvoiceDto;
  }

  it("cancels a DRAFT invoice with the reason echoed, no number and one co-committed audit row", async () => {
    const created = await createDraft(fixture.a);
    const auditsBefore = booted.db.tables.audits.size;

    const response = await cancelInvoice(fixture.a.actor.cookie, created.id, {
      reason: "Mistaken customer",
    }).expect(200);
    const body = response.body as InvoiceDto;
    expect(Object.keys(body).sort()).toEqual([...INVOICE_RESPONSE_KEYS].sort());
    expect("tenantId" in body).toBe(false);
    expect(body.id).toBe(created.id);
    expect(body.status).toBe("CANCELLED");
    expect(body.series).toBe("A");
    // A draft had no number, and cancellation never allocates one (DEC-039).
    expect(body.number).toBeNull();
    expect(body.confirmedAt).toBeNull();
    expect(body.cancelledAt).not.toBeNull();
    expect(body.cancelReason).toBe("Mistaken customer");

    // The response is exactly the STORED document, co-committed with its audit.
    const stored = booted.db.tables.invoices.get(created.id);
    expect(stored?.status).toBe("CANCELLED");
    expect(stored?.number).toBeNull();
    expect(stored?.cancelledAt?.toISOString()).toBe(body.cancelledAt);
    expect(stored?.cancelReason).toBe("Mistaken customer");

    expect(booted.db.tables.audits.size).toBe(auditsBefore + 1);
    const rows = auditsWithAction(created.id, "invoice.cancelled");
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("invoice.cancelled");
    expect(rows[0].targetType).toBe("invoice");
    expect(rows[0].tenantId).toBe(fixture.a.tenant.id);
    expect(rows[0].actorUserProfileId).toBe(fixture.a.actor.profile.id);
    expect(rows[0].metadata).toEqual({
      schemaVersion: BILLING_DTO_SCHEMA_VERSION,
      changedFields: ["status", "cancelledAt", "cancelReason"],
    });
  });

  it("cancelling a CONFIRMED invoice retains the number and its original confirmation timestamp", async () => {
    const created = await createDraft(fixture.a);
    const confirmed = (await confirmInvoice(fixture.a.actor.cookie, created.id).expect(200))
      .body as InvoiceDto;
    expect(confirmed.number).not.toBeNull();
    const confirmedAtBefore = confirmed.confirmedAt;

    const response = await cancelInvoice(fixture.a.actor.cookie, created.id, {
      reason: "Wrong totals",
    }).expect(200);
    const body = response.body as InvoiceDto;
    expect(body.status).toBe("CANCELLED");
    // The allocated number is RETAINED, never released or reallocated (DEC-043).
    expect(body.number).toBe(confirmed.number);
    // The original confirmation time is untouched by the cancellation.
    expect(body.confirmedAt).toBe(confirmedAtBefore);
    expect(body.cancelledAt).not.toBeNull();
    expect(body.cancelReason).toBe("Wrong totals");

    const stored = booted.db.tables.invoices.get(created.id);
    expect(stored?.status).toBe("CANCELLED");
    expect(stored?.number).toBe(confirmed.number);
    expect(stored?.confirmedAt?.toISOString()).toBe(confirmedAtBefore);

    // Exactly ONE audit row per real transition: one confirm and one cancel.
    expect(auditsWithAction(created.id, "invoice.confirmed")).toHaveLength(1);
    expect(auditsWithAction(created.id, "invoice.cancelled")).toHaveLength(1);
  });

  it("replays an already CANCELLED invoice with the SAME body and no second audit row", async () => {
    const created = await createDraft(fixture.a);
    const firstResponse = await cancelInvoice(fixture.a.actor.cookie, created.id, {
      reason: "First reason",
    }).expect(200);
    const first = firstResponse.body as InvoiceDto;
    const auditsAfterFirst = booted.db.tables.audits.size;

    // A DIFFERENT reason on the retry: the replay returns the ORIGINAL document
    // unchanged, so the stored reason is never rewritten.
    const replay = await cancelInvoice(fixture.a.actor.cookie, created.id, {
      reason: "Second reason",
    }).expect(200);
    const body = replay.body as InvoiceDto;
    expect(body.status).toBe("CANCELLED");
    expect(body.cancelReason).toBe(first.cancelReason);
    expect(body.cancelledAt).toBe(first.cancelledAt);
    // Byte-identical representation: the replay writes nothing at all.
    expect(replay.text).toBe(firstResponse.text);

    expect(booted.db.tables.audits.size).toBe(auditsAfterFirst);
    expect(auditsWithAction(created.id, "invoice.cancelled")).toHaveLength(1);
    expect(booted.db.tables.invoices.get(created.id)?.cancelReason).toBe("First reason");
  });

  it("rejects a blank, whitespace-only, missing, over-long or extra-key body with 400 and no residue", async () => {
    const draft = await createDraft(fixture.a);
    const sizesBefore = tableSizes(booted.db);

    const invalidBodies: readonly Record<string, unknown>[] = [
      {},
      { reason: "" },
      { reason: "   " },
      { reason: "\t\n " },
      { reason: "n".repeat(501) },
      { reason: "Fine", tenantId: fixture.a.tenant.id },
      { reason: "Fine", status: "CANCELLED" },
      { reason: 12 },
      { reason: null },
    ];
    for (const body of invalidBodies) {
      const response = await cancelInvoice(fixture.a.actor.cookie, draft.id, body).expect(400);
      expect((response.body as ErrorDto).error.code, JSON.stringify(body)).toBe(
        "VALIDATION_FAILED"
      );
    }

    // No rejection persisted anything: no state transition and no audit row.
    expect(tableSizes(booted.db)).toEqual(sizesBefore);
    expect(booted.db.tables.invoices.get(draft.id)?.status).toBe("DRAFT");

    // The column width is the exact upper bound: 500 characters is admitted.
    const boundary = await cancelInvoice(fixture.a.actor.cookie, draft.id, {
      reason: "n".repeat(500),
    }).expect(200);
    expect((boundary.body as InvoiceDto).cancelReason).toHaveLength(500);
  });

  it("masks a foreign and an unknown invoice id as a byte-equivalent 404 on cancel and persists nothing", async () => {
    const foreign = (
      await postInvoice(fixture.b.actor.cookie, fixture.seedSale(fixture.b).id).expect(201)
    ).body as InvoiceDto;
    const sizesBefore = tableSizes(booted.db);

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      method: "POST",
      nonexistentUrl: `/invoices/${randomUUID()}/cancel`,
      foreignUrl: `/invoices/${foreign.id}/cancel`,
      body: { reason: DEFAULT_CANCEL_REASON },
      forbiddenIdentifiers: [foreign.id, foreign.saleId, fixture.b.tenant.id],
    });

    const probe = await cancelInvoice(fixture.a.actor.cookie, foreign.id).expect(404);
    expect((probe.body as ErrorDto).error.code).toBe("NOT_FOUND");
    expect((probe.body as ErrorDto).error.message).toBe(INVOICE_NOT_FOUND_MESSAGE);

    // Neither tenant's rows moved and the foreign invoice is untouched.
    expect(tableSizes(booted.db)).toEqual(sizesBefore);
    expect(booted.db.tables.invoices.get(foreign.id)?.status).toBe("DRAFT");
  });

  it("requires billing.cancel and the billing entitlement, persisting nothing when denied", async () => {
    const draftA = await createDraft(fixture.a);
    // Tenant C is unentitled, so its draft is seeded directly (the create route
    // is itself gated on the entitlement).
    const draftC = booted.db.prisma.invoice.create({
      data: {
        tenantId: fixture.c.tenant.id,
        saleId: fixture.seedSale(fixture.c).id,
        customerId: null,
        currency: "PYG",
        status: "DRAFT",
        series: "A",
        lines: { create: [] },
      },
    });
    const sizesBefore = tableSizes(booted.db);

    // A member of A whose role has NO billing key.
    const none = await cancelInvoice(fixture.noPermission.cookie, draftA.id).expect(403);
    expect((none.body as ErrorDto).error.code).toBe("FORBIDDEN");
    // A member of A with `billing.read` only: cancel is still a 403.
    const readOnly = await cancelInvoice(fixture.readOnly.cookie, draftA.id).expect(403);
    expect((readOnly.body as ErrorDto).error.code).toBe("FORBIDDEN");
    // Tenant C holds the FULL matrix but no entitlement: gated FIRST.
    const unentitled = await cancelInvoice(fixture.c.actor.cookie, draftC.id).expect(403);
    expect((unentitled.body as ErrorDto).error.code).toBe("FEATURE_NOT_ENTITLED");
    expect((unentitled.body as ErrorDto).error.message).toBe(BILLING_FEATURE_NOT_ENTITLED_MESSAGE);

    // …and a malformed id is the stable 400 for a permissioned actor.
    const malformed = await supertest(booted.app.getHttpServer())
      .post("/invoices/not-a-uuid/cancel")
      .set("Cookie", fixture.a.actor.cookie)
      .send({ reason: DEFAULT_CANCEL_REASON })
      .expect(400);
    expect((malformed.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");

    expect(booted.db.tables.invoices.get(draftA.id)?.status).toBe("DRAFT");
    expect(booted.db.tables.invoices.get(draftC.id)?.status).toBe("DRAFT");
    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });
});
