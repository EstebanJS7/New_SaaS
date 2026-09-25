import { Inject, Injectable } from "@nestjs/common";
// Value imports (not `import type`): `PrismaService` is the DI token and
// `Prisma` provides the exact `Decimal` type used by the price/rate literals.
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import type { CatalogItemKindDto, CatalogItemResponse, TaxRateResponse } from "./catalog.dto.js";
import { CATALOG_PERMISSIONS, type CatalogPermission } from "./catalog.permissions.js";
import {
  CATALOG_DTO_SCHEMA_VERSION,
  type CreateCatalogItemInput,
  type UpdateCatalogItemInput,
} from "./catalog.zod.js";
import {
  CatalogRepository,
  type CatalogItemCreateData,
  type CatalogItemDelegate,
  type CatalogItemRow,
  type CatalogItemUpdateData,
} from "./catalog.repository.js";

/** Read filters accepted by {@link CatalogService.listItems} (both optional). */
export interface CatalogItemFilters {
  kind?: CatalogItemKindDto;
  isActive?: boolean;
}

/**
 * Row shape of the GLOBAL tax-rate reference. `rate` is an exact
 * `Prisma.Decimal` at runtime (a plain string is accepted by test fakes); it is
 * never coerced to a float and no arithmetic is derived from it.
 */
export interface CatalogTaxRateRow {
  id: string;
  code: string;
  name: string;
  rate: Prisma.Decimal | string;
}

/**
 * Structural contract for the ONLY global delegate this boundary needs. The
 * generated client and the in-memory test fake both satisfy it. There is
 * deliberately NO `include`/relation requirement: the service loads the three
 * rates once and maps them by id, so the persistence seam stays a plain
 * tenant-scoped item read.
 *
 * `findFirst` is the WRITE path's rate-resolution seam: a client-supplied
 * `taxRateId` is resolved against the GLOBAL seeded rows, never tenant-filtered.
 */
export interface CatalogTaxRateDelegate {
  findMany: (args: { orderBy: { code: "asc" | "desc" } }) => Promise<CatalogTaxRateRow[]>;
  findFirst: (args: { where: { id: string } }) => Promise<CatalogTaxRateRow | null>;
}

/**
 * Everything the audited catalog mutation closure needs from its transaction
 * handle. Declared structurally (not as `Prisma.TransactionClient`) so the real
 * client and the shared in-memory boundary both satisfy it: `catalogItem`
 * reaches the tenant-safe repository seam and `auditLog` the append-only
 * {@link AuditWriter}, so the item change and its audit row commit atomically.
 */
export interface CatalogWriteTx {
  catalogItem: CatalogItemDelegate;
  auditLog: AuditAppendTx["auditLog"];
}

export interface CatalogPrisma {
  taxRate: CatalogTaxRateDelegate;
  $transaction: <T>(work: (tx: CatalogWriteTx) => Promise<T>) => Promise<T>;
}

/**
 * Audit action codes for the three catalog mutations. The repository's
 * established shape is `<singular_entity_snake>.<past_verb>` (for example
 * `customer_address.updated`, `clinical_weight.created`,
 * `patient_guardian.created`), so the catalog item entity is spelled
 * `catalog_item` rather than nesting a second `item` segment. `targetType`
 * matches that entity name.
 */
export const CATALOG_ITEM_CREATED_ACTION = "catalog_item.created";
export const CATALOG_ITEM_UPDATED_ACTION = "catalog_item.updated";
export const CATALOG_ITEM_DEACTIVATED_ACTION = "catalog_item.deactivated";
export const CATALOG_ITEM_TARGET_TYPE = "catalog_item";

/** Audit field-name order for an update diff (payload order, never value order). */
const CATALOG_UPDATE_FIELD_ORDER = [
  "kind",
  "name",
  "taxRateId",
  "referencePriceAmount",
  "referencePriceCurrency",
] as const;

/**
 * Fixed scale of every decimal this boundary projects, in digits after the
 * point. Both catalog decimal columns store two decimals (`tax_rate.rate` is
 * `DECIMAL(5,2)` and `catalog_item.reference_price_amount` is `DECIMAL(14,2)`,
 * the scale EPIC-09 fixed for every currency) and the write contract caps a
 * submitted amount at two decimals, so the stored scale never exceeds it and
 * the projection below can PAD but never round.
 */
