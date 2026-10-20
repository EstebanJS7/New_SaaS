import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@newsaas/database";
// Value import (not `import type`): `PrismaService` is the DI token.
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";

/**
 * Persistence row for one COMPLETED sale line as the reporting boundary reads it
 * (the same projection `SaleRepository` uses). The three money amounts are exact
 * `Decimal(14, 2)` — `Prisma.Decimal` against PostgreSQL, a plain exact string in
 * the in-memory boundary — and are NEVER coerced to a JavaScript float here or
 * anywhere downstream.
 */
export interface ReportSaleLineRow {
  readonly lineTotal: Prisma.Decimal | string;
  readonly taxableBase: Prisma.Decimal | string;
  readonly taxAmount: Prisma.Decimal | string;
}

/**
 * Persistence row for one COMPLETED sale with its line set. Only the fields a
 * report actually aggregates are named: there is deliberately no customer,
 * patient or clinical reference on this boundary, because the report reads money
 * and instants and nothing else.
 */
export interface ReportSaleRow {
  readonly id: string;
  readonly currency: string;
  /**
   * The business instant of the `DRAFT` → `COMPLETED` transition ([[DEC-064]]).
   * Typed nullable because the column is: a `COMPLETED` row always carries one
   * (the completion transaction writes both together) and the mapper skips any
   * row that somehow does not, rather than inventing a day for it.
   */
  readonly completedAt: Date | null;
  readonly lines: readonly ReportSaleLineRow[];
}

/**
 * The narrow read contract this repository needs, declared with Prisma's OWN arg
 * type so the real client fits by construction and a unit suite can pass a stub
 * (the `NotificationDeliveryReadPrisma` precedent). It carries ONE method: a
 * report reads and never writes, and there is no aggregate/groupBy seam here
 * because the aggregation is TypeScript `Decimal` arithmetic over these rows.
 */
export interface ReportingSaleDelegate {
  findMany(args: Prisma.SaleFindManyArgs): Promise<ReportSaleRow[]>;
}

export interface ReportingReadPrisma {
  readonly sale: ReportingSaleDelegate;
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
    const tenantId = this.requestContext.requireTenantId();
    const rows = await this.prisma.sale.findMany({
      where: {
        tenantId,
        status: "COMPLETED",
        completedAt: { gte: fromInstant, lt: toInstant },
      },
      include: { lines: true },
      orderBy: [{ completedAt: "asc" }, { id: "asc" }],
      take: REPORT_SALE_ROW_LIMIT + 1,
    });

    if (rows.length > REPORT_SALE_ROW_LIMIT) {
      throw new DomainError("VALIDATION_FAILED", REPORT_ROW_LIMIT_EXCEEDED_MESSAGE);
    }
    return rows;
  }
}
