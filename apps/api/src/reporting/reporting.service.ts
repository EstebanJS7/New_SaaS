import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
// Value import (not `import type`): the sign MAP is the function under contract.
// It is the ONLY implementation of the convention in the repo ([[DEC-030]]), so
// this module RESOLVES the sign by calling it and never by restating it.
import { cashMovementSign } from "../cash/cash.expected-amount.js";
import type { CashMovementDirectionValue, CashMovementTypeValue } from "../cash/cash.repository.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { TenantSettingsService } from "../settings/tenant-settings.service.js";
import type {
  CashMovementRowDto,
  CashMovementsResponse,
  CashSessionRowDto,
  CashSessionsResponse,
  KindTotalDto,
  LowStockReportResponse,
  LowStockReportRowDto,
  PaymentMethodRowDto,
  PaymentMethodsResponse,
  PurchaseRowDto,
  PurchasesResponse,
  ReportPeriodDto,
  ReportPeriodQuery,
  SalesByPeriodResponse,
  SalesByPeriodRowDto,
  SalesByProductServiceResponse,
  SalesByProductServiceRowDto,
  StockReportResponse,
  StockReportRowDto,
} from "./reporting.dto.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";
import {
  resolveReportPeriod,
  tenantCalendarDate,
  type ResolvedReportPeriod,
} from "./report.period.js";
import {
  ReportRepository,
  type ReportCatalogItemRow,
  type ReportCashSessionRow,
  type ReportSaleLineRow,
  type ReportSaleRow,
} from "./reporting.repository.js";

/**
 * Stable message behind every report `403`. The route decorator is the first
 * gate; this is the defense-in-depth re-assertion behind it, and a denial reaches
 * no data access at all.
 */
export const REPORT_READ_FORBIDDEN_MESSAGE = "The required report permission is missing.";

/**
 * Stable message when the tenant's sale currency cannot be read as a code. The
 * report never guesses a currency ([[DEC-022]]): a guessed one is a wrong number
 * with a plausible symbol in front of it.
 */
export const REPORT_CURRENCY_UNRESOLVED_MESSAGE = "The tenant sale currency could not be resolved.";

/**
 * Stable message when a sale line names a catalog item the catalog read did not
 * return. `sale_line.catalog_item_id` is a `RESTRICT` composite foreign key, so
 * this is UNREACHABLE; it is asserted rather than assumed because the
 * alternative — dropping the revenue line — would be a report that is quietly
 * short by an amount nobody can see, which is worse than a loud failure.
 */
export function reportCatalogItemMissingMessage(catalogItemId: string): string {
  return `The report read a sale line whose catalog item is missing: ${catalogItemId}`;
}

/**
 * Stable message when a closed session's stored `countedAmount - expectedAmount`
 * is not its stored `differenceAmount`.
 *
 * The close command computes both from the same inputs ([[DEC-031]]), so the
 * three columns agree by construction and this branch is unreachable through the
 * command. It is ASSERTED rather than assumed because the stored
 * `differenceAmount` is the authoritative one: a report that quietly printed a
 * row where the three disagree would be publishing a drawer result that never
 * happened, and a report that recomputed the difference instead would silently
 * overrule what the operator counted.
 */
export function reportCashSessionDifferenceMismatchMessage(sessionId: string): string {
  return `The report read a closed cash session whose counted minus expected amount is not its difference: ${sessionId}`;
}

/**
 * Stable message when a purchase names a supplier the batched supplier read did
 * not return. `purchase.supplier_id` is a `RESTRICT` composite foreign key, so
 * this is UNREACHABLE; it is asserted rather than assumed for the same reason as
 * the missing-catalog-item refusal — a receipt with no supplier name is a row the
 * report cannot honestly render, and dropping it would be worse.
 */
export function reportSupplierMissingMessage(supplierId: string): string {
  return `The report read a purchase whose supplier is missing: ${supplierId}`;
}

/**
 * Stable message when the period's ledger names an item that has NO balance row.
 *
 * `stock_balance` is written in the SAME transaction as the movement that
 * changes it (EPIC-10), under the per-`(tenant, item)` advisory lock, so the
 * projection always exists once a movement does. This branch is therefore
 * UNREACHABLE; it is asserted rather than assumed because the alternative —
 * dropping the movement's flow — would report an item as untouched in a period
 * where stock actually moved, and the row would look exactly like a correct one.
 */
export function reportStockMovementBalanceMissingMessage(catalogItemId: string): string {
  return `The report read a stock movement whose item has no stock balance: ${catalogItemId}`;
}

/**
 * Stable message when a stock read names a catalog item the batched catalog read
 * did not return. `stock_balance` and `stock_movement` both carry a `RESTRICT`
 * composite `(tenant_id, catalog_item_id)` foreign key, so this is UNREACHABLE —
 * the same discipline as the missing sale line item and the missing supplier: a
 * row whose name cannot be resolved is refused loudly, never rendered nameless
 * and never silently dropped.
 */
export function reportStockCatalogItemMissingMessage(catalogItemId: string): string {
  return `The report read a stock row whose catalog item is missing: ${catalogItemId}`;
}

