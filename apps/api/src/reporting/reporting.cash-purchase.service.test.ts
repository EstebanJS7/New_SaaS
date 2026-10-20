import { describe, expect, it } from "vitest";
import { Prisma } from "@newsaas/database";
import { cashMovementSign } from "../cash/cash.expected-amount.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import type { RequestContextService } from "../context/request-context.service.js";
import type { TenantSettingsService } from "../settings/tenant-settings.service.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";
import {
  REPORT_CASH_MOVEMENT_ROW_LIMIT,
  REPORT_CASH_MOVEMENT_ROW_LIMIT_EXCEEDED_MESSAGE,
  REPORT_CASH_SESSION_ROW_LIMIT,
  REPORT_CASH_SESSION_ROW_LIMIT_EXCEEDED_MESSAGE,
  REPORT_PURCHASE_ROW_LIMIT,
  REPORT_PURCHASE_ROW_LIMIT_EXCEEDED_MESSAGE,
  ReportRepository,
  type ReportingReadPrisma,
  type ReportCashMovementRow,
  type ReportCashSessionReadRow,
  type ReportPurchaseReadRow,
  type ReportSupplierRow,
} from "./reporting.repository.js";
import {
  REPORT_READ_FORBIDDEN_MESSAGE,
  ReportingService,
  reportCashSessionDifferenceMismatchMessage,
  reportSupplierMissingMessage,
} from "./reporting.service.js";
import type { PurchaseRowDto } from "./reporting.dto.js";

/**
 * The cash and purchase reports of [[REP-004]] at the SERVICE boundary: the sign
 * convention, the close-result invariant, the purchase shape and every refusal.
 *
 * The pattern is `reporting.service.test.ts`: the REAL repository over stub
 * delegates, so the query the report builds (predicate, order, `take`) is the
 * shipped one and is asserted as an ARGUMENT. What the stub cannot prove is a
 * row-level boundary — it returns what it is given — so both the opened/closed
 * session edge and the `RECEIVED` status filter are also proven against the
 * in-memory boundary in `reporting.cash-purchase.integration.test.ts`, where the
 * predicate is actually applied. Asserting them here as row outcomes would pass
 * whatever range the service asked for.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";

/** Asunción is `-03`, so 2026-06-10 00:00 local is 2026-06-10T03:00:00Z. */
const FROM_INSTANT = "2026-06-10T03:00:00.000Z";
const TO_INSTANT = "2026-06-11T03:00:00.000Z";

const ONE_DAY_PERIOD = {
  preset: null,
  fromDate: "2026-06-10",
  toDate: "2026-06-10",
  timeZone: "America/Asuncion",
  fromInstant: FROM_INSTANT,
  toInstant: TO_INSTANT,
} as const;

const SUPPLIER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUPPLIER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

interface Harness {
  service: ReportingService;
  /** Every `cashSession.findMany` arg the repository built, in call order. */
  sessionQueries: Prisma.CashSessionFindManyArgs[];
  /** Every `cashMovement.findMany` arg the repository built, in call order. */
  movementQueries: Prisma.CashMovementFindManyArgs[];
  /** Every `purchase.findMany` arg the repository built, in call order. */
  purchaseQueries: Prisma.PurchaseFindManyArgs[];
  /** Every `supplier.findMany` arg the repository built, in call order. */
  supplierQueries: Prisma.SupplierFindManyArgs[];
}

/**
 * The real repository over stub cash/purchase delegates, a stub permission
 * resolver and a pinned clock.
 *
 * The settings stub THROWS: no cash or purchase report has a currency (the Cash
 * domain carries none and a purchase owns no money total), so a `sales`
 * settings read here would be a currency resolved for a response that must not
 * carry one.
 */
