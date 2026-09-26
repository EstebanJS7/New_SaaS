import { Inject, Injectable } from "@nestjs/common";
// Value import (not `import type`): `PrismaService` is the DI token.
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";

/**
 * Persistence row for a tenant-scoped supplier. Data classification (DEC-011):
 * `name` is INTERNAL; `legalName`, `taxId`, `email`, `phone` and `address` are
 * CONFIDENTIAL — no log statement on this boundary may carry their values, and
 * logs carry supplier IDS only.
 */
export interface SupplierRow {
  id: string;
  tenantId: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Write payload for {@link SupplierRepository.create}. There is deliberately NO
 * `tenantId` field: tenant identity is resolved server-side from the request
 * context and cannot be supplied (or overridden) by a caller argument.
 */
export interface SupplierCreateData {
  readonly name: string;
  readonly legalName?: string | null;
  readonly taxId?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly address?: string | null;
}

/**
 * Update payload for {@link SupplierRepository.update}. Like the create payload
 * there is NO `tenantId` field; the repository also rebuilds the assignment
 * from an explicit allowlist, so a rogue runtime property cannot re-scope a row.
 *
 * There is deliberately NO `isActive` field: deactivation is its own guarded
 * command ({@link SupplierRepository.deactivate}), so no ordinary update path
 * can reach the flag.
 */
export interface SupplierUpdateData {
  name?: string;
  legalName?: string | null;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}

/**
 * Every column a guarded write may assign, typed for the persistence seam.
 * `isActive` lives HERE and deliberately NOT on {@link SupplierUpdateData}: the
 * ordinary update path cannot reach the flag, because deactivation is the only
 * operation allowed to set it.
 */
export interface SupplierWriteData extends SupplierUpdateData {
  isActive?: boolean;
}

/** Supported read filters for {@link SupplierRepository.list}. */
export interface SupplierListFilters {
  isActive?: boolean;
}

/** Predicate fields the tenant-scoped queries are allowed to build. */
export interface SupplierWhere {
  id?: string;
  tenantId?: string;
  isActive?: boolean;
}

/** Deterministic ordering clauses accepted by {@link SupplierDelegate.findMany}. */
export type SupplierOrderBy = { name?: "asc" | "desc" } | { id?: "asc" | "desc" };

/**
 * Structural contract for the ONLY Prisma delegate this boundary needs. The
 * generated client and the in-memory test fake both satisfy it, keeping the
 * repository independent of the generated model namespace (the convention used
 * by the customer/catalog/inventory boundaries).
 */
export interface SupplierDelegate {
  findFirst: (args: { where: SupplierWhere }) => Promise<SupplierRow | null>;
  findMany: (args: { where: SupplierWhere; orderBy?: SupplierOrderBy[] }) => Promise<SupplierRow[]>;
  create: (args: { data: SupplierCreateData & { tenantId: string } }) => Promise<SupplierRow>;
  updateMany: (args: {
    where: SupplierWhere;
    data: SupplierWriteData;
  }) => Promise<{ count: number }>;
}

/**
 * The delegate set this repository touches. Doubles as the optional transaction
 * seam: the audited service passes its open transaction handle here so the
 * supplier change and its audit row co-commit.
 */
export interface SupplierTx {
  supplier: SupplierDelegate;
}

/** Single stable message behind every supplier 404 — byte-equivalence by construction. */
export const SUPPLIER_NOT_FOUND_MESSAGE = "Supplier was not found.";

/** Copies only the allowlisted update fields; unknown keys are dropped, not persisted. */
function buildUpdateData(input: SupplierUpdateData): SupplierUpdateData {
  const data: SupplierUpdateData = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.legalName !== undefined) data.legalName = input.legalName;
  if (input.taxId !== undefined) data.taxId = input.taxId;
  if (input.email !== undefined) data.email = input.email;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.address !== undefined) data.address = input.address;
  return data;
}

/**
 * Outcome of {@link SupplierRepository.deactivate}: the supplier row AFTER the
 * command, plus whether THIS call performed the `isActive` transition.
 *
 * `flipped` is the command's OWN conditional-write affected-row count, never a
 * comparison against an earlier read (the catalog deactivation contract). Two
 * racing deactivations can both observe an active pre-state, yet the loser
 * matches ZERO rows once the winner commits and therefore reports
 * `flipped: false`, so exactly one accepted call ever describes the transition.
 */
export interface SupplierDeactivation extends SupplierRow {
  readonly flipped: boolean;
}

