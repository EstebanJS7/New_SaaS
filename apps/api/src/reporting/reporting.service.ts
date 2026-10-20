import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { TenantSettingsService } from "../settings/tenant-settings.service.js";
import type {
  KindTotalDto,
  PaymentMethodRowDto,
  PaymentMethodsResponse,
  ReportPeriodDto,
  ReportPeriodQuery,
  SalesByPeriodResponse,
  SalesByPeriodRowDto,
  SalesByProductServiceResponse,
  SalesByProductServiceRowDto,
} from "./reporting.dto.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";
import {
  resolveReportPeriod,
  tenantCalendarDate,
  type ResolvedReportPeriod,
} from "./report.period.js";
import {
  ReportRepository,
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
