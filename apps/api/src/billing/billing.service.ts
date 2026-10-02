import { Inject, Injectable } from "@nestjs/common";
// Value imports (not `import type`): `PrismaService` is the DI token and
// `Prisma` provides the exact `Decimal` used to render and sum the projections.
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { SaleRepository, type SaleLineRow, type SaleTx } from "../sales/sales.repository.js";
import { TenantSettingsService } from "../settings/tenant-settings.service.js";
import type { InvoiceLineResponse, InvoiceResponse } from "./billing.dto.js";
import { BILLING_PERMISSIONS, type BillingPermission } from "./billing.permissions.js";
import {
  INVOICE_CATALOG_ITEM_NOT_FOUND_MESSAGE,
  BillingRepository,
  type BillingTx,
  type InvoiceLineRow,
  type InvoiceLineWriteData,
  type InvoiceListFilters,
  type InvoiceRow,
} from "./billing.repository.js";
import { BILLING_DTO_SCHEMA_VERSION, type CreateInvoiceInput } from "./billing.zod.js";

/**
 * Everything the audited invoice mutation closure needs from its transaction
 * handle. Declared structurally (not as `Prisma.TransactionClient`) so the real
 * client and the shared in-memory boundary both satisfy it: this module's own
 * repository seam, the sibling {@link SaleRepository} seam the source sale is
 * read through, and `auditLog` the append-only {@link AuditWriter}, so the
 * invoice, its lines and its audit row commit atomically.
 */
export type BillingWriteTx = SaleTx & BillingTx & { auditLog: AuditAppendTx["auditLog"] };

export interface BillingPrisma {
  $transaction: <T>(work: (tx: BillingWriteTx) => Promise<T>) => Promise<T>;
}

/**
 * Audit action code for the one invoice mutation of this slice. The repository's
 * established shape is `<singular_entity_snake>.<past_verb>`, so the invoice
 * entity is spelled `invoice` and `targetType` matches it. Reads are never
 * audited, and BILL-003 owns the confirm/cancel actions.
 */
export const INVOICE_CREATED_ACTION = "invoice.created";
export const INVOICE_CONFIRMED_ACTION = "invoice.confirmed";
export const INVOICE_TARGET_TYPE = "invoice";

/**
 * Stable `403 FEATURE_NOT_ENTITLED` message for a tenant without the `billing`
 * capability (DEC-040). The entitlement is asserted BEFORE the granular
 * permission, over the whole surface including reads, exactly as the
 * sales/cash/clinical modules do.
 */
export const BILLING_FEATURE_NOT_ENTITLED_MESSAGE =
  "Billing features are not enabled for this tenant.";

/**
 * Stable `409 CONFLICT` message for a create against a sale whose status is not
 * `COMPLETED` (DEC-038). An invoice always originates in exactly one completed
 * sale, so a `DRAFT` or `CANCELLED` sale is a well-formed request against an
 * existing in-tenant resource whose OWN state forbids the command — `409`, never
 * `404` (which would mask a real sale) and never `400`.
 */
export const INVOICE_SALE_NOT_COMPLETED_MESSAGE = "Only a completed sale can be invoiced.";

/**
 * Stable `409 CONFLICT` message for a create blocked by the
 * `sales.requireCustomerForInvoice` tenant setting when the source sale is a
 * walk-in (no customer). The setting is read through the typed settings service,
 * never from raw JSON (DEC-038).
 */
export const INVOICE_CUSTOMER_REQUIRED_MESSAGE =
  "This tenant requires a customer before an invoice can be issued.";

/**
 * Stable `409 CONFLICT` message for a second LIVE invoice on one sale. It is the
 * translation of the partial unique index `invoice_tenant_id_sale_id_key`
 * (`(tenant_id, sale_id) WHERE status <> 'CANCELLED'`); a cancelled invoice
 * releases its sale and is admitted as a replacement (DEC-043). There is no
 * service-level pre-check: the rule is enforced by the database.
 */
export const INVOICE_SALE_ALREADY_INVOICED_MESSAGE = "This sale already has an invoice.";

/**
 * Stable `409 CONFLICT` message shared by BOTH non-`DRAFT` confirm rejections
 * (DEC-041): a `CANCELLED` invoice is terminal, and the zero-row conditional
 * transition is a lost concurrent-confirm race. One message is the shipped
 * precedent (the sale `complete`/`cancel` and the cash close share a single
 * message across their pre-lock gate and their post-lock backstop), and it
 * keeps the two rejection paths byte-equivalent instead of leaking which
 * interleaving happened.
 */