/**
 * The response order of the movement roll-up: `type` ascending (this list is that
 * alphabetical order) and then `direction` ascending with `null` FIRST.
 *
 * Declared as explicit orders rather than `localeCompare` so the contract is
 * TOTAL and locale-independent: two rows can never compare equal and inherit a
 * map's insertion order, which would make the response depend on the order the
 * database happened to return.
 */
const CASH_MOVEMENT_TYPE_ORDER: readonly CashMovementTypeValue[] = [
  "ADJUSTMENT",
  "DEPOSIT",
  "EXPENSE",
  "INCOME",
  "REFUND",
  "SALE",
  "WITHDRAWAL",
];

const CASH_MOVEMENT_DIRECTION_ORDER: readonly (CashMovementDirectionValue | null)[] = [
  null,
  "DECREASE",
  "INCREASE",
];

/** One accumulating `(type, direction)` group of the movement ledger. */
interface MovementBucket {
  readonly type: CashMovementTypeValue;
  readonly direction: CashMovementDirectionValue | null;
  movementCount: number;
  signedAmount: Prisma.Decimal;
}

/** One accumulating calendar-day bucket. Money is `Decimal` from the first add. */
interface Bucket {
  readonly bucketDate: string;
  saleCount: number;
  net: Prisma.Decimal;
  tax: Prisma.Decimal;
  gross: Prisma.Decimal;
}

/** One accumulating tender row: how many payments of one method, and their sum. */
interface TenderBucket {
  paymentCount: number;
  amount: Prisma.Decimal;
}

/**
 * One item's PERIOD FLOW from the immutable ledger ([[REP-005]]), held as exact
 * decimals from the first add.
 *
 * `inbound` and `outbound` are both POSITIVE magnitudes: the stored sign already
 * says which way a movement went, so `outbound` is reported as the size of the
 * negative rows rather than as a second negative. `net` keeps the sign and is
 * exactly `inbound - outbound`.
 */
interface StockFlow {
  inbound: Prisma.Decimal;
  outbound: Prisma.Decimal;
  net: Prisma.Decimal;
}

/** One low-stock candidate BEFORE formatting, so the sort compares exact decimals. */
interface LowStockCandidate {
  readonly catalogItemId: string;
  readonly name: string;
  readonly quantity: Prisma.Decimal;
  readonly threshold: Prisma.Decimal;
  readonly shortfall: Prisma.Decimal;
}

/**
 * One accumulating money/quantity row, at BOTH stored scales: quantities on the
 * ledger's `Decimal(10, 3)` and money on `Decimal(14, 2)`. Every member starts as
 * a `Decimal` zero, so no value in the aggregate is ever a JavaScript `number`.
 */
interface DecimalTotals {
  quantity: Prisma.Decimal;
  net: Prisma.Decimal;
  tax: Prisma.Decimal;
  gross: Prisma.Decimal;
}

function zeroTotals(): DecimalTotals {
  return {
    quantity: new Prisma.Decimal(0),
    net: new Prisma.Decimal(0),
    tax: new Prisma.Decimal(0),
    gross: new Prisma.Decimal(0),
  };
}

function zeroStockFlow(): StockFlow {
  return {
    inbound: new Prisma.Decimal(0),
    outbound: new Prisma.Decimal(0),
    net: new Prisma.Decimal(0),
  };
}

/** Exact decimal from a row's stored value — `Decimal` in, never a float. */
function toDecimal(value: Prisma.Decimal | string): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}

function toPeriodDto(period: ResolvedReportPeriod): ReportPeriodDto {
  return {
    preset: period.preset,
    fromDate: period.fromDate,
    toDate: period.toDate,
    timeZone: period.timeZone,
    fromInstant: period.fromInstant.toISOString(),
    toInstant: period.toInstant.toISOString(),
  };
}

function toRowDto(bucket: Bucket): SalesByPeriodRowDto {
  return {
    bucketDate: bucket.bucketDate,
    saleCount: bucket.saleCount,
    net: bucket.net.toFixed(2),
    tax: bucket.tax.toFixed(2),
    gross: bucket.gross.toFixed(2),
  };
}

/**
 * `amount / totalGross` at four decimals. A zero gross is answered with
 * `"0.0000"` rather than a division: the `payment.amount > 0` CHECK makes that
 * branch unreachable, and a NaN share would poison a JSON response rather than
 * fail.
 */
function shareOfGross(totalGross: Prisma.Decimal, amount: Prisma.Decimal): string {
  if (totalGross.isZero()) {
    return "0.0000";
  }
  return amount.div(totalGross).toFixed(4);
}

/** The get-or-create accessor every grouping pass uses, so no map is ever trusted to be pre-filled. */
function totalsFor(map: Map<string, DecimalTotals>, key: string): DecimalTotals {
  const existing = map.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created = zeroTotals();
  map.set(key, created);
  return created;
}

/** The same accessor for the per-item stock flow, so no map is pre-filled. */
function stockFlowFor(map: Map<string, StockFlow>, catalogItemId: string): StockFlow {
  const existing = map.get(catalogItemId);
  if (existing !== undefined) {
    return existing;
  }
  const created = zeroStockFlow();
  map.set(catalogItemId, created);
  return created;
}

