import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
// Value imports (not `import type`): `PrismaService` is the DI token and
// `Prisma` provides the exact `Decimal` arithmetic used by the BLOCK policy.
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { resolveWorkingBranch } from "../branches/branch-scope.js";
import type {
  StockBalanceResponse,
  StockBranchResponse,
  StockMovementResponse,
  StockTransferResponse,
} from "./inventory.dto.js";
import { INVENTORY_PERMISSIONS, type InventoryPermission } from "./inventory.permissions.js";
import {
  InventoryRepository,
  type InventoryClient,
  type InventoryWriteTx,
  type StockBalanceListFilters,
  type StockBalanceRow,
  type StockItemRow,
  type StockMovementListFilters,
  type StockMovementRow,
} from "./inventory.repository.js";
import {
  INVENTORY_DTO_SCHEMA_VERSION,
  type CreateStockAdjustmentInput,
  type CreateStockTransferInput,
} from "./inventory.zod.js";

/** The one production client plus the transaction seam this boundary needs. */
export interface InventoryPrisma extends InventoryClient {
  $transaction: <T>(work: (tx: InventoryWriteTx) => Promise<T>) => Promise<T>;
}

/**
 * Audit action code for the adjustment command. The repository's established
 * shape is `<singular_entity_snake>.<past_verb>` (for example
 * `catalog_item.created`), so the ledger entity is spelled `stock_movement`.
 * `targetType` matches that entity name.
 */
export const STOCK_MOVEMENT_CREATED_ACTION = "stock_movement.created";
export const STOCK_MOVEMENT_TARGET_TYPE = "stock_movement";

/**
 * Stable CONFLICT message for an item that does not participate in the stock
 * ledger. The request is well formed and the item exists IN the caller's
 * tenant — its own state forbids the command, so this is `409 CONFLICT` (the
 * scheduling/appointment illegal-state convention), NOT a `400` malformed
 * input and never a `404` (that would wrongly mask a real item).
 */
export const STOCK_ITEM_NOT_TRACKED_MESSAGE = "The catalog item does not track stock.";

/**
 * Stable CONFLICT message for a deactivated item. Removal in the catalog is
 * deactivation, so a deactivated item exists but must not receive new stock
 * movements. Same `409` rationale as {@link STOCK_ITEM_NOT_TRACKED_MESSAGE}.
 */
export const STOCK_ITEM_INACTIVE_MESSAGE = "The catalog item is inactive.";

/**
 * Stable CONFLICT message for the fixed `BLOCK` negative-stock policy (PRD
 * §16): an output that would drive the projection below zero is rejected and
 * persists nothing. The database's `CHECK (quantity >= 0)` is the last line of
 * defence under concurrency; this pre-check is the deterministic rule.
 */
export const INSUFFICIENT_STOCK_MESSAGE =
  "The adjustment would drive the stock balance below zero.";

/** MB-003: Spanish refusals of the transfer command. */
export const TRANSFER_INSUFFICIENT_STOCK_MESSAGE =
  "No hay stock suficiente en la sucursal de origen para transferir esa cantidad.";
export const TRANSFER_DESTINATION_INVALID_MESSAGE =
  "La sucursal de destino no existe o está desactivada.";
export const STOCK_TRANSFER_CREATED_ACTION = "stock_transfer.created";
export const STOCK_TRANSFER_TARGET_TYPE = "stock_transfer";

/**
 * Fixed scale of every decimal this boundary projects, in digits after the
 * point. Both stock columns are `DECIMAL(10,3)`, and the write contract caps a
 * submitted quantity at that scale, so the projection can PAD but never round.
 */
const INVENTORY_DECIMAL_SCALE = 3;

/**
 * Audit field-name order for the adjustment (payload order, never value
 * order). The reason is mandatory, so both names are always present; the
 * VALUES — the reason text and the quantity — never enter the trail.
 */
const STOCK_ADJUSTMENT_CHANGED_FIELDS: readonly string[] = ["quantity", "reason"];

/**
 * Exact `Decimal` → fixed-scale string projection (the catalog and
 * `ClinicalWeight.quantity` rule: an exact decimal never travels as a
 * JavaScript float).
 */
function decimalToFixedScaleString(value: Prisma.Decimal | string): string {
  return new Prisma.Decimal(value).toFixed(INVENTORY_DECIMAL_SCALE);
}

/**
 * Maps one ledger row to its allowlisted DTO. `quantity` keeps its SIGN — a
 * positive input and a negative output are both projected exactly.
 */
