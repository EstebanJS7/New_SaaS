import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@newsaas/database";
// Value import (not `import type`): `PrismaService` is the DI token.
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";

/**
 * Persistence row for one COMPLETED sale line as the reporting boundary reads it
 * (the same projection `SaleRepository` uses). The three money amounts are exact
 * `Decimal(14, 2)` and `quantity` is the ledger's `Decimal(10, 3)` — `Prisma.Decimal`
 * against PostgreSQL, a plain exact string in the in-memory boundary — and are
 * NEVER coerced to a JavaScript float here or anywhere downstream.
 */
export interface ReportSaleLineRow {
  readonly catalogItemId: string;
  readonly quantity: Prisma.Decimal | string;
  readonly lineTotal: Prisma.Decimal | string;
  readonly taxableBase: Prisma.Decimal | string;
  readonly taxAmount: Prisma.Decimal | string;
}

/**
 * Persistence row for one payment of a COMPLETED sale, as the payment-method
 * report reads it: the PRD §19 `method` and the exact `Decimal(14, 2)` amount.
 * There is deliberately no tender, change or refund column — none exists.
 */
export interface ReportSalePaymentRow {
  readonly method: string;
  readonly amount: Prisma.Decimal | string;
}

/** The header projection every completed-sale report reads. No customer, patient or clinical reference. */
export interface ReportSaleHeaderRow {
  readonly id: string;
  readonly currency: string;
  /**
   * The business instant of the `DRAFT` → `COMPLETED` transition ([[DEC-064]]).
   * Typed nullable because the column is: a `COMPLETED` row always carries one
   * (the completion transaction writes both together) and the mapper skips any
   * row that somehow does not, rather than inventing a day for it.
   */
  readonly completedAt: Date | null;
}

/**
 * The row the shared completed-sale read returns: the header plus WHICHEVER
 * relation the query asked to `include`. Both relations are optional because
 * Prisma returns only what the query named — a `payments` read genuinely carries
 * no `lines` — and each public repository method narrows the one it requested.
 */
export interface ReportSaleReadRow extends ReportSaleHeaderRow {
  readonly lines?: readonly ReportSaleLineRow[];
  readonly payments?: readonly ReportSalePaymentRow[];
}

/** A completed sale WITH its line set (`listCompletedSales`). */
export interface ReportSaleRow extends ReportSaleHeaderRow {
  readonly lines: readonly ReportSaleLineRow[];
}

/** A completed sale WITH its payment set (`listCompletedSalesWithPayments`). */
export interface ReportSaleWithPaymentsRow extends ReportSaleHeaderRow {
  readonly payments: readonly ReportSalePaymentRow[];
}

/**
 * The catalog projection the by-product report needs: identity, display name and
 * the `kind` that is a FACT about the item (never re-derived from `tracksStock`).
 */
export interface ReportCatalogItemRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
}

/**
 * The narrow read contracts this repository needs, declared with Prisma's OWN arg
 * types so the real client fits by construction and a unit suite can pass a stub
 * (the `NotificationDeliveryReadPrisma` precedent). They carry reads only: a
 * report reads and never writes, and there is no aggregate/groupBy seam here
 * because the aggregation is TypeScript `Decimal` arithmetic over these rows.
 */
export interface ReportingSaleDelegate {
  findMany(args: Prisma.SaleFindManyArgs): Promise<ReportSaleReadRow[]>;
}

export interface ReportingCatalogItemDelegate {
  findMany(args: Prisma.CatalogItemFindManyArgs): Promise<ReportCatalogItemRow[]>;
}

export interface ReportingReadPrisma {
  readonly sale: ReportingSaleDelegate;
  readonly catalogItem: ReportingCatalogItemDelegate;
}

/**
 * Hard cap on the number of sale rows ONE report may read.
 *
 * A report aggregates in TypeScript, so an unbounded read is a memory liability
 * and — worse — a silently truncated aggregate would look exactly like a correct
 * one. The cap makes the failure honest: a period that would need more rows
 * REFUSES with a stable message instead of returning a partial total. Twenty
 * thousand completed sales is far past any single veterinary tenant's period, so
 * the bound never refuses a real question; it refuses a pathological one, and
 * [[TD-053]] owns the eventual pushdown that would make the cap unnecessary.
 */
export const REPORT_SALE_ROW_LIMIT = 20_000;

/** Stable message when a period needs more rows than the cap allows. */
export const REPORT_ROW_LIMIT_EXCEEDED_MESSAGE = `The report period contains more than ${REPORT_SALE_ROW_LIMIT} completed sales. Narrow the period and try again.`;

/**
 * Stable message when a required relation is absent from a completed-sale read.
 * The call site always names its `include`, so this is unreachable; it is
 * asserted rather than assumed for the same reason the missing-catalog-item
 * refusal is: a report that silently treated an unloaded relation as empty would
 * print a confidently wrong zero.
 */
export function reportRelationNotLoadedMessage(relation: string): string {
  return `The report sale read did not load the ${relation} relation.`;
}