function harness(
  options: {
    sessions?: ReportCashSessionReadRow[];
    movements?: ReportCashMovementRow[];
    purchases?: ReportPurchaseReadRow[];
    suppliers?: ReportSupplierRow[];
    permissions?: readonly string[];
    now?: Date;
  } = {}
): Harness {
  const sessionQueries: Prisma.CashSessionFindManyArgs[] = [];
  const movementQueries: Prisma.CashMovementFindManyArgs[] = [];
  const purchaseQueries: Prisma.PurchaseFindManyArgs[] = [];
  const supplierQueries: Prisma.SupplierFindManyArgs[] = [];

  const prisma: ReportingReadPrisma = {
    // REP-002/REP-003 reads are unreachable from REP-004 and vice versa: each
    // stub throws instead of answering `[]`.
    sale: {
      findMany: () => {
        throw new Error("The cash and purchase reports must not read sales.");
      },
    },
    catalogItem: {
      findMany: () => {
        throw new Error("The cash and purchase reports must not read catalog items.");
      },
    },
    cashSession: {
      findMany: (args) => {
        sessionQueries.push(args);
        return Promise.resolve(options.sessions ?? []);
      },
    },
    cashMovement: {
      findMany: (args) => {
        movementQueries.push(args);
        return Promise.resolve(options.movements ?? []);
      },
    },
    purchase: {
      findMany: (args) => {
        purchaseQueries.push(args);
        return Promise.resolve(options.purchases ?? []);
      },
    },
    supplier: {
      findMany: (args) => {
        supplierQueries.push(args);
        return Promise.resolve(options.suppliers ?? []);
      },
    },
  };

  const requestContext = {
    requireTenantId: () => TENANT,
  } as unknown as RequestContextService;
  const permissionResolver = {
    resolveForActiveRequest: () => Promise.resolve(new Set(options.permissions ?? [])),
  } as unknown as PermissionResolver;
  const settings = {
    get: () => {
      throw new Error("A cash or purchase report must not resolve a currency.");
    },
  } as unknown as TenantSettingsService;

  const repository = new ReportRepository(prisma, requestContext);
  const now = options.now ?? new Date("2026-06-10T12:00:00.000Z");
  const service = new ReportingService(repository, settings, permissionResolver, () => now);
  return { service, sessionQueries, movementQueries, purchaseQueries, supplierQueries };
}

const READ_PERMISSION = [REPORTING_PERMISSIONS.read];

/** One CLOSED session as the cash read returns it. */
function closedSession(options: {
  id: string;
  registerId?: string;
  openedAt: string;
  closedAt: string;
  openingAmount?: string;
  expectedAmount: string;
  countedAmount: string;
  differenceAmount: string;
}): ReportCashSessionReadRow {
  return {
    id: options.id,
    registerId: options.registerId ?? "register-main",
    openedAt: new Date(options.openedAt),
    closedAt: new Date(options.closedAt),
    openingAmount: options.openingAmount ?? "0.00",
    expectedAmount: options.expectedAmount,
    countedAmount: options.countedAmount,
    differenceAmount: options.differenceAmount,
  };
}

/** One movement as the ledger read returns it: the amount stays POSITIVE. */
function movement(
  type: ReportCashMovementRow["type"],
  direction: ReportCashMovementRow["direction"],
  amount: string
): ReportCashMovementRow {
  return { type, direction, amount };
}

/** One received purchase with a line set, as the receive read returns it. */
function purchase(options: {
  id: string;
  supplierId: string;
  receivedAt: string;
  quantities: readonly string[];
}): ReportPurchaseReadRow {
  return {
    id: options.id,
    supplierId: options.supplierId,
    receivedAt: new Date(options.receivedAt),
    lines: options.quantities.map((quantity) => ({ quantity })),
  };
}