/** Adds one sale line to a totals row, at each column's own stored scale. */
function addLine(totals: DecimalTotals, line: ReportSaleLineRow): void {
  totals.quantity = totals.quantity.plus(toDecimal(line.quantity));
  totals.net = totals.net.plus(toDecimal(line.taxableBase));
  totals.tax = totals.tax.plus(toDecimal(line.taxAmount));
  totals.gross = totals.gross.plus(toDecimal(line.lineTotal));
}

function kindTotalDto(totals: DecimalTotals): KindTotalDto {
  return {
    net: totals.net.toFixed(2),
    tax: totals.tax.toFixed(2),
    gross: totals.gross.toFixed(2),
    quantity: totals.quantity.toFixed(3),
  };
}

/**
 * The signed amount a movement contributes to the drawer ([[DEC-030]]):
 *
 *   signed = amount * cashMovementSign(type, direction)
 *
 * The stored `amount` is ALWAYS POSITIVE — the kind owns the sign — so this is
 * the ONE place the reporting module resolves it, and it resolves it with the
 * SAME map the close command validated on write. A second copy of the map here
 * would be two chances for the report and the drawer to disagree about what a
 * `REFUND` does, which is precisely what [[DEC-030]] exists to prevent.
 *
 * Both branches are `Prisma.Decimal` arithmetic: `negated()` is exact, whereas
 * multiplying by a JavaScript `-1` would route the money through a float.
 */
function signedCashMovementAmount(
  type: CashMovementTypeValue,
  direction: CashMovementDirectionValue | null,
  amount: Prisma.Decimal
): Prisma.Decimal {
  return cashMovementSign(type, direction) === 1 ? amount : amount.negated();
}

/**
 * Reporting application boundary (EPIC-18 REP-002).
 *
 * - The permission is RE-ASSERTED here behind the route decorator, before any
 *   data access (the `NotificationDeliveryService` precedent). There is NO
 *   entitlement check: [[DEC-062]] rejected a feature-code gate for reports, so
 *   `reports.read`/`reports.export` are the whole guard.
 * - The period comes from {@link resolveReportPeriod} and nowhere else, so the
 *   boundary rule has one home. "Now" is INJECTED so a suite can pin the instant
 *   the presets resolve against; production defaults to the real clock.
 * - Money is summed with `Prisma.Decimal` and emitted as fixed-scale strings. No
 *   monetary value is ever a JavaScript `number`: `0.1 + 0.2` in floats is a
 *   business defect, not a rounding curiosity.
 * - Buckets are the TENANT's days: a sale completed at 23:30 local belongs to
 *   that local day, using the same conversion helper the period boundaries use —
 *   one implementation, so the bucket and the range cannot disagree.
 * - The tenant comes from the request context inside the repository. It is never
 *   an argument, so a report cannot be pointed at another tenant.
 */
@Injectable()
export class ReportingService {
  constructor(
    private readonly reports: ReportRepository,
    private readonly settings: TenantSettingsService,
    private readonly permissionResolver: PermissionResolver,
    // Injectable clock: the repository owns no clock abstraction, and a report's
    // presets are relative to "now", so a suite that cannot pin the instant can
    // only assert approximate dates. `@Optional()` keeps Nest from treating the
    // reflected `Function` type as a mandatory injection token; the unit suite
    // passes the clock explicitly.
    @Optional() private readonly now: () => Date = () => new Date()
  ) {}

  /**
   * Sales by period (PRD §31): completed sales only, bucketed by local day,
   * summed per bucket and across the period.
   *
   * An EMPTY period is not an error: it returns `rows: []`, `saleCount: 0` and
   * `"0.00"` totals with the resolved period echoed, because "no sales in this
   * period" is an answer and a caller must be able to tell it apart from "this
   * period was rejected".
   */
  async salesByPeriod(query: ReportPeriodQuery): Promise<SalesByPeriodResponse> {
    await this.requireReadPermission();

    const period = resolveReportPeriod(query, this.now());
    const currency = await this.resolveCurrency();
    const rows = await this.reports.listCompletedSales(period.fromInstant, period.toInstant);

    const buckets = new Map<string, Bucket>();
    const totals = {
      net: new Prisma.Decimal(0),
      tax: new Prisma.Decimal(0),
      gross: new Prisma.Decimal(0),
    };
    let saleCount = 0;

    for (const sale of rows) {
      const bucket = this.addSale(buckets, sale, period.timeZone);
      if (bucket === null) {
        continue;
      }
      saleCount += 1;
      bucket.saleCount += 1;
      for (const line of sale.lines) {
        const net = toDecimal(line.taxableBase);
        const tax = toDecimal(line.taxAmount);
        const gross = toDecimal(line.lineTotal);
        bucket.net = bucket.net.plus(net);
        bucket.tax = bucket.tax.plus(tax);
        bucket.gross = bucket.gross.plus(gross);
        totals.net = totals.net.plus(net);
        totals.tax = totals.tax.plus(tax);
        totals.gross = totals.gross.plus(gross);
      }
    }

    // Ascending by local day. The query is already chronological, but the row
    // order is part of the response contract, so it does not rely on that.
    const ordered = [...buckets.values()].sort((left, right) =>
      left.bucketDate.localeCompare(right.bucketDate)
    );

    return {
      report: "sales-by-period",
      period: toPeriodDto(period),
      currency,
      saleCount,
      totalNet: totals.net.toFixed(2),
      totalTax: totals.tax.toFixed(2),
      totalGross: totals.gross.toFixed(2),
      rows: ordered.map(toRowDto),
    };
  }

