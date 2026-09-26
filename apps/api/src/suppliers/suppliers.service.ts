import { Inject, Injectable } from "@nestjs/common";
// Value import (not `import type`): `PrismaService` is the DI token.
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import type { SupplierResponse } from "./suppliers.dto.js";
import { SUPPLIERS_PERMISSIONS, type SuppliersPermission } from "./suppliers.permissions.js";
import {
  SUPPLIERS_DTO_SCHEMA_VERSION,
  type CreateSupplierInput,
  type UpdateSupplierInput,
} from "./suppliers.zod.js";
import {
  SupplierRepository,
  type SupplierCreateData,
  type SupplierDelegate,
  type SupplierRow,
  type SupplierUpdateData,
} from "./suppliers.repository.js";

/** Read filters accepted by {@link SuppliersService.listSuppliers}. */
export interface SupplierFilters {
  isActive?: boolean;
}

/**
 * Everything the audited supplier mutation closure needs from its transaction
 * handle. Declared structurally (not as `Prisma.TransactionClient`) so the real
 * client and the shared in-memory boundary both satisfy it: `supplier` reaches
 * the tenant-safe repository seam and `auditLog` the append-only
 * {@link AuditWriter}, so the supplier change and its audit row commit
 * atomically.
 */
export interface SuppliersWriteTx {
  supplier: SupplierDelegate;
  auditLog: AuditAppendTx["auditLog"];
}

export interface SuppliersPrisma {
  $transaction: <T>(work: (tx: SuppliersWriteTx) => Promise<T>) => Promise<T>;
}

/**
 * Audit action codes for the three supplier mutations (DEC-017). The
 * repository's established shape is `<singular_entity_snake>.<past_verb>`, so
 * the supplier entity is spelled `supplier` and `targetType` matches it.
 */
export const SUPPLIER_CREATED_ACTION = "supplier.created";
export const SUPPLIER_UPDATED_ACTION = "supplier.updated";
export const SUPPLIER_DEACTIVATED_ACTION = "supplier.deactivated";
export const SUPPLIER_TARGET_TYPE = "supplier";

/**
 * Stable `409 CONFLICT` message for a duplicate PRESENT `taxId` inside one
 * tenant (DEC-011's per-tenant partial unique index). It is deliberately
 * value-free: the submitted identifier is CONFIDENTIAL, so the conflict message
 * never echoes it back to the caller.
 */
export const SUPPLIER_TAX_ID_CONFLICT_MESSAGE =
  "A supplier with this tax identifier already exists in this tenant.";

/**
 * Exact unique index behind DEC-011's per-tenant tax-id rule:
 * `CREATE UNIQUE INDEX "supplier_tenant_id_tax_id_key" ON "supplier"("tenant_id",
 * "tax_id") WHERE "tax_id" IS NOT NULL` in the W1 suppliers migration.
 */
const SUPPLIER_TAX_ID_CONSTRAINT = "supplier_tenant_id_tax_id_key";

/** The partial index's columns/fields, normalized once for shape-agnostic matching. */
const SUPPLIER_TAX_ID_FIELDS: readonly string[] = ["tenantid", "taxid"];

function normalizeUniqueTargetToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * True only for the `(tenant_id, tax_id)` tax-id partial index — never for an
 * unrelated `P2002` such as the `(tenant_id, id)` tenant-ownership key, which
 * must propagate untouched.
 *
 * Prisma reports `meta.target` in provider/engine-dependent shapes: the violated
 * index name (as a string or single-element array) or the violated column names
 * (`tenant_id`/`tax_id`, or their mapped field names). Both shapes are
 * recognized; anything else is not this boundary's index and must propagate.
 */
function matchesSupplierTaxIdTarget(target: unknown): boolean {
  const expectedConstraint = normalizeUniqueTargetToken(SUPPLIER_TAX_ID_CONSTRAINT);

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

  // Index/constraint-name shape, e.g. `["supplier_tenant_id_tax_id_key"]`.
  if (tokens.length === 1 && normalizeUniqueTargetToken(tokens[0]) === expectedConstraint) {
    return true;
  }

  // Column/field shape (order is not guaranteed), e.g. `["tenant_id", "tax_id"]`
  // or `["tenantId", "taxId"]`.
  const normalized = tokens.map(normalizeUniqueTargetToken);
  return (
    normalized.length === SUPPLIER_TAX_ID_FIELDS.length &&
    SUPPLIER_TAX_ID_FIELDS.every((field) => normalized.includes(field))
  );
}

/**
 * Prisma unique-constraint violation (`P2002`) scoped to the exact tax-id index,
 * detected structurally so this boundary keeps its narrow, generated-client-free
 * transaction contract. Any other `P2002` is rethrown by the caller.
 */
function isSupplierTaxIdConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  return candidate.code === "P2002" && matchesSupplierTaxIdTarget(candidate.meta?.target);
}

/**
 * Audit field-name order for a supplier diff (payload order, never value
 * order). `changedFields` carries NAMES only: `taxId`, `legalName`, `email`,
 * `phone` and `address` are CONFIDENTIAL (DEC-011/DEC-017), so no stored value
 * may be copied into the trail. Ids and field names are all the row carries.
 */
const SUPPLIER_FIELD_ORDER = ["name", "legalName", "taxId", "email", "phone", "address"] as const;

type SupplierFieldName = (typeof SUPPLIER_FIELD_ORDER)[number];

/**
 * The field NAMES the accepted payload actually supplied, in payload order. An
 * omitted key names nothing (the stored value is untouched); an explicit `null`
 * names its field too, because clearing changed the stored value to NULL.
 */
function suppliedFields(input: Partial<Record<SupplierFieldName, string | null>>): string[] {
  return SUPPLIER_FIELD_ORDER.filter((field) => input[field] !== undefined);
}

/** Maps one row to its allowlisted INTERNAL response DTO. */
function toSupplierResponse(row: SupplierRow): SupplierResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    legalName: row.legalName,
    taxId: row.taxId,
    email: row.email,
    phone: row.phone,
    address: row.address,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Create payload: an omitted optional field is written as an explicit NULL. */
function buildCreateData(input: CreateSupplierInput): SupplierCreateData {
  return {
    name: input.name,
    legalName: input.legalName ?? null,
    taxId: input.taxId ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    address: input.address ?? null,
  };
}

/**
 * Update payload: only keys the caller actually supplied are copied. An absent
 * key leaves the stored column untouched (that is what omitting it means); an
 * explicit `null` is copied through so the column is cleared.
 */