describe("ReportingService · the movement sign convention ([[DEC-030]], [[REP-004]])", () => {
  /**
   * One case per kind, plus `ADJUSTMENT` in BOTH directions: the kind owns the
   * sign and the amounts stay positive, so a `REPORT` that summed `amount` would
   * report every corrective movement as income.
   */
  const SIGN_CASES: readonly {
    readonly type: ReportCashMovementRow["type"];
    readonly direction: ReportCashMovementRow["direction"];
    readonly amount: string;
    readonly signedAmount: string;
  }[] = [
    { type: "SALE", direction: null, amount: "100.00", signedAmount: "100.00" },
    { type: "INCOME", direction: null, amount: "20.50", signedAmount: "20.50" },
    { type: "DEPOSIT", direction: null, amount: "30.25", signedAmount: "30.25" },
    { type: "REFUND", direction: null, amount: "5.10", signedAmount: "-5.10" },
    { type: "EXPENSE", direction: null, amount: "7.75", signedAmount: "-7.75" },
    { type: "WITHDRAWAL", direction: null, amount: "40.00", signedAmount: "-40.00" },
    {
      type: "ADJUSTMENT",
      direction: "INCREASE",
      amount: "3.33",
      signedAmount: "3.33",
    },
    {
      type: "ADJUSTMENT",
      direction: "DECREASE",
      amount: "2.22",
      signedAmount: "-2.22",
    },
  ];

  for (const signCase of SIGN_CASES) {
    const label = `${signCase.type}${signCase.direction === null ? "" : `/${signCase.direction}`}`;
    it(`signs ${label} as ${signCase.signedAmount}`, async () => {
      const { service } = harness({
        permissions: READ_PERMISSION,
        movements: [movement(signCase.type, signCase.direction, signCase.amount)],
      });

      const response = await service.cashMovements({ from: "2026-06-10", to: "2026-06-10" });

      expect(response.rows).toEqual([
        {
          type: signCase.type,
          direction: signCase.direction,
          movementCount: 1,
          signedAmount: signCase.signedAmount,
        },
      ]);
      expect(response.net).toBe(signCase.signedAmount);
    });
  }

  it("groups the whole table at once, ordered by type then direction with null first", async () => {
    // Seeded in a scrambled order on purpose: the response order is the
    // contract's total order, never the order the ledger happened to return.
    const { service } = harness({
      permissions: READ_PERMISSION,
      movements: [
        movement("WITHDRAWAL", null, "40.00"),
        movement("ADJUSTMENT", "INCREASE", "3.33"),
        movement("SALE", null, "100.00"),
        movement("ADJUSTMENT", "DECREASE", "2.22"),
        movement("REFUND", null, "5.10"),
        movement("DEPOSIT", null, "30.25"),
        movement("EXPENSE", null, "7.75"),
        movement("INCOME", null, "20.50"),
      ],
    });

    const response = await service.cashMovements({ from: "2026-06-10", to: "2026-06-10" });

    expect(response.rows).toEqual([
      // ADJUSTMENT first (type ascending), DECREASE before INCREASE (direction
      // ascending) — and both carry a direction, unlike every type-owned kind.
      { type: "ADJUSTMENT", direction: "DECREASE", movementCount: 1, signedAmount: "-2.22" },
      { type: "ADJUSTMENT", direction: "INCREASE", movementCount: 1, signedAmount: "3.33" },
      { type: "DEPOSIT", direction: null, movementCount: 1, signedAmount: "30.25" },
      { type: "EXPENSE", direction: null, movementCount: 1, signedAmount: "-7.75" },
      { type: "INCOME", direction: null, movementCount: 1, signedAmount: "20.50" },
      { type: "REFUND", direction: null, movementCount: 1, signedAmount: "-5.10" },
      { type: "SALE", direction: null, movementCount: 1, signedAmount: "100.00" },
      { type: "WITHDRAWAL", direction: null, movementCount: 1, signedAmount: "-40.00" },
    ]);
    // 100.00 + 20.50 + 30.25 - 5.10 - 7.75 - 40.00 + 3.33 - 2.22
    expect(response.net).toBe("99.01");
  });

  it("counts several movements of one (type, direction) group into one row", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      movements: [
        movement("SALE", null, "10.10"),
        movement("SALE", null, "0.20"),
        movement("ADJUSTMENT", "DECREASE", "1.00"),
        movement("ADJUSTMENT", "DECREASE", "0.05"),
      ],
    });

    const response = await service.cashMovements({ from: "2026-06-10", to: "2026-06-10" });

    expect(response.rows).toEqual([
      { type: "ADJUSTMENT", direction: "DECREASE", movementCount: 2, signedAmount: "-1.05" },
      // 10.10 + 0.20 is 10.300000000000001 as doubles; the report answers "10.30".
      { type: "SALE", direction: null, movementCount: 2, signedAmount: "10.30" },
    ]);
    expect(String(10.1 + 0.2)).not.toBe("10.3");
  });

  it("uses the ONE shipped sign map, so the report cannot drift from the close command", () => {
    // The report imports `cashMovementSign`; a second copy of the map here would
    // be the drift DEC-030 exists to prevent. This pins the contract the report
    // depends on, at the source of truth.
    expect(cashMovementSign("SALE", null)).toBe(1);
    expect(cashMovementSign("REFUND", null)).toBe(-1);
    expect(cashMovementSign("ADJUSTMENT", "DECREASE")).toBe(-1);
    expect(cashMovementSign("ADJUSTMENT", "INCREASE")).toBe(1);
  });
});

