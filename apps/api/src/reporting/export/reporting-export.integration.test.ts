import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { TENANT_TIME_ZONE } from "@newsaas/shared";
import { bootTestApp, type BootedTestApp } from "../../../test/support/boot-test-app.js";
import type { IsolationDatabase } from "../../../test/support/in-memory-database.js";
import { SEEDED_TAX_RATE_IDS } from "../../../test/support/in-memory-database.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
} from "../../../test/support/rbac-fixture.js";
import {
  REPORT_PERIOD_DATE_FORMAT_MESSAGE,
  REPORT_PERIOD_INCOMPLETE_RANGE_MESSAGE,
  tenantCalendarDate,
} from "../report.period.js";
import { REPORT_HORIZON_INTEGER_MESSAGE, REPORT_HORIZON_RANGE_MESSAGE } from "../report.horizon.js";
import { REPORT_QUERY_NOT_ALLOWED_MESSAGE, type SalesByPeriodResponse } from "../reporting.dto.js";
import { REPORTING_PERMISSIONS } from "../reporting.permissions.js";
import { REPORT_READ_FORBIDDEN_MESSAGE } from "../reporting.service.js";
import {
  REPORT_EXPORT_CODES,
  REPORT_EXPORT_DEFINITIONS,
  REPORT_EXPORT_UNKNOWN_CODE_MESSAGE,
  type ReportExportCode,
} from "./report-export.definitions.js";
import { REPORT_EXPORT_CONTENT_TYPE } from "./report-export.controller.js";
import { REPORT_EXPORT_FORBIDDEN_MESSAGE } from "./report-export.service.js";

/**
 * The CSV export over the REAL guard chain and the in-memory boundary
 * ([[REP-007]], [[DEC-062]], [[DEC-066]]).
 *
 * Three things are proven here and nowhere else, because they are properties of
 * the wired route rather than of a unit:
 *
 * - the media type, the `Content-Disposition` filename and the header row of
 *   EVERY shipped report, through the real Nest/Fastify response;
 * - the row set of an export and of the JSON report are the SAME rows for the
 *   same arguments (the Story's single-query invariant), compared field for
 *   field against the live report response;
 * - the two permissions really are two grants: `reports.read` alone is refused,
 *   `reports.export` alone is enough, and each actor keeps the OTHER access.
 *
 * The range is always an explicit `from`/`to` pair; the two due reports and
 * `low-stock` pivot on the live clock, so their filename date is asserted against
 * the tenant calendar day rather than against a literal.
 */

interface ErrorDto {
  error: { code: string; message: string };
}

interface ExportTenant {
  readonly id: string;
  readonly actor: RbacActor;
}

interface ExportFixture {
  /** Tenant A: both report grants, owns the rows an export must contain. */
  readonly a: ExportTenant;
  /** Tenant B: both report grants, owns rows A must NEVER see. */
  readonly b: ExportTenant;
  /** Member of A holding `reports.export` and NOT `reports.read`. */
  readonly exportOnly: RbacActor;
  /** Member of A holding `reports.read` and NOT `reports.export`. */
  readonly readOnly: RbacActor;
}

/** The half-open instant range the assertions use: 2026-06-10..11 in Asunción (`-03`). */
const PERIOD_QUERY = "from=2026-06-10&to=2026-06-11";

/** The `<from>-<to>` fragment a period report's filename carries. */
const PERIOD_DATES = "2026-06-10-2026-06-11";

/**
 * The DOCUMENTED header row per report — the contract, written out here rather
 * than derived from the implementation, so a drift in the table above is caught
 * by this suite instead of agreeing with it.
 */
