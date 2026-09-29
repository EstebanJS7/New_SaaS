import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
// Value imports (not `import type`): `PrismaService` is the DI token and
// `Prisma` provides the exact `Decimal` used to render the fixed-scale
// projections.
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
import { CatalogRepository } from "../catalog/catalog.repository.js";
import { CashRepository, type CashSessionRow, type CashTx } from "../cash/cash.repository.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import {
  InventoryRepository,
  type InventoryClient,
  type StockItemRow,
} from "../inventory/inventory.repository.js";
import {
  INSUFFICIENT_STOCK_MESSAGE,
  STOCK_ITEM_INACTIVE_MESSAGE,
} from "../inventory/inventory.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { TenantSettingsService } from "../settings/tenant-settings.service.js";
import type {
  CompletedSaleResponse,
  SaleLineResponse,
  SalePaymentResponse,
  SaleResponse,
} from "./sales.dto.js";
import { SALES_PERMISSIONS, type SalesPermission } from "./sales.permissions.js";
import {
  SALE_UNSUPPORTED_CURRENCY_MESSAGE,
  computeLineAmounts,
  resolveMinorUnit,
  sumLineTotals,
} from "./sales.pricing.js";
import {
  SALE_CUSTOMER_NOT_FOUND_MESSAGE,
  SaleRepository,
  type PaymentRow,
  type PaymentWriteData,
  type SaleLineRow,
  type SaleLineSnapshotData,
  type SaleLineWriteData,
  type SaleListFilters,
  type SaleRow,
  type SaleTx,
} from "./sales.repository.js";
import {
  SALES_DTO_SCHEMA_VERSION,
  type CompleteSaleInput,
  type CreateSaleInput,
  type UpdateSaleInput,
} from "./sales.zod.js";

/**
 * Everything the audited sale mutation closure needs from its transaction
 * handle. Declared structurally (not as `Prisma.TransactionClient`) so the real
 * client and the shared in-memory boundary both satisfy it: the sale, line,
 * customer, catalog-item and tax-rate delegates reach the tenant-safe repository
 * seam and the locally-provided {@link CatalogRepository}, and `auditLog` the
 * append-only {@link AuditWriter}, so the sale change and its audit row commit
 * atomically.
 */
export type SalesWriteTx = SaleTx &
  InventoryClient &
  CashTx & { auditLog: AuditAppendTx["auditLog"] };

export interface SalesPrisma {
  $transaction: <T>(work: (tx: SalesWriteTx) => Promise<T>) => Promise<T>;
}

/**
 * Audit action codes for the three sale mutations. The repository's established
 * shape is `<singular_entity_snake>.<past_verb>`, so the sale entity is spelled
 * `sale` and `targetType` matches it. Reads are never audited.
 */
export const SALE_CREATED_ACTION = "sale.created";
export const SALE_UPDATED_ACTION = "sale.updated";
export const SALE_CANCELLED_ACTION = "sale.cancelled";
export const SALE_COMPLETED_ACTION = "sale.completed";
export const SALE_TARGET_TYPE = "sale";

/**
 * Stable idempotency operation token persisted in `idempotency_record.operation`
 * (DEC-024, 2026-09-29 resolution note). One token per command; a later epic can
 * add records for its own operations without changing this one.
 */
export const SALE_COMPLETE_OPERATION = "sale.complete";

/**
 * Stable reason recorded on every `SALE` ledger movement of a completion. The
 * ledger column is `TEXT NOT NULL` and the command takes no caller reason, so
 * this constant is the value; it is self-describing and carries no identifier
 * and no quantity — the co-committed audit row identifies the sale and the
 * immutable movement carries the signed amount.
 */
export const SALE_COMPLETION_MOVEMENT_REASON = "Sale completed";

/**
 * Audit field NAMES for a completion. `changedFields` carries NAMES only: the
 * status flips, the line snapshot is frozen and the payment rows are written,
 * but no stored value — no payment method, no amount and no line figure — is
 * copied into the trail (PRD §27/§41). The stock and cash movements are their
 * own immutable records and are not named here.
 */
const SALE_COMPLETE_CHANGED_FIELDS: readonly string[] = ["status", "lines", "payments"];

/**
 * Stable `403 FEATURE_NOT_ENTITLED` message for a tenant without the `sales`
 * capability (DEC-026). The entitlement is asserted BEFORE the granular
 * permission, over the whole surface including reads, exactly as the clinical
 * and patients modules do.
 */
export const SALES_FEATURE_NOT_ENTITLED_MESSAGE = "Sales features are not enabled for this tenant.";

/**
 * Stable `409 CONFLICT` message for an edit or cancel against a sale whose
 * status is not `DRAFT` (DEC-023). A `COMPLETED` sale is a confirmed financial
 * fact corrected only by a future reversal command; a `CANCELLED` one is
 * terminal. Both are well-formed requests against an existing in-tenant resource
 * whose OWN state forbids the command, so this is `409 CONFLICT` — never a `400`
 * and never a `404`, which would wrongly mask a real sale.
 */
