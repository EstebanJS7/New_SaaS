import { Inject, Injectable } from "@nestjs/common";
// Value import (not `import type`): `PrismaService` is the DI token, and
// `Prisma` provides the exact `Decimal` type of the line decimals.
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";

/**
 * Lifecycle values pinned by schema enum `purchase_status` (PRD §17). Kept as a
 * local literal union so this boundary stays decoupled from the generated
 * client namespace (structural compatibility only).
 */
export type PurchaseStatusValue = "DRAFT" | "RECEIVED" | "CANCELLED";

/**
 * Persistence row for one tenant-scoped purchase line as the read boundary
 * sees it. `quantity` is an exact `Decimal(10, 3)` and `unitCost` an optional
 * informational `Decimal(14, 2)` — `Prisma.Decimal` at runtime, a plain exact
 * string in the in-memory fake — and are NEVER coerced to a JavaScript float.
 */
export interface PurchaseLineRow {
  id: string;
  tenantId: string;
  purchaseId: string;
  catalogItemId: string;
  quantity: Prisma.Decimal | string;
  unitCost: Prisma.Decimal | string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Persistence row for a tenant-scoped purchase WITH its line set. Reads always
 * load the lines, so a caller never has to make a second query to describe the
 * aggregate. There is deliberately no number, code, total or tax field
 * (DEC-018/DEC-013).
 */
export interface PurchaseRow {
  id: string;
  tenantId: string;
  supplierId: string;
  status: PurchaseStatusValue;
  lines: PurchaseLineRow[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Write payload for one line of {@link PurchaseRepository.create} and
 * {@link PurchaseRepository.reconcileLines}. There is deliberately NO
 * `tenantId` and NO `purchaseId` field: both are resolved server-side and
 * placed by this repository, so a caller argument cannot re-scope a line.
 */
export interface PurchaseLineWriteData {
  readonly catalogItemId: string;
  readonly quantity: string;
  readonly unitCost?: string | null;
}

/**
 * Write payload for {@link PurchaseRepository.create}. There is deliberately
 * NO `tenantId` field: tenant identity comes from the request context, and no
 * `status` field either, because a new purchase is `DRAFT` until the receive
 * command (PUR-002) exists.
 */
export interface PurchaseCreateData {
  readonly supplierId: string;
  readonly lines: readonly PurchaseLineWriteData[];
}

/** Supported read filters for {@link PurchaseRepository.list}. */
export interface PurchaseListFilters {
  status?: PurchaseStatusValue;
}

/** Predicate fields the tenant-scoped queries are allowed to build. */
export interface PurchaseWhere {
  id?: string;
  tenantId?: string;
  status?: PurchaseStatusValue;
}

/** Deterministic ordering clauses accepted by {@link PurchaseDelegate.findMany}. */
export type PurchaseOrderBy = { createdAt?: "asc" | "desc" } | { id?: "asc" | "desc" };

/**
 * Structural contract for the purchase delegate. The generated client and the
 * in-memory test fake both satisfy it, keeping this repository independent of
 * the generated model namespace (the customer/catalog/inventory/supplier
 * convention). Every read loads the line set.
 */
export interface PurchaseDelegate {
  findFirst: (args: {
    where: PurchaseWhere;
    include: { lines: true };
  }) => Promise<PurchaseRow | null>;
  findMany: (args: {
    where: PurchaseWhere;
    include: { lines: true };
    orderBy?: PurchaseOrderBy[];
  }) => Promise<PurchaseRow[]>;
  create: (args: {
    data: {
      supplierId: string;
      tenantId: string;
      lines: { create: readonly PurchaseLineWriteData[] };
    };
    include: { lines: true };
  }) => Promise<PurchaseRow>;
  updateMany: (args: {
    where: PurchaseWhere;
    data: { supplierId?: string; status?: PurchaseStatusValue };
  }) => Promise<{ count: number }>;
}

/**
 * Structural contract for the line delegate. It exposes EXACTLY the two
 * mutations draft reconciliation needs — delete the lines absent from the
 * submitted set and upsert each submitted line on the
 * `(tenantId, purchaseId, catalogItemId)` unique — and NO delete of a
 * purchase. Line deletes are reachable only while the purchase is DRAFT,
 * which the service asserts and the DEC-019 trigger enforces.
 */
export interface PurchaseLineDelegate {
  deleteMany: (args: {
    where: { tenantId: string; purchaseId: string; catalogItemId: { notIn: string[] } };
  }) => Promise<{ count: number }>;
  upsert: (args: {
    where: {
      tenantId_purchaseId_catalogItemId: {
        tenantId: string;
        purchaseId: string;
        catalogItemId: string;
      };
    };
    create: {
      tenantId: string;
      purchaseId: string;
      catalogItemId: string;
      quantity: string;
      unitCost: string | null;
    };
    update: { quantity: string; unitCost: string | null };
  }) => Promise<PurchaseLineRow>;
}

/**
 * Structural contract for the in-tenant supplier reference check. Only the id
 * is needed: the purchase stores the reference, not a copy of the supplier.
 */
export interface PurchaseSupplierLookup {
  findFirst: (args: { where: { id: string; tenantId: string } }) => Promise<{ id: string } | null>;
}

/**
 * Structural contract for the in-tenant catalog-item reference check. The
 * batched `id.in` read resolves every submitted line reference in ONE query,
 * so a purchase with N lines does not perform N lookups.
 */
export interface PurchaseCatalogItemLookup {
  findMany: (args: {
    where: { tenantId: string; id: { in: string[] } };
  }) => Promise<{ id: string }[]>;
}

/**
 * The delegate set this repository touches. Doubles as the optional
 * transaction seam: the audited service passes its open transaction handle
 * here so the purchase change and its audit row co-commit.
 */
export interface PurchaseTx {
  purchase: PurchaseDelegate;
  purchaseLine: PurchaseLineDelegate;
  supplier: PurchaseSupplierLookup;
  catalogItem: PurchaseCatalogItemLookup;
}

/** Single stable message behind every purchase 404 — byte-equivalence by construction. */
export const PURCHASE_NOT_FOUND_MESSAGE = "Purchase was not found.";

/** Single stable message behind every unresolved purchase supplier reference. */
export const PURCHASE_SUPPLIER_NOT_FOUND_MESSAGE = "The purchase supplier was not found.";

/** Single stable message behind every unresolved purchase catalog-item reference. */
export const PURCHASE_CATALOG_ITEM_NOT_FOUND_MESSAGE =
  "A purchase line catalog item was not found.";

/**
 * Tenant-safe data access for the tenant-scoped `Purchase` aggregate
 * (EPIC-11 PUR-001).
 *
 * Contract: every query carries the tenant predicate IMPLICITLY via
 * `requestContext.requireTenantId()`. Call sites never hand-write tenant
 * filters and cannot forget them; when no tenant authority was resolved
 * server-side, `requireTenantId()` throws FORBIDDEN before any database call
 * happens. Zero matching rows ⇒ `DomainError("NOT_FOUND")` with ONE shared
 * message per resource, so a foreign record is indistinguishable from a
 * missing one and the service renders a byte-equivalent 404.
 *
 * There is deliberately NO delete method of any kind — a purchase is never
 * deleted — and no method takes a caller-supplied tenant id. The line-set
 * reconciliation deletes LINES only, and only while the owning purchase is
 * `DRAFT`, which the service asserts before calling it (DEC-019).
 *
 * Supplier and catalog-item references are resolved IN-TENANT through this same
 * seam: an unknown or foreign reference collapses to the shared 404 for its
 * resource, never to a bare foreign-key error.
 */
@Injectable()
export class PurchaseRepository {
  constructor(
    // Explicit @Inject token keeps DI resolution token-based while the PARAM
    // type stays the narrow delegate set this boundary actually needs.
    @Inject(PrismaService) private readonly prisma: PurchaseTx,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService
  ) {}

  /**
   * Resolves the referenced supplier of the caller's active tenant. A foreign
   * or unknown id fails with the shared supplier-reference NOT_FOUND, so the
   * purchase can never store a reference it cannot read back.
   */
  async assertSupplierExists(id: string, tx?: PurchaseTx): Promise<void> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const row = await client.supplier.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", PURCHASE_SUPPLIER_NOT_FOUND_MESSAGE);
    }
  }