/**
 * Tenant-safe read access for the reporting module (EPIC-18 REP-002).
 *
 * Contract: the tenant predicate is IMPLICIT via
 * `requestContext.requireTenantId()` — it is never a parameter and never a query
 * string, so a caller cannot widen the report to another tenant. When no tenant
 * authority was resolved server-side, `requireTenantId()` throws FORBIDDEN before
 * any database call happens.
 *
 * The query filter is the Story's domain invariant: a report counts revenue only
 * from rows that are `COMPLETED` **and** carry a `completedAt` inside the range.
 * `createdAt` is never a substitute — a draft created last month and completed
 * today is today's revenue, and a draft is never revenue at all.
 */
@Injectable()
export class ReportRepository {
  constructor(
    // Explicit @Inject token keeps DI resolution token-based while the PARAM
    // type stays the narrow read contract this boundary actually needs.
    @Inject(PrismaService) private readonly prisma: ReportingReadPrisma,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService
  ) {}

  /**
   * The caller tenant's completed sales whose business instant falls in the
   * HALF-OPEN range `[fromInstant, toInstant)`, with their lines and in
   * deterministic chronological order.
   *
   * `take` asks for one row past the cap: the extra row is how the call proves
   * the period is over the limit without loading a second one. Nothing is
   * truncated — an over-limit period throws before any caller sees a row.
   */
  async listCompletedSales(fromInstant: Date, toInstant: Date): Promise<ReportSaleRow[]> {
    const rows = await this.readCompletedSales(fromInstant, toInstant, { lines: true });
    return rows.map((row) => ({
      id: row.id,
      currency: row.currency,
      completedAt: row.completedAt,
      lines: requireLoaded(row.lines, "lines"),
    }));
  }

  /**
   * The SAME completed sales, with their payments instead of their lines.
   *
   * The predicate is the sale's `completedAt` and never `Payment.createdAt`: a
   * payment row is written only by the `CompleteSale` transaction ([[DEC-029]]),
   * so its own timestamp is an implementation detail of that same commit. Cutting
   * the payment report on the payment's timestamp would let it disagree with
   * `sales-by-period` about one revenue — which is exactly the invariant
   * [[REP-003]] asserts instead of assuming.
   *
   * `lines` is deliberately NOT included: this report never reads a line, and an
   * unread relation on a bounded read is pure memory.
   */
  async listCompletedSalesWithPayments(
    fromInstant: Date,
    toInstant: Date
  ): Promise<ReportSaleWithPaymentsRow[]> {
    const rows = await this.readCompletedSales(fromInstant, toInstant, { payments: true });
    return rows.map((row) => ({
      id: row.id,
      currency: row.currency,
      completedAt: row.completedAt,
      payments: requireLoaded(row.payments, "payments"),
    }));
  }

  /**
   * The caller tenant's catalog items for the given ids, in one predicated read
   * (no N+1). The tenant predicate is applied HERE, so an id from another tenant
   * resolves to nothing rather than to that tenant's item.
   *
   * An EMPTY id set skips the query entirely: `in: []` is a question with a
   * known answer and a round trip that cannot return a row.
   */
  async listCatalogItemsByIds(ids: readonly string[]): Promise<ReportCatalogItemRow[]> {
    if (ids.length === 0) {
      return [];
    }
    const tenantId = this.requestContext.requireTenantId();
    return this.prisma.catalogItem.findMany({
      where: { tenantId, id: { in: [...ids] } },
    });
  }

  /**
   * The ONE completed-sale query both reports run. Factored so the predicate, the
   * deterministic order and the row cap cannot drift apart between them: two
   * hand-written copies of this filter would be two chances to disagree about
   * which sale is revenue.
   */
  private async readCompletedSales(
    fromInstant: Date,
    toInstant: Date,
    include: { lines: true } | { payments: true }
  ): Promise<ReportSaleReadRow[]> {
    const tenantId = this.requestContext.requireTenantId();
    const rows = await this.prisma.sale.findMany({
      where: {
        tenantId,
        status: "COMPLETED",
        completedAt: { gte: fromInstant, lt: toInstant },
      },
      include,
      orderBy: [{ completedAt: "asc" }, { id: "asc" }],
      take: REPORT_SALE_ROW_LIMIT + 1,
    });

    if (rows.length > REPORT_SALE_ROW_LIMIT) {
      throw new DomainError("VALIDATION_FAILED", REPORT_ROW_LIMIT_EXCEEDED_MESSAGE);
    }
    return rows;
  }
}

/**
 * The requested relation of an included read. A missing one is a programming
 * defect, so it fails loudly instead of aggregating an empty set: `[]` would be
 * indistinguishable from "no rows" in the response.
 */
function requireLoaded<T>(value: T | undefined, relation: string): T {
  if (value === undefined) {
    throw new DomainError("INTERNAL", reportRelationNotLoadedMessage(relation));
  }
  return value;
}