const CATALOG_DECIMAL_SCALE = 2;

/**
 * Exact `Decimal` → fixed-scale string projection (the `ClinicalWeight.quantity`
 * rule: an exact decimal never travels as a JavaScript float).
 *
 * The scale is PINNED rather than taken from the value's own text, because the
 * two persistence paths disagree about padding for the same stored value: a real
 * `DECIMAL` read arrives through Prisma's `Decimal`, which trims trailing zeros
 * (`"10.00"` → `"10"`), while the test double hands back the seeded literal
 * verbatim. Padding both to the column's declared scale gives the API ONE
 * canonical spelling, so a client sees the identical exact value from either
 * environment without the server ever rounding a stored digit.
 */
function decimalToFixedScaleString(value: Prisma.Decimal | string): string {
  return new Prisma.Decimal(value).toFixed(CATALOG_DECIMAL_SCALE);
}

function toTaxRateResponse(row: CatalogTaxRateRow): TaxRateResponse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    rate: decimalToFixedScaleString(row.rate),
  };
}

/**
 * Maps one item row to its allowlisted DTO, resolving the nested rate from the
 * already-loaded global map. A missing rate is a DEPLOY FAULT, not an item
 * state: the column is NOT NULL with a RESTRICT foreign key, so the global seed
 * must exist. Failing loudly is deliberate — the alternative would invent a
 * rate or hide the broken invariant behind a null the UI must handle.
 */