export const INVOICE_NOT_DRAFT_MESSAGE = "Only a draft invoice can be confirmed.";

/**
 * Stable `409 CONFLICT` message for a copied line description that does not fit
 * `invoice_line.description` (`VarChar(200)`) while `catalog_item.name` is
 * unbounded. The document is NEVER truncated silently: a caller-visible
 * rejection is preferable to a silently shortened snapshot (TD-024).
 */
export const INVOICE_LINE_DESCRIPTION_TOO_LONG_MESSAGE =
  "An invoice line description exceeds the supported length.";

/**
 * Stable `400 VALIDATION_FAILED` message for a `sales` namespace whose
 * `requireCustomerForInvoice` did not narrow to a boolean. The typed settings
 * service already validates the stored namespace, so this defence in depth
 * mirrors `SalesService.resolveCurrency`'s narrowing and keeps a stored anomaly
 * from silently weakening the gate.
 */
export const INVOICE_SETTINGS_INVALID_MESSAGE =
  "The sales settings do not provide a usable invoicing policy.";

/**
 * `invoice_line.description` column width (`VarChar(200)`). Kept as a named
 * constant so the boundary check and the column guard cannot drift apart.
 */
export const INVOICE_LINE_DESCRIPTION_MAX_LENGTH = 200;

/**
 * Fixed scales of the line decimals, in digits after the point. Both are the
 * column scales (`Decimal(10, 3)` and `Decimal(14, 2)`), and the copied value is
 * already at that scale, so the projection can PAD but never round.
 */
const INVOICE_QUANTITY_SCALE = 3;
const INVOICE_MONEY_SCALE = 2;

/**
 * Audit field NAMES for an invoice create. `changedFields` carries NAMES only:
 * the sale/customer references, the currency and the line snapshot are INTERNAL
 * or CONFIDENTIAL, but no stored value is copied into the trail — ids and field
 * names are all the row carries (PRD §27/§41).
 */
const INVOICE_CREATE_CHANGED_FIELDS: readonly string[] = [
  "saleId",
  "customerId",
  "currency",
  "lines",
];

/**
 * Audit field NAMES for one invoice confirmation. `changedFields` carries NAMES
 * only: the allocated number, the status and the confirmation timestamp are
 * INTERNAL (PRD §41), but no stored value is copied into the trail — the action,
 * the invoice id and the field names are all the row carries.
 */
const INVOICE_CONFIRM_CHANGED_FIELDS: readonly string[] = ["status", "number", "confirmedAt"];

/**
 * Exact partial unique index behind the one-live-invoice-per-sale rule:
 * `CREATE UNIQUE INDEX "invoice_tenant_id_sale_id_key" ON "invoice"("tenant_id",
 * "sale_id") WHERE "status" <> 'CANCELLED'`. The partial `WHERE` predicate is
 * why the index cannot be expressed in the Prisma schema and lives as raw SQL in
 * the BILL-001 migration.
 */
const INVOICE_SALE_UNIQUE_CONSTRAINT = "invoice_tenant_id_sale_id_key";

/** The partial index columns/fields, normalized once for shape-agnostic matching. */
const INVOICE_SALE_UNIQUE_FIELDS: readonly string[] = ["tenantid", "saleid"];

function normalizeUniqueTargetToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * True only for a `P2002` raised by the partial one-live-invoice index — never
 * for an unrelated `P2002` such as the allocation key, which must propagate
 * untouched. Prisma reports `meta.target` either as the violated index name or
 * as the violated column/field names; both shapes are recognized (the
 * CashService matcher is the precedent).
 */
function isInvoiceSaleConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") {
    return false;
  }

  const target = candidate.meta?.target;
  const expectedConstraint = normalizeUniqueTargetToken(INVOICE_SALE_UNIQUE_CONSTRAINT);
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
    normalized.length === INVOICE_SALE_UNIQUE_FIELDS.length &&
    INVOICE_SALE_UNIQUE_FIELDS.every((field) => normalized.includes(field))
  );
}

/** Exact `Decimal` → fixed-scale string projection (never a JavaScript float). */
function decimalToScaleString(value: Prisma.Decimal | string, scale: number): string {
  return new Prisma.Decimal(value).toFixed(scale);
}