  /**
   * Payment methods (PRD §31): how the money arrived, one row per method that
   * actually has payments in the period.
   *
   * The rows are read through the SALE's `completedAt` predicate, because a
   * payment's own timestamp is written by the same completion transaction and is
   * not a second business fact. That is what makes this report and
   * `salesByPeriod` two views of ONE revenue: their totals must agree exactly,
   * and the suite asserts it rather than trusting it.
   *
   * Ordering is `amount` descending (the biggest tender first), then `method`
   * ascending so equal totals have one order rather than the map's.
   *
   * An EMPTY period is an answer: `rows: []` and `totalGross: "0.00"` with the
   * period echoed, never an error.
   */
  async paymentMethods(query: ReportPeriodQuery): Promise<PaymentMethodsResponse> {
    await this.requireReadPermission();

    const period = resolveReportPeriod(query, this.now());
    const currency = await this.resolveCurrency();
    const sales = await this.reports.listCompletedSalesWithPayments(
      period.fromInstant,
      period.toInstant
    );

    const tenders = new Map<string, TenderBucket>();
    let totalGross = new Prisma.Decimal(0);

    for (const sale of sales) {
      for (const payment of sale.payments) {
        const amount = toDecimal(payment.amount);
        const bucket = tenders.get(payment.method) ?? {
          paymentCount: 0,
          amount: new Prisma.Decimal(0),
        };
        bucket.paymentCount += 1;
        bucket.amount = bucket.amount.plus(amount);
        tenders.set(payment.method, bucket);
        totalGross = totalGross.plus(amount);
      }
    }

    // The row order is part of the response contract, so it is applied HERE and
    // never inherited from the map's insertion order.
    const ordered = [...tenders.entries()].sort((left, right) => {
      const byAmount = right[1].amount.comparedTo(left[1].amount);
      if (byAmount !== 0) {
        return byAmount;
      }
      return left[0].localeCompare(right[0]);
    });

    const rows: PaymentMethodRowDto[] = ordered.map(([method, bucket]) => ({
      method,
      paymentCount: bucket.paymentCount,
      amount: bucket.amount.toFixed(2),
      shareOfGross: shareOfGross(totalGross, bucket.amount),
    }));

    return {
      report: "payment-methods",
      period: toPeriodDto(period),
      currency,
      totalGross: totalGross.toFixed(2),
      rows,
    };
  }

  /**
   * Sales by product/service (PRD §31): which catalog items earned the money, and
   * the roll-up per `kind`.
   *
   * Lines are grouped by their frozen `catalog_item_id`; the identity, name and
   * kind are then resolved in ONE tenant-predicated catalog read (no N+1). A
   * referenced item the catalog read does not return is a LOUD `INTERNAL`, never
   * a silent drop: the foreign key makes it unreachable, which is why it is an
   * assertion about the data layer rather than a user-facing 400.
   *
   * Ordering is `gross` descending, then `name` ascending. A kind with no line in
   * the period is ABSENT from `totalsByKind`, never a zero row.
   */
  async salesByProductService(query: ReportPeriodQuery): Promise<SalesByProductServiceResponse> {
    await this.requireReadPermission();

    const period = resolveReportPeriod(query, this.now());
    const currency = await this.resolveCurrency();
    const sales = await this.reports.listCompletedSales(period.fromInstant, period.toInstant);

    const byItem = new Map<string, DecimalTotals>();
    for (const sale of sales) {
      for (const line of sale.lines) {
        addLine(totalsFor(byItem, line.catalogItemId), line);
      }
    }

    // An empty period asks the catalog for nothing: `listCatalogItemsByIds`
    // short-circuits an empty id set, so no round trip answers known-nothing.
    const items = await this.reports.listCatalogItemsByIds([...byItem.keys()]);
    const catalog = new Map(items.map((item) => [item.id, item]));

    const byKind = new Map<string, DecimalTotals>();
    const grouped: {
      catalogItemId: string;
      name: string;
      kind: string;
      totals: DecimalTotals;
    }[] = [];

    for (const [catalogItemId, totals] of byItem) {
      const item = catalog.get(catalogItemId);
      if (item === undefined) {
        throw new DomainError("INTERNAL", reportCatalogItemMissingMessage(catalogItemId));
      }
      grouped.push({ catalogItemId, name: item.name, kind: item.kind, totals });
      const kindTotals = totalsFor(byKind, item.kind);
      kindTotals.quantity = kindTotals.quantity.plus(totals.quantity);
      kindTotals.net = kindTotals.net.plus(totals.net);
      kindTotals.tax = kindTotals.tax.plus(totals.tax);
      kindTotals.gross = kindTotals.gross.plus(totals.gross);
    }

    // Sorted BEFORE formatting so the comparison is on exact decimals, never on
    // the rendered strings. Ties keep the query's order, which is deterministic.
    grouped.sort((left, right) => {
      const byGross = right.totals.gross.comparedTo(left.totals.gross);
      if (byGross !== 0) {
        return byGross;
      }
      return left.name.localeCompare(right.name);
    });

    const rows: SalesByProductServiceRowDto[] = grouped.map((row) => ({
      catalogItemId: row.catalogItemId,
      name: row.name,
      kind: row.kind,
      quantity: row.totals.quantity.toFixed(3),
      net: row.totals.net.toFixed(2),
      tax: row.totals.tax.toFixed(2),
      gross: row.totals.gross.toFixed(2),
    }));

    const totalsByKind: Record<string, KindTotalDto> = {};
    for (const [kind, totals] of byKind) {
      totalsByKind[kind] = kindTotalDto(totals);
    }

    return {
      report: "sales-by-product-service",
      period: toPeriodDto(period),
      currency,
      totalsByKind,
      rows,
    };
  }