function toCatalogItemResponse(
  row: CatalogItemRow,
  ratesById: ReadonlyMap<string, CatalogTaxRateRow>
): CatalogItemResponse {
  const rate = ratesById.get(row.taxRateId);
  if (!rate) {
    throw new DomainError("INTERNAL", "Catalog tax rate is unavailable.");
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    kind: row.kind,
    name: row.name,
    taxRateId: row.taxRateId,
    taxRate: { code: rate.code, name: rate.name, rate: decimalToFixedScaleString(rate.rate) },
    referencePriceAmount:
      row.referencePriceAmount === null
        ? null
        : decimalToFixedScaleString(row.referencePriceAmount),
    referencePriceCurrency: row.referencePriceCurrency,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Create payload: an absent reference-price pair is written as NULL/NULL. */
function buildCreateData(input: CreateCatalogItemInput): CatalogItemCreateData {
  return {
    kind: input.kind,
    name: input.name,
    taxRateId: input.taxRateId,
    referencePriceAmount: input.referencePriceAmount ?? null,
    referencePriceCurrency: input.referencePriceCurrency ?? null,
  };
}

/**
 * Update payload: only keys the caller actually supplied are copied. An absent
 * key leaves the stored column untouched (that is what omitting it means); an
 * explicit `null` pair is copied through so the columns are cleared.
 */
function buildUpdateData(input: UpdateCatalogItemInput): CatalogItemUpdateData {
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
  return data;
}

/**
 * Audit diff for a create: the field NAMES the caller actually set — never a
 * name, an amount or any other value. The reference-price pair is named only
 * when it carries a value (a create has nothing to clear).
 */
function createChangedFields(input: CreateCatalogItemInput): string[] {
  const fields = ["kind", "name", "taxRateId"];
  if (input.referencePriceAmount !== undefined && input.referencePriceAmount !== null) {
    fields.push("referencePriceAmount", "referencePriceCurrency");
  }
  return fields;
}

/**
 * Audit diff for an update: the NAMES of the supplied keys, in payload order.
 * A clear names its fields too, because the stored value did change to NULL.
 */
function updateChangedFields(input: UpdateCatalogItemInput): string[] {
  return CATALOG_UPDATE_FIELD_ORDER.filter((field) => input[field] !== undefined);
}

function toRatesById(rows: CatalogTaxRateRow[]): Map<string, CatalogTaxRateRow> {
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Catalog application boundary (EPIC-09 WU2): the READ surface and the three
 * audited mutations (create, update, soft-deactivate).
 *
 * - The route-level permission is RE-ASSERTED here per operation as defense in
 *   depth; a missing permission is `403` and reaches no data access.
 * - Tenant identity comes exclusively from `RequestContextService`; item writes
 *   go through the WU1 tenant-safe {@link CatalogRepository}, so a foreign or
 *   unknown UUID is a byte-equivalent `404` and nothing is persisted.
 * - The tax-rate list is GLOBAL reference data — the same three seeded rows for
 *   every tenant, never tenant-filtered. A client-supplied `taxRateId` is
 *   resolved against those rows and an unresolvable id is `400
 *   VALIDATION_FAILED`, so no rate-less item state can ever be written.
 * - Every mutation appends exactly ONE audit row through {@link AuditWriter},
 *   INSIDE the same transaction as the item change, carrying stable ids and
 *   field NAMES only. No catalog event is emitted: nothing reacts post-commit.
 * - There is NO delete operation anywhere on this boundary; removal is the
 *   explicit, idempotent `deactivate` command.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly items: CatalogRepository,
    @Inject(PrismaService) private readonly prisma: CatalogPrisma,
    private readonly requestContext: RequestContextService,
    private readonly permissionResolver: PermissionResolver,
    private readonly audit: AuditWriter
  ) {}

  /** The GLOBAL seeded rate list; identical for every entitled tenant. */
  async listTaxRates(): Promise<TaxRateResponse[]> {
    await this.requirePermission(CATALOG_PERMISSIONS.read);
    const rows = await this.prisma.taxRate.findMany({ orderBy: { code: "asc" } });
    return rows.map(toTaxRateResponse);
  }

  /** The caller tenant's items, optionally filtered by kind and/or active flag. */
  async listItems(filters: CatalogItemFilters = {}): Promise<CatalogItemResponse[]> {
    await this.requirePermission(CATALOG_PERMISSIONS.read);
    const [rows, rates] = await Promise.all([
      this.items.list(filters),
      this.prisma.taxRate.findMany({ orderBy: { code: "asc" } }),
    ]);
    return rows.map((row) => toCatalogItemResponse(row, toRatesById(rates)));
  }

  /** One item of the caller tenant; a foreign UUID is the same `404` as absent. */
  async getItem(id: string): Promise<CatalogItemResponse> {
    await this.requirePermission(CATALOG_PERMISSIONS.read);
    const [row, rates] = await Promise.all([
      this.items.findById(id),
      this.prisma.taxRate.findMany({ orderBy: { code: "asc" } }),
    ]);
    return toCatalogItemResponse(row, toRatesById(rates));
  }

  /**
   * Creates one item in the caller's tenant and co-commits its audit row.
   *
   * `taxRateId` is REQUIRED by the request contract and resolved against the
   * GLOBAL seeded rows BEFORE the transaction opens: an unknown id is `400
   * VALIDATION_FAILED` and persists nothing. The rate check is a read of
   * immutable seed data (the rows are tenant read-only and protected by a
   * RESTRICT foreign key), so it needs no transaction of its own.
   */
  async create(input: CreateCatalogItemInput): Promise<CatalogItemResponse> {
    const tenantId = await this.requirePermission(CATALOG_PERMISSIONS.create);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    await this.assertTaxRateExists(input.taxRateId);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await this.items.create(buildCreateData(input), tx);

      await this.audit.append(
        {
          action: CATALOG_ITEM_CREATED_ACTION,
          tenantId,
          actorUserProfileId,
          targetType: CATALOG_ITEM_TARGET_TYPE,
          targetId: created.id,
          metadata: {
            schemaVersion: CATALOG_DTO_SCHEMA_VERSION,
            changedFields: createChangedFields(input),
          },
        },
        tx
      );

      return created;
    });

    return this.toResponse(row);
  }

  /**
   * Updates one item of the caller's tenant and co-commits its audit row.
   *
   * An omitted `taxRateId` leaves the selected rate unchanged; a present one
   * must resolve to a seeded rate (`400` otherwise). The request contract makes
   * an explicit `null` a validation failure, so the stored rate can never be
   * cleared and no rate-less state is reachable.
   *
   * A foreign or unknown id fails the repository's compound tenant predicate
   * with the shared `404 NOT_FOUND` inside the transaction, which then rolls
   * back — so the rejection is byte-equivalent to any other unknown id and
   * persists nothing.
   */
  async update(id: string, input: UpdateCatalogItemInput): Promise<CatalogItemResponse> {
    const tenantId = await this.requirePermission(CATALOG_PERMISSIONS.update);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    if (input.taxRateId !== undefined) {
      await this.assertTaxRateExists(input.taxRateId);
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await this.items.update(id, buildUpdateData(input), tx);

      await this.audit.append(
        {
          action: CATALOG_ITEM_UPDATED_ACTION,
          tenantId,
          actorUserProfileId,
          targetType: CATALOG_ITEM_TARGET_TYPE,
          targetId: updated.id,
          metadata: {
            schemaVersion: CATALOG_DTO_SCHEMA_VERSION,
            changedFields: updateChangedFields(input),
          },
        },
        tx
      );

      return updated;
    });

    return this.toResponse(row);
  }

  /**
   * Soft-deactivates one item of the caller's tenant and co-commits its audit
   * row. There is no hard-delete operation anywhere.
   *
   * IDEMPOTENT: deactivating an already-inactive item succeeds, returns it
   * unchanged and still appends exactly one audit row, whose `changedFields` is
   * EMPTY because no field changed — the Customer/Patient deactivation
   * convention. A repeat is therefore distinguishable in the trail from the
   * transition that actually flipped `isActive`.
   *
   * That diff is derived from the conditional write's own affected-row count
   * (`flipped`), NOT from a pre-state read: a read taken before the row lock
   * cannot tell a transition from a concurrent repeat, because two racing
   * deactivations can BOTH still observe `isActive = true` while only one of
   * their guarded writes ever matches a row. Exactly one accepted call therefore
   * reports `["isActive"]` and every other reports `[]`.
   *
   * A foreign or unknown id matches no row under the tenant scope and the
   * post-state read then resolves to the shared `404 NOT_FOUND`, so nothing is
   * persisted and the rejection is byte-equivalent to any other unknown id.
   */
  async deactivate(id: string): Promise<CatalogItemResponse> {
    const tenantId = await this.requirePermission(CATALOG_PERMISSIONS.deactivate);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const deactivated = await this.items.deactivate(id, tx);

      await this.audit.append(
        {
          action: CATALOG_ITEM_DEACTIVATED_ACTION,
          tenantId,
          actorUserProfileId,
          targetType: CATALOG_ITEM_TARGET_TYPE,
          targetId: deactivated.id,
          metadata: {
            schemaVersion: CATALOG_DTO_SCHEMA_VERSION,
            changedFields: deactivated.flipped ? ["isActive"] : [],
          },
        },
        tx
      );

      return deactivated;
    });

    return this.toResponse(row);
  }

  /**
   * Resolves a client-supplied rate id against the GLOBAL seeded rows. Rates
   * are never tenant-scoped, so "foreign" can only mean "unknown" here; either
   * way the answer is `400 VALIDATION_FAILED` and nothing is written. Mirrors
   * the global Species/Breed validation in `PatientsService`.
   */
  private async assertTaxRateExists(taxRateId: string): Promise<void> {
    const rate = await this.prisma.taxRate.findFirst({ where: { id: taxRateId } });
    if (!rate) {
      throw new DomainError("VALIDATION_FAILED", "Unknown catalog tax rate.");
    }
  }

  /**
   * Resolves the server-side tenant context and re-applies one catalog
   * permission. `requireTenantId()` fails closed with `FORBIDDEN` before any
   * database call when no tenant authority was resolved upstream; the resolved
   * tenant id is returned so the caller never re-derives it.
   */
  private async requirePermission(permission: CatalogPermission): Promise<string> {
    const tenantId = this.requestContext.requireTenantId();
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(permission)) {
      throw new DomainError("FORBIDDEN", "The required catalog permission is missing.");
    }
    return tenantId;
  }

  /** Re-reads the GLOBAL rates once to render one item's nested projection. */
  private async toResponse(row: CatalogItemRow): Promise<CatalogItemResponse> {
    const rates = await this.prisma.taxRate.findMany({ orderBy: { code: "asc" } });
    return toCatalogItemResponse(row, toRatesById(rates));
  }
}
