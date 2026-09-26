import { Inject, Injectable } from "@nestjs/common";
// Value imports (not `import type`): `PrismaService` is the DI token and
// `Prisma` provides the exact `Decimal` type used by the price pair.
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";

/**
 * Catalog item kind values pinned by schema enum `catalog_item_kind`. Kept as a
 * local literal union so this boundary stays decoupled from the generated
 * client namespace (structural compatibility only) — same convention as
 * `TenantMembershipStatusValue`.
 */
export type CatalogItemKindValue = "PRODUCT" | "SERVICE" | "MEDICATION" | "SUPPLY";

/**
 * Persistence row for a tenant-scoped catalog item. Data classification:
 * catalog configuration (name, kind, flags, rate reference and the
 * informational reference price) is INTERNAL — no CONFIDENTIAL payload is read
 * or written here, and logs must carry ids only.
 *
 * `referencePriceAmount` is an exact `Decimal(14, 2)` value. It is NEVER
 * coerced to a JavaScript float and this slice performs no price or tax
 * arithmetic, rounding or conversion on it (DEC-010 keeps those open).
 */
export interface CatalogItemRow {
  id: string;
  tenantId: string;
  kind: CatalogItemKindValue;
  name: string;
  taxRateId: string;
  referencePriceAmount: Prisma.Decimal | null;
  referencePriceCurrency: string | null;
  isActive: boolean;
  /**
   * EPIC-10 stock dimension. The column is non-null with a database default,
   * so a persisted row ALWAYS carries it; the create/update payloads below can
   * omit it, and only the service owns the by-kind default.
   */
  tracksStock: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Write payload for {@link CatalogRepository.create}. There is deliberately NO
 * `tenantId` field: tenant identity is resolved server-side from the request
 * context and cannot be supplied (or overridden) by a caller argument.
 *
 * `referencePriceAmount` accepts only an exact `Decimal` or its string form —
 * never a `number` — so a floating-point price cannot enter the boundary.
 */
export interface CatalogItemCreateData {
  readonly kind: CatalogItemKindValue;
  readonly name: string;
  readonly taxRateId: string;
  readonly referencePriceAmount?: Prisma.Decimal | string | null;
  readonly referencePriceCurrency?: string | null;
  /**
   * Optional here on purpose: the by-kind default (`SERVICE` false, the
   * physical kinds true) is a SERVICE-layer rule, not a persistence rule. When
   * the key is omitted the database default `true` applies, which is why the
   * write path always sends an explicit value from the service.
   */
  readonly tracksStock?: boolean;
}

/**
 * Update payload for {@link CatalogRepository.update}. Like the create payload
 * there is NO `tenantId` field; the repository also rebuilds the assignment
 * from an explicit allowlist, so a rogue runtime property cannot re-scope a row.
 */
export interface CatalogItemUpdateData {
  kind?: CatalogItemKindValue;
  name?: string;
  taxRateId?: string;
  referencePriceAmount?: Prisma.Decimal | string | null;
  referencePriceCurrency?: string | null;
  isActive?: boolean;
  /** Absent leaves the stored flag untouched; a present value changes it. */
  tracksStock?: boolean;
}

/** Supported read filters for {@link CatalogRepository.list}. */
export interface CatalogItemListFilters {
  kind?: CatalogItemKindValue;
  isActive?: boolean;
}

/** Predicate fields the tenant-scoped queries are allowed to build. */
export interface CatalogItemWhere {
  id?: string;
  tenantId?: string;
  kind?: CatalogItemKindValue;
  isActive?: boolean;
}

/** Deterministic ordering clauses accepted by {@link CatalogItemDelegate.findMany}. */
export type CatalogItemOrderBy = { name?: "asc" | "desc" } | { id?: "asc" | "desc" };

/**
 * Structural contract for the ONLY Prisma delegate this boundary needs. The
 * generated client and the in-memory test fake both satisfy it, keeping the
 * repository independent of the generated model namespace (the convention used
 * by the customer/patient/clinical services).
 */
export interface CatalogItemDelegate {
  findFirst: (args: { where: CatalogItemWhere }) => Promise<CatalogItemRow | null>;
  findMany: (args: {
    where: CatalogItemWhere;
    orderBy?: CatalogItemOrderBy[];
  }) => Promise<CatalogItemRow[]>;
  create: (args: { data: CatalogItemCreateData & { tenantId: string } }) => Promise<CatalogItemRow>;
  updateMany: (args: {
    where: CatalogItemWhere;
    data: CatalogItemUpdateData;
  }) => Promise<{ count: number }>;
}

/**
 * The delegate set this repository touches. Doubles as the optional
 * transaction seam: a caller that must co-commit the item change with its own
 * work (WU2's audited service) passes its open transaction handle here.
 */
export interface CatalogItemTx {
  catalogItem: CatalogItemDelegate;
}

/** Single stable message behind every catalog 404 — byte-equivalence by construction. */
export const CATALOG_ITEM_NOT_FOUND_MESSAGE = "Catalog item was not found.";

/** Copies only the allowlisted update fields; unknown keys are dropped, not persisted. */
function buildUpdateData(input: CatalogItemUpdateData): CatalogItemUpdateData {
  const data: CatalogItemUpdateData = {};
  if (input.kind !== undefined) data.kind = input.kind;
  if (input.name !== undefined) data.name = input.name;
  if (input.taxRateId !== undefined) data.taxRateId = input.taxRateId;
  if (input.referencePriceAmount !== undefined) {
    data.referencePriceAmount = input.referencePriceAmount;
  }
  if (input.referencePriceCurrency !== undefined) {
    data.referencePriceCurrency = input.referencePriceCurrency;
  }
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.tracksStock !== undefined) data.tracksStock = input.tracksStock;
  return data;
}