export const SALE_NOT_EDITABLE_MESSAGE = "Only a draft sale can be changed.";

/**
 * Stable `400 VALIDATION_FAILED` message for a completion whose payment set does
 * not sum EXACTLY to the recomputed sale total (DEC-029). There is no partial
 * payment state, no change and no credit, so a set that over- or under-shoots
 * the total is rejected before any write.
 */
export const SALE_PAYMENT_TOTAL_MISMATCH_MESSAGE =
  "The payments must sum exactly to the sale total.";

/**
 * Stable `409 CONFLICT` message for a sale whose optional customer reference is
 * INACTIVE at completion time (resolution 1 of 2026-09-29). An unknown or
 * foreign customer is the shared customer `404`; an in-tenant but deactivated
 * one is this stable `409`, mirroring the receiving-time item gate.
 */
export const SALE_CUSTOMER_INACTIVE_MESSAGE = "The sale customer is inactive.";

/**
 * Stable `409 CONFLICT` message for a completion whose idempotency key was
 * already used for a DIFFERENT request fingerprint (DEC-024). The key is
 * tenant-scoped; the same key with the same fingerprint is a replay instead.
 */
export const SALE_IDEMPOTENCY_KEY_CONFLICT_MESSAGE =
  "The idempotency key was already used for a different request.";

/**
 * Stable `400 VALIDATION_FAILED` message for a line that supplies neither an
 * override nor a usable catalog reference price (DEC-022): the reference price
 * is a suggestion, but a line must still record the price actually charged.
 */
export const SALE_UNIT_PRICE_REQUIRED_MESSAGE = "A sale line requires a unit price.";

/**
 * Stable `400 VALIDATION_FAILED` message for an item whose informational
 * `referencePriceCurrency` differs from the sale currency. There is NO
 * conversion anywhere (DEC-022): the cross-currency item simply cannot join the
 * sale.
 */
export const SALE_CURRENCY_MISMATCH_MESSAGE =
  "The sale line item currency does not match the sale currency.";

/**
 * Stable `400 VALIDATION_FAILED` message for an item whose `taxRateId` does not
 * resolve to a seeded global rate row. The catalog reference makes this
 * unrepresentable in real PostgreSQL; the check keeps an in-memory or migrated
 * anomaly from persisting a snapshot with no frozen rate (DEC-021).
 */
export const SALE_TAX_RATE_NOT_FOUND_MESSAGE = "The sale line tax rate was not found.";

/**
 * Fixed scales of the line decimals, in digits after the point. Both are the
 * column scales (`Decimal(10, 3)` and `Decimal(14, 2)`), and the write contract
 * caps a submitted value at the same scale, so the projection can PAD but never
 * round. The sale total is money, so it uses the money scale.
 */
const SALE_QUANTITY_SCALE = 3;
const SALE_MONEY_SCALE = 2;

/**
 * Audit field NAMES for a sale create. `changedFields` carries NAMES only: the
 * customer reference, the currency and the line amounts are INTERNAL, but no
 * stored value is copied into the trail — ids and field names are all the row
 * carries. `currency` is included because the aggregate persists it; `lines` is
 * always present because the submitted line set is authoritative and required.
 */
const SALE_CREATE_CHANGED_FIELDS: readonly string[] = ["customerId", "currency", "lines"];

/**
 * Audit field-name order for a sale update (payload order, never value order).
 * `lines` is always present because the submitted line set is authoritative and
 * required; `customerId` only when the caller actually supplied it.
 */
const SALE_UPDATE_FIELD_ORDER = ["customerId", "lines"] as const;

/** Exact `Decimal` → fixed-scale string projection (never a JavaScript float). */
function decimalToScaleString(value: Prisma.Decimal | string, scale: number): string {
  return new Prisma.Decimal(value).toFixed(scale);
}

/** Maps one line row to its allowlisted INTERNAL projected line. */
function toSaleLineResponse(line: SaleLineRow): SaleLineResponse {
  return {
    id: line.id,
    catalogItemId: line.catalogItemId,
    rateCode: line.rateCode,
    unitPrice: decimalToScaleString(line.unitPrice, SALE_MONEY_SCALE),
    quantity: decimalToScaleString(line.quantity, SALE_QUANTITY_SCALE),
    lineTotal: decimalToScaleString(line.lineTotal, SALE_MONEY_SCALE),
    taxableBase: decimalToScaleString(line.taxableBase, SALE_MONEY_SCALE),
    taxAmount: decimalToScaleString(line.taxAmount, SALE_MONEY_SCALE),
  };
}

/** Maps one aggregate row to its allowlisted INTERNAL response DTO. */
function toSaleResponse(row: SaleRow): SaleResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    currency: row.currency,
    status: row.status,
    lines: row.lines.map(toSaleLineResponse),
    // There is no total column (DEC-021): the total is always derived from the
    // frozen line snapshots.
    total: sumLineTotals(row.lines, SALE_MONEY_SCALE).toFixed(SALE_MONEY_SCALE),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The field NAMES an update actually supplied, in field order. */
