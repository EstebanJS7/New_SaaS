import { describe, expect, it } from "vitest";
import { Prisma } from "@newsaas/database";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import type { RequestContextService } from "../context/request-context.service.js";
import type { TenantSettingsService } from "../settings/tenant-settings.service.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";
import {
  REPORT_STOCK_BALANCE_ROW_LIMIT,
  REPORT_STOCK_BALANCE_ROW_LIMIT_EXCEEDED_MESSAGE,
  REPORT_STOCK_MOVEMENT_ROW_LIMIT,
  REPORT_STOCK_MOVEMENT_ROW_LIMIT_EXCEEDED_MESSAGE,
  ReportRepository,
  type ReportingReadPrisma,
  type ReportCatalogItemRow,
  type ReportStockBalanceRow,
  type ReportStockMovementRow,
} from "./reporting.repository.js";
import {
  REPORT_READ_FORBIDDEN_MESSAGE,
  ReportingService,
  reportStockCatalogItemMissingMessage,
  reportStockMovementBalanceMissingMessage,
} from "./reporting.service.js";
import type { LowStockReportRowDto, StockReportRowDto } from "./reporting.dto.js";

/**
 * The inventory reports of [[REP-005]] at the SERVICE boundary: the
 * balance-versus-ledger distinction, the signed flow, the low-stock filter and
 * every refusal.
 *
 * The pattern is the landed suites: the REAL repository over stub delegates, so
 * the query the report builds (predicate, order, `take`) is the shipped one and
 * is asserted as an ARGUMENT. What a stub cannot prove is a row-level boundary —
 * it returns whatever it is given — so the half-open period edges and tenant
 * isolation are also proven against the in-memory boundary in
 * `reporting.inventory.integration.test.ts`, where the predicate is applied.
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

/** Item identities the fixtures reference. */
const ITEM_FEED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_VACCINE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM_SYRINGE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ITEM_GROOMING = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

interface Harness {
  service: ReportingService;
  /** Every `stockBalance.findMany` arg the repository built, in call order. */
  balanceQueries: Prisma.StockBalanceFindManyArgs[];
  /** Every `stockMovement.findMany` arg the repository built, in call order. */
  movementQueries: Prisma.StockMovementFindManyArgs[];
  /** Every `catalogItem.findMany` arg the repository built, in call order. */
  catalogQueries: Prisma.CatalogItemFindManyArgs[];
}

/**
 * The real repository over stub inventory delegates, a stub permission resolver
 * and a pinned clock.
 *
 * The settings stub THROWS: a quantity is not money, and neither inventory report
 * carries a currency, so a `sales` settings read here would be a currency
 * resolved for a response that must not contain one.
 */