/**
 * Outcome of {@link CatalogRepository.deactivate}: the item row AFTER the
 * command, plus whether THIS call performed the `isActive` transition.
 *
 * `flipped` is the command's OWN conditional-write affected-row count, never a
 * comparison against an earlier read. That distinction is what makes the
 * outcome honest under concurrency: two deactivations can both observe an
 * active pre-state (each reads before contending on the row lock), yet the loser
 * matches ZERO rows once the winner commits and therefore reports
 * `flipped: false`. The after-state row stays on the same object, so the
 * persistence seam keeps returning the row its callers already expect.
 */
export interface CatalogItemDeactivation extends CatalogItemRow {
  readonly flipped: boolean;
}

/**
 * Tenant-safe data access for the tenant-scoped `CatalogItem` aggregate
 * (EPIC-09 WU1). This is the persistence seam only: it adds no HTTP route,
 * DTO, permission, module registration or audit write — those belong to WU2.
 *
 * Contract: every query carries the tenant predicate IMPLICITLY via
 * `requestContext.requireTenantId()`. Call sites never hand-write tenant
 * filters and cannot forget them; when no tenant authority was resolved
 * server-side, `requireTenantId()` throws FORBIDDEN before any database call
 * happens. Zero matching rows ⇒ `DomainError("NOT_FOUND")`, so a foreign
 * record is indistinguishable from a missing one (same message constant),
 * which lets the later service render a byte-equivalent 404.
 *
 * There is NO delete operation of any kind: removal is deactivation
 * (`isActive = false`), matching the database `DELETE`-rejecting trigger.
 *
 * Writes accept an optional transaction client so a caller (WU2's audited
 * service) can co-commit the item change with its own work; when omitted the
 * operation runs on the injected client.
 */
@Injectable()
export class CatalogRepository {
  constructor(
    // Explicit @Inject token keeps DI resolution token-based while the PARAM
    // type stays the narrow delegate set this boundary actually needs (the
    // pattern used by AuditWriter and PatientsCatalogService).
    @Inject(PrismaService) private readonly prisma: CatalogItemTx,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService
  ) {}

  /**
   * Creates one item in the CALLER'S active tenant. `tenantId` is resolved
   * from the request context and placed LAST in the payload, so even a rogue
   * property on `data` cannot re-scope the insert.
   */
  async create(data: CatalogItemCreateData, tx?: CatalogItemTx): Promise<CatalogItemRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const created = await client.catalogItem.create({
      data: { ...data, tenantId },
    });
    return created;
  }

  /**
   * One item of the caller's active tenant by id. The tenant predicate rides
   * along in the same WHERE clause, so foreign ids fall through to the shared
   * NOT_FOUND path instead of leaking existence.
   */
  async findById(id: string, tx?: CatalogItemTx): Promise<CatalogItemRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const row = await client.catalogItem.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", CATALOG_ITEM_NOT_FOUND_MESSAGE);
    }
    return row;
  }

  /**
   * Lists the caller's active-tenant items with deterministic ordering. The
   * optional `kind`/`isActive` filters are applied on top of the implicit
   * tenant predicate; an omitted filter adds NO predicate, so the later
   * service — not this repository — owns any default visibility policy.
   */
  async list(filters: CatalogItemListFilters = {}, tx?: CatalogItemTx): Promise<CatalogItemRow[]> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const rows = await client.catalogItem.findMany({
      where: {
        tenantId,
        ...(filters.kind !== undefined ? { kind: filters.kind } : {}),
        ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return rows;
  }

  /**
   * Updates one item of the caller's active tenant. Uses `updateMany` (not
   * `update`) because Prisma's unique-WHERE update could otherwise cross the
   * tenant boundary when handed a foreign primary key; the compound predicate
   * keeps the write inside the tenant and zero affected rows degrade to the
   * shared NOT_FOUND envelope.
   */
  async update(
    id: string,
    data: CatalogItemUpdateData,
    tx?: CatalogItemTx
  ): Promise<CatalogItemRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const result = await client.catalogItem.updateMany({
      where: { id, tenantId },
      data: buildUpdateData(data),
    });
    if (result.count === 0) {
      throw new DomainError("NOT_FOUND", CATALOG_ITEM_NOT_FOUND_MESSAGE);
    }
    const row = await client.catalogItem.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", CATALOG_ITEM_NOT_FOUND_MESSAGE);
    }
    return row;
  }

  /**
   * Soft removal: sets `isActive = false` and returns the after-state row plus
   * whether THIS call flipped it. Idempotent — an already-inactive row (zero
   * matched writes) still resolves to the same row with `flipped: false`, while
   * a foreign or unknown id matches no row and fails with the shared NOT_FOUND,
   * changing nothing. Hard delete is not offered anywhere on this boundary.
   *
   * The conditional `isActive: true` predicate IS the transition claim, so its
   * affected-row count tells the caller whether the flag moved without a second
   * read: under a concurrent repeat, the loser's write re-evaluates the
   * predicate against the winner's committed row and matches nothing.
   */
  async deactivate(id: string, tx?: CatalogItemTx): Promise<CatalogItemDeactivation> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const { count } = await client.catalogItem.updateMany({
      where: { id, tenantId, isActive: true },
      data: { isActive: false },
    });
    const row = await client.catalogItem.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", CATALOG_ITEM_NOT_FOUND_MESSAGE);
    }
    // A copy, so the caller never holds the live row the next write mutates.
    return { ...row, flipped: count > 0 };
  }
}
