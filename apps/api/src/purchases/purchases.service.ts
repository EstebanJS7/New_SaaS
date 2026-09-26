import { Inject, Injectable } from "@nestjs/common";
// Value imports (not `import type`): `PrismaService` is the DI token and
// `Prisma` provides the exact `Decimal` used to render the fixed-scale
// projections.
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import type { PurchaseLineResponse, PurchaseResponse } from "./purchases.dto.js";
import { PURCHASES_PERMISSIONS, type PurchasesPermission } from "./purchases.permissions.js";
import {
  PurchaseRepository,
  type PurchaseLineRow,
  type PurchaseLineWriteData,
  type PurchaseListFilters,
  type PurchaseRow,
  type PurchaseTx,
} from "./purchases.repository.js";
import {
  PURCHASES_DTO_SCHEMA_VERSION,
  type CreatePurchaseInput,
  type UpdatePurchaseInput,
} from "./purchases.zod.js";

/**
 * Everything the audited purchase mutation closure needs from its transaction
 * handle. Declared structurally (not as `Prisma.TransactionClient`) so the real
 * client and the shared in-memory boundary both satisfy it: the purchase,
 * line, supplier and catalog-item delegates reach the tenant-safe repository
 * seam and `auditLog` the append-only {@link AuditWriter}, so the purchase
 * change and its audit row commit atomically.
 */
export interface PurchasesWriteTx extends PurchaseTx {
  auditLog: AuditAppendTx["auditLog"];
}

export interface PurchasesPrisma {
  $transaction: <T>(work: (tx: PurchasesWriteTx) => Promise<T>) => Promise<T>;
}

/**
 * Audit action codes for the three purchase mutations (DEC-017). The
 * repository's established shape is `<singular_entity_snake>.<past_verb>`, so
 * the purchase entity is spelled `purchase` and `targetType` matches it.
 */
export const PURCHASE_CREATED_ACTION = "purchase.created";
export const PURCHASE_UPDATED_ACTION = "purchase.updated";
export const PURCHASE_CANCELLED_ACTION = "purchase.cancelled";
export const PURCHASE_TARGET_TYPE = "purchase";

/**
 * Stable `409 CONFLICT` message for an edit or cancel against a purchase whose
 * status is not `DRAFT` (DEC-015 as refined by DEC-019). A `RECEIVED` purchase
 * is a confirmed inventory fact corrected only by the future reversal command;
 * a `CANCELLED` one is terminal. Both are well-formed requests against an
 * existing in-tenant resource whose OWN state forbids the command, so this is
 * `409 CONFLICT` — never a `400` and never a `404`, which would wrongly mask a
 * real purchase.
 */
export const PURCHASE_NOT_EDITABLE_MESSAGE = "Only a draft purchase can be changed.";

/**
 * Fixed scales of the two line decimals, in digits after the point. Both are
 * the column scales (`Decimal(10, 3)` and `Decimal(14, 2)`), and the write
 * contract caps a submitted value at the same scale, so the projection can PAD
 * but never round.
 */
const PURCHASE_QUANTITY_SCALE = 3;
const PURCHASE_UNIT_COST_SCALE = 2;

/**
 * Audit field-name order for a purchase mutation (payload order, never value
 * order). `changedFields` carries NAMES only: the line quantities, the unit
 * costs and the supplier reference are INTERNAL, but no stored value is copied
 * into the trail — ids and field names are all the row carries (DEC-017).
 * `lines` is always present because the submitted line set is authoritative and
 * required; `supplierId` only when the caller actually supplied it.
 */
const PURCHASE_FIELD_ORDER = ["supplierId", "lines"] as const;

/** Exact `Decimal` → fixed-scale string projection (never a JavaScript float). */
function decimalToScaleString(value: Prisma.Decimal | string, scale: number): string {
  return new Prisma.Decimal(value).toFixed(scale);
}

/** Maps one line row to its allowlisted INTERNAL projected line. */
function toPurchaseLineResponse(line: PurchaseLineRow): PurchaseLineResponse {
  return {
    id: line.id,
    catalogItemId: line.catalogItemId,
    quantity: decimalToScaleString(line.quantity, PURCHASE_QUANTITY_SCALE),
    unitCost:
      line.unitCost === null ? null : decimalToScaleString(line.unitCost, PURCHASE_UNIT_COST_SCALE),
  };
}

/** Maps one aggregate row to its allowlisted INTERNAL response DTO. */
function toPurchaseResponse(row: PurchaseRow): PurchaseResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    supplierId: row.supplierId,
    status: row.status,
    lines: row.lines.map(toPurchaseLineResponse),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * One submitted line → its persistence payload. An omitted `unitCost` becomes
 * an explicit `null`: the submitted line set is authoritative, so a line the
 * caller did not give a cost has none (DEC-013).
 */