/**
 * Tenant-safe data access for the tenant-scoped `Supplier` registry
 * (EPIC-11 W2).
 *
 * Contract: every query carries the tenant predicate IMPLICITLY via
 * `requestContext.requireTenantId()`. Call sites never hand-write tenant filters
 * and cannot forget them; when no tenant authority was resolved server-side,
 * `requireTenantId()` throws FORBIDDEN before any database call happens. Zero
 * matching rows ⇒ `DomainError("NOT_FOUND")` with ONE shared message constant,
 * so a foreign record is indistinguishable from a missing one and the service
 * renders a byte-equivalent 404.
 *
 * There is deliberately NO delete method of any kind, and no method takes a
 * caller-supplied tenant id: removal is deactivation, matching DEC-011's
 * lifecycle and the migration that rejects DELETE.
 */
@Injectable()
export class SupplierRepository {
  constructor(
    // Explicit @Inject token keeps DI resolution token-based while the PARAM
    // type stays the narrow delegate set this boundary actually needs.
    @Inject(PrismaService) private readonly prisma: SupplierTx,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService
  ) {}

  /**
   * Creates one supplier in the CALLER'S active tenant. `tenantId` is resolved
   * from the request context and placed LAST in the payload, so even a rogue
   * property on `data` cannot re-scope the insert.
   */
  async create(data: SupplierCreateData, tx?: SupplierTx): Promise<SupplierRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const created = await client.supplier.create({
      data: { ...data, tenantId },
    });
    return created;
  }

  /**
   * One supplier of the caller's active tenant by id. The tenant predicate
   * rides along in the same WHERE clause, so foreign ids fall through to the
   * shared NOT_FOUND path instead of leaking existence.
   */
  async findById(id: string, tx?: SupplierTx): Promise<SupplierRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const row = await client.supplier.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", SUPPLIER_NOT_FOUND_MESSAGE);
    }
    return row;
  }

  /**
   * Lists the caller's active-tenant suppliers in NAME-ascending order (the W1
   * `(tenant_id, name)` index serves it), with `id` ascending as the
   * deterministic tiebreaker for equal names. The optional `isActive` filter is
   * applied on top of the implicit tenant predicate; an omitted filter adds NO
   * predicate, so the service — not this repository — owns any default
   * visibility policy.
   */
  async list(filters: SupplierListFilters = {}, tx?: SupplierTx): Promise<SupplierRow[]> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const rows = await client.supplier.findMany({
      where: {
        tenantId,
        ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return rows;
  }

  /**
   * Updates one supplier of the caller's active tenant. Uses `updateMany` (not
   * `update`) because Prisma's unique-WHERE update could otherwise cross the
   * tenant boundary when handed a foreign primary key; the compound predicate
   * keeps the write inside the tenant and zero affected rows degrade to the
   * shared NOT_FOUND envelope.
   */
  async update(id: string, data: SupplierUpdateData, tx?: SupplierTx): Promise<SupplierRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const result = await client.supplier.updateMany({
      where: { id, tenantId },
      data: buildUpdateData(data),
    });
    if (result.count === 0) {
      throw new DomainError("NOT_FOUND", SUPPLIER_NOT_FOUND_MESSAGE);
    }
    const row = await client.supplier.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", SUPPLIER_NOT_FOUND_MESSAGE);
    }
    return row;
  }

  /**
   * Soft removal: sets `isActive = false` and returns the after-state row plus
   * whether THIS call flipped it. Idempotent — an already-inactive row (zero
   * matched writes) still resolves to the same row with `flipped: false`, while
   * a foreign or unknown id matches no row and fails with the shared NOT_FOUND,
   * changing nothing. Hard delete is not offered anywhere on this boundary, and
   * there is no reactivation command.
   *
   * The conditional `isActive: true` predicate IS the transition claim, so its
   * affected-row count tells the caller whether the flag moved without a second
   * read: under a concurrent repeat, the loser's write re-evaluates the
   * predicate against the winner's committed row and matches nothing.
   */
  async deactivate(id: string, tx?: SupplierTx): Promise<SupplierDeactivation> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const { count } = await client.supplier.updateMany({
      where: { id, tenantId, isActive: true },
      data: { isActive: false },
    });
    const row = await client.supplier.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", SUPPLIER_NOT_FOUND_MESSAGE);
    }
    // A copy, so the caller never holds the live row the next write mutates.
    return { ...row, flipped: count > 0 };
  }
}
