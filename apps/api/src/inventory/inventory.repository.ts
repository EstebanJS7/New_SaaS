import { Inject, Injectable } from "@nestjs/common";
// Value imports (not `import type`): `PrismaService` is the DI token and
// `Prisma` provides the exact `Decimal` type used by the quantity payloads.
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import type { AuditAppendTx } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";

/**
 * Catalog item kind values pinned by schema enum `catalog_item_kind`. Kept as a
 * local literal union so this boundary stays decoupled from the generated
 * client namespace (structural compatibility only) — the
 * `CatalogItemKindValue` convention.
 */
export type StockItemKindValue = "PRODUCT" | "SERVICE" | "MEDICATION" | "SUPPLY";

/**
 * Movement kind values pinned by schema enum `stock_movement_type`. This slice
 * ships only `ADJUSTMENT` (W1 decision): the reserved purchase/sale/transfer/
 * reversal values arrive with the epics that own their commands.
 */
export type StockMovementTypeValue = "ADJUSTMENT";

/**
 * Persistence row for a tenant-scoped catalog item as the inventory boundary
 * needs it. Data classification: item identity and its stock dimension are
 * INTERNAL. This is a projection of the `CatalogItem` aggregate, not a second
 * catalog: nothing here is written by the inventory slice.
 */
export interface StockItemRow {
  id: string;
  tenantId: string;
  kind: StockItemKindValue;
  name: string;
  tracksStock: boolean;
  isActive: boolean;
}

/**
 * Immutable ledger row (PRD §16). `quantity` is an exact `Decimal(10, 3)`
 * value — `Prisma.Decimal` at runtime, a plain string in test fakes — and is
 * never coerced to a JavaScript float. `reversesMovementId` stays `null` in
 * this slice: nothing populates the reserved compensating link.
 */