describe("ReportingService · the movement net ([[REP-004]])", () => {
  it("equals an independently computed signed sum of the period", async () => {
    const movements = [
      movement("SALE", null, "1234.56"),
      movement("SALE", null, "0.44"),
      movement("INCOME", null, "99.99"),
      movement("REFUND", null, "12.34"),
      movement("EXPENSE", null, "0.01"),
      movement("ADJUSTMENT", "INCREASE", "5.00"),
      movement("ADJUSTMENT", "DECREASE", "5.00"),
    ];

    const { service } = harness({ permissions: READ_PERMISSION, movements });
    const response = await service.cashMovements({ from: "2026-06-10", to: "2026-06-10" });

    // Recomputed from the ROWS, not from the response: the same map, a different
    // summation path, and exact string equality at the end — no epsilon.
    const independent = movements.reduce(
      (total, entry) =>
        cashMovementSign(entry.type, entry.direction) === 1
          ? total.plus(new Prisma.Decimal(entry.amount))
          : total.minus(new Prisma.Decimal(entry.amount)),
      new Prisma.Decimal(0)
    );

    expect(response.net).toBe(independent.toFixed(2));
    expect(response.net).toBe("1322.64");
  });

  it("sums a period of only corrections, and a period of only subtractive kinds is negative", async () => {
    const correctionsOnly = harness({
      permissions: READ_PERMISSION,
      movements: [
        movement("ADJUSTMENT", "INCREASE", "10.00"),
        movement("ADJUSTMENT", "DECREASE", "12.50"),
      ],
    });

    const corrections = await correctionsOnly.service.cashMovements({
      from: "2026-06-10",
      to: "2026-06-10",
    });

    expect(corrections.rows).toEqual([
      { type: "ADJUSTMENT", direction: "DECREASE", movementCount: 1, signedAmount: "-12.50" },
      { type: "ADJUSTMENT", direction: "INCREASE", movementCount: 1, signedAmount: "10.00" },
    ]);
    expect(corrections.net).toBe("-2.50");

    const subtractiveOnly = harness({
      permissions: READ_PERMISSION,
      movements: [
        movement("REFUND", null, "5.00"),
        movement("EXPENSE", null, "7.25"),
        movement("WITHDRAWAL", null, "40.00"),
      ],
    });

    const subtractive = await subtractiveOnly.service.cashMovements({
      from: "2026-06-10",
      to: "2026-06-10",
    });

    // The sign RENDERS on the net, not just on a row: this is a drawer that only
    // ever paid out, and `"52.25"` would be a different business fact.
    expect(subtractive.net).toBe("-52.25");
    expect(subtractive.rows.map((row) => row.signedAmount)).toEqual(["-7.25", "-5.00", "-40.00"]);
  });

  it("reads movements by their own createdAt, tenant-scoped and half-open", async () => {
    const { service, movementQueries } = harness({ permissions: READ_PERMISSION });

    await service.cashMovements({ from: "2026-06-10", to: "2026-06-10" });

    expect(movementQueries).toHaveLength(1);
    expect(movementQueries[0]).toMatchObject({
      where: {
        tenantId: TENANT,
        createdAt: { gte: new Date(FROM_INSTANT), lt: new Date(TO_INSTANT) },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    // One row past the cap, so an over-limit period is REFUSED rather than cut.
    expect(movementQueries[0]?.take).toBe(REPORT_CASH_MOVEMENT_ROW_LIMIT + 1);
  });

  it("returns an empty row set and a zero net for an empty period", async () => {
    const { service } = harness({ permissions: READ_PERMISSION, movements: [] });

    const response = await service.cashMovements({ from: "2026-06-10", to: "2026-06-10" });

    expect(response).toEqual({
      report: "cash-movements",
      period: ONE_DAY_PERIOD,
      net: "0.00",
      rows: [],
    });
  });

  it("refuses a period over the movement cap instead of aggregating a truncated one", async () => {
    const movements = Array.from({ length: REPORT_CASH_MOVEMENT_ROW_LIMIT + 1 }, () =>
      movement("SALE", null, "1.00")
    );
    const { service } = harness({ permissions: READ_PERMISSION, movements });

    await expect(
      service.cashMovements({ from: "2026-06-10", to: "2026-06-10" })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: REPORT_CASH_MOVEMENT_ROW_LIMIT_EXCEEDED_MESSAGE,
    });
  });

  it("refuses a missing reports.read BEFORE any query runs", async () => {
    const { service, movementQueries } = harness({ permissions: ["sales.read"] });

    await expect(service.cashMovements({ preset: "today" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: REPORT_READ_FORBIDDEN_MESSAGE,
    });
    expect(movementQueries).toEqual([]);
  });
});

describe("ReportingService · cash sessions ([[REP-004]])", () => {
  it("reports the stored close result, sums it, and asserts counted - expected = difference", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      sessions: [
        closedSession({
          id: "session-1",
          openedAt: "2026-06-10T10:00:00.000Z",
          closedAt: "2026-06-10T20:00:00.000Z",
          openingAmount: "100.00",
          expectedAmount: "250.00",
          countedAmount: "245.00",
          differenceAmount: "-5.00",
        }),
        closedSession({
          id: "session-2",
          registerId: "register-2",
          openedAt: "2026-06-10T09:00:00.000Z",
          closedAt: "2026-06-10T21:00:00.000Z",
          openingAmount: "0.50",
          expectedAmount: "1000.5",
          countedAmount: "1002.00",
          differenceAmount: "1.50",
        }),
      ],
    });

    const response = await service.cashSessions({ from: "2026-06-10", to: "2026-06-10" });

    expect(response).toEqual({
      report: "cash-sessions",
      period: ONE_DAY_PERIOD,
      rows: [
        {
          sessionId: "session-1",
          registerId: "register-main",
          openedAt: "2026-06-10T10:00:00.000Z",
          closedAt: "2026-06-10T20:00:00.000Z",
          openingAmount: "100.00",
          expectedAmount: "250.00",
          countedAmount: "245.00",
          differenceAmount: "-5.00",
        },
        {
          sessionId: "session-2",
          registerId: "register-2",
          openedAt: "2026-06-10T09:00:00.000Z",
          closedAt: "2026-06-10T21:00:00.000Z",
          openingAmount: "0.50",
          // Rendered at the money scale, never as the literal the row held.
          expectedAmount: "1000.50",
          countedAmount: "1002.00",
          differenceAmount: "1.50",
        },
      ],
      totals: { expected: "1250.50", counted: "1247.00", difference: "-3.50" },
    });
  });

  it("refuses LOUDLY when a stored difference disagrees with the other two amounts, naming the session", async () => {
    // `counted - expected` is -5.00 but the row claims 0.00: exactly the shape a
    // partially-written close would leave, and a row a reader could not detect.
    const { service } = harness({
      permissions: READ_PERMISSION,
      sessions: [
        closedSession({
          id: "session-broken",
          openedAt: "2026-06-10T10:00:00.000Z",
          closedAt: "2026-06-10T20:00:00.000Z",
          expectedAmount: "250.00",
          countedAmount: "245.00",
          differenceAmount: "0.00",
        }),
      ],
    });

    const refusal = service.cashSessions({ from: "2026-06-10", to: "2026-06-10" });
    await expect(refusal).rejects.toMatchObject({
      code: "INTERNAL",
      message: reportCashSessionDifferenceMismatchMessage("session-broken"),
    });
    await expect(refusal).rejects.toThrow("session-broken");
  });

  it("accepts a consistent row, a zero difference and a short drawer alike", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      sessions: [
        closedSession({
          id: "short",
          openedAt: "2026-06-10T10:00:00.000Z",
          closedAt: "2026-06-10T20:00:00.000Z",
          expectedAmount: "100.00",
          countedAmount: "95.00",
          differenceAmount: "-5.00",
        }),
        closedSession({
          id: "exact",
          openedAt: "2026-06-10T11:00:00.000Z",
          closedAt: "2026-06-10T22:00:00.000Z",
          expectedAmount: "100.00",
          countedAmount: "100.00",
          differenceAmount: "0.00",
        }),
        closedSession({
          id: "over",
          openedAt: "2026-06-10T12:00:00.000Z",
          closedAt: "2026-06-10T23:00:00.000Z",
          expectedAmount: "100.00",
          countedAmount: "101.25",
          differenceAmount: "1.25",
        }),
      ],
    });

    const response = await service.cashSessions({ from: "2026-06-10", to: "2026-06-10" });

    expect(response.rows.map((row) => row.differenceAmount)).toEqual(["-5.00", "0.00", "1.25"]);
    // -5.00 + 0.00 + 1.25: the period total keeps the sign of the sum.
    expect(response.totals.difference).toBe("-3.75");
  });

  it("reads CLOSED sessions by closedAt — never by openedAt — tenant-scoped and half-open", async () => {
    const { service, sessionQueries } = harness({ permissions: READ_PERMISSION });

    await service.cashSessions({ from: "2026-06-10", to: "2026-06-10" });

    expect(sessionQueries).toHaveLength(1);
    expect(sessionQueries[0]).toMatchObject({
      where: {
        tenantId: TENANT,
        // An OPEN drawer has no close result and no close instant: the status
        // predicate, not a NULL filter, is what keeps it out.
        status: "CLOSED",
        closedAt: { gte: new Date(FROM_INSTANT), lt: new Date(TO_INSTANT) },
      },
      orderBy: [{ closedAt: "asc" }, { id: "asc" }],
    });
    // The period predicate is NOT the opening instant: a session opened yesterday
    // and closed today belongs to today's close report.
    expect(Object.keys(sessionQueries[0]?.where ?? {})).not.toContain("openedAt");
    expect(sessionQueries[0]?.take).toBe(REPORT_CASH_SESSION_ROW_LIMIT + 1);
  });

  it("returns an empty row set and zero totals for an empty period", async () => {
    const { service } = harness({ permissions: READ_PERMISSION, sessions: [] });

    const response = await service.cashSessions({ preset: "today" });

    expect(response).toEqual({
      report: "cash-sessions",
      period: { ...ONE_DAY_PERIOD, preset: "today" },
      rows: [],
      totals: { expected: "0.00", counted: "0.00", difference: "0.00" },
    });
  });

  it("refuses a period over the session cap instead of truncating the totals", async () => {
    const sessions = Array.from({ length: REPORT_CASH_SESSION_ROW_LIMIT + 1 }, (_unused, index) =>
      closedSession({
        id: `session-${index}`,
        openedAt: "2026-06-10T10:00:00.000Z",
        closedAt: "2026-06-10T20:00:00.000Z",
        expectedAmount: "1.00",
        countedAmount: "1.00",
        differenceAmount: "0.00",
      })
    );
    const { service } = harness({ permissions: READ_PERMISSION, sessions });

    await expect(
      service.cashSessions({ from: "2026-06-10", to: "2026-06-10" })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: REPORT_CASH_SESSION_ROW_LIMIT_EXCEEDED_MESSAGE,
    });
  });

  it("refuses a missing reports.read BEFORE any query runs", async () => {
    const { service, sessionQueries } = harness({ permissions: ["sales.read"] });

    await expect(service.cashSessions({ preset: "today" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: REPORT_READ_FORBIDDEN_MESSAGE,
    });
    expect(sessionQueries).toEqual([]);
  });
});