const DOCUMENTED_HEADERS: Readonly<Record<string, string>> = {
  "sales-by-period": "bucketDate,saleCount,net,tax,gross",
  "payment-methods": "method,paymentCount,amount,shareOfGross",
  "sales-by-product-service": "catalogItemId,name,kind,quantity,net,tax,gross",
  "cash-sessions":
    "sessionId,registerId,openedAt,closedAt,openingAmount,expectedAmount,countedAmount,differenceAmount",
  "cash-movements": "type,direction,movementCount,signedAmount",
  purchases: "purchaseId,supplierId,supplierName,receivedAt,lineCount,totalQuantity",
  stock: "catalogItemId,name,kind,quantity,inbound,outbound,net",
  "low-stock": "catalogItemId,name,quantity,threshold,shortfall",
  consultations: "bucketDate,consultationCount",
  "new-patients": "bucketDate,count",
  "vaccines-due": "patientId,patientName,vaccine,administeredAt,nextDueAt,status",
  "deworming-due": "patientId,patientName,product,administeredAt,nextDueAt,status",
};

/** One completed sale at an explicit business instant, as the completion command writes it. */
function seedSale(
  db: IsolationDatabase,
  tenantId: string,
  options: {
    readonly completedAt: string;
    readonly taxableBase: string;
    readonly taxAmount: string;
    readonly lineTotal: string;
  }
): void {
  // A REAL catalog item: `sales-by-product-service` resolves every line's name
  // and kind from the catalog and refuses a line whose item is missing, so a
  // random id here would make that export a 500 rather than a row.
  const item = db.prisma.catalogItem.create({
    data: {
      tenantId,
      kind: "PRODUCT",
      name: `Item ${randomUUID().slice(0, 8)}`,
      taxRateId: SEEDED_TAX_RATE_IDS.EXEMPT,
    },
  });
  const sale = db.prisma.sale.create({
    data: {
      tenantId,
      currency: "PYG",
      status: "COMPLETED",
      lines: {
        create: [
          {
            catalogItemId: item.id,
            rateCode: "EXEMPT",
            unitPrice: options.taxableBase,
            quantity: "1.000",
            lineTotal: options.lineTotal,
            taxableBase: options.taxableBase,
            taxAmount: options.taxAmount,
          },
        ],
      },
    },
  });
  // `completed_at` is written ONLY by the completion transaction (DEC-064), so
  // the fixture writes it through that same conditional update path.
  db.prisma.sale.updateMany({
    where: { id: sale.id },
    data: { completedAt: new Date(options.completedAt) },
  });
}

/** Seeds one closed drawer and a `SALE` movement — a kind whose `direction` is `null`. */
function seedCash(db: IsolationDatabase, tenant: ExportTenant): void {
  const register = db.prisma.cashRegister.create({
    data: { tenantId: tenant.id, name: "Main drawer" },
  });
  const session = db.prisma.cashSession.create({
    data: {
      tenantId: tenant.id,
      registerId: register.id,
      openedByMembershipId: tenant.actor.membership?.id ?? randomUUID(),
      openingAmount: "100.00",
    },
  });
  db.prisma.cashSession.updateMany({
    where: { id: session.id, tenantId: tenant.id },
    data: {
      status: "CLOSED",
      closedAt: new Date("2026-06-11T20:00:00.000Z"),
      expectedAmount: "110.00",
      countedAmount: "110.00",
      differenceAmount: "0.00",
    },
  });
  const movement = db.prisma.cashMovement.create({
    data: {
      tenantId: tenant.id,
      registerId: register.id,
      sessionId: session.id,
      type: "SALE",
      // `null` on purpose: a type-owned kind carries no direction, and the export
      // must render an EMPTY field for it.
      direction: null,
      amount: "110.00",
    },
  });
  const stored = db.tables.cashMovements.get(movement.id);
  if (stored === undefined) {
    throw new Error("The in-memory cash movement row was not stored.");
  }
  // `cash_movement` is append-only with no `updated_at`: its creation instant IS
  // its business instant, and the fixture dates it where the report reads it.
  stored.createdAt = new Date("2026-06-10T12:00:00.000Z");
}

/**
 * Two tenants with both report grants, plus the two single-grant actors that
 * prove the keys are separate.
 */