function toStockMovementResponse(row: StockMovementRow): StockMovementResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    catalogItemId: row.catalogItemId,
    type: row.type,
    quantity: decimalToFixedScaleString(row.quantity),
    reason: row.reason,
    reversesMovementId: row.reversesMovementId,
    branchId: row.branchId,
    transferId: row.transferId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Maps one projection row to its allowlisted DTO, resolving the item identity
 * from the already-loaded tenant item map. A missing item is a DEPLOY FAULT,
 * not a balance state: the composite `(tenant_id, catalog_item_id)` foreign key
 * makes a balance for a non-existent item unrepresentable, so failing loudly is
 * deliberate — the alternative would invent an identity or hide the broken
 * invariant behind a null the client must handle.
 */
function toStockBalanceResponse(
  row: StockBalanceRow,
  itemsById: ReadonlyMap<string, StockItemRow>,
  branchNames: ReadonlyMap<string, string>
): StockBalanceResponse {
  const item = itemsById.get(row.catalogItemId);
  if (!item) {
    throw new DomainError("INTERNAL", "Stock item is unavailable.");
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    catalogItemId: row.catalogItemId,
    item: { name: item.name, kind: item.kind },
    branchId: row.branchId,
    branchName: branchNames.get(row.branchId) ?? null,
    quantity: decimalToFixedScaleString(row.quantity),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The write-path eligibility gate: only an ACTIVE item that participates in
 * the ledger can receive movements. Both failures are stable `409 CONFLICT`
 * domain errors and reach no data access, so nothing is persisted.
 */
function assertStockableItem(item: StockItemRow): void {
  if (!item.tracksStock) {
    throw new DomainError("CONFLICT", STOCK_ITEM_NOT_TRACKED_MESSAGE);
  }
  if (!item.isActive) {
    throw new DomainError("CONFLICT", STOCK_ITEM_INACTIVE_MESSAGE);
  }
}

/**
 * Inventory application boundary (EPIC-10 W2): the tenant stock reads and the
 * signed adjustment command.
 *
 * - The route-level permission is RE-ASSERTED here per operation as defense in
 *   depth; a missing permission is `403` and reaches no data access.
 * - Tenant identity comes exclusively from `RequestContextService`; item
 *   resolution and every ledger/projection query go through the tenant-safe
 *   {@link InventoryRepository}, so a foreign or unknown item UUID is a
 *   byte-equivalent `404` on BOTH the command and the item-addressed read, and
 *   nothing is persisted by the command.
 * - The adjustment is ONE transaction: the movement insert, the balance upsert
 *   and exactly ONE audit row commit together or not at all. The movement is
 *   created CONFIRMED and immutable — there is no update and no delete route
 *   anywhere on this boundary, and no event is emitted: the ledger is correct
 *   without one.
 * - The negative-stock policy is a fixed `BLOCK`: an output that would drive
 *   the projection below zero is a `409 CONFLICT` and persists nothing. The
 *   pre-check and the absolute balance write are ONE read-modify-write
 *   serialized per `(tenant, item)` by a transaction-scoped advisory lock, so
 *   under concurrency exactly one output is admitted and the projection always
 *   equals the ledger's signed sum.
 * - Every mutation appends exactly ONE audit row carrying stable ids and field
 *   NAMES only — the adjustment reason VALUE never reaches the trail.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly inventory: InventoryRepository,
    @Inject(PrismaService) private readonly prisma: InventoryPrisma,
    private readonly requestContext: RequestContextService,
    private readonly permissionResolver: PermissionResolver,
    private readonly audit: AuditWriter
  ) {}

  /**
   * The caller tenant's stock projection, each row carrying the item identity.
   * Rows are the ledger's transactional sum, so a deactivated item keeps its
   * balance — the ledger is history, not a live catalog view.
   */
  /** MB-003: one row per (item, branch); `branchId` narrows to one branch. */
  /** MB-003: the tenant's active branches, by name, for the stock screen. */
  async listStockBranches(): Promise<StockBranchResponse[]> {
    const tenantId = await this.requirePermission(INVENTORY_PERMISSIONS.read);
    const rows = await this.prisma.branch.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true },
    });
    return rows
      .map((row) => ({ id: row.id, name: row.name }))
      .sort((left, right) => left.name.localeCompare(right.name, "es"));
  }

  async listBalances(filters: StockBalanceListFilters = {}): Promise<StockBalanceResponse[]> {
    const tenantId = await this.requirePermission(INVENTORY_PERMISSIONS.read);
    const [balances, items] = await Promise.all([
      this.inventory.listBalances(filters),
      this.inventory.listItems(),
    ]);
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const branchIds = [...new Set(balances.map((row) => row.branchId))];
    const branches =
      branchIds.length === 0
        ? []
        : await this.prisma.branch.findMany({
            where: { tenantId, id: { in: branchIds } },
            select: { id: true, name: true },
          });
    const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
    return balances.map((row) => toStockBalanceResponse(row, itemsById, branchNames));
  }

  /**
   * The caller tenant's immutable movement ledger, optionally narrowed to one
   * item. A supplied `catalogItemId` is resolved in-tenant first, so an unknown
   * or FOREIGN id is the same byte-equivalent `404` as everywhere else instead
   * of a silently empty list that would leak nothing but also explain nothing.
   */
  async listMovements(filters: StockMovementListFilters = {}): Promise<StockMovementResponse[]> {
    await this.requirePermission(INVENTORY_PERMISSIONS.read);
    if (filters.catalogItemId !== undefined) {
      await this.inventory.findItem(filters.catalogItemId);
    }
    const rows = await this.inventory.listMovements(filters);
    return rows.map(toStockMovementResponse);
  }

  /**
   * Applies one SIGNED adjustment: a positive quantity is an input, a negative
   * one an output.
   *
   * The item is resolved in-tenant (foreign/unknown ⇒ `404`), then must be an
   * ACTIVE, stock-tracking item (`409` otherwise). The current projection is
   * read INSIDE the transaction under the per-`(tenant, item)` advisory lock
   * (see `InventoryRepository.lockItemStock`), the projected sum is computed
   * with exact `Decimal` arithmetic and the fixed `BLOCK` policy rejects a
   * negative result before anything is written. Because the lock covers BOTH
   * the pre-check and the write, two concurrent outputs that together exceed
   * the balance cannot both commit: the loser is serialized behind the winner,
   * re-reads the committed balance and is rejected. On acceptance the movement,
   * the balance and the single audit row commit atomically; a rejection rolls
   * the transaction back so the ledger and the projection are untouched.
   *
   * A blank reason is rejected with `400 VALIDATION_FAILED` before the
   * transaction opens (the clinical amendment precedent), because the column is
   * `NOT NULL` but an empty string would still be a missing reason.
   */
  async adjust(input: CreateStockAdjustmentInput): Promise<StockMovementResponse> {
    const tenantId = await this.requirePermission(INVENTORY_PERMISSIONS.adjust);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    if (input.reason.trim().length === 0) {
      throw new DomainError("VALIDATION_FAILED", "A stock adjustment reason is required.");
    }

    const quantity = new Prisma.Decimal(input.quantity);

    const movement = await this.prisma.$transaction(async (tx) => {
      const item = await this.inventory.findItem(input.catalogItemId, tx);
      assertStockableItem(item);
      // MB-003 (DEC-094 §10): an adjustment happens in an active branch the
      // caller works at — the requested one, or their only one.
      const branchId = await resolveWorkingBranch(
        tx,
        { tenantId, userProfileId: actorUserProfileId },
        input.branchId
      );

      // Serialize this `(tenant, item)` stock scope BEFORE the projection is
      // read: the `BLOCK` pre-check and the absolute balance write are ONE
      // read-modify-write, so without the lock two concurrent outputs both read
      // the pre-commit balance, both pass and both write — which admits an
      // overdraw and leaves the projection different from the ledger's signed
      // sum. PostgreSQL arbitrates the order here; the loser then re-reads the
      // committed balance and is rejected by `BLOCK` before writing anything.
      await this.inventory.lockItemStock(item.id, branchId, tx);

      const balance = await this.inventory.findBalance(item.id, branchId, tx);
      const projected = new Prisma.Decimal(balance?.quantity ?? 0).plus(quantity);
      if (projected.isNegative()) {
        throw new DomainError("CONFLICT", INSUFFICIENT_STOCK_MESSAGE);
      }

      const created = await this.inventory.createMovement(
        {
          catalogItemId: item.id,
          type: "ADJUSTMENT",
          quantity,
          reason: input.reason,
          branchId,
        },
        tx
      );

      await this.inventory.upsertBalance(item.id, branchId, projected, tx);

      await this.audit.append(
        {
          action: STOCK_MOVEMENT_CREATED_ACTION,
          tenantId,
          actorUserProfileId,
          targetType: STOCK_MOVEMENT_TARGET_TYPE,
          targetId: created.id,
          metadata: {
            schemaVersion: INVENTORY_DTO_SCHEMA_VERSION,
            changedFields: [...STOCK_ADJUSTMENT_CHANGED_FIELDS],
          },
        },
        tx
      );

      return created;
    });

    return toStockMovementResponse(movement);
  }

  /**
   * Resolves the server-side tenant context and re-applies one inventory
   * permission. `requireTenantId()` fails closed with `FORBIDDEN` before any
   * database call when no tenant authority was resolved upstream; the resolved
   * tenant id is returned so the caller never re-derives it.
   */
  /**
   * MB-003 (DEC-094 §10): moves stock of one item from one branch to another.
   * The origin must be an active branch the caller works at (they hand the
   * goods over); the destination any active branch of the clinic. Both
   * per-(item, branch) locks are taken in branch-id order, so two opposite
   * transfers cannot deadlock. The pair of movements, both balances and the
   * audit row commit together; the origin may not go below zero (`BLOCK`).
   */
  async transfer(input: CreateStockTransferInput): Promise<StockTransferResponse> {
    const tenantId = await this.requirePermission(INVENTORY_PERMISSIONS.transfer);
    const actorUserProfileId = this.requestContext.requireUserProfileId();
    if (input.reason.trim().length === 0) {
      throw new DomainError("VALIDATION_FAILED", "A stock transfer reason is required.");
    }
    const quantity = new Prisma.Decimal(input.quantity);

    const result = await this.prisma.$transaction(async (tx) => {
      const item = await this.inventory.findItem(input.catalogItemId, tx);
      assertStockableItem(item);
      const from = await resolveWorkingBranch(
        tx,
        { tenantId, userProfileId: actorUserProfileId },
        input.fromBranchId
      );
      const destination = await tx.branch.findMany({
        where: { tenantId, isActive: true, id: { in: [input.toBranchId] } },
        select: { id: true, name: true },
      });
      if (destination.length !== 1) {
        throw new DomainError("VALIDATION_FAILED", TRANSFER_DESTINATION_INVALID_MESSAGE);
      }
      const to = input.toBranchId;

      for (const branchId of [from, to].sort()) {
        await this.inventory.lockItemStock(item.id, branchId, tx);
      }

      const fromBalance = await this.inventory.findBalance(item.id, from, tx);
      const fromProjected = new Prisma.Decimal(fromBalance?.quantity ?? 0).minus(quantity);
      if (fromProjected.isNegative()) {
        throw new DomainError("CONFLICT", TRANSFER_INSUFFICIENT_STOCK_MESSAGE);
      }
      const toBalance = await this.inventory.findBalance(item.id, to, tx);
      const toProjected = new Prisma.Decimal(toBalance?.quantity ?? 0).plus(quantity);

      const transferId = randomUUID();
      const out = await this.inventory.createMovement(
        {
          catalogItemId: item.id,
          type: "TRANSFER_OUT",
          quantity: quantity.negated(),
          reason: input.reason,
          branchId: from,
          transferId,
        },
        tx
      );
      await this.inventory.upsertBalance(item.id, from, fromProjected, tx);
      const into = await this.inventory.createMovement(
        {
          catalogItemId: item.id,
          type: "TRANSFER_IN",
          quantity,
          reason: input.reason,
          branchId: to,
          transferId,
        },
        tx
      );
      await this.inventory.upsertBalance(item.id, to, toProjected, tx);

      await this.audit.append(
        {
          action: STOCK_TRANSFER_CREATED_ACTION,
          tenantId,
          actorUserProfileId,
          targetType: STOCK_TRANSFER_TARGET_TYPE,
          targetId: transferId,
          // Ids only: the reason is free text and stays in the ledger.
          metadata: {
            schemaVersion: INVENTORY_DTO_SCHEMA_VERSION,
            catalogItemId: item.id,
            fromBranchId: from,
            toBranchId: to,
            movementIds: [out.id, into.id],
          },
        },
        tx
      );
      return { transferId, out, into };
    });

    return {
      transferId: result.transferId,
      out: toStockMovementResponse(result.out),
      in: toStockMovementResponse(result.into),
    };
  }

  private async requirePermission(permission: InventoryPermission): Promise<string> {
    const tenantId = this.requestContext.requireTenantId();
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(permission)) {
      throw new DomainError("FORBIDDEN", "The required inventory permission is missing.");
    }
    return tenantId;
  }
}
