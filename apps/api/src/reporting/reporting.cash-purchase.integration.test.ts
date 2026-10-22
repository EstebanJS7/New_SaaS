import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import {
  SEEDED_TAX_RATE_IDS,
  type IsolationDatabase,
} from "../../test/support/in-memory-database.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
} from "../../test/support/rbac-fixture.js";
import {
  REPORT_PERIOD_DATE_FORMAT_MESSAGE,
  REPORT_PERIOD_MISSING_MESSAGE,
} from "./report.period.js";
import {
  REPORT_PERIOD_QUERY_INVALID_MESSAGE,
  type CashMovementsResponse,
  type CashSessionsResponse,
  type PurchasesResponse,
} from "./reporting.dto.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";

/**
 * The cash and purchase reports of [[REP-004]] over the REAL guard chain and the
 * in-memory boundary: `GET /reports/cash-sessions`, `GET /reports/cash-movements`
 * and `GET /reports/purchases`.
 *
 * This is where the row-level boundaries are proven, because the fake actually
 * APPLIES the predicates the repository builds: the half-open edges of
 * `closedAt`, `createdAt` and `receivedAt`, the `CLOSED`/`RECEIVED` status
 * filters, the "opened inside but closed outside" exclusion, and tenant
 * isolation. The service suite asserts the queries; this suite asserts the rows.
 *
 * The range is always an explicit `from`/`to` pair: a preset resolves against the
 * live clock, and an assertion about "today" is not a test.
 */

interface ErrorDto {
  error: { code: string; message: string };
}

interface ReportTenant {
  id: string;
  actor: RbacActor;
}

interface CashPurchaseFixture {
  /** Probing tenant: holds `reports.read`, owns the rows the reports must count. */
  a: ReportTenant;
  /** Foreign tenant: holds `reports.read` too, owns rows A must NEVER see. */
  b: ReportTenant;
  /** Member of A whose role holds NO report permission (403 probe). */
  noPermission: RbacActor;
  createRegister(owner: ReportTenant, name: string): { id: string };
  seedSession(
    owner: ReportTenant,
    registerId: string,
    options: {
      openedAt: Date;
      closedAt: Date | null;
      openingAmount?: string;
      expectedAmount?: string;
      countedAmount?: string;
      differenceAmount?: string;
    }
  ): { id: string };
  seedMovement(
    owner: ReportTenant,
    options: {
      registerId: string;
      sessionId: string;
      type: "SALE" | "REFUND" | "INCOME" | "EXPENSE" | "WITHDRAWAL" | "DEPOSIT" | "ADJUSTMENT";
      direction?: "INCREASE" | "DECREASE" | null;
      amount: string;
      createdAt: Date;
    }
  ): { id: string };
  createSupplier(owner: ReportTenant, name: string): { id: string };
  seedPurchase(
    owner: ReportTenant,
    options: {
      supplierId: string;
      status?: "DRAFT" | "RECEIVED" | "CANCELLED";
      receivedAt: Date | null;
      quantities: readonly string[];
    }
  ): { id: string };
}

/**
 * Two tenants with the same `reports.read` grant and one actor without it. No
 * entitlement is seeded for either, which is the point: [[DEC-062]] leaves the
 * report surface ungated by feature code.
 *
 * Two columns are written by mutating the stored in-memory row rather than
 * through a delegate: `cash_session.openedAt` and `cash_movement.createdAt` are
 * stamped with the wall clock on create, and the fake exposes no write for them.
 * Only the fixture does this, and only for instants the report does NOT derive
 * from a command.
 */
