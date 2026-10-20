import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { Prisma } from "@newsaas/database";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import {
  SEEDED_TAX_RATE_IDS,
  type IsolationDatabase,
  type PaymentMethodRow,
} from "../../test/support/in-memory-database.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
} from "../../test/support/rbac-fixture.js";
import {
  REPORT_PERIOD_DATE_FORMAT_MESSAGE,
  REPORT_PERIOD_INCOMPLETE_RANGE_MESSAGE,
  REPORT_PERIOD_INVERTED_MESSAGE,
  REPORT_PERIOD_MISSING_MESSAGE,
  REPORT_PERIOD_SHAPE_CONFLICT_MESSAGE,
  REPORT_PERIOD_TOO_LONG_MESSAGE,
  REPORT_PERIOD_UNKNOWN_PRESET_MESSAGE,
} from "./report.period.js";
import {
  REPORT_PERIOD_QUERY_INVALID_MESSAGE,
  type PaymentMethodsResponse,
  type SalesByPeriodResponse,
  type SalesByProductServiceResponse,
} from "./reporting.dto.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";

/**
 * The reporting surface over the REAL guard chain and the in-memory boundary:
 * `GET /reports/sales-by-period` ([[REP-002]]) and the two commercial reports of
 * [[REP-003]].
 *
 * The range is always sent as explicit `from`/`to` dates: a preset resolves
 * against the live clock, and an assertion about "today" is not a test — the
 * preset arithmetic has its own suite in `report.period.test.ts`.
 */

interface ErrorDto {
  error: { code: string; message: string };
}

interface ReportingTenant {
  id: string;
  actor: RbacActor;
}

interface ReportingFixture {
  /** Probing tenant: holds `reports.read`, owns the rows the report must count. */
  a: ReportingTenant;
  /** Foreign tenant: holds `reports.read` too, owns rows A must NEVER see. */
  b: ReportingTenant;
  /** Member of A whose role holds NO report permission (403 probe). */
  noPermission: RbacActor;
  /** Books a sale with an explicit lifecycle state and business instant. */
  seedSale(
    owner: ReportingTenant,
    options: {
      completedAt: Date | null;
      status?: "DRAFT" | "COMPLETED" | "CANCELLED";
      taxableBase?: string;
      taxAmount?: string;
      lineTotal?: string;
    }
  ): { id: string };
}

/**
 * Two tenants with the same `reports.read` grant and one actor without it. No
 * entitlement is seeded for either, which is the point: [[DEC-062]] leaves the
 * report surface ungated by feature code.
 */
function seedReporting(db: IsolationDatabase): ReportingFixture {
  const suffix = randomUUID().slice(0, 8);

  function seedTenant(letter: string, keys: readonly string[]): ReportingTenant {
    const tenant = db.prisma.tenant.create({
      data: { slug: `reports-${letter}-${suffix}`, name: `Reports ${letter.toUpperCase()}` },
    });
    const role = seedRoleWithKeys(db, `REPORTS_${letter.toUpperCase()}_${suffix}`, "Reports", [
      ...keys,
    ]);
    const actor = seedRbacActor(db, {
      email: `reports-${letter}-${suffix}@isolation.test`,
      tenantId: tenant.id,
      roleId: role.role.id,
    });
    return { id: tenant.id, actor };
  }

  const a = seedTenant("a", [REPORTING_PERMISSIONS.read]);
  const b = seedTenant("b", [REPORTING_PERMISSIONS.read]);

  const noPermissionRole = seedRoleWithKeys(db, `REPORTS_NONE_${suffix}`, "Reports none", []);
  const noPermission = seedRbacActor(db, {
    email: `reports-none-${suffix}@isolation.test`,
    tenantId: a.id,
    roleId: noPermissionRole.role.id,
  });

  const seedSale: ReportingFixture["seedSale"] = (owner, options) => {
    const sale = db.prisma.sale.create({
      data: {
        tenantId: owner.id,
        currency: "PYG",
        status: options.status ?? "COMPLETED",
        lines: {
          create: [
            {
              catalogItemId: randomUUID(),
              rateCode: "EXEMPT",
              unitPrice: options.taxableBase ?? "100.00",
              quantity: "1.000",
              lineTotal: options.lineTotal ?? "100.00",
              taxableBase: options.taxableBase ?? "100.00",
              taxAmount: options.taxAmount ?? "0.00",
            },
          ],
        },
      },
    });
    // `completed_at` is written ONLY by the completion transaction (DEC-064), so
    // the fixture writes it through that same conditional update path.
    if (options.completedAt !== null) {
      db.prisma.sale.updateMany({
        where: { id: sale.id },
        data: { completedAt: options.completedAt },
      });
    }
    return { id: sale.id };
  };

  return { a, b, noPermission, seedSale };
}