  /**
   * Resolves EVERY submitted catalog-item reference in one tenant-scoped read.
   * The submitted ids are distinct (the request contract rejects a duplicate
   * `catalogItemId`), so a row count lower than the id count means at least one
   * reference is unknown or foreign and collapses to the shared catalog-item
   * NOT_FOUND.
   */
  async assertCatalogItemsExist(ids: readonly string[], tx?: PurchaseTx): Promise<void> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const uniqueIds = [...new Set(ids)];
    const rows = await client.catalogItem.findMany({ where: { tenantId, id: { in: uniqueIds } } });
    if (rows.length !== uniqueIds.length) {
      throw new DomainError("NOT_FOUND", PURCHASE_CATALOG_ITEM_NOT_FOUND_MESSAGE);
    }
  }

  /**
   * Creates one purchase WITH its lines in the CALLER'S active tenant.
   * `tenantId` is resolved from the request context and placed LAST in the
   * payload, so even a rogue property on `data` cannot re-scope the insert; the
   * nested line create inherits the tenant and purchase ids from the parent, so
   * no line can land in another tenant. The status is the schema default
   * (`DRAFT`): nothing in this slice can create a non-draft purchase.
   */
  async create(data: PurchaseCreateData, tx?: PurchaseTx): Promise<PurchaseRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.purchase.create({
      data: {
        supplierId: data.supplierId,
        tenantId,
        lines: {
          create: data.lines.map((line) => ({
            catalogItemId: line.catalogItemId,
            quantity: line.quantity,
            unitCost: line.unitCost ?? null,
          })),
        },
      },
      include: { lines: true },
    });
  }

  /**
   * One purchase of the caller's active tenant by id, WITH its lines. The
   * tenant predicate rides along in the same WHERE clause, so foreign ids fall
   * through to the shared NOT_FOUND path instead of leaking existence.
   */
  async findById(id: string, tx?: PurchaseTx): Promise<PurchaseRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const row = await client.purchase.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });
    if (!row) {
      throw new DomainError("NOT_FOUND", PURCHASE_NOT_FOUND_MESSAGE);
    }
    return row;
  }

  /**
   * The caller's active-tenant purchases, WITH their lines.
   *
   * DETERMINISTIC ORDER: newest first by `createdAt`, with `id` ascending as
   * the tiebreaker for rows created in the same millisecond — there is no
   * numbering column to sort on (DEC-018), so this pair is what makes the list
   * stable across reads. The optional `status` filter is applied on top of the
   * implicit tenant predicate; an omitted filter adds NO predicate, so this
   * layer owns no default visibility policy.
   */
  async list(filters: PurchaseListFilters = {}, tx?: PurchaseTx): Promise<PurchaseRow[]> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.purchase.findMany({
      where: {
        tenantId,
        ...(filters.status !== undefined ? { status: filters.status } : {}),
      },
      include: { lines: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
  }

  /**
   * Updates the header (`supplierId`) of one purchase of the caller's active
   * tenant. Uses `updateMany` (not `update`) because Prisma's unique-WHERE
   * update could otherwise cross the tenant boundary when handed a foreign
   * primary key; the compound predicate keeps the write inside the tenant and
   * zero affected rows degrade to the shared NOT_FOUND envelope. `status` is
   * NOT writable here: the lifecycle has its own command.
   */
  async updateSupplier(id: string, supplierId: string, tx?: PurchaseTx): Promise<void> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const result = await client.purchase.updateMany({
      where: { id, tenantId },
      data: { supplierId },
    });
    if (result.count === 0) {
      throw new DomainError("NOT_FOUND", PURCHASE_NOT_FOUND_MESSAGE);
    }
  }

  /**
   * Reconciles the draft's line set BY `catalogItemId`: every stored line whose
   * item is absent from the submitted set is deleted, and every submitted line
   * is upserted on the `(tenantId, purchaseId, catalogItemId)` unique — so a
   * matched line is updated in place (its `id` is preserved) and a new item is
   * inserted. Both steps are tenant-scoped, and the caller has already proven
   * the purchase exists, belongs to the caller's tenant and is `DRAFT`; this
   * method therefore never touches a confirmed purchase's lines (DEC-019).
   *
   * The submitted payload is AUTHORITATIVE for each matched line: an omitted
   * `unitCost` clears the stored cost rather than leaving it untouched, because
   * the update states the complete line set it wants.
   */
  async reconcileLines(
    purchaseId: string,
    lines: readonly PurchaseLineWriteData[],
    tx?: PurchaseTx
  ): Promise<void> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;

    await client.purchaseLine.deleteMany({
      where: {
        tenantId,
        purchaseId,
        catalogItemId: { notIn: lines.map((line) => line.catalogItemId) },
      },
    });

    for (const line of lines) {
      await client.purchaseLine.upsert({
        where: {
          tenantId_purchaseId_catalogItemId: {
            tenantId,
            purchaseId,
            catalogItemId: line.catalogItemId,
          },
        },
        create: {
          tenantId,
          purchaseId,
          catalogItemId: line.catalogItemId,
          quantity: line.quantity,
          unitCost: line.unitCost ?? null,
        },
        update: {
          quantity: line.quantity,
          unitCost: line.unitCost ?? null,
        },
      });
    }
  }

  /**
   * Flips one purchase of the caller's active tenant to `CANCELLED`. The
   * DRAFT-only rule is the service's guard (asserted on the row it just read),
   * so this write is a plain tenant-scoped status transition: it never deletes
   * the purchase and never touches its lines, keeping a cancelled purchase
   * readable. Zero affected rows degrade to the shared NOT_FOUND envelope.
   */
  async cancel(id: string, tx?: PurchaseTx): Promise<void> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const result = await client.purchase.updateMany({
      where: { id, tenantId },
      data: { status: "CANCELLED" },
    });
    if (result.count === 0) {
      throw new DomainError("NOT_FOUND", PURCHASE_NOT_FOUND_MESSAGE);
    }
  }
}