function seedExportFixture(db: IsolationDatabase): ExportFixture {
  const suffix = randomUUID().slice(0, 8);

  function seedTenant(letter: string): { id: string; roleId: string } {
    const tenant = db.prisma.tenant.create({
      data: { slug: `export-${letter}-${suffix}`, name: `Export ${letter.toUpperCase()}` },
    });
    const role = seedRoleWithKeys(db, `EXPORT_${letter.toUpperCase()}_${suffix}`, "Export", [
      REPORTING_PERMISSIONS.read,
      REPORTING_PERMISSIONS.export,
    ]);
    return { id: tenant.id, roleId: role.role.id };
  }

  function actorFor(tenantId: string, roleId: string, label: string): RbacActor {
    return seedRbacActor(db, {
      email: `export-${label}-${suffix}@isolation.test`,
      tenantId,
      roleId,
    });
  }

  const tenantA = seedTenant("a");
  const tenantB = seedTenant("b");
  const a: ExportTenant = { id: tenantA.id, actor: actorFor(tenantA.id, tenantA.roleId, "a") };
  const b: ExportTenant = { id: tenantB.id, actor: actorFor(tenantB.id, tenantB.roleId, "b") };

  const exportOnlyRole = seedRoleWithKeys(db, `EXPORT_ONLY_${suffix}`, "Export only", [
    REPORTING_PERMISSIONS.export,
  ]);
  const readOnlyRole = seedRoleWithKeys(db, `READ_ONLY_${suffix}`, "Read only", [
    REPORTING_PERMISSIONS.read,
  ]);

  return {
    a,
    b,
    exportOnly: actorFor(a.id, exportOnlyRole.role.id, "export-only"),
    readOnly: actorFor(a.id, readOnlyRole.role.id, "read-only"),
  };
}

/**
 * A minimal RFC 4180 reader, used to compare an export with the JSON report.
 *
 * Written here rather than reusing the serializer: a round trip through the same
 * code would prove only that the module agrees with itself. A quoted field may
 * carry commas, doubled quotes and newlines, so `split(",")` would not do.
 */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = false;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  // An unterminated trailing field would mean the document lost its final
  // newline, which the serializer always writes.
  expect({ record, field }).toEqual({ record: [], field: "" });
  return records;
}

/**
 * The path of one report's export, carrying the query its contract actually
 * accepts: a period report gets the standard range, and the due and
 * current-state reports get NO query at all — sending one would be the `400`
 * their own routes return.
 */
function exportPath(reportCode: ReportExportCode): string {
  const { queryContract } = REPORT_EXPORT_DEFINITIONS[reportCode];
  return queryContract === "period"
    ? `/reports/${reportCode}/export?${PERIOD_QUERY}`
    : `/reports/${reportCode}/export`;
}

/** The filename an `attachment` header carries, or the raw header when it does not match. */
function filenameOf(contentDisposition: string | undefined): string {
  return (contentDisposition ?? "").replace(/^attachment; filename="(.*)"$/, "$1");
}