function toLineWriteData(line: {
  catalogItemId: string;
  quantity: string;
  unitCost?: string;
}): PurchaseLineWriteData {
  return {
    catalogItemId: line.catalogItemId,
    quantity: line.quantity,
    unitCost: line.unitCost ?? null,
  };
}

/** The field NAMES an update actually supplied, in field order. */
function updateChangedFields(input: UpdatePurchaseInput): string[] {
  return PURCHASE_FIELD_ORDER.filter(
    (field) => field !== "supplierId" || input.supplierId !== undefined
  );
}

/**
 * The DRAFT-only mutability gate (DEC-015 + DEC-019). A `RECEIVED` purchase is
 * immutable — it is the confirmed inventory fact the future reversal corrects —
 * and a `CANCELLED` one is terminal; both reject an edit or a cancel with the
 * same stable `409 CONFLICT` and reach no write, so nothing is persisted.
 */
function assertDraft(row: PurchaseRow): void {
  if (row.status !== "DRAFT") {
    throw new DomainError("CONFLICT", PURCHASE_NOT_EDITABLE_MESSAGE);
  }
}

/**
 * Purchase application boundary (EPIC-11 PUR-001): the tenant-scoped read
 * surface and the three audited draft mutations (create, update, cancel).
 *
 * - The route-level permission is RE-ASSERTED here per operation as defense in
 *   depth; a missing permission is `403` and reaches no data access, so nothing
 *   is persisted and no audit row is appended.
 * - Tenant identity comes exclusively from `RequestContextService`; every
 *   write goes through the tenant-safe {@link PurchaseRepository}, so a foreign
 *   or unknown purchase, supplier or catalog-item reference is a byte-equivalent
 *   `404` through ONE shared message per resource.
 * - ONLY a `DRAFT` is mutable. A `RECEIVED` or `CANCELLED` purchase rejects an
 *   edit and a cancel with the same stable `409 CONFLICT`, and `CANCELLED` is
 *   reachable only from `DRAFT` (DEC-015/DEC-019).
 * - Every mutation appends exactly ONE audit row through {@link AuditWriter},
 *   INSIDE the same transaction as the purchase change, carrying stable ids and
 *   field NAMES only. Reads are never audited. No purchase event is emitted:
 *   nothing reacts post-commit.
 * - This boundary is INERT with respect to the rest of the system: a draft
 *   operation performs no stock movement, changes no balance, writes no cash
 *   movement, creates no invoice, calls no fiscal provider and allocates no
 *   number (DEC-014/DEC-018). Receiving is PUR-002.
 * - There is NO delete operation anywhere on this boundary: a draft drops a
 *   line through the update command's line-set reconciliation, and a confirmed
 *   purchase is corrected only by the future explicit reversal.
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly purchases: PurchaseRepository,
    @Inject(PrismaService) private readonly prisma: PurchasesPrisma,
    private readonly requestContext: RequestContextService,
    private readonly permissionResolver: PermissionResolver,
    private readonly audit: AuditWriter
  ) {}

  /**
   * The caller tenant's purchases with their lines, newest first, optionally
   * narrowed by status. An omitted filter applies NO implicit default.
   */
  async listPurchases(filters: PurchaseListFilters = {}): Promise<PurchaseResponse[]> {
    await this.requirePermission(PURCHASES_PERMISSIONS.read);
    const rows = await this.purchases.list(filters);
    return rows.map(toPurchaseResponse);
  }

  /** One purchase of the caller tenant; a foreign UUID is the same `404` as absent. */
  async getPurchase(id: string): Promise<PurchaseResponse> {
    await this.requirePermission(PURCHASES_PERMISSIONS.read);
    const row = await this.purchases.findById(id);
    return toPurchaseResponse(row);
  }

  /**
   * Creates one `DRAFT` purchase with its lines in the caller's tenant and
   * co-commits its single audit row.
   *
   * The supplier and every submitted catalog item are resolved IN-TENANT inside
   * the same transaction BEFORE any write, so an unknown or foreign reference
   * collapses to the shared `404` for its resource and the rollback leaves no
   * purchase, no line and no audit row behind. The status is never caller-owned:
   * a new purchase is `DRAFT` until PUR-002 receives it.
   */
  async create(input: CreatePurchaseInput): Promise<PurchaseResponse> {
    const tenantId = await this.requirePermission(PURCHASES_PERMISSIONS.create);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      await this.purchases.assertSupplierExists(input.supplierId, tx);
      await this.purchases.assertCatalogItemsExist(
        input.lines.map((line) => line.catalogItemId),
        tx
      );

      const created = await this.purchases.create(
        {
          supplierId: input.supplierId,
          lines: input.lines.map(toLineWriteData),
        },
        tx
      );

      await this.audit.append(
        {
          action: PURCHASE_CREATED_ACTION,
          tenantId,
          actorUserProfileId,
          targetType: PURCHASE_TARGET_TYPE,
          targetId: created.id,
          metadata: {
            schemaVersion: PURCHASES_DTO_SCHEMA_VERSION,
            changedFields: [...PURCHASE_FIELD_ORDER],
          },
        },
        tx
      );

      return created;
    });

    return toPurchaseResponse(row);
  }

  /**
   * Updates one `DRAFT` purchase of the caller's tenant and co-commits its
   * single audit row.
   *
   * Order of resolutions inside the transaction: the PURCHASE first (an unknown
   * or foreign id is the shared `404` and nothing else runs), then the
   * DRAFT-only guard (any other status is the stable `409` and nothing is
   * written), then the submitted supplier and catalog-item references (each an
   * unknown or foreign reference is the shared `404` for its resource). The
   * line set is then reconciled BY `catalogItemId` — a matched line updated in
   * place, a new item inserted and an absent item deleted — which is exactly the
   * DRAFT-only editability DEC-019 permits. Every rejection rolls the whole
   * transaction back, so nothing is persisted.
   */
  async update(id: string, input: UpdatePurchaseInput): Promise<PurchaseResponse> {
    const tenantId = await this.requirePermission(PURCHASES_PERMISSIONS.update);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.purchases.findById(id, tx);
      assertDraft(current);

      if (input.supplierId !== undefined) {
        await this.purchases.assertSupplierExists(input.supplierId, tx);
      }
      await this.purchases.assertCatalogItemsExist(
        input.lines.map((line) => line.catalogItemId),
        tx
      );

      if (input.supplierId !== undefined) {
        await this.purchases.updateSupplier(id, input.supplierId, tx);
      }
      await this.purchases.reconcileLines(id, input.lines.map(toLineWriteData), tx);

      const updated = await this.purchases.findById(id, tx);

      await this.audit.append(
        {
          action: PURCHASE_UPDATED_ACTION,
          tenantId,
          actorUserProfileId,
          targetType: PURCHASE_TARGET_TYPE,
          targetId: updated.id,
          metadata: {
            schemaVersion: PURCHASES_DTO_SCHEMA_VERSION,
            changedFields: updateChangedFields(input),
          },
        },
        tx
      );

      return updated;
    });

    return toPurchaseResponse(row);
  }

  /**
   * Cancels one `DRAFT` purchase of the caller's tenant and co-commits its
   * single audit row.
   *
   * `CANCELLED` is reachable ONLY from `DRAFT` (DEC-015): a `RECEIVED` or
   * already-`CANCELLED` purchase is the stable `409 CONFLICT` and nothing is
   * persisted. Cancellation is a status transition, never a delete — the
   * purchase and its lines stay readable — and it writes no stock, cash,
   * invoice or fiscal state and allocates no number.
   */
  async cancel(id: string): Promise<PurchaseResponse> {
    const tenantId = await this.requirePermission(PURCHASES_PERMISSIONS.cancel);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.purchases.findById(id, tx);
      assertDraft(current);

      await this.purchases.cancel(id, tx);
      const cancelled = await this.purchases.findById(id, tx);

      await this.audit.append(
        {
          action: PURCHASE_CANCELLED_ACTION,
          tenantId,
          actorUserProfileId,
          targetType: PURCHASE_TARGET_TYPE,
          targetId: cancelled.id,
          metadata: {
            schemaVersion: PURCHASES_DTO_SCHEMA_VERSION,
            changedFields: ["status"],
          },
        },
        tx
      );

      return cancelled;
    });

    return toPurchaseResponse(row);
  }

  /**
   * Resolves the server-side tenant context and re-applies one purchase
   * permission. `requireTenantId()` fails closed with `FORBIDDEN` before any
   * database call when no tenant authority was resolved upstream; the resolved
   * tenant id is returned so the caller never re-derives it.
   */
  private async requirePermission(permission: PurchasesPermission): Promise<string> {
    const tenantId = this.requestContext.requireTenantId();
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(permission)) {
      throw new DomainError("FORBIDDEN", "The required purchase permission is missing.");
    }
    return tenantId;
  }
}