function updateChangedFields(input: UpdateSaleInput): string[] {
  return SALE_UPDATE_FIELD_ORDER.filter(
    (field) => field !== "customerId" || input.customerId !== undefined
  );
}

/** Maps one payment row to its allowlisted INTERNAL projected payment. */
function toSalePaymentResponse(row: PaymentRow): SalePaymentResponse {
  return {
    id: row.id,
    method: row.method,
    amount: decimalToScaleString(row.amount, SALE_MONEY_SCALE),
  };
}

/**
 * Maps a completed aggregate to its allowlisted INTERNAL response: the sale
 * projection plus its allowlisted payments and the replay discriminant. A fresh
 * completion and an identical replay carry exactly the same shape.
 */
function toCompletedSaleResponse(
  row: SaleRow,
  payments: readonly PaymentRow[],
  replay: boolean
): CompletedSaleResponse {
  return {
    ...toSaleResponse(row),
    payments: payments.map(toSalePaymentResponse),
    replay,
  };
}

/**
 * Canonical SHA-256 fingerprint of a completion request (DEC-024). It covers
 * the addressed sale id and the payment set, with the payments SORTED so the
 * client's order can never change the fingerprint, and every amount normalized
 * to the money column scale so `"10"` and `"10.00"` describe the same request.
 * The result is a 64-character lowercase hex string, the `VarChar(64)` shape
 * `idempotency_record.fingerprint` stores.
 */
export function saleCompletionFingerprint(
  saleId: string,
  payments: readonly { method: string; amount: string }[]
): string {
  const canonicalPayments = payments
    .map(
      (payment) =>
        `${payment.method}:${new Prisma.Decimal(payment.amount).toFixed(SALE_MONEY_SCALE)}`
    )
    .sort();
  const canonical = JSON.stringify({ saleId, payments: canonicalPayments });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Exact unique constraint behind completion idempotency:
 * `@@unique([tenantId, operation, key])` on `idempotency_record`, which maps to
 * the PostgreSQL index `idempotency_record_tenant_id_operation_key_key`.
 */
const IDEMPOTENCY_KEY_CONSTRAINT = "idempotency_record_tenant_id_operation_key_key";

/** The unique-key columns/fields, normalized once for shape-agnostic matching. */
const IDEMPOTENCY_KEY_FIELDS: readonly string[] = ["tenantid", "operation", "key"];

function normalizeUniqueTargetToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * True only for a `P2002` raised by the `(tenant_id, operation, key)` unique —
 * never for an unrelated `P2002` such as the tenant-ownership key, which must
 * propagate untouched. Prisma reports `meta.target` either as the violated
 * index name or as the violated column/field names; both shapes are recognized
 * (the cash-register-name matcher is the precedent).
 */
function isIdempotencyKeyConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") {
    return false;
  }
  const target = candidate.meta?.target;
  const expectedConstraint = normalizeUniqueTargetToken(IDEMPOTENCY_KEY_CONSTRAINT);
  if (typeof target === "string") {
    return normalizeUniqueTargetToken(target) === expectedConstraint;
  }
  if (!Array.isArray(target)) {
    return false;
  }
  const tokens = target.filter((entry): entry is string => typeof entry === "string");
  if (tokens.length === 0) {
    return false;
  }
  if (tokens.length === 1 && normalizeUniqueTargetToken(tokens[0]) === expectedConstraint) {
    return true;
  }
  const normalized = tokens.map(normalizeUniqueTargetToken);
  return (
    normalized.length === IDEMPOTENCY_KEY_FIELDS.length &&
    IDEMPOTENCY_KEY_FIELDS.every((field) => normalized.includes(field))
  );
}

/**
 * The DRAFT-only mutability gate (DEC-023). A `COMPLETED` sale is immutable — it
 * is the confirmed financial fact a future reversal corrects — and a
 * `CANCELLED` one is terminal; both reject an edit or a cancel with the same
 * stable `409 CONFLICT` and reach no write, so nothing is persisted.
 */
function assertDraft(row: SaleRow): void {
  if (row.status !== "DRAFT") {
    throw new DomainError("CONFLICT", SALE_NOT_EDITABLE_MESSAGE);
  }
}