/**
 * The reporting range every HTTP assertion uses: 2026-06-10 through 2026-06-11
 * in Asunción (`-03`), which is the half-open instant range
 * `[2026-06-10T03:00Z, 2026-06-12T03:00Z)`.
 */
const PERIOD_QUERY = "from=2026-06-10&to=2026-06-11";
const FROM_INSTANT = "2026-06-10T03:00:00.000Z";
const TO_INSTANT = "2026-06-12T03:00:00.000Z";

describe("GET /reports/sales-by-period", () => {
  let booted: BootedTestApp;
  let fixture: ReportingFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedReporting(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  /** Books the standard six-row scenario: in-range, out-of-range and foreign. */
  function seedScenario(): void {
    // Exactly at `fromInstant`: INSIDE the period (the start bound is inclusive).
    fixture.seedSale(fixture.a, {
      completedAt: new Date(FROM_INSTANT),
      taxableBase: "100.00",
      taxAmount: "10.00",
      lineTotal: "110.00",
    });
    // 2026-06-11T02:00Z is 23:00 on the 10th in Asunción: the LOCAL day is the 10th.
    fixture.seedSale(fixture.a, {
      completedAt: new Date("2026-06-11T02:00:00.000Z"),
      taxableBase: "20.00",
      taxAmount: "2.00",
      lineTotal: "22.00",
    });
    fixture.seedSale(fixture.a, {
      completedAt: new Date("2026-06-11T12:00:00.000Z"),
      taxableBase: "300.00",
      taxAmount: "30.00",
      lineTotal: "330.00",
    });
    // Always excluded: exactly at `toInstant` (the NEXT period's first instant).
    fixture.seedSale(fixture.a, {
      completedAt: new Date(TO_INSTANT),
      taxableBase: "4000.00",
      taxAmount: "400.00",
      lineTotal: "4400.00",
    });
    // Always excluded: a draft is not revenue, and it has no business instant.
    fixture.seedSale(fixture.a, {
      completedAt: null,
      status: "DRAFT",
      taxableBase: "9000.00",
      taxAmount: "0.00",
      lineTotal: "9000.00",
    });
    // Always excluded: a cancelled sale completed nothing worth reporting.
    fixture.seedSale(fixture.a, {
      completedAt: new Date("2026-06-10T12:00:00.000Z"),
      status: "CANCELLED",
      taxableBase: "9500.00",
      taxAmount: "0.00",
      lineTotal: "9500.00",
    });
    // The foreign row: inside the same period, other tenant, must never appear.
    fixture.seedSale(fixture.b, {
      completedAt: new Date("2026-06-10T12:00:00.000Z"),
      taxableBase: "50000.00",
      taxAmount: "5000.00",
      lineTotal: "55000.00",
    });
  }

  it("returns completed sales bucketed by the tenant's day, with the period echoed", async () => {
    seedScenario();

    const response = await supertest(booted.app.getHttpServer())
      .get(`/reports/sales-by-period?${PERIOD_QUERY}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const body = response.body as SalesByPeriodResponse;
    expect(body.report).toBe("sales-by-period");
    expect(body.period).toEqual({
      preset: null,
      fromDate: "2026-06-10",
      toDate: "2026-06-11",
      timeZone: "America/Asuncion",
      fromInstant: FROM_INSTANT,
      toInstant: TO_INSTANT,
    });
    // The server-resolved `sales.defaultCurrency`, never a hardcoded literal.
    expect(body.currency).toBe("PYG");
    expect(body.saleCount).toBe(3);
    expect(body.rows).toEqual([
      { bucketDate: "2026-06-10", saleCount: 2, net: "120.00", tax: "12.00", gross: "132.00" },
      { bucketDate: "2026-06-11", saleCount: 1, net: "300.00", tax: "30.00", gross: "330.00" },
    ]);
    // Decimal strings, exact to the cent — the totals are the row sums.
    expect(body.totalNet).toBe("420.00");
    expect(body.totalTax).toBe("42.00");
    expect(body.totalGross).toBe("462.00");
  });

  it("counts the sale on the exclusive boundary in the NEXT period, not this one", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get("/reports/sales-by-period?from=2026-06-12&to=2026-06-12")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const body = response.body as SalesByPeriodResponse;
    expect(body.period.fromInstant).toBe("2026-06-12T03:00:00.000Z");
    expect(body.period.toInstant).toBe("2026-06-13T03:00:00.000Z");
    expect(body.saleCount).toBe(1);
    expect(body.rows).toEqual([
      { bucketDate: "2026-06-12", saleCount: 1, net: "4000.00", tax: "400.00", gross: "4400.00" },
    ]);
  });

  it("never shows another tenant's sales", async () => {
    // Tenant B's own report sees exactly its own row…
    const foreign = await supertest(booted.app.getHttpServer())
      .get(`/reports/sales-by-period?${PERIOD_QUERY}`)
      .set("Cookie", fixture.b.actor.cookie)
      .expect(200);
    const foreignBody = foreign.body as SalesByPeriodResponse;
    expect(foreignBody.saleCount).toBe(1);
    expect(foreignBody.totalGross).toBe("55000.00");

    // …and tenant A's report never contains B's amounts for the SAME period.
    const local = await supertest(booted.app.getHttpServer())
      .get(`/reports/sales-by-period?${PERIOD_QUERY}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const localBody = local.body as SalesByPeriodResponse;
    expect(localBody.totalGross).not.toBe(foreignBody.totalGross);
    expect(JSON.stringify(localBody)).not.toContain("55000.00");
    expect(JSON.stringify(localBody)).not.toContain("50000.00");
  });

  it("reads the currency from the tenant's own sales settings, never a constant", async () => {
    booted.db.prisma.tenantSettingNamespace.upsert({
      where: {
        tenantId_namespace: { tenantId: fixture.b.id, namespace: "sales" },
      },
      create: {
        tenantId: fixture.b.id,
        namespace: "sales",
        schemaVersion: 1,
        data: { defaultCurrency: "USD", requireCustomerForInvoice: false },
      },
      update: {
        schemaVersion: 1,
        data: { defaultCurrency: "USD", requireCustomerForInvoice: false },
      },
    });

    const foreign = await supertest(booted.app.getHttpServer())
      .get(`/reports/sales-by-period?${PERIOD_QUERY}`)
      .set("Cookie", fixture.b.actor.cookie)
      .expect(200);
    expect((foreign.body as SalesByPeriodResponse).currency).toBe("USD");

    const local = await supertest(booted.app.getHttpServer())
      .get(`/reports/sales-by-period?${PERIOD_QUERY}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    expect((local.body as SalesByPeriodResponse).currency).toBe("PYG");
  });

  it("returns an empty row set, not an error, for a period with no sales", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get("/reports/sales-by-period?from=2019-01-01&to=2019-01-02")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const body = response.body as SalesByPeriodResponse;
    expect(body.rows).toEqual([]);
    expect(body.saleCount).toBe(0);
    expect(body.totalNet).toBe("0.00");
    expect(body.totalGross).toBe("0.00");
    expect(body.period.fromDate).toBe("2019-01-01");
  });

  it("echoes the resolved preset when one is asked for", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get("/reports/sales-by-period?preset=today")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const body = response.body as SalesByPeriodResponse;
    expect(body.period.preset).toBe("today");
    // "Today" is one local day, whatever the wall clock says when this runs.
    expect(body.period.fromDate).toBe(body.period.toDate);
    expect(body.period.timeZone).toBe("America/Asuncion");
    expect(Date.parse(body.period.toInstant) - Date.parse(body.period.fromInstant)).toBe(
      86_400_000
    );
  });

  it("refuses every malformed period with its own stable message", async () => {
    const cases: readonly { label: string; query: string; message: string }[] = [
      { label: "no period", query: "", message: REPORT_PERIOD_MISSING_MESSAGE },
      {
        label: "unknown preset",
        query: "preset=quarter",
        message: REPORT_PERIOD_UNKNOWN_PRESET_MESSAGE,
      },
      {
        label: "preset plus range",
        query: "preset=today&from=2026-06-10",
        message: REPORT_PERIOD_SHAPE_CONFLICT_MESSAGE,
      },
      {
        label: "half a range",
        query: "from=2026-06-10",
        message: REPORT_PERIOD_INCOMPLETE_RANGE_MESSAGE,
      },
      {
        label: "malformed date",
        query: "from=2026-02-30&to=2026-03-01",
        message: REPORT_PERIOD_DATE_FORMAT_MESSAGE,
      },
      {
        label: "raw instant",
        query: "from=2026-06-10T00:00:00Z&to=2026-06-11",
        message: REPORT_PERIOD_DATE_FORMAT_MESSAGE,
      },
      {
        label: "inverted range",
        query: "from=2026-06-12&to=2026-06-10",
        message: REPORT_PERIOD_INVERTED_MESSAGE,
      },
      {
        label: "over the span bound",
        query: "from=2026-01-01&to=2027-01-02",
        message: REPORT_PERIOD_TOO_LONG_MESSAGE,
      },
      {
        label: "unknown key",
        query: `${PERIOD_QUERY}&tenantId=11111111-1111-4111-8111-111111111111`,
        message: REPORT_PERIOD_QUERY_INVALID_MESSAGE,
      },
    ];

    for (const scenario of cases) {
      const response = await supertest(booted.app.getHttpServer())
        .get(`/reports/sales-by-period?${scenario.query}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(400);
      expect((response.body as ErrorDto).error.code, scenario.label).toBe("VALIDATION_FAILED");
      expect((response.body as ErrorDto).error.message, scenario.label).toBe(scenario.message);
    }
  });

  it("refuses the report without reports.read, before any row is read", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get(`/reports/sales-by-period?${PERIOD_QUERY}`)
      .set("Cookie", fixture.noPermission.cookie)
      .expect(403);

    expect((response.body as ErrorDto).error.code).toBe("FORBIDDEN");
    expect(JSON.stringify(response.body)).not.toContain("462.00");
  });

  it("requires authentication at all", async () => {
    await supertest(booted.app.getHttpServer())
      .get(`/reports/sales-by-period?${PERIOD_QUERY}`)
      .expect(401);
  });
});

/**
 * The two commercial reports ([[REP-003]]) over their own boot: this suite seeds
 * catalog items and payments, so it cannot share the sales-by-period fixture
 * (whose sale lines reference no catalog row and whose sales carry no payment).
 */

interface CommercialTenant {
  id: string;
  actor: RbacActor;
}

/** One priced line as the fixture freezes it (the completed-sale snapshot). */
interface CommercialLineSeed {
  readonly catalogItemId: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly lineTotal: string;
  readonly taxableBase: string;
  readonly taxAmount: string;
  /** Frozen stable rate code (DEC-021); defaults to the exempt rate. */
  readonly rateCode?: string;
}

interface CommercialFixture {
  /** Probing tenant: holds `reports.read` and owns the rows the reports count. */
  a: CommercialTenant;
  /** Foreign tenant: holds `reports.read` too and owns rows A must NEVER see. */
  b: CommercialTenant;
  /** Member of A whose role holds NO report permission (403 probe). */
  noPermission: RbacActor;
  createItem(owner: CommercialTenant, kind: CatalogKindSeed, name: string): { id: string };
  seedSale(
    owner: CommercialTenant,
    options: {
      completedAt: Date | null;
      status?: "DRAFT" | "COMPLETED" | "CANCELLED";
      lines: readonly CommercialLineSeed[];
      payments?: readonly { method: PaymentMethodRow; amount: string }[];
    }
  ): { id: string };
}

type CatalogKindSeed = "PRODUCT" | "SERVICE" | "MEDICATION" | "SUPPLY";

/**
 * Two tenants with the same `reports.read` grant and one actor without it. The
 * catalog rows are REAL (the by-product report resolves names and kinds from
 * them) and the payments are written exactly where the completion transaction
 * writes them — under the completed sale.
 */
function seedCommercial(db: IsolationDatabase): CommercialFixture {
  const suffix = randomUUID().slice(0, 8);

  function seedTenant(letter: string): CommercialTenant {
    const tenant = db.prisma.tenant.create({
      data: { slug: `commerce-${letter}-${suffix}`, name: `Commerce ${letter.toUpperCase()}` },
    });
    const role = seedRoleWithKeys(db, `COMMERCE_${letter.toUpperCase()}_${suffix}`, "Commerce", [
      REPORTING_PERMISSIONS.read,
    ]);
    const actor = seedRbacActor(db, {
      email: `commerce-${letter}-${suffix}@isolation.test`,
      tenantId: tenant.id,
      roleId: role.role.id,
    });
    return { id: tenant.id, actor };
  }

  const a = seedTenant("a");
  const b = seedTenant("b");

  const noPermissionRole = seedRoleWithKeys(db, `COMMERCE_NONE_${suffix}`, "Commerce none", []);
  const noPermission = seedRbacActor(db, {
    email: `commerce-none-${suffix}@isolation.test`,
    tenantId: a.id,
    roleId: noPermissionRole.role.id,
  });

  const createItem: CommercialFixture["createItem"] = (owner, kind, name) => {
    const item = db.prisma.catalogItem.create({
      data: {
        tenantId: owner.id,
        kind,
        name,
        // GLOBAL reference rate: exempt keeps every fixture line's arithmetic the
        // identity, so a tax assertion below is about the report and not about
        // the rate table.
        taxRateId: SEEDED_TAX_RATE_IDS.EXEMPT,
      },
    });
    return { id: item.id };
  };

  const seedSale: CommercialFixture["seedSale"] = (owner, options) => {
    const sale = db.prisma.sale.create({
      data: {
        tenantId: owner.id,
        currency: "PYG",
        status: options.status ?? "COMPLETED",
        lines: {
          create: options.lines.map((line) => ({
            catalogItemId: line.catalogItemId,
            rateCode: line.rateCode ?? "EXEMPT",
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            lineTotal: line.lineTotal,
            taxableBase: line.taxableBase,
            taxAmount: line.taxAmount,
          })),
        },
      },
    });
    // `completed_at` is written ONLY by the completion transaction (DEC-064), so
    // the fixture writes it through that same conditional update path.
    if (options.completedAt !== null) {
      db.prisma.sale.updateMany({
        where: { id: sale.id },
        data: { completedAt: options.completedAt },
      });
    }
    // Payments are written only for a COMPLETED sale — a draft carries none
    // (DEC-029). A CANCELLED fixture still gets them on purpose: the report must
    // exclude them by the SALE's status predicate, not by trusting the caller.
    for (const payment of options.payments ?? []) {
      db.prisma.payment.create({
        data: {
          tenantId: owner.id,
          saleId: sale.id,
          method: payment.method,
          amount: payment.amount,
        },
      });
    }
    return { id: sale.id };
  };

  return { a, b, noPermission, createItem, seedSale };
}

describe("the commercial reports (REP-003)", () => {
  let booted: BootedTestApp;
  let fixture: CommercialFixture;

  /** The seeded revenue of tenant A, by catalog item. */
  let productA: string;
  let serviceB: string;
  let medicationC: string;

  /**
   * The fixture's period: 2026-06-10 through 2026-06-11 in Asunción (`-03`), the
   * half-open instant range `[2026-06-10T03:00Z, 2026-06-12T03:00Z)`.
   */
  const PERIOD = "from=2026-06-10&to=2026-06-11";

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedCommercial(booted.db);

    productA = fixture.createItem(fixture.a, "PRODUCT", "Vacuna antirrábica").id;
    serviceB = fixture.createItem(fixture.a, "SERVICE", "Consulta clínica").id;
    medicationC = fixture.createItem(fixture.a, "MEDICATION", "Antibiótico").id;

    // Day 2026-06-10: one sale paid with TWO methods, one of them an amount no
    // double can represent exactly (1000.55).
    fixture.seedSale(fixture.a, {
      completedAt: new Date("2026-06-10T12:00:00.000Z"),
      lines: [
        {
          catalogItemId: productA,
          quantity: "2.000",
          unitPrice: "500.00",
          lineTotal: "1000.00",
          taxableBase: "1000.00",
          taxAmount: "0.00",
        },
        {
          catalogItemId: serviceB,
          quantity: "1.000",
          unitPrice: "250.00",
          lineTotal: "250.00",
          taxableBase: "250.00",
          taxAmount: "0.00",
        },
      ],
      payments: [
        { method: "CASH", amount: "1000.55" },
        { method: "CARD", amount: "249.45" },
      ],
    });

    // 2026-06-11T02:00Z is 23:00 on the 10th in Asunción: still the LOCAL day 10.
    fixture.seedSale(fixture.a, {
      completedAt: new Date("2026-06-11T02:00:00.000Z"),
      lines: [
        {
          catalogItemId: medicationC,
          quantity: "3.500",
          unitPrice: "100.00",
          lineTotal: "350.00",
          taxableBase: "350.00",
          taxAmount: "0.00",
        },
        {
          catalogItemId: productA,
          quantity: "1.000",
          unitPrice: "500.00",
          lineTotal: "500.00",
          taxableBase: "500.00",
          taxAmount: "0.00",
        },
      ],
      payments: [{ method: "BANK_TRANSFER", amount: "850.00" }],
    });

    // Day 2026-06-11, with a real tax split (IVA 10%) so the tax column is not
    // trivially zero.
    fixture.seedSale(fixture.a, {
      completedAt: new Date("2026-06-11T14:00:00.000Z"),
      lines: [
        {
          catalogItemId: serviceB,
          quantity: "1.000",
          unitPrice: "330.00",
          lineTotal: "330.00",
          taxableBase: "300.00",
          taxAmount: "30.00",
          rateCode: "IVA_10",
        },
      ],
      payments: [{ method: "CARD", amount: "330.00" }],
    });

    // Always excluded: a cancelled sale completed something worth reporting.
    fixture.seedSale(fixture.a, {
      completedAt: new Date("2026-06-10T12:00:00.000Z"),
      status: "CANCELLED",
      lines: [
        {
          catalogItemId: productA,
          quantity: "9.000",
          unitPrice: "1000.00",
          lineTotal: "9000.00",
          taxableBase: "9000.00",
          taxAmount: "0.00",
        },
      ],
      payments: [{ method: "CHECK", amount: "9000.00" }],
    });

    // Always excluded: a draft is never revenue and carries no payment.
    fixture.seedSale(fixture.a, {
      completedAt: null,
      status: "DRAFT",
      lines: [
        {
          catalogItemId: medicationC,
          quantity: "7.000",
          unitPrice: "100.00",
          lineTotal: "700.00",
          taxableBase: "700.00",
          taxAmount: "0.00",
        },
      ],
    });

    // The foreign tenant: its own catalog item, sale and payment, inside the same
    // period, which tenant A must never see in either report.
    const foreignItem = fixture.createItem(fixture.b, "SUPPLY", "Insumo ajeno").id;
    fixture.seedSale(fixture.b, {
      completedAt: new Date("2026-06-10T15:00:00.000Z"),
      lines: [
        {
          catalogItemId: foreignItem,
          quantity: "1.000",
          unitPrice: "9999.00",
          lineTotal: "9999.00",
          taxableBase: "9999.00",
          taxAmount: "0.00",
        },
      ],
      payments: [{ method: "OTHER", amount: "9999.00" }],
    });
  });

  afterAll(async () => {
    await booted.close();
  });

  it("returns payment methods ordered by amount with their share of gross", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get(`/reports/payment-methods?${PERIOD}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const body = response.body as PaymentMethodsResponse;
    expect(body.report).toBe("payment-methods");
    expect(body.period).toEqual({
      preset: null,
      fromDate: "2026-06-10",
      toDate: "2026-06-11",
      timeZone: "America/Asuncion",
      fromInstant: "2026-06-10T03:00:00.000Z",
      toInstant: "2026-06-12T03:00:00.000Z",
    });
    expect(body.currency).toBe("PYG");
    expect(body.totalGross).toBe("2430.00");
    expect(body.rows).toEqual([
      // CASH 1000.55 and BANK_TRANSFER 850.00 first; CARD sums two payments
      // (249.45 + 330.00). CHECK exists only on the CANCELLED sale: absent.
      { method: "CASH", paymentCount: 1, amount: "1000.55", shareOfGross: "0.4117" },
      { method: "BANK_TRANSFER", paymentCount: 1, amount: "850.00", shareOfGross: "0.3498" },
      { method: "CARD", paymentCount: 2, amount: "579.45", shareOfGross: "0.2385" },
    ]);
  });

  it("returns sales by product/service with the kind roll-up", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get(`/reports/sales-by-product-service?${PERIOD}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const body = response.body as SalesByProductServiceResponse;
    expect(body.report).toBe("sales-by-product-service");
    expect(body.currency).toBe("PYG");
    expect(body.rows).toEqual([
      {
        catalogItemId: productA,
        name: "Vacuna antirrábica",
        kind: "PRODUCT",
        quantity: "3.000",
        net: "1500.00",
        tax: "0.00",
        gross: "1500.00",
      },
      {
        catalogItemId: serviceB,
        name: "Consulta clínica",
        kind: "SERVICE",
        quantity: "2.000",
        net: "550.00",
        tax: "30.00",
        gross: "580.00",
      },
      {
        catalogItemId: medicationC,
        name: "Antibiótico",
        kind: "MEDICATION",
        quantity: "3.500",
        net: "350.00",
        tax: "0.00",
        gross: "350.00",
      },
    ]);
    // Only the kinds that appear: SUPPLY is not "0.00", it is absent.
    expect(body.totalsByKind).toEqual({
      PRODUCT: { net: "1500.00", tax: "0.00", gross: "1500.00", quantity: "3.000" },
      SERVICE: { net: "550.00", tax: "30.00", gross: "580.00", quantity: "2.000" },
      MEDICATION: { net: "350.00", tax: "0.00", gross: "350.00", quantity: "3.500" },
    });
  });

  it("agrees with sales-by-period: tenders and item grosses sum to the period gross EXACTLY", async () => {
    const period = await supertest(booted.app.getHttpServer())
      .get(`/reports/sales-by-period?${PERIOD}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const methods = await supertest(booted.app.getHttpServer())
      .get(`/reports/payment-methods?${PERIOD}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const byItem = await supertest(booted.app.getHttpServer())
      .get(`/reports/sales-by-product-service?${PERIOD}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const periodBody = period.body as SalesByPeriodResponse;
    const methodsBody = methods.body as PaymentMethodsResponse;
    const itemBody = byItem.body as SalesByProductServiceResponse;

    const sum = (values: readonly string[]): string =>
      values
        .reduce((total, value) => total.plus(new Prisma.Decimal(value)), new Prisma.Decimal(0))
        .toFixed(2);

    // Payments sum EXACTLY to the sale total (Sales.md), and a sale's total is
    // derived from its lines — so all three reports describe one revenue.
    expect(periodBody.totalGross).toBe("2430.00");
    expect(methodsBody.totalGross).toBe(periodBody.totalGross);
    expect(sum(methodsBody.rows.map((row) => row.amount))).toBe(periodBody.totalGross);
    expect(sum(itemBody.rows.map((row) => row.gross))).toBe(periodBody.totalGross);

    // String equality is the whole point: no epsilon, no `toBeCloseTo`. A
    // floating-point accumulator is exactly what this system never uses.
    expect(sum(methodsBody.rows.map((row) => row.amount))).not.toBe("2430.0000000000005");
  });

  it("never shows another tenant's payments or sale lines", async () => {
    const foreignMethods = await supertest(booted.app.getHttpServer())
      .get(`/reports/payment-methods?${PERIOD}`)
      .set("Cookie", fixture.b.actor.cookie)
      .expect(200);
    const foreignItems = await supertest(booted.app.getHttpServer())
      .get(`/reports/sales-by-product-service?${PERIOD}`)
      .set("Cookie", fixture.b.actor.cookie)
      .expect(200);

    const foreignMethodsBody = foreignMethods.body as PaymentMethodsResponse;
    const foreignItemsBody = foreignItems.body as SalesByProductServiceResponse;
    expect(foreignMethodsBody.totalGross).toBe("9999.00");
    expect(foreignMethodsBody.rows).toEqual([
      { method: "OTHER", paymentCount: 1, amount: "9999.00", shareOfGross: "1.0000" },
    ]);
    expect(foreignItemsBody.rows.map((row) => row.name)).toEqual(["Insumo ajeno"]);

    // Tenant A sees its own revenue only, in BOTH commercial reports.
    const localMethods = await supertest(booted.app.getHttpServer())
      .get(`/reports/payment-methods?${PERIOD}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const localItems = await supertest(booted.app.getHttpServer())
      .get(`/reports/sales-by-product-service?${PERIOD}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    expect(JSON.stringify(localMethods.body)).not.toContain("9999.00");
    expect(JSON.stringify(localMethods.body)).not.toContain("OTHER");
    expect(JSON.stringify(localItems.body)).not.toContain("Insumo ajeno");
    expect(JSON.stringify(localItems.body)).not.toContain("9999.00");
  });

  it("returns an empty answer, not an error, for a period with no revenue", async () => {
    const methods = await supertest(booted.app.getHttpServer())
      .get("/reports/payment-methods?from=2019-01-01&to=2019-01-02")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const items = await supertest(booted.app.getHttpServer())
      .get("/reports/sales-by-product-service?from=2019-01-01&to=2019-01-02")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const methodsBody = methods.body as PaymentMethodsResponse;
    expect(methodsBody.rows).toEqual([]);
    expect(methodsBody.totalGross).toBe("0.00");
    expect(methodsBody.period.fromDate).toBe("2019-01-01");

    const itemsBody = items.body as SalesByProductServiceResponse;
    expect(itemsBody.rows).toEqual([]);
    expect(itemsBody.totalsByKind).toEqual({});
    expect(itemsBody.period.fromDate).toBe("2019-01-01");
  });

  it("refuses a malformed period on both routes with the same stable messages", async () => {
    const cases: readonly { label: string; query: string; message: string }[] = [
      { label: "no period", query: "", message: REPORT_PERIOD_MISSING_MESSAGE },
      {
        label: "malformed date",
        query: "from=2026-02-30&to=2026-03-01",
        message: REPORT_PERIOD_DATE_FORMAT_MESSAGE,
      },
      {
        label: "unknown key",
        query: `${PERIOD}&tenantId=11111111-1111-4111-8111-111111111111`,
        message: REPORT_PERIOD_QUERY_INVALID_MESSAGE,
      },
    ];

    for (const route of ["payment-methods", "sales-by-product-service"]) {
      for (const scenario of cases) {
        const response = await supertest(booted.app.getHttpServer())
          .get(`/reports/${route}?${scenario.query}`)
          .set("Cookie", fixture.a.actor.cookie)
          .expect(400);
        expect((response.body as ErrorDto).error.code, `${route}: ${scenario.label}`).toBe(
          "VALIDATION_FAILED"
        );
        expect((response.body as ErrorDto).error.message, `${route}: ${scenario.label}`).toBe(
          scenario.message
        );
      }
    }
  });

  it("refuses both reports without reports.read, before any row is read", async () => {
    for (const route of ["payment-methods", "sales-by-product-service"]) {
      const response = await supertest(booted.app.getHttpServer())
        .get(`/reports/${route}?${PERIOD}`)
        .set("Cookie", fixture.noPermission.cookie)
        .expect(403);
      expect((response.body as ErrorDto).error.code, route).toBe("FORBIDDEN");
      expect(JSON.stringify(response.body), route).not.toContain("2430.00");
    }
  });
});