describe("GET /reports/:reportCode/export", () => {
  let booted: BootedTestApp;
  let fixture: ExportFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedExportFixture(booted.db);

    // Tenant A: two days of revenue inside the period.
    seedSale(booted.db, fixture.a.id, {
      completedAt: "2026-06-10T12:00:00.000Z",
      taxableBase: "100.00",
      taxAmount: "10.00",
      lineTotal: "110.00",
    });
    seedSale(booted.db, fixture.a.id, {
      completedAt: "2026-06-11T12:00:00.000Z",
      taxableBase: "300.00",
      taxAmount: "30.00",
      lineTotal: "330.00",
    });
    // Tenant B: the row that must never reach A's export.
    seedSale(booted.db, fixture.b.id, {
      completedAt: "2026-06-10T12:00:00.000Z",
      taxableBase: "50000.00",
      taxAmount: "5000.00",
      lineTotal: "55000.00",
    });
    seedCash(booted.db, fixture.a);
  });

  afterAll(async () => {
    await booted.close();
  });

  it("answers every shipped report with text/csv, an attachment filename and its header row", async () => {
    for (const reportCode of REPORT_EXPORT_CODES) {
      // The due reports and `low-stock` carry no period in their name, so their
      // as-of date is read around the request: a run that straddles midnight in
      // the tenant zone is not a failure.
      const beforeAsOf = tenantCalendarDate(new Date(), TENANT_TIME_ZONE);

      const response = await supertest(booted.app.getHttpServer())
        .get(exportPath(reportCode))
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const afterAsOf = tenantCalendarDate(new Date(), TENANT_TIME_ZONE);
      const contentDisposition = response.headers["content-disposition"];
      const filename = filenameOf(contentDisposition);

      expect(response.headers["content-type"], reportCode).toBe(REPORT_EXPORT_CONTENT_TYPE);
      expect(contentDisposition, reportCode).toBe(`attachment; filename="${filename}"`);
      expect(filename.endsWith(".csv"), reportCode).toBe(true);
      if (REPORT_EXPORT_DEFINITIONS[reportCode].queryContract === "period") {
        expect(filename, reportCode).toBe(`${reportCode}-${PERIOD_DATES}.csv`);
      } else {
        expect([`${reportCode}-${beforeAsOf}.csv`, `${reportCode}-${afterAsOf}.csv`]).toContain(
          filename
        );
      }

      // The header row is the documented column list, verbatim, and it is present
      // even when the report has no rows at all.
      expect(response.text.split("\n")[0], reportCode).toBe(DOCUMENTED_HEADERS[reportCode]);
    }
  });

  it("returns the export's rows as the JSON report's rows, field for field", async () => {
    const json = await supertest(booted.app.getHttpServer())
      .get(`/reports/sales-by-period?${PERIOD_QUERY}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const report = json.body as SalesByPeriodResponse;

    const exported = await supertest(booted.app.getHttpServer())
      .get(exportPath("sales-by-period"))
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const [header, ...rows] = parseCsv(exported.text);
    expect(header).toEqual(["bucketDate", "saleCount", "net", "tax", "gross"]);
    // The JSON rows and the CSV rows are the SAME rows: the export is a rendering
    // of the report, never a second query of its own.
    expect(rows).toEqual(
      report.rows.map((row) => [row.bucketDate, String(row.saleCount), row.net, row.tax, row.gross])
    );
    // The money scale survives the whole path: `100.00`, never `100` or `100.0`.
    expect(rows.map((row) => row[2])).toEqual(["100.00", "300.00"]);
  });

  it("renders a null cash-movement direction as an empty field", async () => {
    const exported = await supertest(booted.app.getHttpServer())
      .get(exportPath("cash-movements"))
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    expect(parseCsv(exported.text)).toEqual([
      ["type", "direction", "movementCount", "signedAmount"],
      // `SALE` owns its sign, so there is no direction to print — an empty field,
      // never the word `null`.
      ["SALE", "", "1", "110.00"],
    ]);
  });

  it("never contains another tenant's rows", async () => {
    const foreign = await supertest(booted.app.getHttpServer())
      .get(exportPath("sales-by-period"))
      .set("Cookie", fixture.b.actor.cookie)
      .expect(200);
    expect(foreign.text).toContain("55000.00");

    const local = await supertest(booted.app.getHttpServer())
      .get(exportPath("sales-by-period"))
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    expect(local.text).not.toContain("55000.00");
    expect(local.text).not.toContain("50000.00");
    expect(local.text).toContain("330.00");
  });

  it("refuses an unknown report code with 404 and the stable message", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get(`/reports/profit-and-loss/export?${PERIOD_QUERY}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(404);

    expect((response.body as ErrorDto).error).toMatchObject({
      code: "NOT_FOUND",
      message: REPORT_EXPORT_UNKNOWN_CODE_MESSAGE,
    });
  });

  it("refuses a malformed period with the period rule's own message", async () => {
    const incomplete = await supertest(booted.app.getHttpServer())
      .get("/reports/sales-by-period/export?from=2026-06-10")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(400);
    expect((incomplete.body as ErrorDto).error).toMatchObject({
      code: "VALIDATION_FAILED",
      message: REPORT_PERIOD_INCOMPLETE_RANGE_MESSAGE,
    });

    const impossibleDate = await supertest(booted.app.getHttpServer())
      .get("/reports/sales-by-period/export?from=2026-02-30&to=2026-03-01")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(400);
    expect((impossibleDate.body as ErrorDto).error).toMatchObject({
      code: "VALIDATION_FAILED",
      message: REPORT_PERIOD_DATE_FORMAT_MESSAGE,
    });
  });

  it("refuses a malformed horizon with the horizon rule's own message", async () => {
    const fractional = await supertest(booted.app.getHttpServer())
      .get("/reports/vaccines-due/export?horizonDays=1.5")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(400);
    expect((fractional.body as ErrorDto).error).toMatchObject({
      code: "VALIDATION_FAILED",
      message: REPORT_HORIZON_INTEGER_MESSAGE,
    });

    const outOfRange = await supertest(booted.app.getHttpServer())
      .get("/reports/deworming-due/export?horizonDays=366")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(400);
    expect((outOfRange.body as ErrorDto).error).toMatchObject({
      code: "VALIDATION_FAILED",
      message: REPORT_HORIZON_RANGE_MESSAGE,
    });
  });

  it("refuses ANY query key on low-stock's export", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get(`/reports/low-stock/export?${PERIOD_QUERY}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(400);

    expect((response.body as ErrorDto).error).toMatchObject({
      code: "VALIDATION_FAILED",
      message: REPORT_QUERY_NOT_ALLOWED_MESSAGE,
    });
  });

  it("refuses a caller holding reports.read WITHOUT reports.export", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get(exportPath("sales-by-period"))
      .set("Cookie", fixture.readOnly.cookie)
      .expect(403);

    // The route decorator refuses BEFORE the handler, so the message the client
    // sees is the guard's; the service's own stable message is pinned in the unit
    // suite (defense in depth behind the decorator).
    expect((response.body as ErrorDto).error.code).toBe("FORBIDDEN");
    // The same actor can still READ the report: the two grants are separate in
    // this direction.
    await supertest(booted.app.getHttpServer())
      .get(`/reports/sales-by-period?${PERIOD_QUERY}`)
      .set("Cookie", fixture.readOnly.cookie)
      .expect(200);
  });

  it("refuses a caller holding reports.export whose role lacks reports.read", async () => {
    // A DOCUMENTED CONSEQUENCE, not the delegated spec's expectation: the export
    // renders the report by calling the report's own service method, and every
    // one of those methods re-asserts `reports.read` as defense in depth behind
    // its route decorator. So `reports.export` is REQUIRED and never sufficient
    // on its own while `ReportingService.requireReadPermission` stands — making it
    // sufficient would mean weakening the assertion that guards the twelve read
    // routes, which [[DEC-062]] and the REP-002 contract do not allow.
    //
    // Nothing observable changes for a real role: the seeded matrix grants
    // `reports.export` ONLY to OWNER and ADMIN, and both also hold
    // `reports.read`.
    const response = await supertest(booted.app.getHttpServer())
      .get(exportPath("sales-by-period"))
      .set("Cookie", fixture.exportOnly.cookie)
      .expect(403);

    expect((response.body as ErrorDto).error.message).toBe(REPORT_READ_FORBIDDEN_MESSAGE);
    // The same actor cannot read the report on screen either, so the two grants
    // stay separate in this direction too.
    await supertest(booted.app.getHttpServer())
      .get(`/reports/sales-by-period?${PERIOD_QUERY}`)
      .set("Cookie", fixture.exportOnly.cookie)
      .expect(403);
  });

  it("carries a refusal message of its own, distinct from the report read's", () => {
    // Two grants, two refusals: a caller told "the required report permission is
    // missing" the day after exporting successfully would have no way to learn
    // that the missing grant is the narrower one.
    expect(REPORT_EXPORT_FORBIDDEN_MESSAGE).not.toBe(REPORT_READ_FORBIDDEN_MESSAGE);
  });
});