describe("ReportingService · purchases ([[REP-004]])", () => {
  /**
   * The purchase row's EXACT key set, enforced by the type: `Record<keyof
   * PurchaseRowDto, true>` fails to compile the moment a money key (a `total`,
   * an `amount`, a `unitCost`) is added to the DTO, and the runtime assertion
   * below then proves the response populates exactly these keys. There is no
   * purchase money total because the aggregate owns none (`Purchases.md`).
   */
  function everyPurchaseRowKey(): Record<keyof PurchaseRowDto, true> {
    return {
      purchaseId: true,
      supplierId: true,
      supplierName: true,
      receivedAt: true,
      lineCount: true,
      totalQuantity: true,
    };
  }

  it("reports line count and total quantity at scale 3, with the supplier resolved", async () => {
    const { service, supplierQueries } = harness({
      permissions: READ_PERMISSION,
      purchases: [
        purchase({
          id: "purchase-1",
          supplierId: SUPPLIER_A,
          receivedAt: "2026-06-10T09:00:00.000Z",
          quantities: ["1.500", "0.250", "2"],
        }),
        purchase({
          id: "purchase-2",
          supplierId: SUPPLIER_B,
          receivedAt: "2026-06-10T15:00:00.000Z",
          quantities: ["3.500"],
        }),
      ],
      suppliers: [
        { id: SUPPLIER_A, name: "Distribuidora Norte" },
        { id: SUPPLIER_B, name: "Insumos Sur" },
      ],
    });

    const response = await service.purchases({ from: "2026-06-10", to: "2026-06-10" });

    expect(response).toEqual({
      report: "purchases",
      period: ONE_DAY_PERIOD,
      rows: [
        {
          purchaseId: "purchase-1",
          supplierId: SUPPLIER_A,
          supplierName: "Distribuidora Norte",
          receivedAt: "2026-06-10T09:00:00.000Z",
          lineCount: 3,
          // 1.500 + 0.250 + 2 renders on the ledger's Decimal(10, 3) scale.
          totalQuantity: "3.750",
        },
        {
          purchaseId: "purchase-2",
          supplierId: SUPPLIER_B,
          supplierName: "Insumos Sur",
          receivedAt: "2026-06-10T15:00:00.000Z",
          lineCount: 1,
          totalQuantity: "3.500",
        },
      ],
    });
    // ONE batched supplier read for both receipts: no query per purchase.
    expect(supplierQueries).toHaveLength(1);
  });

  it("carries no money key at all, structurally", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      purchases: [
        purchase({
          id: "purchase-1",
          supplierId: SUPPLIER_A,
          receivedAt: "2026-06-10T09:00:00.000Z",
          quantities: ["1.000"],
        }),
      ],
      suppliers: [{ id: SUPPLIER_A, name: "Distribuidora Norte" }],
    });

    const response = await service.purchases({ from: "2026-06-10", to: "2026-06-10" });

    const row = response.rows[0];
    expect(row).toBeDefined();
    // The exact key set, both ways: no missing key and no extra one. A money key
    // would fail the `Record<keyof PurchaseRowDto, true>` return type above AND
    // this comparison.
    expect(Object.keys(row ?? {}).sort()).toEqual(Object.keys(everyPurchaseRowKey()).sort());
    for (const moneyKey of ["amount", "total", "totalAmount", "totalCost", "unitCost", "net"]) {
      expect(Object.keys(row ?? {})).not.toContain(moneyKey);
    }
    expect(JSON.stringify(response)).not.toContain("unitCost");
  });

  it("reads RECEIVED purchases by receivedAt, tenant-scoped and half-open", async () => {
    const { service, purchaseQueries } = harness({ permissions: READ_PERMISSION });

    await service.purchases({ from: "2026-06-10", to: "2026-06-10" });

    expect(purchaseQueries).toHaveLength(1);
    expect(purchaseQueries[0]).toMatchObject({
      where: {
        tenantId: TENANT,
        // A DRAFT was never received and a CANCELLED one was never stock: the
        // status is part of the predicate, not a later filter.
        status: "RECEIVED",
        receivedAt: { gte: new Date(FROM_INSTANT), lt: new Date(TO_INSTANT) },
      },
      include: { lines: true },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    });
    expect(purchaseQueries[0]?.take).toBe(REPORT_PURCHASE_ROW_LIMIT + 1);
  });

  it("resolves suppliers with the tenant predicate and the referenced ids only", async () => {
    const { service, supplierQueries } = harness({
      permissions: READ_PERMISSION,
      purchases: [
        purchase({
          id: "purchase-1",
          supplierId: SUPPLIER_A,
          receivedAt: "2026-06-10T09:00:00.000Z",
          quantities: ["1.000"],
        }),
        purchase({
          id: "purchase-2",
          supplierId: SUPPLIER_A,
          receivedAt: "2026-06-10T10:00:00.000Z",
          quantities: ["2.000"],
        }),
      ],
      suppliers: [{ id: SUPPLIER_A, name: "Distribuidora Norte" }],
    });

    await service.purchases({ from: "2026-06-10", to: "2026-06-10" });

    const where = supplierQueries[0]?.where as { tenantId: string; id: { in: string[] } };
    expect(where.tenantId).toBe(TENANT);
    // The same supplier on two receipts is ONE id in the batched read.
    expect([...where.id.in]).toEqual([SUPPLIER_A]);
  });

  it("refuses LOUDLY when a supplier the batched read did not return, naming the id", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      purchases: [
        purchase({
          id: "purchase-1",
          supplierId: SUPPLIER_B,
          receivedAt: "2026-06-10T09:00:00.000Z",
          quantities: ["1.000"],
        }),
      ],
      // The composite RESTRICT FK makes this unreachable; a dropped receipt would
      // be worse than a 500.
      suppliers: [],
    });

    const refusal = service.purchases({ from: "2026-06-10", to: "2026-06-10" });
    await expect(refusal).rejects.toMatchObject({
      code: "INTERNAL",
      message: reportSupplierMissingMessage(SUPPLIER_B),
    });
    await expect(refusal).rejects.toThrow(SUPPLIER_B);
  });

  it("returns an empty row set for an empty period, reading no supplier", async () => {
    const { service, supplierQueries } = harness({ permissions: READ_PERMISSION, purchases: [] });

    const response = await service.purchases({ from: "2026-06-10", to: "2026-06-10" });

    expect(response).toEqual({
      report: "purchases",
      period: ONE_DAY_PERIOD,
      rows: [],
    });
    // Nothing to identify, so nothing is asked: an empty id set is not a query.
    expect(supplierQueries).toEqual([]);
  });

  it("refuses a period over the purchase cap instead of reporting a partial receipt list", async () => {
    const purchases = Array.from({ length: REPORT_PURCHASE_ROW_LIMIT + 1 }, (_unused, index) =>
      purchase({
        id: `purchase-${index}`,
        supplierId: SUPPLIER_A,
        receivedAt: "2026-06-10T09:00:00.000Z",
        quantities: ["1.000"],
      })
    );
    const { service } = harness({
      permissions: READ_PERMISSION,
      purchases,
      suppliers: [{ id: SUPPLIER_A, name: "Distribuidora Norte" }],
    });

    await expect(service.purchases({ from: "2026-06-10", to: "2026-06-10" })).rejects.toMatchObject(
      {
        code: "VALIDATION_FAILED",
        message: REPORT_PURCHASE_ROW_LIMIT_EXCEEDED_MESSAGE,
      }
    );
  });

  it("refuses a missing reports.read BEFORE any query runs", async () => {
    const { service, purchaseQueries, supplierQueries } = harness({ permissions: ["sales.read"] });

    await expect(service.purchases({ preset: "today" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: REPORT_READ_FORBIDDEN_MESSAGE,
    });
    expect(purchaseQueries).toEqual([]);
    expect(supplierQueries).toEqual([]);
  });
});