  /**
   * Cash sessions by period (PRD §31, [[REP-004]]): the sessions that CLOSED in
   * the period, with their opening, expected, counted and difference amounts.
   *
   * The rows are the stored close result — the report never recomputes a drawer.
   * What it DOES do is assert the domain invariant on every row it returns:
   * `countedAmount - expectedAmount` must equal the stored `differenceAmount`, or
   * the row refuses with a loud `INTERNAL` naming the session. The stored
   * difference is authoritative and the report must not silently publish a row
   * whose three amounts disagree, because a reader cannot tell such a row from a
   * correct one.
   *
   * There is no `currency` in the response: a drawer amount is the tenant's own
   * cash and the Cash domain carries no currency column (`Cash.md`), so a code
   * here would be invented rather than resolved.
   *
   * An EMPTY period is an answer: `rows: []`, every total `"0.00"`, period
   * echoed.
   */
  async cashSessions(query: ReportPeriodQuery): Promise<CashSessionsResponse> {
    await this.requireReadPermission();

    const period = resolveReportPeriod(query, this.now());
    const sessions = await this.reports.listClosedCashSessions(
      period.fromInstant,
      period.toInstant
    );

    const totals = {
      expected: new Prisma.Decimal(0),
      counted: new Prisma.Decimal(0),
      difference: new Prisma.Decimal(0),
    };
    const rows: CashSessionRowDto[] = [];

    for (const session of sessions) {
      const amounts = this.assertCloseResult(session);
      rows.push({
        sessionId: session.id,
        registerId: session.registerId,
        openedAt: session.openedAt.toISOString(),
        closedAt: session.closedAt.toISOString(),
        openingAmount: toDecimal(session.openingAmount).toFixed(2),
        expectedAmount: amounts.expected.toFixed(2),
        countedAmount: amounts.counted.toFixed(2),
        differenceAmount: amounts.difference.toFixed(2),
      });
      totals.expected = totals.expected.plus(amounts.expected);
      totals.counted = totals.counted.plus(amounts.counted);
      totals.difference = totals.difference.plus(amounts.difference);
    }

    return {
      report: "cash-sessions",
      period: toPeriodDto(period),
      rows,
      totals: {
        expected: totals.expected.toFixed(2),
        counted: totals.counted.toFixed(2),
        difference: totals.difference.toFixed(2),
      },
    };
  }

  /**
   * Cash movements by period (PRD §31, [[REP-004]]): the period's movements rolled
   * up by `(type, direction)`, with the sign convention of [[DEC-030]] resolved,
   * plus the period's net.
   *
   * The stored `amount` is ALWAYS POSITIVE and the kind owns the sign, so a report
   * that summed `amount` would be wrong by construction. Each row's
   * `signedAmount` is `amount * cashMovementSign(type, direction)` in
   * `Prisma.Decimal`, and `net` is the sum of EVERY signed amount in the period —
   * accumulated as the movements are read, not derived from the rows, so the two
   * are computed independently and a rounding bug cannot agree with itself.
   *
   * `direction` is non-null exactly for `ADJUSTMENT`; every other kind carries
   * `null` because its kind, not a direction, owns its sign.
   *
   * Order is `type` ascending, then `direction` ascending with `null` first.
   * An EMPTY period is `rows: []` with `net: "0.00"`.
   */
  async cashMovements(query: ReportPeriodQuery): Promise<CashMovementsResponse> {
    await this.requireReadPermission();

    const period = resolveReportPeriod(query, this.now());
    const movements = await this.reports.listCashMovements(period.fromInstant, period.toInstant);

    const buckets = new Map<string, MovementBucket>();
    let net = new Prisma.Decimal(0);

    for (const movement of movements) {
      const key = `${movement.type}\u0000${movement.direction ?? ""}`;
      let bucket = buckets.get(key);
      if (bucket === undefined) {
        bucket = {
          type: movement.type,
          direction: movement.direction,
          movementCount: 0,
          signedAmount: new Prisma.Decimal(0),
        };
        buckets.set(key, bucket);
      }
      const signed = signedCashMovementAmount(
        movement.type,
        movement.direction,
        toDecimal(movement.amount)
      );
      bucket.movementCount += 1;
      bucket.signedAmount = bucket.signedAmount.plus(signed);
      net = net.plus(signed);
    }

    // The row order is part of the response contract, so it is applied HERE from
    // an explicit total order and never inherited from the map's insertion order.
    const ordered = [...buckets.values()].sort((left, right) => {
      const byType =
        CASH_MOVEMENT_TYPE_ORDER.indexOf(left.type) - CASH_MOVEMENT_TYPE_ORDER.indexOf(right.type);
      if (byType !== 0) {
        return byType;
      }
      return (
        CASH_MOVEMENT_DIRECTION_ORDER.indexOf(left.direction) -
        CASH_MOVEMENT_DIRECTION_ORDER.indexOf(right.direction)
      );
    });

    const rows: CashMovementRowDto[] = ordered.map((bucket) => ({
      type: bucket.type,
      direction: bucket.direction,
      movementCount: bucket.movementCount,
      signedAmount: bucket.signedAmount.toFixed(2),
    }));

    return {
      report: "cash-movements",
      period: toPeriodDto(period),
      net: net.toFixed(2),
      rows,
    };
  }