export interface StockMovementRow {
  id: string;
  tenantId: string;
  catalogItemId: string;
  type: StockMovementTypeValue;
  quantity: Prisma.Decimal | string;
  reason: string;
  reversesMovementId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Transactional projection row, one per (tenant, item). Never negative. */
export interface StockBalanceRow {
  id: string;
  tenantId: string;
  catalogItemId: string;
  quantity: Prisma.Decimal | string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Movement insert payload. There is deliberately NO `tenantId` field: tenant
 * identity is resolved server-side from the request context and placed by this
 * repository, so a caller argument cannot re-scope the ledger.
 */
export interface StockMovementCreateData {
  readonly catalogItemId: string;
  readonly type: StockMovementTypeValue;
  /** Signed exact quantity: positive is an input, negative an output. */
  readonly quantity: Prisma.Decimal | string;
  readonly reason: string;
}

/** Supported read filters for {@link InventoryRepository.listMovements}. */
export interface StockMovementListFilters {
  catalogItemId?: string;
}

/** Deterministic ordering clauses accepted by the movement `findMany`. */
export type StockMovementOrderBy = { createdAt?: "asc" | "desc" } | { id?: "asc" | "desc" };

/** Deterministic ordering clauses accepted by the balance `findMany`. */
export type StockBalanceOrderBy = { catalogItemId?: "asc" | "desc" } | { id?: "asc" | "desc" };

/**
 * Structural contract for the catalog-item delegate this boundary reads. The
 * generated client and the in-memory test fake both satisfy it, keeping the
 * repository independent of the generated model namespace.
 */
export interface StockItemDelegate {
  findFirst: (args: { where: { id: string; tenantId: string } }) => Promise<StockItemRow | null>;
  findMany: (args: {
    where: { tenantId: string };
    orderBy?: { name?: "asc" | "desc"; id?: "asc" | "desc" }[];
  }) => Promise<StockItemRow[]>;
}

/**
 * Structural contract for the ledger delegate. `create` is the ONLY mutation
 * this boundary exposes: the ledger has no update and no delete, matching the
 * schema's `BEFORE DELETE` trigger and its absent update semantics.
 */
export interface StockMovementDelegate {
  create: (args: {
    data: StockMovementCreateData & { tenantId: string };
  }) => Promise<StockMovementRow>;
  findMany: (args: {
    where: { tenantId: string; catalogItemId?: string };
    orderBy?: StockMovementOrderBy[];
  }) => Promise<StockMovementRow[]>;
}

/**
 * Structural contract for the projection delegate. `upsert` is keyed by the
 * database's `(tenant_id, catalog_item_id)` unique — one row per pair — and is
 * only ever called inside the adjustment transaction.
 */
export interface StockBalanceDelegate {
  findFirst: (args: {
    where: { tenantId: string; catalogItemId: string };
  }) => Promise<StockBalanceRow | null>;
  findMany: (args: {
    where: { tenantId: string };
    orderBy?: StockBalanceOrderBy[];
  }) => Promise<StockBalanceRow[]>;
  upsert: (args: {
    where: { tenantId_catalogItemId: { tenantId: string; catalogItemId: string } };
    create: { tenantId: string; catalogItemId: string; quantity: Prisma.Decimal | string };
    update: { quantity: Prisma.Decimal | string };
  }) => Promise<StockBalanceRow>;
}

/**
 * Raw-SQL seam for the transaction-scoped serialization lock. Declared
 * structurally (like every other delegate here) so the generated client and the
 * shared in-memory boundary both satisfy it. The in-memory boundary models
 * `pg_advisory_xact_lock` as a no-op because a synchronous map cannot
 * interleave, so the real serialization proof stays live-PostgreSQL-owned.
 */
export interface InventoryRawClient {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
}

/**
 * The delegate set this repository touches. Doubles as the optional
 * transaction seam: a caller that must co-commit a movement, its balance and
 * its audit row passes its open transaction handle here.
 */
export interface InventoryClient extends InventoryRawClient {
  catalogItem: StockItemDelegate;
  stockMovement: StockMovementDelegate;
  stockBalance: StockBalanceDelegate;
}

/**
 * Everything the audited adjustment closure needs from its transaction handle.
 * Declared structurally so the real client and the shared in-memory boundary
 * both satisfy it: the three stock delegates plus the append-only
 * {@link AuditWriter} target.
 */
export interface InventoryWriteTx extends InventoryClient {
  auditLog: AuditAppendTx["auditLog"];
}

/** Single stable message behind every inventory 404 — byte-equivalence by construction. */
export const INVENTORY_ITEM_NOT_FOUND_MESSAGE = "Inventory item was not found.";

/**
 * Advisory-lock KEY for one `(tenant, item)` stock serialization scope, composed
 * as `<tenantId>:<itemId>` (the scheduling `tenant:professional` convention).
 * Exported so the live-PostgreSQL evidence can reconstruct the EXACT key the
 * command locks and prove the overlap is scoped to that key rather than to the
 * whole database.
 */
export function stockSerializationLockKey(tenantId: string, catalogItemId: string): string {
  return `${tenantId}:${catalogItemId}`;
}

/**
 * Tenant-safe data access for the EPIC-10 stock ledger (PRD §16, W1 schema).
 * This is the persistence seam only: it adds no HTTP route, DTO, permission or
 * module registration, and it owns no business policy (BLOCK lives in the
 * application service).
 *
 * Contract: every query carries the tenant predicate IMPLICITLY via
 * `requestContext.requireTenantId()`. Call sites never hand-write tenant
 * filters and cannot forget them; when no tenant authority was resolved
 * server-side, `requireTenantId()` throws FORBIDDEN before any database call
 * happens. An item id with zero matching rows inside the tenant ⇒
 * `DomainError("NOT_FOUND")` with ONE shared message, so a foreign item is
 * indistinguishable from a missing one and the service renders a
 * byte-equivalent 404 for both.
 *
 * There is NO movement update and NO delete operation of any kind: the ledger
 * is immutable by schema (no update semantics, `BEFORE DELETE` trigger) and a
 * correction is a later compensating movement through the reserved
 * `reversesMovementId` link.
 *
 * Writes accept an optional transaction client so the audited service can
 * co-commit the movement, the projection and the audit row; when omitted the
 * operation runs on the injected client.
 */
@Injectable()
export class InventoryRepository {
  constructor(
    // Explicit @Inject token keeps DI resolution token-based while the PARAM
    // type stays the narrow delegate set this boundary actually needs (the
    // pattern used by CatalogRepository and AuditWriter).
    @Inject(PrismaService) private readonly prisma: InventoryClient,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService
  ) {}

