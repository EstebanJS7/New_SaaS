import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { TenantSettingsService } from "../settings/tenant-settings.service.js";
import type {
  ReportPeriodDto,
  ReportPeriodQuery,
  SalesByPeriodResponse,
  SalesByPeriodRowDto,
} from "./reporting.dto.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";
import {
  resolveReportPeriod,
  tenantCalendarDate,
  type ResolvedReportPeriod,
} from "./report.period.js";
import { ReportRepository, type ReportSaleRow } from "./reporting.repository.js";

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

/** One accumulating calendar-day bucket. Money is `Decimal` from the first add. */
interface Bucket {
  readonly bucketDate: string;
  saleCount: number;
  net: Prisma.Decimal;
  tax: Prisma.Decimal;
  gross: Prisma.Decimal;
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