function seedCashAndPurchases(db: IsolationDatabase): CashPurchaseFixture {
  const suffix = randomUUID().slice(0, 8);

  function seedTenant(letter: string): ReportTenant {
    const tenant = db.prisma.tenant.create({
      data: { slug: `ledger-${letter}-${suffix}`, name: `Ledger ${letter.toUpperCase()}` },
    });
    const role = seedRoleWithKeys(db, `LEDGER_${letter.toUpperCase()}_${suffix}`, "Ledger", [
      REPORTING_PERMISSIONS.read,
    ]);
    const actor = seedRbacActor(db, {
      email: `ledger-${letter}-${suffix}@isolation.test`,
      tenantId: tenant.id,
      roleId: role.role.id,
    });
    return { id: tenant.id, actor };
  }

  const a = seedTenant("a");
  const b = seedTenant("b");

  const noPermissionRole = seedRoleWithKeys(db, `LEDGER_NONE_${suffix}`, "Ledger none", []);
  const noPermission = seedRbacActor(db, {
    email: `ledger-none-${suffix}@isolation.test`,
    tenantId: a.id,
    roleId: noPermissionRole.role.id,
  });

  const createRegister: CashPurchaseFixture["createRegister"] = (owner, name) =>
    db.prisma.cashRegister.create({ data: { tenantId: owner.id, name } });

  const seedSession: CashPurchaseFixture["seedSession"] = (owner, registerId, options) => {
    const session = db.prisma.cashSession.create({
      data: {
        tenantId: owner.id,
        registerId,
        openedByMembershipId: owner.actor.membership?.id ?? randomUUID(),
        openingAmount: options.openingAmount ?? "0.00",
      },
    });
    const stored = db.tables.cashSessions.get(session.id);
    if (stored === undefined) {
      throw new Error("The in-memory cash session row was not stored.");
    }
    stored.openedAt = options.openedAt;
    if (options.closedAt !== null) {
      // The close command writes status, the three amounts and `closedAt` in ONE
      // statement (DEC-031, DEC-064); the fixture reproduces that write.
      db.prisma.cashSession.updateMany({
        where: { id: session.id, tenantId: owner.id },
        data: {
          status: "CLOSED",
          closedAt: options.closedAt,
          expectedAmount: options.expectedAmount ?? "0.00",
          countedAmount: options.countedAmount ?? "0.00",
          differenceAmount: options.differenceAmount ?? "0.00",
        },
      });
    }
    return { id: session.id };
  };

  const seedMovement: CashPurchaseFixture["seedMovement"] = (owner, options) => {
    const created = db.prisma.cashMovement.create({
      data: {
        tenantId: owner.id,
        registerId: options.registerId,
        sessionId: options.sessionId,
        type: options.type,
        direction: options.direction ?? null,
        amount: options.amount,
      },
    });
    const stored = db.tables.cashMovements.get(created.id);
    if (stored === undefined) {
      throw new Error("The in-memory cash movement row was not stored.");
    }
    // `cash_movement` is append-only and carries no updated_at, so its creation
    // instant IS its business instant; the fixture dates it and the report reads
    // that column directly.
    stored.createdAt = options.createdAt;
    return { id: created.id };
  };

  const createSupplier: CashPurchaseFixture["createSupplier"] = (owner, name) =>
    db.prisma.supplier.create({ data: { tenantId: owner.id, name } });

  const seedPurchase: CashPurchaseFixture["seedPurchase"] = (owner, options) => {
    const lines = options.quantities.map((quantity) => {
      const item = db.prisma.catalogItem.create({
        data: {
          tenantId: owner.id,
          kind: "SUPPLY",
          name: `Item ${randomUUID().slice(0, 8)}`,
          taxRateId: SEEDED_TAX_RATE_IDS.EXEMPT,
        },
      });
      return { catalogItemId: item.id, quantity };
    });
    const created = db.prisma.purchase.create({
      data: {
        tenantId: owner.id,
        supplierId: options.supplierId,
        status: options.status ?? "RECEIVED",
        lines: { create: lines },
      },
    });
    if (options.receivedAt !== null) {
      // Written only by the receive transition (DEC-064).
      db.prisma.purchase.updateMany({
        where: { id: created.id, tenantId: owner.id },
        data: { receivedAt: options.receivedAt },
      });
    }
    return { id: created.id };
  };

  return {
    a,
    b,
    noPermission,
    createRegister,
    seedSession,
    seedMovement,
    createSupplier,
    seedPurchase,
  };
}