  /**
   * One item of the caller's active tenant by id. The tenant predicate rides
   * along in the same WHERE clause, so a foreign id falls through to the
   * shared NOT_FOUND path instead of leaking existence.
   */
  async findItem(id: string, tx?: InventoryClient): Promise<StockItemRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const row = await client.catalogItem.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", INVENTORY_ITEM_NOT_FOUND_MESSAGE);
    }
    return row;
  }

  /**
   * Every item of the caller's active tenant, in deterministic name order.
   * Used to resolve the item IDENTITY of the balance projection in one read
   * instead of a per-row join, exactly like the catalog loads its rates once.
   */
  async listItems(tx?: InventoryClient): Promise<StockItemRow[]> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.catalogItem.findMany({
      where: { tenantId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
  }

  /**
   * Appends one immutable ledger entry in the CALLER'S active tenant.
   * `tenantId` is resolved from the request context and placed LAST in the
   * payload, so even a rogue property on `data` cannot re-scope the insert.
   */
  async createMovement(
    data: StockMovementCreateData,
    tx?: InventoryClient
  ): Promise<StockMovementRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.stockMovement.create({ data: { ...data, tenantId } });
  }

  /**
   * The caller's active-tenant ledger in stable chronological order. The
   * optional `catalogItemId` filter is applied on top of the implicit tenant
   * predicate; an omitted filter lists the whole tenant ledger.
   */
  async listMovements(
    filters: StockMovementListFilters = {},
    tx?: InventoryClient
  ): Promise<StockMovementRow[]> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.stockMovement.findMany({
      where: {
        tenantId,
        ...(filters.catalogItemId !== undefined ? { catalogItemId: filters.catalogItemId } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  /** The single balance row of one item, or `null` when the item has none yet. */
  async findBalance(catalogItemId: string, tx?: InventoryClient): Promise<StockBalanceRow | null> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.stockBalance.findFirst({ where: { tenantId, catalogItemId } });
  }

  /**
   * Serializes every stock command that targets ONE (tenant, item) for the rest
   * of the caller's open transaction.
   *
   * The invariant this protects is a read-modify-write on the projection: the
   * fixed `BLOCK` policy is evaluated against the running balance and the
   * balance is then written as an ABSOLUTE value. Under READ COMMITTED two
   * concurrent outputs would both read the PRE-COMMIT balance, both pass the
   * pre-check and both write their own projected value, so an overdraw is
   * admitted AND the projection silently stops being the ledger's signed sum
   * (the lost update this lock removes).
   *
   * PostgreSQL itself decides the order: the transaction-scoped advisory lock
   * (`pg_advisory_xact_lock`, the scheduling precedent) parks the loser here,
   * and once the winner commits the loser re-reads the COMMITTED balance in its
   * own next statement and is rejected by `BLOCK` before writing anything. The
   * lock is released automatically at transaction end, so a rolled-back
   * adjustment leaves nothing locked.
   *
   * Key scope is `(tenant, item)`: two tenants never contend and unrelated items
   * stay fully concurrent. This is the ledger's serialization protocol, not an
   * optimization — every future stock command MUST take this same lock before
   * it reads or writes `stock_balance`.
   */
  async lockItemStock(catalogItemId: string, tx?: InventoryClient): Promise<void> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const lockKey = stockSerializationLockKey(tenantId, catalogItemId);
    await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text`;
  }

  /** Every balance row of the caller's active tenant in stable item order. */
  async listBalances(tx?: InventoryClient): Promise<StockBalanceRow[]> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.stockBalance.findMany({
      where: { tenantId },
      orderBy: [{ catalogItemId: "asc" }],
    });
  }

  /**
   * Creates or replaces the single projection row for (tenant, item). The
   * compound unique key is the database's `@@unique([tenantId, catalogItemId])`
   * and `tenantId` is resolved from the request context, so the upsert can
   * never address another tenant's row.
   */
  async upsertBalance(
    catalogItemId: string,
    quantity: Prisma.Decimal | string,
    tx?: InventoryClient
  ): Promise<StockBalanceRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.stockBalance.upsert({
      where: { tenantId_catalogItemId: { tenantId, catalogItemId } },
      create: { tenantId, catalogItemId, quantity },
      update: { quantity },
    });
  }
}
