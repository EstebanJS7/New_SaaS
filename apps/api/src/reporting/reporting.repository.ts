import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@newsaas/database";
// Value import (not `import type`): `PrismaService` is the DI token.
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import type { CashMovementDirectionValue, CashMovementTypeValue } from "../cash/cash.repository.js";
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

/**
 * Persistence row for one CLOSED cash session as the cash report reads it
 * ([[REP-004]]). The close result columns are nullable because the `cash_session`
 * columns are: `CLOSED` is terminal and the close command writes `closedAt` and
 * the three amounts in the SAME statement ([[DEC-031]], [[DEC-036]],
 * [[DEC-064]]), so a null on a closed row is unreachable — and asserted in
 * {@link ReportRepository.listClosedCashSessions} rather than papered over with a
 * zero.
 */
export interface ReportCashSessionReadRow {
  readonly id: string;
  readonly registerId: string;
  readonly openedAt: Date;
  readonly closedAt: Date | null;
  readonly openingAmount: Prisma.Decimal | string;
  readonly expectedAmount: Prisma.Decimal | string | null;
  readonly countedAmount: Prisma.Decimal | string | null;
  readonly differenceAmount: Prisma.Decimal | string | null;
}

/** A closed cash session whose close result and close instant are present. */
export interface ReportCashSessionRow {
  readonly id: string;
  readonly registerId: string;
  readonly openedAt: Date;
  readonly closedAt: Date;
  readonly openingAmount: Prisma.Decimal | string;
  readonly expectedAmount: Prisma.Decimal | string;
  readonly countedAmount: Prisma.Decimal | string;
  readonly differenceAmount: Prisma.Decimal | string;
}

/**
 * Persistence row for one immutable cash movement as the cash report reads it
 * ([[REP-004]]): the kind, the `ADJUSTMENT`-only direction and the exact positive
 * `Decimal(14, 2)` amount. The sign is owned by the kind ([[DEC-030]]) and is
 * resolved by the service through `cashMovementSign`, never here.
 */
export interface ReportCashMovementRow {
  readonly type: CashMovementTypeValue;
  readonly direction: CashMovementDirectionValue | null;
  readonly amount: Prisma.Decimal | string;
}

/** The single purchase-line column the receive report sums: the `Decimal(10, 3)` quantity. */
export interface ReportPurchaseLineRow {
  readonly quantity: Prisma.Decimal | string;
}

/**
 * Persistence row for one received purchase with its line set. `receivedAt` is
 * typed nullable because the column is: the receive command writes it in the
 * same transition that sets `RECEIVED` ([[DEC-064]]), so it is asserted in
 * {@link ReportRepository.listReceivedPurchases}. There is deliberately no money
 * field — the aggregate owns no total (`Purchases.md`).
 */
export interface ReportPurchaseReadRow {
  readonly id: string;
  readonly supplierId: string;
  readonly receivedAt: Date | null;
  readonly lines: readonly ReportPurchaseLineRow[];
}

/** A received purchase whose business instant is present. */
export interface ReportPurchaseRow {
  readonly id: string;
  readonly supplierId: string;
  readonly receivedAt: Date;
  readonly lines: readonly ReportPurchaseLineRow[];
}

/** The supplier identity the receive report resolves in one batched read. */
export interface ReportSupplierRow {
  readonly id: string;
  readonly name: string;
}

/**
 * The cash and purchase reads of [[REP-004]], in the same shape as the sale and
 * catalog delegates above: Prisma's own arg types, a promise of narrow rows, reads
 * only. Each one is a single `findMany` so the predicate and the order live in ONE
 * place — the repository method that owns the report's contract.
 */
export interface ReportingCashSessionDelegate {
  findMany(args: Prisma.CashSessionFindManyArgs): Promise<ReportCashSessionReadRow[]>;
}

export interface ReportingCashMovementDelegate {
  findMany(args: Prisma.CashMovementFindManyArgs): Promise<ReportCashMovementRow[]>;
}

export interface ReportingPurchaseDelegate {
  findMany(args: Prisma.PurchaseFindManyArgs): Promise<ReportPurchaseReadRow[]>;
}

export interface ReportingSupplierDelegate {
  findMany(args: Prisma.SupplierFindManyArgs): Promise<ReportSupplierRow[]>;
}