/**
 * Code-point length of a description. PostgreSQL `VarChar(200)` counts
 * CHARACTERS, so a surrogate pair counts once — the boundary check must measure
 * the same thing as the column it protects.
 */
function characterLength(value: string): number {
  return [...value].length;
}

/**
 * Builds the invoice line writes from the source sale's frozen snapshot.
 *
 * ORDER: the lines are walked in stable ascending `catalogItemId` order (the
 * order the completion command fixes), so the document's frozen `position`
 * values do NOT depend on an unordered relation read and the same sale always
 * produces the same document layout.
 *
 * VALUES: every money and quantity value is copied VERBATIM from the frozen
 * `SaleLine` — no conversion, no re-rounding and no arithmetic (DEC-038). The
 * only derived field is `description`, which comes from the source catalog
 * item's name because `SaleLine` carries no description; a description that does
 * not fit the `VarChar(200)` column is a stable `409` instead of a silent
 * truncation.
 */
function buildInvoiceLines(
  saleLines: readonly SaleLineRow[],
  names: ReadonlyMap<string, string>
): InvoiceLineWriteData[] {
  const ordered = [...saleLines].sort((left, right) =>
    left.catalogItemId.localeCompare(right.catalogItemId)
  );

  return ordered.map((line, position) => {
    const description = names.get(line.catalogItemId);
    if (description === undefined) {
      // Unreachable through the request path: readCatalogItemNames already
      // proved every id resolved. Kept so no code path can persist a document
      // with a fabricated description.
      throw new DomainError("CONFLICT", INVOICE_CATALOG_ITEM_NOT_FOUND_MESSAGE);
    }
    if (characterLength(description) > INVOICE_LINE_DESCRIPTION_MAX_LENGTH) {
      throw new DomainError("CONFLICT", INVOICE_LINE_DESCRIPTION_TOO_LONG_MESSAGE);
    }
    return {
      catalogItemId: line.catalogItemId,
      position,
      description,
      rateCode: line.rateCode,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      lineTotal: line.lineTotal,
      taxableBase: line.taxableBase,
      taxAmount: line.taxAmount,
    };
  });
}

/** Maps one line row to its allowlisted INTERNAL projected line. */
function toInvoiceLineResponse(line: InvoiceLineRow): InvoiceLineResponse {
  return {
    id: line.id,
    catalogItemId: line.catalogItemId,
    position: line.position,
    description: line.description,
    rateCode: line.rateCode,
    unitPrice: decimalToScaleString(line.unitPrice, INVOICE_MONEY_SCALE),
    quantity: decimalToScaleString(line.quantity, INVOICE_QUANTITY_SCALE),
    lineTotal: decimalToScaleString(line.lineTotal, INVOICE_MONEY_SCALE),
    taxableBase: decimalToScaleString(line.taxableBase, INVOICE_MONEY_SCALE),
    taxAmount: decimalToScaleString(line.taxAmount, INVOICE_MONEY_SCALE),
  };
}