function buildUpdateData(input: UpdateSupplierInput): SupplierUpdateData {
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
 * Supplier application boundary (EPIC-11 W2): the tenant-scoped read surface
 * and the three audited mutations (create, update, soft-deactivate).
 *
 * - The route-level permission is RE-ASSERTED here per operation as defense in
 *   depth; a missing permission is `403` and reaches no data access, so nothing
 *   is persisted and no audit row is appended.
 * - Tenant identity comes exclusively from `RequestContextService`; supplier
 *   writes go through the tenant-safe {@link SupplierRepository}, so a foreign
 *   or unknown UUID is a byte-equivalent `404` through ONE shared message.
 * - Every mutation appends exactly ONE audit row through {@link AuditWriter},
 *   INSIDE the same transaction as the supplier change, carrying stable ids and
 *   field NAMES only. Reads are never audited. No supplier event is emitted:
 *   nothing reacts post-commit.
 * - There is NO delete operation and NO reactivation anywhere on this boundary;
 *   removal is the explicit, idempotent `deactivate` command.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly suppliers: SupplierRepository,
    @Inject(PrismaService) private readonly prisma: SuppliersPrisma,
    private readonly requestContext: RequestContextService,
    private readonly permissionResolver: PermissionResolver,
    private readonly audit: AuditWriter
  ) {}

  /**
   * The caller tenant's suppliers, name-ascending, optionally narrowed by the
   * active flag. An omitted filter applies NO implicit active-only default.
   */
  async listSuppliers(filters: SupplierFilters = {}): Promise<SupplierResponse[]> {
    await this.requirePermission(SUPPLIERS_PERMISSIONS.read);
    const rows = await this.suppliers.list(filters);
    return rows.map(toSupplierResponse);
  }

  /** One supplier of the caller tenant; a foreign UUID is the same `404` as absent. */
  async getSupplier(id: string): Promise<SupplierResponse> {
    await this.requirePermission(SUPPLIERS_PERMISSIONS.read);
    const row = await this.suppliers.findById(id);
    return toSupplierResponse(row);
  }

  /**
   * Creates one supplier in the caller's tenant and co-commits its audit row.
   * The `taxId` uniqueness rule is the W1 per-tenant partial unique index, not a
   * service convention, so no pre-read is needed here: a duplicate PRESENT
   * `taxId` makes the index reject the write, and that `P2002` is translated
   * into the stable `409 CONFLICT`. Any other `P2002` (for example the
   * `(tenant_id, id)` ownership key) is rethrown untouched.
   */
  async create(input: CreateSupplierInput): Promise<SupplierResponse> {
    const tenantId = await this.requirePermission(SUPPLIERS_PERMISSIONS.create);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await this.suppliers.create(buildCreateData(input), tx);

        await this.audit.append(
          {
            action: SUPPLIER_CREATED_ACTION,
            tenantId,
            actorUserProfileId,
            targetType: SUPPLIER_TARGET_TYPE,
            targetId: created.id,
            metadata: {
              schemaVersion: SUPPLIERS_DTO_SCHEMA_VERSION,
              changedFields: suppliedFields(input),
            },
          },
          tx
        );

        return created;
      });

      return toSupplierResponse(row);
    } catch (error) {
      // The partial unique index rejected a duplicate PRESENT tax_id: surface
      // the stable 409 instead of leaking the raw P2002 as an INTERNAL 500.
      // Anything else (an unrelated P2002, the shared 404, an audit failure)
      // propagates unchanged, so the rejection shape stays byte-equivalent.
      if (isSupplierTaxIdConflict(error)) {
        throw new DomainError("CONFLICT", SUPPLIER_TAX_ID_CONFLICT_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Updates one supplier of the caller's tenant and co-commits its audit row.
   *
   * An omitted optional key leaves the stored value untouched; an explicit
   * `null` clears it; `name` can never be cleared (the request contract rejects
   * `null` with `400 VALIDATION_FAILED`). A foreign or unknown id fails the
   * repository's compound tenant predicate with the shared `404 NOT_FOUND`
   * inside the transaction, which then rolls back — so the rejection is
   * byte-equivalent to any other unknown id and persists nothing.
   *
   * A duplicate PRESENT `taxId` makes the DEC-011 partial unique index reject
   * the write; that `P2002` becomes the stable `409 CONFLICT`, while any other
   * `P2002` — including the `(tenant_id, id)` ownership key — is rethrown.
   */
  async update(id: string, input: UpdateSupplierInput): Promise<SupplierResponse> {
    const tenantId = await this.requirePermission(SUPPLIERS_PERMISSIONS.update);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const updated = await this.suppliers.update(id, buildUpdateData(input), tx);

        await this.audit.append(
          {
            action: SUPPLIER_UPDATED_ACTION,
            tenantId,
            actorUserProfileId,
            targetType: SUPPLIER_TARGET_TYPE,
            targetId: updated.id,
            metadata: {
              schemaVersion: SUPPLIERS_DTO_SCHEMA_VERSION,
              changedFields: suppliedFields(input),
            },
          },
          tx
        );

        return updated;
      });

      return toSupplierResponse(row);
    } catch (error) {
      // The partial unique index rejected a duplicate PRESENT tax_id: surface
      // the stable 409 instead of leaking the raw P2002 as an INTERNAL 500.
      // Anything else (an unrelated P2002, the shared 404, an audit failure)
      // propagates unchanged, so the rejection shape stays byte-equivalent.
      if (isSupplierTaxIdConflict(error)) {
        throw new DomainError("CONFLICT", SUPPLIER_TAX_ID_CONFLICT_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Soft-deactivates one supplier of the caller's tenant and co-commits its
   * audit row. There is no hard-delete operation and no reactivation.
   *
   * IDEMPOTENT: deactivating an already-inactive supplier succeeds, returns it
   * unchanged and still appends exactly one audit row, whose `changedFields` is
   * EMPTY because no field changed. That diff is derived from the conditional
   * write's own affected-row count (`flipped`), NOT from a pre-state read, so
   * exactly one accepted call ever reports `["isActive"]`.
   *
   * A foreign or unknown id matches no row under the tenant scope and fails
   * with the shared `404 NOT_FOUND`, so nothing is persisted and the rejection
   * is byte-equivalent to any other unknown id.
   */
  async deactivate(id: string): Promise<SupplierResponse> {
    const tenantId = await this.requirePermission(SUPPLIERS_PERMISSIONS.deactivate);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const deactivated = await this.suppliers.deactivate(id, tx);

      await this.audit.append(
        {
          action: SUPPLIER_DEACTIVATED_ACTION,
          tenantId,
          actorUserProfileId,
          targetType: SUPPLIER_TARGET_TYPE,
          targetId: deactivated.id,
          metadata: {
            schemaVersion: SUPPLIERS_DTO_SCHEMA_VERSION,
            changedFields: deactivated.flipped ? ["isActive"] : [],
          },
        },
        tx
      );

      return deactivated;
    });

    return toSupplierResponse(row);
  }

  /**
   * Resolves the server-side tenant context and re-applies one supplier
   * permission. `requireTenantId()` fails closed with `FORBIDDEN` before any
   * database call when no tenant authority was resolved upstream; the resolved
   * tenant id is returned so the caller never re-derives it.
   */
  private async requirePermission(permission: SuppliersPermission): Promise<string> {
    const tenantId = this.requestContext.requireTenantId();
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(permission)) {
      throw new DomainError("FORBIDDEN", "The required supplier permission is missing.");
    }
    return tenantId;
  }
}