export interface ReportingReadPrisma {
  readonly sale: ReportingSaleDelegate;
  readonly catalogItem: ReportingCatalogItemDelegate;
  readonly cashSession: ReportingCashSessionDelegate;
  readonly cashMovement: ReportingCashMovementDelegate;
  readonly purchase: ReportingPurchaseDelegate;
  readonly supplier: ReportingSupplierDelegate;
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
 * Hard cap on the number of CLOSED cash sessions the close report may read, and
 * on the number of received purchases the receive report may read.
 *
 * The same discipline as {@link REPORT_SALE_ROW_LIMIT}, chosen per read: a drawer
 * closes once a day per register, and a tenant receives a handful of purchases a
 * day, so five thousand rows is far past any real period for either. The caps
 * differ from the movement cap because a movement ledger is the dense one — a
 * busy register records many movements per session.
 */
export const REPORT_CASH_SESSION_ROW_LIMIT = 5_000;

/** Hard cap on the number of cash MOVEMENT rows the movement report may read. */
export const REPORT_CASH_MOVEMENT_ROW_LIMIT = 20_000;

/** Hard cap on the number of received PURCHASE rows the receive report may read. */
export const REPORT_PURCHASE_ROW_LIMIT = 5_000;

/** Stable message when a period needs more closed sessions than the cap allows. */
export const REPORT_CASH_SESSION_ROW_LIMIT_EXCEEDED_MESSAGE = `The report period contains more than ${REPORT_CASH_SESSION_ROW_LIMIT} closed cash sessions. Narrow the period and try again.`;

/** Stable message when a period needs more movements than the cap allows. */
export const REPORT_CASH_MOVEMENT_ROW_LIMIT_EXCEEDED_MESSAGE = `The report period contains more than ${REPORT_CASH_MOVEMENT_ROW_LIMIT} cash movements. Narrow the period and try again.`;

/** Stable message when a period needs more received purchases than the cap allows. */
export const REPORT_PURCHASE_ROW_LIMIT_EXCEEDED_MESSAGE = `The report period contains more than ${REPORT_PURCHASE_ROW_LIMIT} received purchases. Narrow the period and try again.`;

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
 * Stable message when a `CLOSED` session read carries no close result.
 *
 * `CLOSED` is terminal and the close command writes `closedAt` and the three
 * amounts in ONE statement ([[DEC-031]], [[DEC-036]], [[DEC-064]]), so this is
 * UNREACHABLE. It is asserted rather than assumed because the alternative —
 * treating a missing amount as `0.00` — would report a drawer that closed short
 * by everything it ever held, and look exactly like a correct row.
 */
export function reportCashSessionCloseResultMissingMessage(sessionId: string): string {
  return `The report read a closed cash session without its close result: ${sessionId}`;
}

/**
 * Stable message when a `RECEIVED` purchase read carries no receive instant. The
 * receive command writes `received_at` in the same transition that sets
 * `RECEIVED` ([[DEC-064]]), so this is UNREACHABLE; it is asserted for the same
 * reason as {@link reportCashSessionCloseResultMissingMessage} — a purchase
 * silently dropped from a received report is a receipt nobody can see.
 */
export function reportPurchaseReceivedInstantMissingMessage(purchaseId: string): string {
  return `The report read a received purchase without its receive instant: ${purchaseId}`;
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

  /**
   * The caller tenant's CLOSED cash sessions whose `closedAt` falls in the
   * HALF-OPEN range `[fromInstant, toInstant)`.
   *
   * `closedAt` is the period predicate, never `openedAt` and never `createdAt`: a
   * session opened yesterday and closed today is today's close, and a session
   * opened today and closed next week belongs to next week's report. `OPEN` is
   * excluded by the status predicate — an open drawer has no close amounts and no
   * close instant, so including it would report NULLs as zeros.
   *
   * The close result is asserted present here rather than defaulted, because a
   * silent `0.00` would be indistinguishable from a drawer that really closed
   * empty (`reportCashSessionCloseResultMissingMessage`).
   */
  async listClosedCashSessions(
    fromInstant: Date,
    toInstant: Date
  ): Promise<ReportCashSessionRow[]> {
    const tenantId = this.requestContext.requireTenantId();
    const rows = await this.prisma.cashSession.findMany({
      where: {
        tenantId,
        status: "CLOSED",
        closedAt: { gte: fromInstant, lt: toInstant },
      },
      orderBy: [{ closedAt: "asc" }, { id: "asc" }],
      take: REPORT_CASH_SESSION_ROW_LIMIT + 1,
    });

    if (rows.length > REPORT_CASH_SESSION_ROW_LIMIT) {
      throw new DomainError("VALIDATION_FAILED", REPORT_CASH_SESSION_ROW_LIMIT_EXCEEDED_MESSAGE);
    }
    return rows.map((row) => requireCloseResult(row));
  }

  /**
   * The caller tenant's cash movements whose own `createdAt` falls in the
   * HALF-OPEN range `[fromInstant, toInstant)`.
   *
   * `cash_movement` is append-only with no `updated_at`, so its creation instant
   * IS the movement's business instant. The SESSION a movement belongs to is a
   * different fact and never dates it: a movement recorded at 23:59 belongs to
   * that day even if its drawer closes the next morning.
   */
  async listCashMovements(fromInstant: Date, toInstant: Date): Promise<ReportCashMovementRow[]> {
    const tenantId = this.requestContext.requireTenantId();
    const rows = await this.prisma.cashMovement.findMany({
      where: { tenantId, createdAt: { gte: fromInstant, lt: toInstant } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: REPORT_CASH_MOVEMENT_ROW_LIMIT + 1,
    });

    if (rows.length > REPORT_CASH_MOVEMENT_ROW_LIMIT) {
      throw new DomainError("VALIDATION_FAILED", REPORT_CASH_MOVEMENT_ROW_LIMIT_EXCEEDED_MESSAGE);
    }
    return rows;
  }

  /**
   * The caller tenant's RECEIVED purchases whose `receivedAt` falls in the
   * HALF-OPEN range `[fromInstant, toInstant)`, with their lines.
   *
   * `status: "RECEIVED"` is part of the predicate, not a later filter: a `DRAFT`
   * was never received and a `CANCELLED` one was never stock. `receivedAt` is the
   * business instant of the receive transition ([[DEC-064]]), so `createdAt` is
   * never a substitute for it.
   */
  async listReceivedPurchases(fromInstant: Date, toInstant: Date): Promise<ReportPurchaseRow[]> {
    const tenantId = this.requestContext.requireTenantId();
    const rows = await this.prisma.purchase.findMany({
      where: {
        tenantId,
        status: "RECEIVED",
        receivedAt: { gte: fromInstant, lt: toInstant },
      },
      include: { lines: true },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
      take: REPORT_PURCHASE_ROW_LIMIT + 1,
    });

    if (rows.length > REPORT_PURCHASE_ROW_LIMIT) {
      throw new DomainError("VALIDATION_FAILED", REPORT_PURCHASE_ROW_LIMIT_EXCEEDED_MESSAGE);
    }
    return rows.map((row) => requireReceivedInstant(row));
  }

  /**
   * The caller tenant's suppliers for the given ids, in ONE batched read (no
   * N+1) and with the tenant predicate applied HERE, so an id from another tenant
   * resolves to nothing rather than to that tenant's supplier.
   *
   * An EMPTY id set skips the query entirely, exactly as
   * {@link listCatalogItemsByIds} does: `in: []` is a question with a known
   * answer.
   */
  async listSuppliersByIds(ids: readonly string[]): Promise<ReportSupplierRow[]> {
    if (ids.length === 0) {
      return [];
    }
    const tenantId = this.requestContext.requireTenantId();
    return this.prisma.supplier.findMany({
      where: { tenantId, id: { in: [...ids] } },
    });
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

/**
 * Asserts the close result of a `CLOSED` session is present, and narrows the row
 * to the non-null shape the report consumes. A missing column on a closed row
 * cannot happen (`CLOSED` is terminal and the close command writes all four
 * columns together), so it fails loudly instead of being read as `"0.00"`.
 */
function requireCloseResult(row: ReportCashSessionReadRow): ReportCashSessionRow {
  const { closedAt, expectedAmount, countedAmount, differenceAmount } = row;
  if (
    closedAt === null ||
    expectedAmount === null ||
    countedAmount === null ||
    differenceAmount === null
  ) {
    throw new DomainError("INTERNAL", reportCashSessionCloseResultMissingMessage(row.id));
  }
  return {
    id: row.id,
    registerId: row.registerId,
    openedAt: row.openedAt,
    closedAt,
    openingAmount: row.openingAmount,
    expectedAmount,
    countedAmount,
    differenceAmount,
  };
}

/**
 * Asserts the receive instant of a `RECEIVED` purchase is present, and narrows
 * the row to the non-null shape the report consumes.
 */
function requireReceivedInstant(row: ReportPurchaseReadRow): ReportPurchaseRow {
  if (row.receivedAt === null) {
    throw new DomainError("INTERNAL", reportPurchaseReceivedInstantMissingMessage(row.id));
  }
  return {
    id: row.id,
    supplierId: row.supplierId,
    receivedAt: row.receivedAt,
    lines: row.lines,
  };
}