/**
 * Sale application boundary (EPIC-12 POS-001/POS-003): the tenant-scoped read
 * surface, the three audited draft mutations (create, update, cancel) and the
 * explicit audited `complete` command.
 *
 * - The `sales` entitlement is asserted FIRST (`403 FEATURE_NOT_ENTITLED`) and
 *   the route-level permission is RE-ASSERTED SECOND (`403 FORBIDDEN`), on EVERY
 *   method including reads (DEC-026). A denial reaches no data access, so
 *   nothing is persisted and no audit row is appended.
 * - Tenant identity comes exclusively from `RequestContextService`; every write
 *   goes through the tenant-safe {@link SaleRepository}, so a foreign or unknown
 *   sale or customer reference is a byte-equivalent `404` through ONE shared
 *   message per resource.
 * - The sale currency is resolved server-side from the `sales.defaultCurrency`
 *   tenant setting (never from the body) and validated through
 *   {@link resolveMinorUnit}; an unsupported currency is a stable `400` instead
 *   of a silently wrong rounding (DEC-022, POS-001 slice resolution 1).
 * - The line snapshot is recomputed on EVERY draft write, because the operator
 *   must see line and sale totals while building the cart (POS-001 slice
 *   resolution 2); `CompleteSale` (POS-003) recomputes and freezes it and a
 *   `COMPLETED` sale is never recomputed.
 * - ONLY a `DRAFT` is mutable. `update` and `cancel` take the header row lock
 *   FIRST, then apply the post-lock `DRAFT` gate, then the conditional status
 *   write as a backstop — the order that closed the PUR-002 double-receive
 *   defect. `CANCELLED` is reachable only from `DRAFT` (DEC-023).
 * - `complete` is the sale's ONLY stock, cash and payment effect. It is one
 *   transaction under the header row lock that writes the signed negative
 *   `SALE` movements through the EPIC-10 ledger, the CASH `SALE` movements
 *   through the POS-002 cash seam, the frozen snapshot, the payment rows, the
 *   `DRAFT` → `COMPLETED` transition, the idempotency record and exactly ONE
 *   audit row — or persists nothing (DEC-020/024/029).
 * - Every mutation appends exactly ONE audit row through {@link AuditWriter},
 *   INSIDE the same transaction as the sale change, carrying stable ids and field
 *   NAMES only. Reads are never audited. No sale event is emitted.
 * - A draft create, update or cancel is INERT with respect to the rest of the
 *   system; the ONLY exception is the explicit `complete` command, which is the
 *   single write path for stock, cash and payments.
 * - There is NO delete operation anywhere on this boundary: a draft drops a line
 *   through the update command's line-set reconciliation, and a settled sale is
 *   immutable.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly sales: SaleRepository,
    private readonly catalog: CatalogRepository,
    private readonly inventory: InventoryRepository,
    private readonly cash: CashRepository,
    @Inject(PrismaService) private readonly prisma: SalesPrisma,
    private readonly settings: TenantSettingsService,
    private readonly entitlements: EntitlementsService,
    private readonly requestContext: RequestContextService,
    private readonly permissionResolver: PermissionResolver,
    private readonly audit: AuditWriter
  ) {}

  /**
   * The caller tenant's sales with their lines, newest first, optionally
   * narrowed by status. An omitted filter applies NO implicit default.
   */
  async listSales(filters: SaleListFilters = {}): Promise<SaleResponse[]> {
    await this.assertSalesEnabled();
    await this.requirePermission(SALES_PERMISSIONS.read);
    const rows = await this.sales.list(filters);
    return rows.map(toSaleResponse);
  }

  /** One sale of the caller tenant; a foreign UUID is the same `404` as absent. */
  async getSale(id: string): Promise<SaleResponse> {
    await this.assertSalesEnabled();
    await this.requirePermission(SALES_PERMISSIONS.read);
    const row = await this.sales.findById(id);
    return toSaleResponse(row);
  }

  /**
   * Creates one `DRAFT` sale with its lines in the caller's tenant and
   * co-commits its single audit row.
   *
   * The optional customer and every submitted catalog item are resolved
   * IN-TENANT inside the same transaction BEFORE any write, so an unknown or
   * foreign reference collapses to the shared `404` for its resource and the
   * rollback leaves no sale, no line and no audit row behind. The currency is
   * resolved server-side and the status is never caller-owned: a new sale is
   * `DRAFT` until the cancel command or `CompleteSale`.
   */
  async create(input: CreateSaleInput): Promise<SaleResponse> {
    await this.assertSalesEnabled();
    await this.requirePermission(SALES_PERMISSIONS.create);
    const actorUserProfileId = this.requestContext.requireUserProfileId();
    const { currency, minorUnit } = await this.resolveCurrency();

    const row = await this.prisma.$transaction(async (tx) => {
      if (input.customerId !== undefined && input.customerId !== null) {
        await this.sales.assertCustomerExists(input.customerId, tx);
      }
      const lines = await this.buildLineWrites(input.lines, currency, minorUnit, tx);

      const created = await this.sales.create(
        { customerId: input.customerId ?? null, currency, lines },
        tx
      );

      await this.audit.append(
        {
          action: SALE_CREATED_ACTION,
          tenantId: created.tenantId,
          actorUserProfileId,
          targetType: SALE_TARGET_TYPE,
          targetId: created.id,
          metadata: {
            schemaVersion: SALES_DTO_SCHEMA_VERSION,
            changedFields: [...SALE_CREATE_CHANGED_FIELDS],
          },
        },
        tx
      );

      return created;
    });

    return toSaleResponse(row);
  }

  /**
   * Updates one `DRAFT` sale of the caller's tenant and co-commits its single
   * audit row.
   *
   * SERIALIZATION ORDER: the sale HEADER row lock comes FIRST, then the
   * post-lock authoritative read and the `DRAFT`-only guard, then the submitted
   * customer and catalog-item references, then the line-set reconciliation. A
   * concurrent cancel of the same sale blocks on the header lock and is resolved
   * by the status the lock read sees, so a cancel can never interleave with a
   * line-set rewrite. Every rejection rolls the whole transaction back, so
   * nothing is persisted.
   *
   * The currency used to recompute the lines is the STORED sale currency, not
   * the current tenant setting: a sale records its currency once (DEC-022), so a
   * later `sales.defaultCurrency` change can never silently re-price an existing
   * draft.
   */
  async update(id: string, input: UpdateSaleInput): Promise<SaleResponse> {
    await this.assertSalesEnabled();
    await this.requirePermission(SALES_PERMISSIONS.update);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      await this.sales.lockById(id, tx);
      const current = await this.sales.findById(id, tx);
      assertDraft(current);

      const minorUnit = resolveMinorUnit(current.currency);

      if (input.customerId !== undefined && input.customerId !== null) {
        await this.sales.assertCustomerExists(input.customerId, tx);
      }
      const lines = await this.buildLineWrites(input.lines, current.currency, minorUnit, tx);

      if (input.customerId !== undefined) {
        await this.sales.updateCustomer(id, input.customerId, tx);
      }
      await this.sales.reconcileLines(id, lines, tx);

      const updated = await this.sales.findById(id, tx);

      await this.audit.append(
        {
          action: SALE_UPDATED_ACTION,
          tenantId: updated.tenantId,
          actorUserProfileId,
          targetType: SALE_TARGET_TYPE,
          targetId: updated.id,
          metadata: {
            schemaVersion: SALES_DTO_SCHEMA_VERSION,
            changedFields: updateChangedFields(input),
          },
        },
        tx
      );

      return updated;
    });

    return toSaleResponse(row);
  }

  /**
   * Cancels one `DRAFT` sale of the caller's tenant and co-commits its single
   * audit row.
   *
   * `CANCELLED` is reachable ONLY from `DRAFT` (DEC-023): a `COMPLETED` or
   * already-`CANCELLED` sale is the stable `409 CONFLICT` and nothing is
   * persisted. The header lock comes first and the conditional status write is
   * the backstop, so a concurrent cancel cannot apply twice. Cancellation is a
   * status transition, never a delete — the sale and its lines stay readable —
   * and it writes no stock, cash, invoice, payment or fiscal state and allocates
   * no number.
   */
  async cancel(id: string): Promise<SaleResponse> {
    await this.assertSalesEnabled();
    await this.requirePermission(SALES_PERMISSIONS.cancel);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      await this.sales.lockById(id, tx);
      const current = await this.sales.findById(id, tx);
      assertDraft(current);

      const applied = await this.sales.cancel(id, tx);
      if (!applied) {
        throw new DomainError("CONFLICT", SALE_NOT_EDITABLE_MESSAGE);
      }
      const cancelled = await this.sales.findById(id, tx);

      await this.audit.append(
        {
          action: SALE_CANCELLED_ACTION,
          tenantId: cancelled.tenantId,
          actorUserProfileId,
          targetType: SALE_TARGET_TYPE,
          targetId: cancelled.id,
          metadata: {
            schemaVersion: SALES_DTO_SCHEMA_VERSION,
            changedFields: ["status"],
          },
        },
        tx
      );

      return cancelled;
    });

    return toSaleResponse(row);
  }

  /**
   * Applies the ONE explicit `DRAFT` → `COMPLETED` transition of the sale
   * aggregate: the epic's central command and its only stock, cash and payment
   * writer (PRD §18, DEC-020/DEC-023/DEC-024/DEC-029).
   *
   * ORDER (DEC-014's receiving precedent applied to the sale): the `sales`
   * entitlement and the `sales.complete` permission are asserted FIRST, outside
   * the transaction, so a denial reaches no data access. Inside ONE
   * `$transaction` the command then:
   *
   * 1. row-locks the sale HEADER (`SELECT ... FOR UPDATE`);
   * 2. with an `Idempotency-Key`, reads the tenant-scoped record after the lock:
   *    the same key with the same fingerprint returns the stored prior sale as a
   *    REPLAY, a different fingerprint is a stable `409`;
   * 3. re-reads the sale and applies the post-lock `DRAFT` gate — any other
   *    status that is not an identical replay is the stable `409`;
   * 4. recomputes the line snapshot from the frozen inputs (`unitPrice`,
   *    `quantity`, `rateCode` against the global rate) and derives the total;
   * 5. validates the payment set sums EXACTLY to the total before any write;
   * 6. gates reference state in-tenant (each item active; the optional customer
   *    active) — the item currency is NOT re-validated (the line was priced);
   * 7. resolves the tenant's SINGLE `OPEN` cash session server-side when a CASH
   *    payment is present;
   * 8. writes one signed negative `SALE` movement and the absolute projection
   *    per tracking line, under the per-`(tenant, item)` advisory lock in
   *    ASCENDING `catalogItemId` order, with the fixed `BLOCK` policy;
   * 9. writes one `SALE` cash movement per CASH payment against that session;
   * 10. freezes the recomputed snapshot onto the lines;
   * 11. writes the payment rows;
   * 12. applies the conditional `WHERE status = 'DRAFT'` write as the backstop;
   * 13. appends the idempotency record when a key was supplied;
   * 14. appends exactly ONE audit row;
   * 15. re-reads the sale with its lines and payments and returns the DTO.
   *
   * Any rejection rolls the whole transaction back, so nothing is persisted — no
   * movement, no balance change, no cash effect, no payment row, no status
   * change and no audit row. A fresh completion returns `201`; a replay returns
   * `200` with the same body shape (see the controller).
   */
  async complete(
    id: string,
    input: CompleteSaleInput,
    idempotencyKey?: string
  ): Promise<{ sale: CompletedSaleResponse; replay: boolean }> {
    await this.assertSalesEnabled();
    await this.requirePermission(SALES_PERMISSIONS.complete);
    const actorUserProfileId = this.requestContext.requireUserProfileId();
    const fingerprint = saleCompletionFingerprint(id, input.payments);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // PRIMARY serialization: row-lock the sale HEADER before anything else,
        // so two concurrent completions of the SAME sale serialize here and the
        // loser's post-lock read sees the winner's committed status.
        await this.sales.lockById(id, tx);

        // Idempotency lookup AFTER the lock (DEC-024, 2026-09-29 resolution
        // note): an identical replay short-circuits to the prior result; a
        // same-key/different-fingerprint request is a stable conflict.
        if (idempotencyKey !== undefined) {
          const record = await this.sales.findIdempotencyRecord(
            SALE_COMPLETE_OPERATION,
            idempotencyKey,
            tx
          );
          if (record) {
            if (record.fingerprint !== fingerprint) {
              throw new DomainError("CONFLICT", SALE_IDEMPOTENCY_KEY_CONFLICT_MESSAGE);
            }
            const prior = await this.sales.findById(record.resultSaleId, tx);
            const priorPayments = await this.sales.listPayments(record.resultSaleId, tx);
            return { sale: toCompletedSaleResponse(prior, priorPayments, true), replay: true };
          }
        }

        // POST-LOCK authoritative read and DRAFT gate. An unknown or foreign id
        // resolves here as the shared `404`; any non-`DRAFT` sale is the stable
        // `409` and persists nothing.
        const locked = await this.sales.findById(id, tx);
        assertDraft(locked);
        const minorUnit = resolveMinorUnit(locked.currency);

        // Stable ascending order over the line items: the lock order DEC-014
        // fixes, and the order every pass below follows.
        const orderedLines = [...locked.lines].sort((left, right) =>
          left.catalogItemId.localeCompare(right.catalogItemId)
        );

        // STEP 4 — recompute the snapshot in memory from each line's frozen
        // inputs. `rateCode` resolves against the GLOBAL rate row (shared
        // reference data, no tenant predicate); there is no catalog re-read.
        const recomputed: { line: SaleLineRow; snapshot: SaleLineSnapshotData }[] = [];
        for (const line of orderedLines) {
          const rate = await this.sales.findTaxRateByCode(line.rateCode, tx);
          if (rate === null) {
            throw new DomainError("VALIDATION_FAILED", SALE_TAX_RATE_NOT_FOUND_MESSAGE);
          }
          const amounts = computeLineAmounts({
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            ratePercent: rate.rate,
            minorUnit,
          });
          recomputed.push({
            line,
            snapshot: {
              lineTotal: amounts.lineTotal.toFixed(SALE_MONEY_SCALE),
              taxableBase: amounts.taxableBase.toFixed(SALE_MONEY_SCALE),
              taxAmount: amounts.taxAmount.toFixed(SALE_MONEY_SCALE),
            },
          });
        }
        const total = sumLineTotals(
          recomputed.map((entry) => entry.snapshot),
          SALE_MONEY_SCALE
        );

        // STEP 5 — normalize and validate the payment set before ANY write. The
        // amounts are exact `Decimal`s; no float arithmetic is involved.
        const payments: PaymentWriteData[] = input.payments.map((payment) => ({
          method: payment.method,
          amount: new Prisma.Decimal(payment.amount).toFixed(SALE_MONEY_SCALE),
        }));
        const paymentSum = payments.reduce(
          (sum, payment) => sum.plus(new Prisma.Decimal(payment.amount)),
          new Prisma.Decimal(0)
        );
        if (!paymentSum.equals(total)) {
          throw new DomainError("VALIDATION_FAILED", SALE_PAYMENT_TOTAL_MISMATCH_MESSAGE);
        }

        // STEP 6 — reference-state gates. Each line's item must resolve
        // in-tenant (shared `404`) and be ACTIVE (`409`); the item's currency is
        // deliberately NOT re-validated because the line was already priced
        // (resolution 1 of 2026-09-29). The optional customer must be in-tenant
        // (`404`) and active (`409`).
        const items = new Map<string, StockItemRow>();
        for (const entry of recomputed) {
          const item = await this.inventory.findItem(entry.line.catalogItemId, tx);
          if (!item.isActive) {
            throw new DomainError("CONFLICT", STOCK_ITEM_INACTIVE_MESSAGE);
          }
          items.set(entry.line.catalogItemId, item);
        }
        if (locked.customerId !== null) {
          const customer = await this.sales.findCustomerReference(locked.customerId, tx);
          if (customer === null) {
            throw new DomainError("NOT_FOUND", SALE_CUSTOMER_NOT_FOUND_MESSAGE);
          }
          if (!customer.isActive) {
            throw new DomainError("CONFLICT", SALE_CUSTOMER_INACTIVE_MESSAGE);
          }
        }

        // STEP 7 — resolve the tenant's single OPEN session server-side, only
        // when a CASH payment is present. Zero sessions and more than one are
        // both stable `409`s with distinct messages; never read from the body.
        const hasCashPayment = payments.some((payment) => payment.method === "CASH");
        let cashSession: CashSessionRow | undefined;
        if (hasCashPayment) {
          cashSession = await this.cash.resolveSingleOpenSession(tx);
        }

        // STEP 8 — stock writes, per line, in the already-ascending order. The
        // advisory lock is acquired BEFORE the projection is read, the fixed
        // `BLOCK` policy rejects an output that would drive it negative and the
        // balance is written as the ABSOLUTE projection. A non-tracking item
        // writes no movement and gets no stock validation.
        for (const entry of recomputed) {
          const item = items.get(entry.line.catalogItemId);
          if (!item?.tracksStock) {
            continue;
          }
          await this.inventory.lockItemStock(entry.line.catalogItemId, tx);

          const balance = await this.inventory.findBalance(entry.line.catalogItemId, tx);
          const quantity = new Prisma.Decimal(entry.line.quantity);
          const projected = new Prisma.Decimal(balance?.quantity ?? 0).plus(quantity.negated());
          if (projected.isNegative()) {
            throw new DomainError("CONFLICT", INSUFFICIENT_STOCK_MESSAGE);
          }

          await this.inventory.createMovement(
            {
              catalogItemId: entry.line.catalogItemId,
              type: "SALE",
              quantity: quantity.negated(),
              reason: SALE_COMPLETION_MOVEMENT_REASON,
            },
            tx
          );
          await this.inventory.upsertBalance(entry.line.catalogItemId, projected, tx);
        }

        // STEP 9 — exactly one `SALE` cash movement per CASH payment against
        // the resolved session and its register; non-CASH payments write none.
        if (cashSession !== undefined) {
          for (const payment of payments) {
            if (payment.method !== "CASH") {
              continue;
            }
            await this.cash.createSaleMovement(
              {
                registerId: cashSession.registerId,
                sessionId: cashSession.id,
                amount: payment.amount,
              },
              tx
            );
          }
        }

        // STEP 10 — freeze the recomputed snapshot onto the line rows.
        await this.sales.freezeLines(
          id,
          recomputed.map((entry) => ({
            catalogItemId: entry.line.catalogItemId,
            snapshot: entry.snapshot,
          })),
          tx
        );

        // STEP 11 — one payment row per submitted payment.
        await this.sales.createPayments(id, payments, tx);

        // STEP 12 — conditional `DRAFT`-only status write (the backstop).
        const applied = await this.sales.complete(id, tx);
        if (!applied) {
          throw new DomainError("CONFLICT", SALE_NOT_EDITABLE_MESSAGE);
        }

        // STEP 13 — the idempotency record, when a key was supplied. A lost
        // race on the `(tenant, operation, key)` unique is recovered below.
        if (idempotencyKey !== undefined) {
          await this.sales.createIdempotencyRecord(
            {
              operation: SALE_COMPLETE_OPERATION,
              key: idempotencyKey,
              fingerprint,
              resultSaleId: id,
            },
            tx
          );
        }

        const completed = await this.sales.findById(id, tx);
        const completionPayments = await this.sales.listPayments(id, tx);

        // STEP 14 — exactly one audit row, field NAMES only.
        await this.audit.append(
          {
            action: SALE_COMPLETED_ACTION,
            tenantId: completed.tenantId,
            actorUserProfileId,
            targetType: SALE_TARGET_TYPE,
            targetId: completed.id,
            metadata: {
              schemaVersion: SALES_DTO_SCHEMA_VERSION,
              changedFields: [...SALE_COMPLETE_CHANGED_FIELDS],
            },
          },
          tx
        );

        // STEP 15 — re-read with lines and payments.
        return {
          sale: toCompletedSaleResponse(completed, completionPayments, false),
          replay: false,
        };
      });
    } catch (error) {
      // A genuinely concurrent first attempt with the SAME key lost the
      // `(tenant, operation, key)` unique race. Recover to the winner's
      // committed result when the fingerprint matches (a replay); otherwise the
      // conflict stands. Any other error propagates untouched.
      if (idempotencyKey !== undefined && isIdempotencyKeyConflict(error)) {
        const record = await this.sales.findIdempotencyRecord(
          SALE_COMPLETE_OPERATION,
          idempotencyKey
        );
        if (record?.fingerprint === fingerprint) {
          const prior = await this.sales.findById(record.resultSaleId);
          const priorPayments = await this.sales.listPayments(record.resultSaleId);
          return { sale: toCompletedSaleResponse(prior, priorPayments, true), replay: true };
        }
      }
      throw error;
    }
  }

  /**
   * Resolves the server-owned tenant and asserts the `sales` entitlement FIRST
   * (DEC-026). `FEATURE_NOT_ENTITLED` (403) is the only rejection path; no
   * generic feature guard is introduced, matching the clinical/branding copy.
   */
  private async assertSalesEnabled(): Promise<string> {
    const tenantId = this.requestContext.requireTenantId();
    if (!(await this.entitlements.has(tenantId, "sales"))) {
      throw new DomainError("FEATURE_NOT_ENTITLED", SALES_FEATURE_NOT_ENTITLED_MESSAGE);
    }
    return tenantId;
  }

  /**
   * Defense-in-depth permission gate applied AFTER the entitlement, for every
   * operation including reads. A missing permission is `403 FORBIDDEN` and
   * reaches no data access.
   */
  private async requirePermission(permission: SalesPermission): Promise<void> {
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(permission)) {
      throw new DomainError("FORBIDDEN", "The required sale permission is missing.");
    }
  }

  /**
   * The server-resolved sale currency: the `sales.defaultCurrency` tenant
   * setting, validated through {@link resolveMinorUnit}. Never read from the
   * request body (DEC-022).
   */
  private async resolveCurrency(): Promise<{ currency: string; minorUnit: number }> {
    const settings = await this.settings.get("sales");
    const currency = settings.defaultCurrency;
    if (typeof currency !== "string") {
      throw new DomainError("VALIDATION_FAILED", SALE_UNSUPPORTED_CURRENCY_MESSAGE);
    }
    return { currency, minorUnit: resolveMinorUnit(currency) };
  }

  /**
   * Resolves and prices every submitted line, IN-TENANT, inside the caller's
   * transaction: the item (tenant-safe), its global rate row, the applied unit
   * price (override, else reference price, else the stable `400`) and the
   * derived tax-included snapshot. Any rejection aborts the whole command, so
   * nothing is persisted.
   */
  private async buildLineWrites(
    lines: readonly { catalogItemId: string; quantity: string; unitPrice?: string }[],
    currency: string,
    minorUnit: number,
    tx: SalesWriteTx
  ): Promise<SaleLineWriteData[]> {
    const writes: SaleLineWriteData[] = [];

    for (const line of lines) {
      // Tenant-safe resolution: a foreign or unknown item is the shared 404.
      const item = await this.catalog.findById(line.catalogItemId, tx);

      if (item.referencePriceCurrency !== null && item.referencePriceCurrency !== currency) {
        throw new DomainError("VALIDATION_FAILED", SALE_CURRENCY_MISMATCH_MESSAGE);
      }

      // The operator's override wins; otherwise the catalog reference price is
      // the suggestion (DEC-022). No usable price at all is a stable 400.
      const appliedUnitPrice = line.unitPrice ?? item.referencePriceAmount ?? null;
      if (appliedUnitPrice === null) {
        throw new DomainError("VALIDATION_FAILED", SALE_UNIT_PRICE_REQUIRED_MESSAGE);
      }

      const taxRate = await this.sales.findTaxRate(item.taxRateId, tx);
      if (taxRate === null) {
        throw new DomainError("VALIDATION_FAILED", SALE_TAX_RATE_NOT_FOUND_MESSAGE);
      }

      const amounts = computeLineAmounts({
        unitPrice: appliedUnitPrice,
        quantity: line.quantity,
        ratePercent: taxRate.rate,
        minorUnit,
      });

      writes.push({
        catalogItemId: line.catalogItemId,
        rateCode: taxRate.code,
        unitPrice: new Prisma.Decimal(appliedUnitPrice).toFixed(SALE_MONEY_SCALE),
        quantity: new Prisma.Decimal(line.quantity).toFixed(SALE_QUANTITY_SCALE),
        lineTotal: amounts.lineTotal.toFixed(SALE_MONEY_SCALE),
        taxableBase: amounts.taxableBase.toFixed(SALE_MONEY_SCALE),
        taxAmount: amounts.taxAmount.toFixed(SALE_MONEY_SCALE),
      });
    }

    return writes;
  }
}
