import { Inject, Injectable } from "@nestjs/common";
// Value imports (not `import type`): `PrismaService` is the DI token and
// `Prisma` provides the exact `Decimal` used to render the fixed-scale
// projections.
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
import { CatalogRepository } from "../catalog/catalog.repository.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { TenantSettingsService } from "../settings/tenant-settings.service.js";
import type { SaleLineResponse, SaleResponse } from "./sales.dto.js";
import { SALES_PERMISSIONS, type SalesPermission } from "./sales.permissions.js";
import {
  SALE_UNSUPPORTED_CURRENCY_MESSAGE,
  computeLineAmounts,
  resolveMinorUnit,
  sumLineTotals,
} from "./sales.pricing.js";
import {
  SaleRepository,
  type SaleLineRow,
  type SaleLineWriteData,
  type SaleListFilters,
  type SaleRow,
  type SaleTx,
} from "./sales.repository.js";
import {
  SALES_DTO_SCHEMA_VERSION,
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
export type SalesWriteTx = SaleTx & { auditLog: AuditAppendTx["auditLog"] };

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
export const SALE_TARGET_TYPE = "sale";

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
 * Sale application boundary (EPIC-12 POS-001): the tenant-scoped read surface
 * and the three audited draft mutations (create, update, cancel).
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
 * - Every mutation appends exactly ONE audit row through {@link AuditWriter},
 *   INSIDE the same transaction as the sale change, carrying stable ids and field
 *   NAMES only. Reads are never audited. No sale event is emitted.
 * - This boundary is INERT with respect to the rest of the system: a draft
 *   create, update or cancel performs no stock movement, changes no balance,
 *   writes no cash movement, creates no invoice, writes no payment, calls no
 *   fiscal provider and allocates no number (DEC-023/DEC-027).
 * - There is NO delete operation anywhere on this boundary: a draft drops a line
 *   through the update command's line-set reconciliation, and a settled sale is
 *   immutable.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly sales: SaleRepository,
    private readonly catalog: CatalogRepository,
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