/**
 * The range every HTTP assertion uses: 2026-06-10 through 2026-06-11 in Asunción
 * (`-03`), the half-open instant range `[2026-06-10T03:00Z, 2026-06-12T03:00Z)`.
 */
const PERIOD_QUERY = "from=2026-06-10&to=2026-06-11";
const FROM_INSTANT = "2026-06-10T03:00:00.000Z";
const TO_INSTANT = "2026-06-12T03:00:00.000Z";

const EXPECTED_PERIOD_ECHO = {
  preset: null,
  fromDate: "2026-06-10",
  toDate: "2026-06-11",
  timeZone: "America/Asuncion",
  fromInstant: FROM_INSTANT,
  toInstant: TO_INSTANT,
} as const;

describe("the cash and purchase reports (REP-004)", () => {
  let booted: BootedTestApp;
  let fixture: CashPurchaseFixture;

  /** Tenant A's register, sessions and the supplier ids the reports resolve. */
  let registerA: string;
  let sessionIncluded: string;
  let sessionIncludedLate: string;
  let sessionBoundaryEnd: string;
  let supplierA: string;
  let supplierB: string;
  let purchaseIncluded: string;
  let purchaseIncludedLate: string;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedCashAndPurchases(booted.db);

    registerA = fixture.createRegister(fixture.a, "Main drawer").id;

    // Included: opened BEFORE the period and closed at the INCLUSIVE first
    // instant of it. The report dates a close by `closedAt`, so this is today's
    // close — and a close exactly at `fromInstant` is inside the range.
    sessionIncluded = fixture.seedSession(fixture.a, registerA, {
      openedAt: new Date("2026-06-09T12:00:00.000Z"),
      closedAt: new Date(FROM_INSTANT),
      openingAmount: "100.00",
      expectedAmount: "250.00",
      countedAmount: "245.00",
      differenceAmount: "-5.00",
    }).id;

    // Included second: closed later in the period, so the row order is provable.
    sessionIncludedLate = fixture.seedSession(fixture.a, registerA, {
      openedAt: new Date("2026-06-10T08:00:00.000Z"),
      closedAt: new Date("2026-06-11T20:00:00.000Z"),
      openingAmount: "50.00",
      expectedAmount: "50.00",
      countedAmount: "50.00",
      differenceAmount: "0.00",
    }).id;

    // EXCLUDED: OPENED inside the period but closed AFTER it. If the report dated
    // sessions by `openedAt` this one would appear and inflate every total.
    fixture.seedSession(fixture.a, registerA, {
      openedAt: new Date("2026-06-10T12:00:00.000Z"),
      closedAt: new Date("2026-06-13T12:00:00.000Z"),
      expectedAmount: "7000.00",
      countedAmount: "7000.00",
      differenceAmount: "0.00",
    });

    // EXCLUDED from the 10th-11th period: closed exactly at its exclusive end,
    // which makes it the FIRST close of the NEXT period instead.
    sessionBoundaryEnd = fixture.seedSession(fixture.a, registerA, {
      openedAt: new Date("2026-06-11T12:00:00.000Z"),
      closedAt: new Date(TO_INSTANT),
      expectedAmount: "8000.00",
      countedAmount: "8000.00",
      differenceAmount: "0.00",
    }).id;

    // EXCLUDED: still OPEN — no close result and no close instant.
    fixture.seedSession(fixture.a, registerA, {
      openedAt: new Date("2026-06-10T09:00:00.000Z"),
      closedAt: null,
    });

    // The foreign session: inside the same period, other tenant.
    const registerB = fixture.createRegister(fixture.b, "Drawer B").id;
    const foreignSession = fixture.seedSession(fixture.b, registerB, {
      openedAt: new Date("2026-06-10T10:00:00.000Z"),
      closedAt: new Date("2026-06-10T18:00:00.000Z"),
      expectedAmount: "9999.00",
      countedAmount: "9999.00",
      differenceAmount: "0.00",
    }).id;

    // Tenant A's movements, dated by their OWN instants. The first is exactly at
    // the inclusive start of the range, so it must be counted.
    const movements: readonly {
      readonly type:
        "SALE" | "REFUND" | "INCOME" | "EXPENSE" | "WITHDRAWAL" | "DEPOSIT" | "ADJUSTMENT";
      readonly direction?: "INCREASE" | "DECREASE";
      readonly amount: string;
      readonly createdAt: string;
    }[] = [
      { type: "SALE", amount: "7.00", createdAt: FROM_INSTANT },
      { type: "SALE", amount: "100.00", createdAt: "2026-06-10T12:00:00.000Z" },
      { type: "REFUND", amount: "10.00", createdAt: "2026-06-10T13:00:00.000Z" },
      { type: "EXPENSE", amount: "5.50", createdAt: "2026-06-10T14:00:00.000Z" },
      {
        type: "ADJUSTMENT",
        direction: "DECREASE",
        amount: "2.00",
        createdAt: "2026-06-10T15:00:00.000Z",
      },
      {
        type: "ADJUSTMENT",
        direction: "INCREASE",
        amount: "1.00",
        createdAt: "2026-06-10T16:00:00.000Z",
      },
      { type: "DEPOSIT", amount: "20.00", createdAt: "2026-06-10T17:00:00.000Z" },
      { type: "INCOME", amount: "3.00", createdAt: "2026-06-10T18:00:00.000Z" },
      { type: "WITHDRAWAL", amount: "40.00", createdAt: "2026-06-10T19:00:00.000Z" },
      // EXCLUDED: exactly at the exclusive end of the range.
      { type: "SALE", amount: "500.00", createdAt: TO_INSTANT },
    ];
    for (const movement of movements) {
      fixture.seedMovement(fixture.a, {
        registerId: registerA,
        sessionId: sessionIncluded,
        type: movement.type,
        direction: movement.direction ?? null,
        amount: movement.amount,
        createdAt: new Date(movement.createdAt),
      });
    }
    // The foreign movement: inside the same period, other tenant.
    fixture.seedMovement(fixture.b, {
      registerId: registerB,
      sessionId: foreignSession,
      type: "SALE",
      amount: "9999.00",
      createdAt: new Date("2026-06-10T12:00:00.000Z"),
    });

    supplierA = fixture.createSupplier(fixture.a, "Distribuidora Norte").id;
    supplierB = fixture.createSupplier(fixture.a, "Insumos Sur").id;

    // Included: received at 10:00 on the 10th, two lines.
    purchaseIncluded = fixture.seedPurchase(fixture.a, {
      supplierId: supplierA,
      receivedAt: new Date("2026-06-10T10:00:00.000Z"),
      quantities: ["1.500", "2.250"],
    }).id;
    // Included second: proves the `receivedAt` ascending order.
    purchaseIncludedLate = fixture.seedPurchase(fixture.a, {
      supplierId: supplierB,
      receivedAt: new Date("2026-06-11T12:00:00.000Z"),
      quantities: ["0.500"],
    }).id;
    // EXCLUDED: a DRAFT was never received.
    fixture.seedPurchase(fixture.a, {
      supplierId: supplierA,
      status: "DRAFT",
      receivedAt: null,
      quantities: ["900.000"],
    });
    // EXCLUDED: a CANCELLED purchase was never stock.
    fixture.seedPurchase(fixture.a, {
      supplierId: supplierA,
      status: "CANCELLED",
      receivedAt: null,
      quantities: ["950.000"],
    });
    // EXCLUDED: received exactly at the exclusive end of the range.
    fixture.seedPurchase(fixture.a, {
      supplierId: supplierA,
      receivedAt: new Date(TO_INSTANT),
      quantities: ["990.000"],
    });

    // The foreign receipt: inside the same period, other tenant.
    const foreignSupplier = fixture.createSupplier(fixture.b, "Proveedor ajeno").id;
    fixture.seedPurchase(fixture.b, {
      supplierId: foreignSupplier,
      receivedAt: new Date("2026-06-10T15:00:00.000Z"),
      quantities: ["9999.000"],
    });
  });

  afterAll(async () => {
    await booted.close();
  });

  describe("GET /reports/cash-sessions", () => {
    it("returns the sessions that CLOSED in the period with the period echoed and the totals", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get(`/reports/cash-sessions?${PERIOD_QUERY}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const body = response.body as CashSessionsResponse;
      expect(body.report).toBe("cash-sessions");
      expect(body.period).toEqual(EXPECTED_PERIOD_ECHO);
      // A drawer amount is the tenant's own cash and the Cash domain carries no
      // currency, so there is deliberately NO `currency` key here.
      expect(Object.keys(body)).not.toContain("currency");
      expect(body.rows.map((row) => row.sessionId)).toEqual([sessionIncluded, sessionIncludedLate]);
      // `closedAt` ascending: the 10th's close before the 11th's.
      expect(body.rows.map((row) => row.closedAt)).toEqual([
        "2026-06-10T03:00:00.000Z",
        "2026-06-11T20:00:00.000Z",
      ]);
      expect(body.rows[0]).toEqual({
        sessionId: sessionIncluded,
        registerId: registerA,
        openedAt: "2026-06-09T12:00:00.000Z",
        closedAt: "2026-06-10T03:00:00.000Z",
        openingAmount: "100.00",
        expectedAmount: "250.00",
        countedAmount: "245.00",
        differenceAmount: "-5.00",
      });
      expect(body.totals).toEqual({ expected: "300.00", counted: "295.00", difference: "-5.00" });
      // The excluded rows are absent, not zero: their amounts never appear.
      expect(JSON.stringify(body)).not.toContain("7000.00");
      expect(JSON.stringify(body)).not.toContain("8000.00");
    });

    it("dates a session by its close, so a session OPENED inside the period but closed outside is absent", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get(`/reports/cash-sessions?${PERIOD_QUERY}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const body = response.body as CashSessionsResponse;
      // The excluded fixture WAS opened at 2026-06-10T12:00Z (inside the period)
      // and closed on the 13th: an `openedAt` predicate would list it.
      for (const row of body.rows) {
        expect(row.openedAt).not.toBe("2026-06-10T12:00:00.000Z");
      }
      // The included fixture was opened on the 9th (OUTSIDE the period) and closed
      // on the 10th: a `closedAt` predicate lists it, which it does.
      expect(body.rows[0]?.openedAt).toBe("2026-06-09T12:00:00.000Z");
    });

    it("puts a close exactly at toInstant in the NEXT period, not this one", async () => {
      const nextPeriod = await supertest(booted.app.getHttpServer())
        .get("/reports/cash-sessions?from=2026-06-12&to=2026-06-12")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);
      const nextBody = nextPeriod.body as CashSessionsResponse;
      expect(nextBody.period.fromInstant).toBe("2026-06-12T03:00:00.000Z");
      // The boundary close is the INCLUSIVE first instant of the next period, and
      // it was absent from the 10th-11th report above.
      expect(nextBody.rows.map((row) => row.sessionId)).toEqual([sessionBoundaryEnd]);
      expect(nextBody.totals.expected).toBe("8000.00");
    });

    it("never shows another tenant's closed session", async () => {
      const foreign = await supertest(booted.app.getHttpServer())
        .get(`/reports/cash-sessions?${PERIOD_QUERY}`)
        .set("Cookie", fixture.b.actor.cookie)
        .expect(200);
      const foreignBody = foreign.body as CashSessionsResponse;
      expect(foreignBody.rows).toHaveLength(1);
      expect(foreignBody.totals.expected).toBe("9999.00");

      const local = await supertest(booted.app.getHttpServer())
        .get(`/reports/cash-sessions?${PERIOD_QUERY}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);
      expect(JSON.stringify(local.body)).not.toContain("9999.00");
    });
  });

  describe("GET /reports/cash-movements", () => {
    it("groups the period's movements by kind with the sign resolved, plus the net", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get(`/reports/cash-movements?${PERIOD_QUERY}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const body = response.body as CashMovementsResponse;
      expect(body.report).toBe("cash-movements");
      expect(body.period).toEqual(EXPECTED_PERIOD_ECHO);
      expect(body.rows).toEqual([
        // Type ascending, direction ascending with `null` first.
        { type: "ADJUSTMENT", direction: "DECREASE", movementCount: 1, signedAmount: "-2.00" },
        { type: "ADJUSTMENT", direction: "INCREASE", movementCount: 1, signedAmount: "1.00" },
        { type: "DEPOSIT", direction: null, movementCount: 1, signedAmount: "20.00" },
        { type: "EXPENSE", direction: null, movementCount: 1, signedAmount: "-5.50" },
        { type: "INCOME", direction: null, movementCount: 1, signedAmount: "3.00" },
        { type: "REFUND", direction: null, movementCount: 1, signedAmount: "-10.00" },
        // Two SALE movements, including the one exactly at `fromInstant`; the one
        // exactly at `toInstant` is in the NEXT period and is not counted.
        { type: "SALE", direction: null, movementCount: 2, signedAmount: "107.00" },
        { type: "WITHDRAWAL", direction: null, movementCount: 1, signedAmount: "-40.00" },
      ]);
      // 107.00 + 20.00 + 3.00 - 10.00 - 5.50 - 40.00 - 2.00 + 1.00
      expect(body.net).toBe("73.50");
      expect(JSON.stringify(body)).not.toContain("500.00");
    });

    it("dates a movement by its own createdAt, not by its session's close", async () => {
      // Every movement above belongs to ONE session that closed on the 10th. A
      // report that dated movements by the session would put the whole session's
      // ledger in one bucket instead of summing the period's own instants.
      const response = await supertest(booted.app.getHttpServer())
        .get("/reports/cash-movements?from=2026-06-11&to=2026-06-11")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const body = response.body as CashMovementsResponse;
      // No movement was recorded on the 11th, even though a session was open.
      expect(body.rows).toEqual([]);
      expect(body.net).toBe("0.00");
    });

    it("never shows another tenant's movements", async () => {
      const foreign = await supertest(booted.app.getHttpServer())
        .get(`/reports/cash-movements?${PERIOD_QUERY}`)
        .set("Cookie", fixture.b.actor.cookie)
        .expect(200);
      const foreignBody = foreign.body as CashMovementsResponse;
      expect(foreignBody.rows).toEqual([
        { type: "SALE", direction: null, movementCount: 1, signedAmount: "9999.00" },
      ]);

      const local = await supertest(booted.app.getHttpServer())
        .get(`/reports/cash-movements?${PERIOD_QUERY}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);
      expect(JSON.stringify(local.body)).not.toContain("9999.00");
    });
  });

  describe("GET /reports/purchases", () => {
    it("returns the purchases RECEIVED in the period with line count and total quantity", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get(`/reports/purchases?${PERIOD_QUERY}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const body = response.body as PurchasesResponse;
      expect(body.report).toBe("purchases");
      expect(body.period).toEqual(EXPECTED_PERIOD_ECHO);
      // `receivedAt` ascending, and no `currency` key: a purchase has no money.
      expect(body.rows).toEqual([
        {
          purchaseId: purchaseIncluded,
          supplierId: supplierA,
          supplierName: "Distribuidora Norte",
          receivedAt: "2026-06-10T10:00:00.000Z",
          lineCount: 2,
          // 1.500 + 2.250 on the ledger's Decimal(10, 3) scale.
          totalQuantity: "3.750",
        },
        {
          purchaseId: purchaseIncludedLate,
          supplierId: supplierB,
          supplierName: "Insumos Sur",
          receivedAt: "2026-06-11T12:00:00.000Z",
          lineCount: 1,
          totalQuantity: "0.500",
        },
      ]);
      expect(Object.keys(body)).not.toContain("currency");
      expect(JSON.stringify(body)).not.toContain("unitCost");
    });

    it("never shows a DRAFT, a CANCELLED or a boundary receipt", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get(`/reports/purchases?${PERIOD_QUERY}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const body = response.body as PurchasesResponse;
      // The excluded fixtures carried 900, 950 and 990 units: none appears, and
      // neither does their quantity in any total.
      expect(body.rows).toHaveLength(2);
      expect(JSON.stringify(body)).not.toContain("900.000");
      expect(JSON.stringify(body)).not.toContain("950.000");
      expect(JSON.stringify(body)).not.toContain("990.000");
    });

    it("never shows another tenant's purchase or supplier", async () => {
      const foreign = await supertest(booted.app.getHttpServer())
        .get(`/reports/purchases?${PERIOD_QUERY}`)
        .set("Cookie", fixture.b.actor.cookie)
        .expect(200);
      const foreignBody = foreign.body as PurchasesResponse;
      expect(foreignBody.rows.map((row) => row.supplierName)).toEqual(["Proveedor ajeno"]);
      expect(foreignBody.rows[0]?.totalQuantity).toBe("9999.000");

      const local = await supertest(booted.app.getHttpServer())
        .get(`/reports/purchases?${PERIOD_QUERY}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);
      expect(JSON.stringify(local.body)).not.toContain("Proveedor ajeno");
      expect(JSON.stringify(local.body)).not.toContain("9999.000");
    });
  });

  describe("the three routes share one period and one guard", () => {
    it("returns empty answers, not errors, for a period with nothing", async () => {
      for (const route of ["cash-sessions", "cash-movements", "purchases"]) {
        const response = await supertest(booted.app.getHttpServer())
          .get(`/reports/${route}?from=2019-01-01&to=2019-01-02`)
          .set("Cookie", fixture.a.actor.cookie)
          .expect(200);
        expect((response.body as { period: { fromDate: string } }).period.fromDate, route).toBe(
          "2019-01-01"
        );
      }

      const sessions = await supertest(booted.app.getHttpServer())
        .get("/reports/cash-sessions?from=2019-01-01&to=2019-01-02")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);
      const sessionsBody = sessions.body as CashSessionsResponse;
      expect(sessionsBody.rows).toEqual([]);
      expect(sessionsBody.totals).toEqual({
        expected: "0.00",
        counted: "0.00",
        difference: "0.00",
      });

      const movements = await supertest(booted.app.getHttpServer())
        .get("/reports/cash-movements?from=2019-01-01&to=2019-01-02")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);
      const movementsBody = movements.body as CashMovementsResponse;
      expect(movementsBody.rows).toEqual([]);
      expect(movementsBody.net).toBe("0.00");

      const purchases = await supertest(booted.app.getHttpServer())
        .get("/reports/purchases?from=2019-01-01&to=2019-01-02")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);
      expect((purchases.body as PurchasesResponse).rows).toEqual([]);
    });

    it("refuses every malformed period on all three routes with the same stable messages", async () => {
      const cases: readonly { label: string; query: string; message: string }[] = [
        { label: "no period", query: "", message: REPORT_PERIOD_MISSING_MESSAGE },
        {
          label: "malformed date",
          query: "from=2026-02-30&to=2026-03-01",
          message: REPORT_PERIOD_DATE_FORMAT_MESSAGE,
        },
        {
          label: "unknown key",
          query: `${PERIOD_QUERY}&tenantId=11111111-1111-4111-8111-111111111111`,
          message: REPORT_PERIOD_QUERY_INVALID_MESSAGE,
        },
      ];

      for (const route of ["cash-sessions", "cash-movements", "purchases"]) {
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

    it("refuses all three without reports.read, before any row is read", async () => {
      for (const route of ["cash-sessions", "cash-movements", "purchases"]) {
        const response = await supertest(booted.app.getHttpServer())
          .get(`/reports/${route}?${PERIOD_QUERY}`)
          .set("Cookie", fixture.noPermission.cookie)
          .expect(403);
        expect((response.body as ErrorDto).error.code, route).toBe("FORBIDDEN");
        expect(JSON.stringify(response.body), route).not.toContain("250.00");
        expect(JSON.stringify(response.body), route).not.toContain("Distribuidora Norte");
      }
    });

    it("requires authentication at all", async () => {
      for (const route of ["cash-sessions", "cash-movements", "purchases"]) {
        await supertest(booted.app.getHttpServer())
          .get(`/reports/${route}?${PERIOD_QUERY}`)
          .expect(401);
      }
    });
  });
});