  /**
   * Purchases by period (PRD §31, [[REP-004]]): the purchases RECEIVED in the
   * period, with their line count, total quantity and supplier.
   *
   * The period predicate is `receivedAt` and the status predicate is `RECEIVED`: a
   * `DRAFT` was never received and a `CANCELLED` one was never stock.
   *
   * There is NO money column and no total. `PurchaseLine.unitCost` is optional and
   * informational ([[DEC-013]]) and the purchase aggregate owns no total and no
   * payment state (`Purchases.md`), so a "purchase total" would report a number
   * the domain deliberately does not have. What the domain DOES own is the line
   * quantity at the ledger's `Decimal(10, 3)` scale, and that is what is summed.
   *
   * Suppliers are resolved in ONE batched read; a name the read does not return is
   * a loud `INTERNAL` naming the id, never a dropped receipt (the
   * `reportCatalogItemMissingMessage` discipline).
   */
  async purchases(query: ReportPeriodQuery): Promise<PurchasesResponse> {
    await this.requireReadPermission();

    const period = resolveReportPeriod(query, this.now());
    const received = await this.reports.listReceivedPurchases(period.fromInstant, period.toInstant);

    // An EMPTY period asks the supplier read for nothing: the id set is empty, so
    // `listSuppliersByIds` short-circuits and no round trip answers known-nothing.
    const supplierIds = [...new Set(received.map((purchase) => purchase.supplierId))];
    const suppliers = await this.reports.listSuppliersByIds(supplierIds);
    const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));

    const rows: PurchaseRowDto[] = received.map((purchase) => {
      const supplier = supplierById.get(purchase.supplierId);
      if (supplier === undefined) {
        throw new DomainError("INTERNAL", reportSupplierMissingMessage(purchase.supplierId));
      }
      let totalQuantity = new Prisma.Decimal(0);
      for (const line of purchase.lines) {
        totalQuantity = totalQuantity.plus(toDecimal(line.quantity));
      }
      return {
        purchaseId: purchase.id,
        supplierId: purchase.supplierId,
        supplierName: supplier.name,
        receivedAt: purchase.receivedAt.toISOString(),
        lineCount: purchase.lines.length,
        totalQuantity: totalQuantity.toFixed(3),
      };
    });

    return {
      report: "purchases",
      period: toPeriodDto(period),
      rows,
    };
  }

  /**
   * Stock on hand and the period's flow (PRD §31, [[REP-005]]): one row per
   * tracked item that HAS a balance row.
   *
   * **Two different facts, and the report never lets them merge.** `quantity` is
   * read from `stock_balance` — a transactional PROJECTION with one row per
   * `(tenant, item)` and no history — so it is the CURRENT BALANCE and no period
   * can narrow it. `inbound`/`outbound`/`net` are summed from the immutable
   * `stock_movement` LEDGER inside the resolved period, so they are the PERIOD'S
   * FLOW. An item stocked last year and sold last week has a positive `quantity`
   * and a negative `net` for last week; conflating the two labels would make one
   * of those numbers a lie.
   *
   * The ledger's `quantity` is ALREADY SIGNED, so `inbound` sums the positives,
   * `outbound` sums the absolute values of the negatives (a POSITIVE magnitude)
   * and `net` sums every row with its sign. All three are `Prisma.Decimal` from
   * the first add and are emitted at the column's own scale of three decimals.
   *
   * An item with a balance and no movement in the period is NORMAL and reports
   * `"0.000"` flows. An item with a movement and NO balance row is not: the
   * projection is written in the same transaction as its movements, so it is an
   * anomalous data state and refuses with `INTERNAL` naming the item rather than
   * dropping the flow.
   */
  async stock(query: ReportPeriodQuery): Promise<StockReportResponse> {
    await this.requireReadPermission();

    const period = resolveReportPeriod(query, this.now());
    // The SNAPSHOT: the projection, read whole. A balance row has no date, so it
    // is never bounded by the period — that is the point of the two reads.
    const balances = await this.reports.listStockBalances();
    // The FLOW: the ledger, bounded to the period.
    const movements = await this.reports.listStockMovements(period.fromInstant, period.toInstant);

    const flows = new Map<string, StockFlow>();
    for (const movement of movements) {
      const quantity = toDecimal(movement.quantity);
      const flow = stockFlowFor(flows, movement.catalogItemId);
      if (quantity.isNegative()) {
        // ABSOLUTE value: the stored sign says the direction, so the report
        // renders the size and does not print a second minus beside `inbound`.
        flow.outbound = flow.outbound.plus(quantity.abs());
      } else if (quantity.isPositive()) {
        flow.inbound = flow.inbound.plus(quantity);
      }
      flow.net = flow.net.plus(quantity);
    }

    const balanceByItem = new Map(
      balances.map((balance) => [balance.catalogItemId, balance] as const)
    );

    // A movement whose item has no projection is anomalous (EPIC-10 writes both
    // in one transaction under the `(tenant, item)` advisory lock), so it is
    // refused by id instead of being dropped from the flow.
    for (const catalogItemId of flows.keys()) {
      if (!balanceByItem.has(catalogItemId)) {
        throw new DomainError("INTERNAL", reportStockMovementBalanceMissingMessage(catalogItemId));
      }
    }

    // ONE batched catalog read over the UNION of both id sets, skipped entirely
    // when there is neither a balance nor a movement to identify (no N+1).
    const catalog = await this.readCatalog(new Set([...balanceByItem.keys(), ...flows.keys()]));

    const rows: StockReportRowDto[] = [];
    for (const [catalogItemId, balance] of balanceByItem) {
      const item = catalog.get(catalogItemId);
      if (item === undefined) {
        throw new DomainError("INTERNAL", reportStockCatalogItemMissingMessage(catalogItemId));
      }
      // `tracksStock = false` is a SERVICE or an explicitly untracked item: it is
      // not inventory, so it appears in neither inventory report.
      if (!item.tracksStock) {
        continue;
      }
      const flow = flows.get(catalogItemId) ?? zeroStockFlow();
      rows.push({
        catalogItemId,
        name: item.name,
        kind: item.kind,
        // The SNAPSHOT, padded to the column's three decimals.
        quantity: toDecimal(balance.quantity).toFixed(3),
        inbound: flow.inbound.toFixed(3),
        outbound: flow.outbound.toFixed(3),
        net: flow.net.toFixed(3),
      });
    }

    // The row order is part of the response contract, so it is applied HERE.
    rows.sort((left, right) => {
      const byName = left.name.localeCompare(right.name);
      return byName !== 0 ? byName : left.catalogItemId.localeCompare(right.catalogItemId);
    });

    return {
      report: "stock",
      period: toPeriodDto(period),
      rows,
    };
  }

  /**
   * Items at or below their own low-stock threshold (PRD §31, [[REP-005]]).
   *
   * This is a CURRENT-STATE view and therefore takes NO period: it compares the
   * projection's quantity with the item's own threshold, and neither has a date.
   * The route refuses every query key for the same reason.
   *
   * An item is MONITORED only when somebody set a threshold on it ([[DEC-065]]):
   * `lowStockThreshold === null` means "not monitored" and the item NEVER appears,
   * not even at quantity zero. No default is invented — a tenant default is
   * exactly what that decision rejected — so the report starts empty and a tenant
   * opts in item by item.
   *
   * The comparison is `quantity <= threshold`, exact `Decimal` arithmetic, so an
   * item sitting EXACTLY on its threshold is low (it has nothing to spare) and one
   * a thousandth above it is not. `shortfall = threshold - quantity` is therefore
   * never negative for a returned row.
   *
   * `thresholdsConfigured` separates the two empty answers: `false` with no rows
   * means nobody has set a threshold yet, `true` with no rows means thresholds
   * exist and every item is above its own. Both are an empty array, and a UI that
   * could not tell them apart would report a working inventory setup as a
   * misconfiguration.
   */
  async lowStock(): Promise<LowStockReportResponse> {
    await this.requireReadPermission();

    const balances = await this.reports.listStockBalances();
    // ONE batched catalog read for the balanced items; an empty inventory asks the
    // catalog for nothing at all.
    const catalog = await this.readCatalog(
      new Set(balances.map((balance) => balance.catalogItemId))
    );

    // Asked SEPARATELY, not derived from the loop below: a tenant that sets a
    // threshold on an item which has never moved has no balance row, so that item
    // is invisible to the balanced catalog read and the loop would report
    // "nobody configured anything" to the one tenant who did.
    const thresholdsConfigured = await this.reports.hasAnyLowStockThreshold();
    const candidates: LowStockCandidate[] = [];

    for (const balance of balances) {
      const item = catalog.get(balance.catalogItemId);
      if (item === undefined) {
        throw new DomainError(
          "INTERNAL",
          reportStockCatalogItemMissingMessage(balance.catalogItemId)
        );
      }
      // Not inventory at all: never low, never listed.
      if (!item.tracksStock) {
        continue;
      }
      // NULL is NOT a zero threshold: it means nobody monitors this item
      // ([[DEC-065]]), so it is skipped BEFORE any comparison.
      if (item.lowStockThreshold === null) {
        continue;
      }
      const quantity = toDecimal(balance.quantity);
      const threshold = toDecimal(item.lowStockThreshold);
      // `<=`, not `<`: AT the threshold is already low. Above it is not.
      if (quantity.greaterThan(threshold)) {
        continue;
      }
      candidates.push({
        catalogItemId: balance.catalogItemId,
        name: item.name,
        quantity,
        threshold,
        shortfall: threshold.minus(quantity),
      });
    }

    // Sorted BEFORE formatting so the comparison is on exact decimals, never on
    // the rendered strings. The tie-break is `name`; two rows equal on both keep
    // the balance read's `catalogItemId` order, which `sort` preserves.
    candidates.sort((left, right) => {
      const byShortfall = right.shortfall.comparedTo(left.shortfall);
      return byShortfall !== 0 ? byShortfall : left.name.localeCompare(right.name);
    });

    const rows: LowStockReportRowDto[] = candidates.map((candidate) => ({
      catalogItemId: candidate.catalogItemId,
      name: candidate.name,
      quantity: candidate.quantity.toFixed(3),
      threshold: candidate.threshold.toFixed(3),
      shortfall: candidate.shortfall.toFixed(3),
    }));

    return {
      report: "low-stock",
      thresholdsConfigured,
      rows,
    };
  }

  /**
   * Asserts the stored close result of one session agrees with itself and returns
   * the three amounts as `Decimal`s.
   *
   * `counted - expected === difference` is the domain invariant the close command
   * establishes ([[DEC-031]]); the report re-checks it rather than trusting it,
   * because the stored `differenceAmount` is authoritative and a row where the
   * three disagree is a row no reader could detect. Exact arithmetic, no epsilon:
   * these are `Decimal(14, 2)` values, so equality is equality.
   */
  private assertCloseResult(session: ReportCashSessionRow): {
    expected: Prisma.Decimal;
    counted: Prisma.Decimal;
    difference: Prisma.Decimal;
  } {
    const expected = toDecimal(session.expectedAmount);
    const counted = toDecimal(session.countedAmount);
    const difference = toDecimal(session.differenceAmount);
    if (!counted.minus(expected).equals(difference)) {
      throw new DomainError("INTERNAL", reportCashSessionDifferenceMismatchMessage(session.id));
    }
    return { expected, counted, difference };
  }

  /**
   * The tenant's catalog items for the given ids as a lookup map, resolved in ONE
   * batched, tenant-predicated read (no N+1).
   *
   * An EMPTY id set asks the repository for nothing: `listCatalogItemsByIds`
   * short-circuits it, because `in: []` is a question whose answer is already
   * known.
   */
  private async readCatalog(ids: ReadonlySet<string>): Promise<Map<string, ReportCatalogItemRow>> {
    const items = await this.reports.listCatalogItemsByIds([...ids]);
    return new Map(items.map((item) => [item.id, item]));
  }

  /**
   * Opens (or returns) the LOCAL day bucket a sale belongs to.
   *
   * The bucket date is the calendar date of `completedAt` in the period's own
   * zone, computed by the same helper that resolved the range. A sale whose
   * `completedAt` is null cannot reach here — the query filters on that column —
   * so the null branch is a defensive skip rather than an invented day.
   */
  private addSale(
    buckets: Map<string, Bucket>,
    sale: ReportSaleRow,
    timeZone: string
  ): Bucket | null {
    if (sale.completedAt === null) {
      return null;
    }
    const bucketDate = tenantCalendarDate(sale.completedAt, timeZone);
    const existing = buckets.get(bucketDate);
    if (existing !== undefined) {
      return existing;
    }
    const created: Bucket = {
      bucketDate,
      saleCount: 0,
      net: new Prisma.Decimal(0),
      tax: new Prisma.Decimal(0),
      gross: new Prisma.Decimal(0),
    };
    buckets.set(bucketDate, created);
    return created;
  }

  /** Defense in depth behind `@RequirePermissions`: a denial reaches no query. */
  private async requireReadPermission(): Promise<void> {
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(REPORTING_PERMISSIONS.read)) {
      throw new DomainError("FORBIDDEN", REPORT_READ_FORBIDDEN_MESSAGE);
    }
  }

  /**
   * The server-resolved sale currency: the `sales.defaultCurrency` tenant setting
   * read through the typed settings service, exactly as `SalesService` resolves
   * it ([[DEC-022]]). Never a literal, and never a request parameter — a report
   * that hardcoded `PYG` would silently mislabel every other tenant.
   */
  private async resolveCurrency(): Promise<string> {
    const settings = await this.settings.get("sales");
    const currency = settings.defaultCurrency;
    if (typeof currency !== "string") {
      throw new DomainError("VALIDATION_FAILED", REPORT_CURRENCY_UNRESOLVED_MESSAGE);
    }
    return currency;
  }
}