function harness(
  options: {
    balances?: ReportStockBalanceRow[];
    movements?: ReportStockMovementRow[];
    catalogItems?: ReportCatalogItemRow[];
    /**
     * What the low-stock EXISTENCE PROBE answers: does the tenant monitor at
     * least one tracked item? It is deliberately independent of `catalogItems`,
     * because the probe reads the catalog directly rather than the balanced
     * items — the whole point of [[REP-005]]'s fix.
     */
    anyLowStockThreshold?: boolean;
    permissions?: readonly string[];
    now?: Date;
  } = {}
): Harness {
  const balanceQueries: Prisma.StockBalanceFindManyArgs[] = [];
  const movementQueries: Prisma.StockMovementFindManyArgs[] = [];
  const catalogQueries: Prisma.CatalogItemFindManyArgs[] = [];

  const prisma: ReportingReadPrisma = {
    // Every OTHER report's reads are unreachable from here and vice versa: each
    // stub throws instead of answering `[]`, so a case that reached one fails
    // loudly rather than silently aggregating an empty set.
    sale: {
      findMany: () => {
        throw new Error("The inventory reports must not read sales.");
      },
    },
    cashSession: {
      findMany: () => {
        throw new Error("The inventory reports must not read cash sessions.");
      },
    },
    cashMovement: {
      findMany: () => {
        throw new Error("The inventory reports must not read cash movements.");
      },
    },
    purchase: {
      findMany: () => {
        throw new Error("The inventory reports must not read purchases.");
      },
    },
    supplier: {
      findMany: () => {
        throw new Error("The inventory reports must not read suppliers.");
      },
    },
    catalogItem: {
      findMany: (args) => {
        catalogQueries.push(args);
        return Promise.resolve(options.catalogItems ?? []);
      },
      // The existence probe: a full row shape, because the report reads identity
      // from it like any other catalog row.
      findFirst: () =>
        Promise.resolve(
          options.anyLowStockThreshold
            ? {
                id: "probe",
                name: "probe",
                kind: "PRODUCT",
                tracksStock: true,
                lowStockThreshold: "1.000",
              }
            : null
        ),
    },
    stockBalance: {
      findMany: (args) => {
        balanceQueries.push(args);
        return Promise.resolve(options.balances ?? []);
      },
    },
    stockMovement: {
      findMany: (args) => {
        movementQueries.push(args);
        return Promise.resolve(options.movements ?? []);
      },
    },
    // REP-006's veterinary reads are not inventory reads: they THROW here so an
    // inventory case that reached one fails loudly rather than counting nothing.
    clinicalEncounter: {
      findMany: () => {
        throw new Error("The inventory reports must not read clinical encounters.");
      },
    },
    patient: {
      findMany: () => {
        throw new Error("The inventory reports must not read patients.");
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
      throw new Error("An inventory report must not resolve a currency.");
    },
  } as unknown as TenantSettingsService;

  const repository = new ReportRepository(prisma, requestContext);
  const now = options.now ?? new Date("2026-06-10T12:00:00.000Z");
  const service = new ReportingService(repository, settings, permissionResolver, () => now);
  return { service, balanceQueries, movementQueries, catalogQueries };
}

const READ_PERMISSION = [REPORTING_PERMISSIONS.read];

/** One catalog item as the batched read returns it. */
function catalogItem(options: {
  id: string;
  name?: string;
  kind?: ReportCatalogItemRow["kind"];
  tracksStock?: boolean;
  lowStockThreshold?: string | null;
}): ReportCatalogItemRow {
  return {
    id: options.id,
    name: options.name ?? options.id,
    kind: options.kind ?? "PRODUCT",
    tracksStock: options.tracksStock ?? true,
    lowStockThreshold: options.lowStockThreshold ?? null,
  };
}

/** One projection row: the CURRENT balance, as the projection stores it. */
function balance(catalogItemId: string, quantity: string): ReportStockBalanceRow {
  return { catalogItemId, quantity };
}

/** One ledger row: the quantity keeps its SIGN, exactly as the ledger stores it. */
function movement(catalogItemId: string, quantity: string): ReportStockMovementRow {
  return { catalogItemId, quantity };
}

describe("ReportingService · the stock report ([[REP-005]])", () => {
  it("reports a balance equal to the signed sum of the item's movements", async () => {
    // THE INVARIANT EPIC-10 closed with: the projection equals the ledger's
    // signed sum. The fixture's movements ARE this item's whole ledger (the stub
    // answers exactly what it is given), which is what makes the equality
    // assertable here.
    //
    // It CANNOT be a runtime check in the report: the shipped movement read is
    // period-bounded, so the report never sees lifetime movements and could not
    // compute a lifetime sum to compare against. That is the reason this is a
    // TEST-level guard and not a service assertion, and it is exactly why
    // `quantity` and `net` must never be conflated in the DTO.
    const ledger = ["10.000", "-3.000", "5.000", "-3.000"];
    const movements = ledger.map((quantity) => movement(ITEM_VACCINE, quantity));

    const { service } = harness({
      permissions: READ_PERMISSION,
      balances: [balance(ITEM_VACCINE, "9.000")],
      movements,
      catalogItems: [catalogItem({ id: ITEM_VACCINE, name: "Vacuna antirrábica" })],
    });

    const response = await service.stock({ from: "2026-06-10", to: "2026-06-10" });

    // Recomputed from the ROWS on a different summation path, exact string
    // equality at the end — no epsilon.
    const signedSum = movements.reduce(
      (total, entry) => total.plus(new Prisma.Decimal(entry.quantity.toString())),
      new Prisma.Decimal(0)
    );
    expect(signedSum.toFixed(3)).toBe("9.000");

    const row = response.rows[0];
    expect(row?.quantity).toBe(signedSum.toFixed(3));
    // The period's flow is a DIFFERENT number for the same item: 15 in, 6 out.
    expect(row?.inbound).toBe("15.000");
    expect(row?.outbound).toBe("6.000");
    expect(row?.net).toBe("9.000");
  });

  it("sums positives into inbound, the negatives as a POSITIVE outbound, and the signed net", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      balances: [balance(ITEM_FEED, "10.000")],
      movements: [
        movement(ITEM_FEED, "10.000"),
        movement(ITEM_FEED, "-3.000"),
        movement(ITEM_FEED, "5.000"),
        movement(ITEM_FEED, "-2.000"),
      ],
      catalogItems: [catalogItem({ id: ITEM_FEED, name: "Balanceado 10kg", kind: "SUPPLY" })],
    });

    const response = await service.stock({ from: "2026-06-10", to: "2026-06-10" });

    expect(response.rows).toEqual([
      {
        catalogItemId: ITEM_FEED,
        name: "Balanceado 10kg",
        kind: "SUPPLY",
        quantity: "10.000",
        inbound: "15.000",
        // 3 + 2 rendered as a MAGNITUDE, never as "-5.000" beside an inbound that
        // already carries no sign: the ledger's sign says the direction and the
        // column's name says which way, so a second minus would be noise at best.
        outbound: "5.000",
        net: "10.000",
      },
    ]);
    // in - out === net, exactly, on the same scale.
    expect(new Prisma.Decimal("15.000").minus(new Prisma.Decimal("5.000")).toFixed(3)).toBe(
      response.rows[0]?.net
    );
  });

  it("reads the flow by the movement's own createdAt, tenant-scoped and half-open", async () => {
    // A movement OUTSIDE the period contributes to none of `inbound`, `outbound`
    // or `net`. The stub returns whatever it is given, so what proves the
    // exclusion here is the QUERY: it is half-open `[fromInstant, toInstant)`, so
    // a row before the inclusive start or at the exclusive end cannot match. The
    // in-memory suite then proves the rows, because the fake applies it.
    const { service, movementQueries } = harness({ permissions: READ_PERMISSION });

    await service.stock({ from: "2026-06-10", to: "2026-06-10" });

    expect(movementQueries).toHaveLength(1);
    expect(movementQueries[0]).toMatchObject({
      where: {
        tenantId: TENANT,
        createdAt: { gte: new Date(FROM_INSTANT), lt: new Date(TO_INSTANT) },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    // One row past the cap, so an over-limit period is REFUSED rather than cut.
    expect(movementQueries[0]?.take).toBe(REPORT_STOCK_MOVEMENT_ROW_LIMIT + 1);
  });

  it("reads the CURRENT balance with no date predicate at all, capped and item-ordered", async () => {
    const { service, balanceQueries } = harness({ permissions: READ_PERMISSION });

    await service.stock({ from: "2026-06-10", to: "2026-06-10" });

    expect(balanceQueries).toHaveLength(1);
    expect(balanceQueries[0]).toMatchObject({
      where: { tenantId: TENANT },
      orderBy: [{ catalogItemId: "asc" }],
    });
    // The projection has NO business instant, so there is deliberately nothing to
    // date it by: a `createdAt`/`updatedAt` predicate here would be a period
    // filter the snapshot cannot honour.
    expect(Object.keys(balanceQueries[0]?.where ?? {})).toEqual(["tenantId"]);
    expect(balanceQueries[0]?.take).toBe(REPORT_STOCK_BALANCE_ROW_LIMIT + 1);
  });

  it("reports zero flows for an item with a balance and no movement in the period", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      balances: [balance(ITEM_VACCINE, "12.500")],
      movements: [],
      catalogItems: [catalogItem({ id: ITEM_VACCINE, name: "Vacuna" })],
    });

    const response = await service.stock({ from: "2026-06-10", to: "2026-06-10" });

    // Untouched in the period is a FACT, not an absence: the row is present with
    // a real balance and three zeros.
    expect(response.rows).toEqual([
      {
        catalogItemId: ITEM_VACCINE,
        name: "Vacuna",
        kind: "PRODUCT",
        quantity: "12.500",
        inbound: "0.000",
        outbound: "0.000",
        net: "0.000",
      },
    ]);
  });

  it("still lists an item whose period sold it down to exactly zero", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      balances: [balance(ITEM_SYRINGE, "0.000")],
      movements: [movement(ITEM_SYRINGE, "-20.000")],
      catalogItems: [catalogItem({ id: ITEM_SYRINGE, name: "Jeringa 5ml", kind: "SUPPLY" })],
    });

    const response = await service.stock({ from: "2026-06-10", to: "2026-06-10" });

    // A zero balance is a business fact ("there are none"), not the absence of a
    // row, and the BLOCK policy explicitly accepts an output that lands on zero.
    expect(response.rows).toHaveLength(1);
    expect(response.rows[0]).toMatchObject({
      quantity: "0.000",
      inbound: "0.000",
      outbound: "20.000",
      net: "-20.000",
    });
  });

  it("refuses LOUDLY when the period's ledger names an item with no balance row", async () => {
    // The projection is written in the SAME transaction as its movements, so this
    // is an anomalous data state, not a user-facing answer: dropping the flow
    // would report an item as untouched in a period where stock moved.
    const { service } = harness({
      permissions: READ_PERMISSION,
      balances: [],
      movements: [movement(ITEM_GROOMING, "-1.000")],
      catalogItems: [catalogItem({ id: ITEM_GROOMING, name: "Baño" })],
    });

    const refusal = service.stock({ from: "2026-06-10", to: "2026-06-10" });
    await expect(refusal).rejects.toMatchObject({
      code: "INTERNAL",
      message: reportStockMovementBalanceMissingMessage(ITEM_GROOMING),
    });
    await expect(refusal).rejects.toThrow(ITEM_GROOMING);
  });

  it("refuses LOUDLY when a balance names a catalog item the batched read did not return", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      balances: [balance(ITEM_VACCINE, "1.000")],
      movements: [],
      // The composite RESTRICT FK makes this unreachable; a nameless row would be
      // worse than a failure.
      catalogItems: [],
    });

    const refusal = service.stock({ from: "2026-06-10", to: "2026-06-10" });
    await expect(refusal).rejects.toMatchObject({
      code: "INTERNAL",
      message: reportStockCatalogItemMissingMessage(ITEM_VACCINE),
    });
    await expect(refusal).rejects.toThrow(ITEM_VACCINE);
  });

  it("resolves names with the tenant predicate and the UNION of balance and movement ids", async () => {
    const { service, catalogQueries } = harness({
      permissions: READ_PERMISSION,
      balances: [balance(ITEM_FEED, "3.000"), balance(ITEM_VACCINE, "4.000")],
      movements: [movement(ITEM_FEED, "1.000")],
      catalogItems: [
        catalogItem({ id: ITEM_FEED, name: "Balanceado" }),
        catalogItem({ id: ITEM_VACCINE, name: "Vacuna" }),
      ],
    });

    await service.stock({ from: "2026-06-10", to: "2026-06-10" });

    // ONE batched read: no query per row, and the movement's item is included
    // even when it also has a balance (the union is de-duplicated).
    expect(catalogQueries).toHaveLength(1);
    const where = catalogQueries[0]?.where as { tenantId: string; id: { in: string[] } };
    expect(where.tenantId).toBe(TENANT);
    expect([...where.id.in].sort()).toEqual([ITEM_FEED, ITEM_VACCINE].sort());
  });

  it("orders rows by name ascending, then catalogItemId ascending", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      // Seeded in a deliberately scrambled order: the response order is the
      // contract's, never the read's.
      balances: [
        balance(ITEM_VACCINE, "1.000"),
        balance("item-zulu", "2.000"),
        balance("item-alfa", "3.000"),
        balance("item-alfa-2", "4.000"),
      ],
      movements: [],
      catalogItems: [
        catalogItem({ id: ITEM_VACCINE, name: "Zenith" }),
        catalogItem({ id: "item-zulu", name: "Alfa" }),
        catalogItem({ id: "item-alfa", name: "Alfa" }),
        catalogItem({ id: "item-alfa-2", name: "Alfa" }),
      ],
    });

    const response = await service.stock({ from: "2026-06-10", to: "2026-06-10" });

    // The equal-name tie is broken by ID, not by the map's insertion order.
    expect(response.rows.map((row) => row.catalogItemId)).toEqual([
      "item-alfa",
      "item-alfa-2",
      "item-zulu",
      ITEM_VACCINE,
    ]);
  });

  it("excludes a tracksStock=false item from the stock report", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      balances: [balance(ITEM_FEED, "1.000"), balance(ITEM_GROOMING, "5.000")],
      movements: [movement(ITEM_GROOMING, "5.000")],
      catalogItems: [
        catalogItem({ id: ITEM_FEED, name: "Balanceado" }),
        // A SERVICE, or an explicitly untracked item: not inventory.
        catalogItem({ id: ITEM_GROOMING, name: "Baño", kind: "SERVICE", tracksStock: false }),
      ],
    });

    const response = await service.stock({ from: "2026-06-10", to: "2026-06-10" });

    expect(response.rows.map((row) => row.catalogItemId)).toEqual([ITEM_FEED]);
    expect(JSON.stringify(response)).not.toContain(ITEM_GROOMING);
  });

  it("returns an empty row set with the period echoed, reading no catalog", async () => {
    const { service, catalogQueries } = harness({ permissions: READ_PERMISSION });

    const response = await service.stock({ from: "2026-06-10", to: "2026-06-10" });

    expect(response).toEqual({ report: "stock", period: ONE_DAY_PERIOD, rows: [] });
    // Nothing to identify, so nothing is asked: an empty id set is not a query.
    expect(catalogQueries).toEqual([]);
  });

  it("carries no currency and exactly the declared row keys", async () => {
    // The row type is pinned KEY BY KEY: `Record<keyof StockReportRowDto, true>`
    // fails to compile the moment a `currency` or a money key is added, and the
    // runtime assertion then proves the response populates exactly these keys.
    const everyStockRowKey: Record<keyof StockReportRowDto, true> = {
      catalogItemId: true,
      name: true,
      kind: true,
      quantity: true,
      inbound: true,
      outbound: true,
      net: true,
    };

    const { service } = harness({
      permissions: READ_PERMISSION,
      balances: [balance(ITEM_FEED, "1.000")],
      movements: [],
      catalogItems: [catalogItem({ id: ITEM_FEED, name: "Balanceado" })],
    });

    const response = await service.stock({ from: "2026-06-10", to: "2026-06-10" });

    expect(Object.keys(response).sort()).toEqual(["period", "report", "rows"]);
    expect(Object.keys(response.rows[0] ?? {}).sort()).toEqual(
      Object.keys(everyStockRowKey).sort()
    );
    expect(JSON.stringify(response)).not.toContain("currency");
  });

  it("refuses a balance read over the cap instead of reporting a partial inventory", async () => {
    const balances = Array.from({ length: REPORT_STOCK_BALANCE_ROW_LIMIT + 1 }, (_unused, index) =>
      balance(`item-${index}`, "1.000")
    );
    const { service } = harness({ permissions: READ_PERMISSION, balances });

    await expect(service.stock({ from: "2026-06-10", to: "2026-06-10" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: REPORT_STOCK_BALANCE_ROW_LIMIT_EXCEEDED_MESSAGE,
    });
  });

  it("refuses a period over the movement cap instead of aggregating a truncated flow", async () => {
    const movements = Array.from({ length: REPORT_STOCK_MOVEMENT_ROW_LIMIT + 1 }, () =>
      movement(ITEM_FEED, "1.000")
    );
    const { service } = harness({ permissions: READ_PERMISSION, movements });

    await expect(service.stock({ from: "2026-06-10", to: "2026-06-10" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: REPORT_STOCK_MOVEMENT_ROW_LIMIT_EXCEEDED_MESSAGE,
    });
  });

  it("refuses a missing reports.read BEFORE any query runs", async () => {
    const { service, balanceQueries, movementQueries, catalogQueries } = harness({
      permissions: ["sales.read"],
    });

    await expect(service.stock({ preset: "today" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: REPORT_READ_FORBIDDEN_MESSAGE,
    });
    expect(balanceQueries).toEqual([]);
    expect(movementQueries).toEqual([]);
    expect(catalogQueries).toEqual([]);
  });
});

describe("ReportingService · the low-stock report ([[REP-005]])", () => {
  it("includes an item exactly AT its threshold and excludes one just above it", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      balances: [balance(ITEM_VACCINE, "5.000"), balance(ITEM_FEED, "5.001")],
      catalogItems: [
        catalogItem({ id: ITEM_VACCINE, name: "Vacuna", lowStockThreshold: "5.000" }),
        catalogItem({ id: ITEM_FEED, name: "Balanceado", lowStockThreshold: "5.000" }),
      ],
    });

    const response = await service.lowStock();

    // `<=`, not `<`: sitting ON the threshold means there is nothing to spare.
    expect(response.rows.map((row) => row.catalogItemId)).toEqual([ITEM_VACCINE]);
    expect(response.rows[0]).toEqual({
      catalogItemId: ITEM_VACCINE,
      name: "Vacuna",
      quantity: "5.000",
      threshold: "5.000",
      shortfall: "0.000",
    });
    expect(JSON.stringify(response)).not.toContain(ITEM_FEED);
  });

  it("never lists an item whose threshold is NULL, even at quantity zero", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      balances: [balance(ITEM_VACCINE, "0.000")],
      // DEC-065: NULL means NOT MONITORED. A zero-row here would be the invented
      // default that decision explicitly refused.
      catalogItems: [catalogItem({ id: ITEM_VACCINE, name: "Vacuna" })],
    });

    const response = await service.lowStock();

    expect(response.rows).toEqual([]);
    expect(response.thresholdsConfigured).toBe(false);
  });

  it("reports the shortfall as threshold minus quantity on the three-decimal scale", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      balances: [balance(ITEM_VACCINE, "2.250"), balance(ITEM_FEED, "0.000")],
      catalogItems: [
        catalogItem({ id: ITEM_VACCINE, name: "Vacuna", lowStockThreshold: "10.000" }),
        catalogItem({ id: ITEM_FEED, name: "Balanceado", lowStockThreshold: "7.500" }),
      ],
    });

    const response = await service.lowStock();

    const byId = new Map(response.rows.map((row) => [row.catalogItemId, row]));
    // 10.000 - 2.250 = 7.750 exactly; a float path could produce 7.749999…
    expect(byId.get(ITEM_VACCINE)).toEqual({
      catalogItemId: ITEM_VACCINE,
      name: "Vacuna",
      quantity: "2.250",
      threshold: "10.000",
      shortfall: "7.750",
    });
    expect(byId.get(ITEM_FEED)).toEqual({
      catalogItemId: ITEM_FEED,
      name: "Balanceado",
      quantity: "0.000",
      threshold: "7.500",
      shortfall: "7.500",
    });
    for (const row of response.rows) {
      expect(new Prisma.Decimal(row.shortfall).greaterThanOrEqualTo(0)).toBe(true);
    }
  });

  it("orders most-depleted first, and ties on shortfall by name ascending", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      // Scrambled on purpose: the response order is the contract's, not the read's.
      balances: [
        balance("item-c", "1.000"),
        balance("item-a", "2.000"),
        balance("item-b", "0.000"),
      ],
      catalogItems: [
        // shortfall 4
        catalogItem({ id: "item-c", name: "Charlot", lowStockThreshold: "5.000" }),
        // shortfall 0 — exactly at its threshold, so included and least urgent
        catalogItem({ id: "item-a", name: "Zulu", lowStockThreshold: "2.000" }),
        // shortfall 4, the TIE with Charlot
        catalogItem({ id: "item-b", name: "Beta", lowStockThreshold: "4.000" }),
      ],
    });

    const response = await service.lowStock();

    // Most depleted first (4.000 before 0.000); the equal-shortfall pair is
    // broken by NAME, so Beta precedes Charlot instead of following the read's
    // `catalogItemId` order (item-b before item-c), which would be the opposite.
    expect(response.rows.map((row) => row.name)).toEqual(["Beta", "Charlot", "Zulu"]);
    expect(response.rows.map((row) => row.shortfall)).toEqual(["4.000", "4.000", "0.000"]);
  });

  it("distinguishes the two empty answers: no threshold anywhere, versus thresholds all satisfied", async () => {
    const unconfigured = harness({
      permissions: READ_PERMISSION,
      balances: [balance(ITEM_VACCINE, "1.000")],
      catalogItems: [catalogItem({ id: ITEM_VACCINE, name: "Vacuna" })],
    });

    const noThresholds = await unconfigured.service.lowStock();
    expect(noThresholds).toEqual({ report: "low-stock", thresholdsConfigured: false, rows: [] });

    const satisfied = harness({
      permissions: READ_PERMISSION,
      anyLowStockThreshold: true,
      balances: [balance(ITEM_VACCINE, "50.000")],
      catalogItems: [
        catalogItem({ id: ITEM_VACCINE, name: "Vacuna", lowStockThreshold: "10.000" }),
      ],
    });

    const allFine = await satisfied.service.lowStock();
    expect(allFine).toEqual({ report: "low-stock", thresholdsConfigured: true, rows: [] });

    // Both are an empty array, and they MUST NOT look identical: one means nobody
    // opted in, the other means the setup works.
    expect(noThresholds.rows).toEqual(allFine.rows);
    expect(noThresholds.thresholdsConfigured).not.toBe(allFine.thresholdsConfigured);
  });

  it("reports a configured tenant as configured even when no thresholded item has a balance", async () => {
    // REGRESSION. The probe used to be derived from the balanced items, so a
    // tenant that set a threshold on an item which had never moved — no balance
    // row, therefore invisible to the batched catalog read — was told "nobody has
    // configured anything" while its configuration sat right there in the catalog.
    const { service } = harness({
      permissions: READ_PERMISSION,
      // The probe says yes; the balanced items say nothing about thresholds.
      anyLowStockThreshold: true,
      balances: [balance(ITEM_VACCINE, "50.000")],
      catalogItems: [catalogItem({ id: ITEM_VACCINE, name: "Vacuna" })],
    });

    const response = await service.lowStock();

    expect(response.rows).toEqual([]);
    expect(response.thresholdsConfigured).toBe(true);
  });

  it("excludes a tracksStock=false item from the low-stock report", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      balances: [balance(ITEM_GROOMING, "0.000"), balance(ITEM_VACCINE, "1.000")],
      catalogItems: [
        catalogItem({
          id: ITEM_GROOMING,
          name: "Baño",
          kind: "SERVICE",
          tracksStock: false,
          // Even a threshold on a non-tracking item does not make it inventory.
          lowStockThreshold: "10.000",
        }),
        catalogItem({ id: ITEM_VACCINE, name: "Vacuna", lowStockThreshold: "2.000" }),
      ],
    });

    const response = await service.lowStock();

    expect(response.rows.map((row) => row.catalogItemId)).toEqual([ITEM_VACCINE]);
    expect(JSON.stringify(response)).not.toContain(ITEM_GROOMING);
  });

  it("refuses LOUDLY when a balance names a catalog item the batched read did not return", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      balances: [balance(ITEM_VACCINE, "1.000")],
      catalogItems: [],
    });

    const refusal = service.lowStock();
    await expect(refusal).rejects.toMatchObject({
      code: "INTERNAL",
      message: reportStockCatalogItemMissingMessage(ITEM_VACCINE),
    });
    await expect(refusal).rejects.toThrow(ITEM_VACCINE);
  });

  it("reads the projection once, tenant-scoped and capped, with one catalog read", async () => {
    const { service, balanceQueries, movementQueries, catalogQueries } = harness({
      permissions: READ_PERMISSION,
      balances: [balance(ITEM_VACCINE, "1.000")],
      catalogItems: [catalogItem({ id: ITEM_VACCINE, name: "Vacuna" })],
    });

    await service.lowStock();

    expect(balanceQueries).toHaveLength(1);
    expect(balanceQueries[0]).toMatchObject({
      where: { tenantId: TENANT },
      orderBy: [{ catalogItemId: "asc" }],
    });
    expect(balanceQueries[0]?.take).toBe(REPORT_STOCK_BALANCE_ROW_LIMIT + 1);
    // A current-state view reads NO ledger: there is no period to bound one by.
    expect(movementQueries).toEqual([]);
    expect(catalogQueries).toHaveLength(1);
  });

  it("refuses a balance read over the cap instead of listing a partial inventory", async () => {
    const balances = Array.from({ length: REPORT_STOCK_BALANCE_ROW_LIMIT + 1 }, (_unused, index) =>
      balance(`item-${index}`, "1.000")
    );
    const { service } = harness({ permissions: READ_PERMISSION, balances });

    await expect(service.lowStock()).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: REPORT_STOCK_BALANCE_ROW_LIMIT_EXCEEDED_MESSAGE,
    });
  });

  it("returns an empty answer for an empty inventory, reading no catalog", async () => {
    const { service, catalogQueries } = harness({ permissions: READ_PERMISSION });

    const response = await service.lowStock();

    expect(response).toEqual({ report: "low-stock", thresholdsConfigured: false, rows: [] });
    expect(catalogQueries).toEqual([]);
  });

  it("carries no currency, no period and exactly the declared row keys", async () => {
    const everyLowStockRowKey: Record<keyof LowStockReportRowDto, true> = {
      catalogItemId: true,
      name: true,
      quantity: true,
      threshold: true,
      shortfall: true,
    };

    const { service } = harness({
      permissions: READ_PERMISSION,
      balances: [balance(ITEM_VACCINE, "1.000")],
      catalogItems: [catalogItem({ id: ITEM_VACCINE, name: "Vacuna", lowStockThreshold: "2.000" })],
    });

    const response = await service.lowStock();

    // No `period` either: this is a current-state view and a period echo would
    // claim a range that was never applied.
    expect(Object.keys(response).sort()).toEqual(["report", "rows", "thresholdsConfigured"]);
    expect(Object.keys(response.rows[0] ?? {}).sort()).toEqual(
      Object.keys(everyLowStockRowKey).sort()
    );
    expect(JSON.stringify(response)).not.toContain("currency");
    expect(JSON.stringify(response)).not.toContain("period");
  });

  it("refuses a missing reports.read BEFORE any query runs", async () => {
    const { service, balanceQueries, catalogQueries } = harness({ permissions: ["sales.read"] });

    await expect(service.lowStock()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: REPORT_READ_FORBIDDEN_MESSAGE,
    });
    expect(balanceQueries).toEqual([]);
    expect(catalogQueries).toEqual([]);
  });
});