/** Maps one aggregate row to its allowlisted INTERNAL response DTO. */
function toInvoiceResponse(row: InvoiceRow): InvoiceResponse {
  // `total` and `taxTotal` are PROJECTIONS of the invoice's OWN immutable
  // snapshot lines — summed with exact decimals, never recomputed from a rate,
  // a price or any pricing rule (which Billing is forbidden to apply, DEC-038).
  // The invoice stores no header total, so the projection can never disagree
  // with the lines it describes.
  const total = row.lines.reduce(
    (sum, line) => sum.plus(new Prisma.Decimal(line.lineTotal)),
    new Prisma.Decimal(0)
  );
  const taxTotal = row.lines.reduce(
    (sum, line) => sum.plus(new Prisma.Decimal(line.taxAmount)),
    new Prisma.Decimal(0)
  );

  return {
    id: row.id,
    saleId: row.saleId,
    customerId: row.customerId,
    currency: row.currency,
    status: row.status,
    series: row.series,
    number: row.number,
    confirmedAt: row.confirmedAt === null ? null : row.confirmedAt.toISOString(),
    cancelledAt: row.cancelledAt === null ? null : row.cancelledAt.toISOString(),
    cancelReason: row.cancelReason,
    lines: row.lines.map(toInvoiceLineResponse),
    total: total.toFixed(INVOICE_MONEY_SCALE),
    taxTotal: taxTotal.toFixed(INVOICE_MONEY_SCALE),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Billing application boundary (EPIC-14 BILL-002): the create command that turns
 * exactly one `COMPLETED` in-tenant sale into one `DRAFT` invoice, plus the two
 * tenant-scoped reads that describe it (`listInvoices`, `getInvoice`).
 *
 * - The `billing` entitlement is asserted FIRST (`403 FEATURE_NOT_ENTITLED`) and
 *   the route-level permission is RE-ASSERTED SECOND (`403 FORBIDDEN`), on every
 *   method including reads (DEC-040). A denial reaches no data access, so nothing
 *   is persisted and no audit row is appended.
 * - Tenant identity comes exclusively from `RequestContextService`; the source
 *   sale is read through the tenant-predicated {@link SaleRepository}, so a
 *   foreign or unknown sale is the shared byte-equivalent sale `404`.
 * - The command performs NO money arithmetic and trusts no caller-computed
 *   amount: the currency and the customer are inherited from the sale and every
 *   line value is copied verbatim from the frozen snapshot (DEC-038). The
 *   invoice is `DRAFT` by schema default, carries the database-default series
 *   and has NO number — allocation belongs to confirmation (DEC-039).
 * - The invoice is IMMUTABLE from creation: there is no edit and no delete
 *   path here. BILL-003 W2 ships the ONE explicit `confirm` transition (row lock
 *   + atomic number allocation + conditional state write + one audit row);
 *   cancellation stays BILL-003 W3 (DEC-038/DEC-039/DEC-041/DEC-043).
 * - The reads run the SAME gate order as the command — entitlement first,
 *   permission second — and are pure: no audit row is appended and no row is
 *   mutated. A foreign or unknown invoice id is the shared `404`, so every
 *   invoice `404` is byte-equivalent by construction.
 * - Reference-state gates are deliberately absent: a customer or catalog item
 *   deactivated AFTER the sale must never make a completed sale un-invoiceable.
 * - The command appends exactly ONE audit row through {@link AuditWriter},
 *   INSIDE the same transaction as the invoice write, carrying stable ids and
 *   field NAMES only. A rejection persists nothing — no invoice, no line and no
 *   audit row. Confirmation is replay-safe by its own state gate and requires
 *   NO `Idempotency-Key` (DEC-041).
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly billing: BillingRepository,
    private readonly sales: SaleRepository,
    @Inject(PrismaService) private readonly prisma: BillingPrisma,
    private readonly settings: TenantSettingsService,
    private readonly entitlements: EntitlementsService,
    private readonly requestContext: RequestContextService,
    private readonly permissionResolver: PermissionResolver,
    private readonly audit: AuditWriter
  ) {}

  /**
   * Creates one `DRAFT` invoice from one `COMPLETED` sale of the caller's tenant
   * and co-commits its single audit row (DEC-038).
   *
   * ORDER: the `billing` entitlement and the `billing.create` permission are
   * asserted FIRST, outside the transaction, so a denial reaches no data access.
   * Inside ONE `$transaction` the command then:
   *
   * 1. reads the source sale tenant-scoped — a foreign or unknown id is the
   *    shared sale `404`;
   * 2. applies the `COMPLETED`-only gate — any other status is the stable `409`;
   * 3. reads `sales.requireCustomerForInvoice` through the typed settings
   *    service and rejects a walk-in sale when the tenant requires a customer;
   * 4. resolves every line's catalog name in ONE tenant-predicated query and
   *    builds the snapshot lines, copying the frozen values verbatim and
   *    rejecting an over-long description;
   * 5. writes the invoice with its nested lines;
   * 6. appends exactly ONE audit row.
   *
   * A second live invoice for the same sale violates the partial unique index
   * and is translated into the stable `409`; a cancelled invoice releases its
   * sale. Any rejection rolls the whole transaction back.
   */
  async create(input: CreateInvoiceInput): Promise<InvoiceResponse> {
    await this.assertBillingEnabled();
    await this.requirePermission(BILLING_PERMISSIONS.create);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // Tenant-safe resolution: a foreign or unknown sale is the shared 404.
        const sale = await this.sales.findById(input.saleId, tx);

        if (sale.status !== "COMPLETED") {
          throw new DomainError("CONFLICT", INVOICE_SALE_NOT_COMPLETED_MESSAGE);
        }

        if ((await this.requireCustomerForInvoice()) && sale.customerId === null) {
          throw new DomainError("CONFLICT", INVOICE_CUSTOMER_REQUIRED_MESSAGE);
        }

        const names = await this.billing.readCatalogItemNames(
          sale.lines.map((line) => line.catalogItemId),
          tx
        );
        const lines = buildInvoiceLines(sale.lines, names);

        const created = await this.billing.create(
          {
            saleId: sale.id,
            customerId: sale.customerId,
            currency: sale.currency,
            lines,
          },
          tx
        );

        await this.audit.append(
          {
            action: INVOICE_CREATED_ACTION,
            // The resource's OWN tenant, resolved by the repository from the
            // request context — never a caller-supplied value.
            tenantId: created.tenantId,
            actorUserProfileId,
            targetType: INVOICE_TARGET_TYPE,
            targetId: created.id,
            metadata: {
              schemaVersion: BILLING_DTO_SCHEMA_VERSION,
              changedFields: [...INVOICE_CREATE_CHANGED_FIELDS],
            },
          },
          tx
        );

        return created;
      });

      return toInvoiceResponse(row);
    } catch (error) {
      // The partial one-live-invoice index rejected a second invoice for this
      // sale: surface the stable 409 instead of leaking the raw P2002 as an
      // INTERNAL 500. Anything else (an unrelated P2002, a shared 404, a
      // settings rejection, an audit failure) propagates unchanged, and the
      // transaction rollback leaves the state untouched.
      if (isInvoiceSaleConflict(error)) {
        throw new DomainError("CONFLICT", INVOICE_SALE_ALREADY_INVOICED_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * The caller tenant's invoices with their lines, newest first, optionally
   * narrowed by status (EPIC-14 BILL-002 W3). An omitted filter applies NO
   * implicit default, and there is no pagination: the shipped sales/cash list
   * precedent.
   *
   * The gate order is the SAME one the create path and the sibling sales reads
   * use: the `billing` entitlement FIRST (`403 FEATURE_NOT_ENTITLED`) and the
   * `billing.read` permission SECOND (`403 FORBIDDEN`). A denial reaches no data
   * access, so this pure read never touches a row.
   */
  async listInvoices(filters: InvoiceListFilters = {}): Promise<InvoiceResponse[]> {
    await this.assertBillingEnabled();
    await this.requirePermission(BILLING_PERMISSIONS.read);
    const rows = await this.billing.list(filters);
    return rows.map(toInvoiceResponse);
  }

  /**
   * One invoice of the caller tenant with its lines, addressed by id. A foreign
   * or unknown UUID is the SAME `404` with the repository's single message, so
   * the two masks are byte-equivalent by construction and no other tenant's
   * document is ever described.
   *
   * The gate order is the list's: entitlement first, `billing.read` second.
   */
  async getInvoice(id: string): Promise<InvoiceResponse> {
    await this.assertBillingEnabled();
    await this.requirePermission(BILLING_PERMISSIONS.read);
    const row = await this.billing.findById(id);
    return toInvoiceResponse(row);
  }

  /**
   * Confirms one `DRAFT` invoice of the caller tenant and co-commits its single
   * audit row: the number allocation and the `DRAFT -> CONFIRMED` transition
   * commit together or not at all (DEC-039, DEC-041).
   *
   * ORDER: the `billing` entitlement and the `billing.confirm` permission are
   * asserted FIRST, outside the transaction, exactly like the creation path, so
   * a denial reaches no data access. Inside ONE `$transaction` the command then:
   *
   * 1. row-locks the invoice HEADER (`SELECT ... FOR UPDATE`), which is the
   *    PRIMARY serialization against a concurrent confirm;
   * 2. reads the invoice tenant-scoped AFTER the lock — a foreign or unknown id
   *    is the shared byte-equivalent `404` — and branches on the LOCKED status:
   *    - `CONFIRMED` is a REPLAY (DEC-041): the row is returned UNCHANGED, with
   *      no allocation and no second audit row, so a retry can never consume a
   *      number (which would make a later invoice skip one);
   *    - `CANCELLED` is terminal and rejected with the stable `409`, persisting
   *      nothing;
   *    - `DRAFT` allocates the number and applies the conditional transition; a
   *      zero-row result is a lost concurrent-confirm race and the same stable
   *      `409`, never a silent success;
   * 3. appends exactly ONE audit row on a REAL transition;
   * 4. re-reads the invoice and returns its allowlisted DTO with `series`,
   *    `number`, `status: "CONFIRMED"` and `confirmedAt` populated.
   *
   * The command writes NO line, NO amount, NO payment, NO cash, NO stock and NO
   * fiscal state, and emits NO event: it changes only the header's own status,
   * number and confirmation timestamp (DEC-041, DEC-042).
   */
  async confirmInvoice(id: string): Promise<InvoiceResponse> {
    await this.assertBillingEnabled();
    await this.requirePermission(BILLING_PERMISSIONS.confirm);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      // PRIMARY serialization: row-lock the invoice HEADER before anything else,
      // so two concurrent confirms of the SAME invoice serialize here and the
      // loser's post-lock read sees the winner's committed `CONFIRMED` status.
      await this.billing.lockById(id, tx);

      // POST-LOCK authoritative read: a foreign or unknown id resolves here as
      // the shared byte-equivalent `404` and writes nothing.
      const locked = await this.billing.findById(id, tx);

      // A retried confirm on an already `CONFIRMED` invoice is a PURE REPLAY:
      // the row is returned unchanged and NOTHING is written — no allocation,
      // no state change and no second audit row (DEC-041).
      if (locked.status === "CONFIRMED") {
        return locked;
      }

      // A cancelled invoice is terminal (DEC-043): the stable `409`, nothing
      // written.
      if (locked.status === "CANCELLED") {
        throw new DomainError("CONFLICT", INVOICE_NOT_DRAFT_MESSAGE);
      }

      // The allocation is ONE atomic statement that also creates the counter row
      // when the tenant has none, so no read-then-write window exists (DEC-039).
      const number = await this.billing.allocateNumber(locked.series, tx);

      // The conditional `WHERE status = 'DRAFT'` write is the backstop of the
      // serialization: a zero-row result means the stored status was not `DRAFT`
      // after all, which is a lost race and rejects with the same stable `409`.
      const applied = await this.billing.markConfirmed(id, number, tx);
      if (applied === 0) {
        throw new DomainError("CONFLICT", INVOICE_NOT_DRAFT_MESSAGE);
      }

      const confirmed = await this.billing.findById(id, tx);

      await this.audit.append(
        {
          action: INVOICE_CONFIRMED_ACTION,
          // The resource's OWN tenant, resolved by the repository from the
          // request context — never a caller-supplied value.
          tenantId: confirmed.tenantId,
          actorUserProfileId,
          targetType: INVOICE_TARGET_TYPE,
          targetId: confirmed.id,
          metadata: {
            schemaVersion: BILLING_DTO_SCHEMA_VERSION,
            changedFields: [...INVOICE_CONFIRM_CHANGED_FIELDS],
          },
        },
        tx
      );

      return confirmed;
    });

    return toInvoiceResponse(row);
  }

  /**
   * Resolves the server-owned tenant and asserts the `billing` entitlement FIRST
   * (DEC-040). `FEATURE_NOT_ENTITLED` (403) is the only rejection path; no
   * generic feature guard is introduced, matching the sales/cash copy.
   */
  private async assertBillingEnabled(): Promise<void> {
    const tenantId = this.requestContext.requireTenantId();
    if (!(await this.entitlements.has(tenantId, "billing"))) {
      throw new DomainError("FEATURE_NOT_ENTITLED", BILLING_FEATURE_NOT_ENTITLED_MESSAGE);
    }
  }

  /**
   * Defense-in-depth permission gate applied AFTER the entitlement, for every
   * operation including reads. A missing permission is `403 FORBIDDEN` and
   * reaches no data access.
   */
  private async requirePermission(permission: BillingPermission): Promise<void> {
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(permission)) {
      throw new DomainError("FORBIDDEN", "The required billing permission is missing.");
    }
  }

  /**
   * The server-owned `sales.requireCustomerForInvoice` policy, read through the
   * typed settings service (never raw JSON) and narrowed with a `typeof`
   * defence mirroring `SalesService.resolveCurrency`. Anomalous stored data is a
   * stable `400` rather than a silently disabled gate.
   */
  private async requireCustomerForInvoice(): Promise<boolean> {
    const settings = await this.settings.get("sales");
    const flag = settings.requireCustomerForInvoice;
    if (typeof flag !== "boolean") {
      throw new DomainError("VALIDATION_FAILED", INVOICE_SETTINGS_INVALID_MESSAGE);
    }
    return flag;
  }
}
