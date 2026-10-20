import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import type { IsolationDatabase } from "../../test/support/in-memory-database.js";
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
  type SalesByPeriodResponse,
} from "./reporting.dto.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";

/**
 * `GET /reports/sales-by-period` over the REAL guard chain and the in-memory
 * boundary ([[REP-002]]).
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
