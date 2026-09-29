import { Inject, Injectable } from "@nestjs/common";
// Value import (not `import type`): `PrismaService` is the DI token, and
// `Prisma` provides the exact `Decimal` type of the line decimals.
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import type { CatalogItemDelegate } from "../catalog/catalog.repository.js";
import { RequestContextService } from "../context/request-context.service.js";

/**
 * Lifecycle values pinned by schema enum `sale_status` (PRD §18). Kept as a
 * local literal union so this boundary stays decoupled from the generated
 * client namespace (structural compatibility only).
 */
export type SaleStatusValue = "DRAFT" | "COMPLETED" | "CANCELLED";

/**
 * Persistence row for one tenant-scoped sale line as the read boundary sees it.
 * `quantity` is an exact `Decimal(10, 3)` and the four money amounts are exact
 * `Decimal(14, 2)` — `Prisma.Decimal` at runtime, a plain exact string in the
 * in-memory fake — and are NEVER coerced to a JavaScript float.
 */
export interface SaleLineRow {
  id: string;
  tenantId: string;
  saleId: string;
  catalogItemId: string;
  rateCode: string;
  unitPrice: Prisma.Decimal | string;
  quantity: Prisma.Decimal | string;
  lineTotal: Prisma.Decimal | string;
  taxableBase: Prisma.Decimal | string;
  taxAmount: Prisma.Decimal | string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Persistence row for a tenant-scoped sale WITH its line set. Reads always load
 * the lines, so a caller never has to make a second query to describe the
 * aggregate. There is deliberately no number, discount, appointment, patient or
 * total field (DEC-021/DEC-027/DEC-028).
 */
export interface SaleRow {
  id: string;
  tenantId: string;
  customerId: string | null;
  currency: string;
  status: SaleStatusValue;
  lines: SaleLineRow[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Write payload for one line of {@link SaleRepository.create} and
 * {@link SaleRepository.reconcileLines}. There is deliberately NO `tenantId`
 * and NO `saleId` field: both are resolved server-side and placed by this
 * repository, so a caller argument cannot re-scope a line. The money amounts
 * are already exact fixed-scale strings computed by the pricing arithmetic.
 */
export interface SaleLineWriteData {
  readonly catalogItemId: string;
  readonly rateCode: string;
  readonly unitPrice: string;
  readonly quantity: string;
  readonly lineTotal: string;
  readonly taxableBase: string;
  readonly taxAmount: string;
}

/**
 * Write payload for {@link SaleRepository.create}. There is deliberately NO
 * `tenantId` field: tenant identity comes from the request context. The
 * `currency` is the server-resolved `sales.defaultCurrency` (DEC-022), never
 * caller input, and no `status` field exists because a new sale is `DRAFT`.
 */
export interface SaleCreateData {
  readonly customerId?: string | null;
  readonly currency: string;
  readonly lines: readonly SaleLineWriteData[];
}

/** Supported read filters for {@link SaleRepository.list}. */
export interface SaleListFilters {
  status?: SaleStatusValue;
}

/** Predicate fields the tenant-scoped queries are allowed to build. */
export interface SaleWhere {
  id?: string;
  tenantId?: string;
  status?: SaleStatusValue;
}

/**
 * Raw-SQL seam for the transaction-scoped sale header row lock. Declared
 * structurally (the inventory/purchase raw-seam convention) so the generated
 * client and the shared in-memory boundary both satisfy it. The in-memory
 * boundary models `SELECT ... FOR UPDATE` as a plain read because a synchronous
 * map cannot interleave, so the real serialization proof stays
 * live-PostgreSQL-owned.
 */
export interface SaleRawClient {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
}

/** Deterministic ordering clauses accepted by {@link SaleDelegate.findMany}. */
export type SaleOrderBy = { createdAt?: "asc" | "desc" } | { id?: "asc" | "desc" };

/**
 * Structural contract for the sale delegate. The generated client and the
 * in-memory test fake both satisfy it, keeping this repository independent of
 * the generated model namespace (the customer/catalog/inventory/supplier
 * convention). Every read loads the line set.
 */
export interface SaleDelegate {
  findFirst: (args: { where: SaleWhere; include: { lines: true } }) => Promise<SaleRow | null>;
  findMany: (args: {
    where: SaleWhere;
    include: { lines: true };
    orderBy?: SaleOrderBy[];
  }) => Promise<SaleRow[]>;
  create: (args: {
    data: {
      customerId?: string | null;
      currency: string;
      tenantId: string;
      lines: { create: readonly SaleLineWriteData[] };
    };
    include: { lines: true };
  }) => Promise<SaleRow>;
  updateMany: (args: {
    where: SaleWhere;
    data: { customerId?: string | null; status?: SaleStatusValue };
  }) => Promise<{ count: number }>;
}

/**
 * The three frozen money amounts a completion recomputes and writes onto a line
 * (resolutions 2 of 2026-09-29, DEC-021). `rateCode`, `unitPrice` and `quantity`
 * are the ALREADY-frozen inputs and are not rewritten; only the derived snapshot
 * moves.
 */
export interface SaleLineSnapshotData {
  readonly lineTotal: string;
  readonly taxableBase: string;
  readonly taxAmount: string;
}

/**
 * Structural contract for the line delegate. It exposes the two draft
 * mutations and the completion snapshot write, and NO delete of a sale. The
 * snapshot `updateMany` is tenant-scoped on `(tenantId, saleId, catalogItemId)`,
 * so a completion can never rewrite another tenant's or another sale's line,
 * and zero matched rows is the caller's signal that the line set moved.
 */
export interface SaleLineDelegate {
  deleteMany: (args: {
    where: { tenantId: string; saleId: string; catalogItemId: { notIn: string[] } };
  }) => Promise<{ count: number }>;
  upsert: (args: {
    where: {
      tenantId_saleId_catalogItemId: {
        tenantId: string;
        saleId: string;
        catalogItemId: string;
      };
    };
    create: SaleLineWriteData & { tenantId: string; saleId: string };
    update: Omit<SaleLineWriteData, "catalogItemId">;
  }) => Promise<SaleLineRow>;
  updateMany: (args: {
    where: { tenantId: string; saleId: string; catalogItemId: string };
    data: SaleLineSnapshotData;
  }) => Promise<{ count: number }>;
}

/**
 * Structural contract for the in-tenant customer reference check. `isActive` is
 * carried because the completion command validates reference state (resolution 1
 * of 2026-09-29): an inactive customer rejects a completion with a stable `409`,
 * while an unknown or foreign one is the shared `404`. Only the id and the flag
 * are needed: the sale stores the reference, not a copy of the customer.
 */
export interface SaleCustomerLookup {
  findFirst: (args: {
    where: { id: string; tenantId: string };
  }) => Promise<{ id: string; isActive: boolean } | null>;
}

/**
 * Row shape of the GLOBAL tax-rate reference. `rate` is an exact
 * `Prisma.Decimal` at runtime (a plain string is accepted by test fakes); it is
 * never coerced to a float.
 */
export interface SaleTaxRateRow {
  id: string;
  code: string;
  name: string;
  rate: Prisma.Decimal | string;
}

/**
 * Structural contract for the GLOBAL tax-rate lookup. `tax_rate` is shared
 * reference data with no tenant predicate; the item's `taxRateId` resolves to
 * the frozen `code` and `rate` the line snapshot stores (DEC-021).
 */
export interface SaleTaxRateDelegate {
  findFirst: (args: { where: { id?: string; code?: string } }) => Promise<SaleTaxRateRow | null>;
}

/**
 * Payment method values pinned by schema enum `payment_method` (PRD §19). Kept
 * as a local literal union so this boundary stays decoupled from the generated
 * client namespace (structural compatibility only).
 */
export type PaymentMethodValue = "CASH" | "CARD" | "BANK_TRANSFER" | "QR" | "CHECK" | "OTHER";

/**
 * Persistence row for one tenant-scoped payment as the read boundary sees it
 * (PRD §19, DEC-029). `amount` is an exact `Decimal(14, 2)` — `Prisma.Decimal`
 * at runtime, a plain exact string in the in-memory fake — and is NEVER coerced
 * to a JavaScript float. There is deliberately no tendered amount, change or
 * refunded amount (DEC-029).
 */
export interface PaymentRow {
  id: string;
  tenantId: string;
  saleId: string;
  method: PaymentMethodValue;
  amount: Prisma.Decimal | string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Write payload for {@link SaleRepository.createPayments}. There is deliberately
 * NO `tenantId` and NO `saleId`: both are resolved by the inserting method, so a
 * caller argument cannot re-scope a payment. The amount is already an exact
 * fixed-scale string validated by the request contract.
 */
export interface PaymentWriteData {
  readonly method: PaymentMethodValue;
  readonly amount: string;
}

/**
 * Structural contract for the payment delegate. `create` is the ONLY mutation
 * and `findMany` the only read: a completed payment is immutable (no update, no
 * delete), matching the migration's confirmation-time triggers. Nothing in
 * POS-001 writes one; the completion transaction is the single write path.
 */
export interface PaymentDelegate {
  create: (args: {
    data: { tenantId: string; saleId: string; method: PaymentMethodValue; amount: string };
  }) => Promise<PaymentRow>;
  findMany: (args: {
    where: { tenantId: string; saleId: string };
    orderBy?: readonly { createdAt?: "asc" | "desc"; id?: "asc" | "desc" }[];
  }) => Promise<PaymentRow[]>;
}

/**
 * Persistence row for the tenant-scoped idempotency record (DEC-024). One row
 * per accepted command execution, unique per `(tenant, operation, key)`. The
 * result reference is the sale id, re-read inside the caller's tenant on replay
 * rather than storing a response snapshot (2026-09-29 resolution note).
 */
export interface IdempotencyRecordRow {
  id: string;
  tenantId: string;
  operation: string;
  key: string;
  fingerprint: string;
  resultSaleId: string;
  createdAt: Date;
}

/**
 * Write payload for {@link SaleRepository.createIdempotencyRecord}. There is
 * deliberately NO `tenantId`: tenant identity comes from the request context, so
 * a caller argument cannot re-scope the record. The operation token, key and
 * fingerprint are all supplied by the completion command.
 */
export interface IdempotencyRecordCreateData {
  readonly operation: string;
  readonly key: string;
  readonly fingerprint: string;
  readonly resultSaleId: string;
}

/**
 * Structural contract for the idempotency delegate. `create` is the only
 * mutation — the row is append-only (no update, no delete; PRD §41) — and
 * `findFirst` resolves the `(tenant, operation, key)` replay key.
 */
export interface IdempotencyRecordDelegate {
  findFirst: (args: {
    where: { tenantId: string; operation: string; key: string };
  }) => Promise<IdempotencyRecordRow | null>;
  create: (args: {
    data: IdempotencyRecordCreateData & { tenantId: string };
  }) => Promise<IdempotencyRecordRow>;
}

/**
 * The delegate set this repository touches. Doubles as the optional transaction
 * seam: the audited service passes its open transaction handle here so the sale
 * change and its audit row co-commit. Extends the raw seam because the update
 * and cancel commands row-lock the sale header through it. `catalogItem` is
 * carried so the same transaction handle also satisfies the locally-provided
 * {@link CatalogRepository} the service resolves items through, and `payment`
 * and `idempotencyRecord` carry the POS-003 completion writes.
 */
export interface SaleTx extends SaleRawClient {
  sale: SaleDelegate;
  saleLine: SaleLineDelegate;
  customer: SaleCustomerLookup;
  catalogItem: CatalogItemDelegate;
  taxRate: SaleTaxRateDelegate;
  payment: PaymentDelegate;
  idempotencyRecord: IdempotencyRecordDelegate;
}

/** Single stable message behind every sale 404 — byte-equivalence by construction. */
export const SALE_NOT_FOUND_MESSAGE = "Sale was not found.";

/** Single stable message behind every unresolved sale customer reference. */
export const SALE_CUSTOMER_NOT_FOUND_MESSAGE = "The sale customer was not found.";

/**
 * Tenant-safe data access for the tenant-scoped `Sale` aggregate (EPIC-12
 * POS-001).
 *
 * Contract: every query carries the tenant predicate IMPLICITLY via
 * `requestContext.requireTenantId()`. Call sites never hand-write tenant
 * filters and cannot forget them; when no tenant authority was resolved
 * server-side, `requireTenantId()` throws FORBIDDEN before any database call
 * happens. Zero matching rows ⇒ `DomainError("NOT_FOUND")` with ONE shared
 * message per resource, so a foreign record is indistinguishable from a missing
 * one and the service renders a byte-equivalent 404.
 *
 * There is deliberately NO delete method of any kind — a sale is never deleted
 * — and no method takes a caller-supplied tenant id. The line-set reconciliation
 * deletes LINES only, and only while the owning sale is `DRAFT`, which the
 * service asserts before calling it (DEC-023).
 *
 * The optional customer reference is resolved IN-TENANT through this same seam:
 * an unknown or foreign reference collapses to the shared customer-reference
 * 404, never to a bare foreign-key error.
 */
@Injectable()
export class SaleRepository {
  constructor(
    // Explicit @Inject token keeps DI resolution token-based while the PARAM
    // type stays the narrow delegate set this boundary actually needs.
    @Inject(PrismaService) private readonly prisma: SaleTx,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService
  ) {}

  /**
   * Resolves the referenced customer of the caller's active tenant. A foreign
   * or unknown id fails with the shared customer-reference NOT_FOUND, so the
   * sale can never store a reference it cannot read back. A `null`/absent
   * customer is a valid walk-in sale and never reaches this method (DEC-028).
   */
  async assertCustomerExists(id: string, tx?: SaleTx): Promise<void> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const row = await client.customer.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", SALE_CUSTOMER_NOT_FOUND_MESSAGE);
    }
  }

  /**
   * Resolves the GLOBAL tax-rate row of an item's required `taxRateId` so the
   * service can freeze its `code` and `rate` on the line (DEC-021). There is no
   * tenant predicate: `tax_rate` is shared reference data.
   */
  async findTaxRate(taxRateId: string, tx?: SaleTx): Promise<SaleTaxRateRow | null> {
    const client = tx ?? this.prisma;
    return client.taxRate.findFirst({ where: { id: taxRateId } });
  }

  /**
   * Resolves the line's FROZEN `rateCode` against the GLOBAL rate row so the
   * completion transaction can recompute the derived amounts from the already
   * frozen inputs (DEC-021). Like {@link findTaxRate} there is no tenant
   * predicate: `tax_rate` is shared reference data.
   */
  async findTaxRateByCode(code: string, tx?: SaleTx): Promise<SaleTaxRateRow | null> {
    const client = tx ?? this.prisma;
    return client.taxRate.findFirst({ where: { code } });
  }

  /**
   * Resolves an OPTIONAL customer reference of the caller's active tenant for
   * the completion reference-state gate (resolution 1 of 2026-09-29). Unlike
   * {@link assertCustomerExists} it returns the row (or `null`) instead of
   * throwing, so the completion command can distinguish an unknown or foreign
   * reference (the shared customer `404`) from an inactive one (a stable `409`).
   */
  async findCustomerReference(
    id: string,
    tx?: SaleTx
  ): Promise<{ id: string; isActive: boolean } | null> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.customer.findFirst({ where: { id, tenantId } });
  }

  /**
   * Creates one sale WITH its lines in the CALLER'S active tenant. `tenantId`
   * is resolved from the request context and placed LAST in the payload, so
   * even a rogue property on `data` cannot re-scope the insert; the nested line
   * create inherits the tenant and sale ids from the parent, so no line can land
   * in another tenant. The status is the schema default (`DRAFT`): nothing in
   * this slice can create a non-draft sale.
   */
  async create(data: SaleCreateData, tx?: SaleTx): Promise<SaleRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.sale.create({
      data: {
        customerId: data.customerId ?? null,
        currency: data.currency,
        tenantId,
        lines: {
          create: data.lines.map((line) => ({
            catalogItemId: line.catalogItemId,
            rateCode: line.rateCode,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            lineTotal: line.lineTotal,
            taxableBase: line.taxableBase,
            taxAmount: line.taxAmount,
          })),
        },
      },
      include: { lines: true },
    });
  }

  /**
   * One sale of the caller's active tenant by id, WITH its lines. The tenant
   * predicate rides along in the same WHERE clause, so foreign ids fall through
   * to the shared NOT_FOUND path instead of leaking existence.
   */
  async findById(id: string, tx?: SaleTx): Promise<SaleRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const row = await client.sale.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });
    if (!row) {
      throw new DomainError("NOT_FOUND", SALE_NOT_FOUND_MESSAGE);
    }
    return row;
  }

  /**
   * The caller's active-tenant sales, WITH their lines.
   *
   * DETERMINISTIC ORDER: newest first by `createdAt`, with `id` ascending as
   * the tiebreaker for rows created in the same millisecond — there is no
   * numbering column to sort on (DEC-027), so this pair is what makes the list
   * stable across reads. The optional `status` filter is applied on top of the
   * implicit tenant predicate; an omitted filter adds NO predicate, so this
   * layer owns no default visibility policy.
   */
  async list(filters: SaleListFilters = {}, tx?: SaleTx): Promise<SaleRow[]> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.sale.findMany({
      where: {
        tenantId,
        ...(filters.status !== undefined ? { status: filters.status } : {}),
      },
      include: { lines: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
  }

  /**
   * Updates the header (`customerId`) of one sale of the caller's active
   * tenant. Uses `updateMany` (not `update`) because Prisma's unique-WHERE
   * update could otherwise cross the tenant boundary when handed a foreign
   * primary key; the compound predicate keeps the write inside the tenant and
   * zero affected rows degrade to the shared NOT_FOUND envelope. `status` is NOT
   * writable here: the lifecycle has its own command.
   */
  async updateCustomer(id: string, customerId: string | null, tx?: SaleTx): Promise<void> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const result = await client.sale.updateMany({
      where: { id, tenantId },
      data: { customerId },
    });
    if (result.count === 0) {
      throw new DomainError("NOT_FOUND", SALE_NOT_FOUND_MESSAGE);
    }
  }

  /**
   * Reconciles the draft's line set BY `catalogItemId`: every stored line whose
   * item is absent from the submitted set is deleted, and every submitted line
   * is upserted on the `(tenantId, saleId, catalogItemId)` unique — so a matched
   * line is updated in place (its `id` is preserved) and a new item is inserted.
   * Both steps are tenant-scoped, and the caller has already proven the sale
   * exists, belongs to the caller's tenant and is `DRAFT`; this method therefore
   * never touches a completed or cancelled sale's lines (DEC-023).
   *
   * The submitted payload is AUTHORITATIVE for each matched line: the derived
   * amounts are recomputed on every write (POS-001 slice resolution 2), because
   * the operator must see line and sale totals while building the cart.
   */
  async reconcileLines(
    saleId: string,
    lines: readonly SaleLineWriteData[],
    tx?: SaleTx
  ): Promise<void> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;

    await client.saleLine.deleteMany({
      where: {
        tenantId,
        saleId,
        catalogItemId: { notIn: lines.map((line) => line.catalogItemId) },
      },
    });

    for (const line of lines) {
      await client.saleLine.upsert({
        where: {
          tenantId_saleId_catalogItemId: {
            tenantId,
            saleId,
            catalogItemId: line.catalogItemId,
          },
        },
        create: {
          tenantId,
          saleId,
          catalogItemId: line.catalogItemId,
          rateCode: line.rateCode,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
          lineTotal: line.lineTotal,
          taxableBase: line.taxableBase,
          taxAmount: line.taxAmount,
        },
        update: {
          rateCode: line.rateCode,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
          lineTotal: line.lineTotal,
          taxableBase: line.taxableBase,
          taxAmount: line.taxAmount,
        },
      });
    }
  }

  /**
   * Row-locks one sale HEADER of the caller's active tenant, identified by the
   * `(tenant_id, id)` pair, for the rest of the caller's open transaction.
   *
   * This is the PRIMARY serialization of the update and cancel commands: the
   * transaction takes the header lock BEFORE its post-lock status read, so two
   * concurrent mutations of the SAME sale serialize here — the loser blocks on
   * this row lock and its post-lock read then sees the winner's committed
   * status. That is the same order that closed the PUR-002 double-receive defect
   * and is what stops a concurrent cancel from interleaving with a line-set
   * rewrite. The lock is transaction-scoped, so a rolled-back command leaves
   * nothing locked.
   *
   * A zero-row match (unknown or foreign id, which by construction takes no
   * lock) is not an error here: the caller's subsequent tenant-scoped read is
   * what renders the shared byte-equivalent `404`. The in-memory boundary models
   * this as a plain read; the real interleaving is proven by the live-PostgreSQL
   * evidence owned by the next slice.
   */
  async lockById(id: string, tx?: SaleTx): Promise<void> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    // Explicit `::uuid` casts (the purchase/clinical row-lock precedent):
    // Prisma binds template values as `text`, so comparing them directly against
    // the `uuid` columns fails with `42883: operator does not exist: uuid =
    // text`.
    await client.$queryRaw`
      SELECT "id" FROM "sale"
      WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${id}::uuid
      FOR UPDATE
    `;
  }

  /**
   * The payments of one sale in the CALLER'S active tenant, in stable
   * chronological order with the `id` tiebreaker. The tenant predicate rides
   * along in the same WHERE clause, so a completion response can only ever
   * project payments of the sale whose header the caller already resolved.
   */
  async listPayments(saleId: string, tx?: SaleTx): Promise<PaymentRow[]> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.payment.findMany({
      where: { tenantId, saleId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  /**
   * Writes one payment row per submitted payment in the CALLER'S active tenant
   * (DEC-029). `tenantId` and `saleId` are resolved here, so even a rogue
   * property on a payment cannot re-scope the row. Payments are only written by
   * the completion transaction; no other path reaches this method.
   */
  async createPayments(
    saleId: string,
    payments: readonly PaymentWriteData[],
    tx?: SaleTx
  ): Promise<PaymentRow[]> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const created: PaymentRow[] = [];
    for (const payment of payments) {
      created.push(
        await client.payment.create({
          data: { tenantId, saleId, method: payment.method, amount: payment.amount },
        })
      );
    }
    return created;
  }

  /**
   * Freezes the recomputed derived snapshot onto each line, keyed on
   * `(tenantId, saleId, catalogItemId)` — the schema's tenant-leading unique.
   * The `rateCode`, `unitPrice` and `quantity` are NOT rewritten: they were
   * already frozen when the line joined the draft (resolution 2 of 2026-09-29),
   * and completion only re-derives and writes `lineTotal`, `taxableBase` and
   * `taxAmount`. A `COMPLETED` sale is never recomputed again.
   */
  async freezeLines(
    saleId: string,
    lines: readonly { catalogItemId: string; snapshot: SaleLineSnapshotData }[],
    tx?: SaleTx
  ): Promise<void> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    for (const line of lines) {
      await client.saleLine.updateMany({
        where: { tenantId, saleId, catalogItemId: line.catalogItemId },
        data: line.snapshot,
      });
    }
  }

  /**
   * Applies the `DRAFT` → `COMPLETED` transition of one sale of the caller's
   * active tenant.
   *
   * This write is the BACKSTOP of the completion serialization, not its primary
   * mechanism: {@link lockById}'s header row lock is what makes a concurrent
   * second completion observe the committed status. The write is still
   * conditional on the STORED status being `DRAFT`, so if that status were ever
   * not `DRAFT` the statement affects zero rows and returns `false`, which the
   * service maps to the same stable `409 CONFLICT` as any other non-`DRAFT`
   * sale. `COMPLETED` is the ONLY status this method can produce.
   */
  async complete(id: string, tx?: SaleTx): Promise<boolean> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const result = await client.sale.updateMany({
      where: { id, tenantId, status: "DRAFT" },
      data: { status: "COMPLETED" },
    });
    return result.count > 0;
  }

  /**
   * The idempotency record of one `(tenant, operation, key)` replay key in the
   * CALLER'S active tenant (DEC-024), or `null` when the operation has not run
   * with that key yet. The tenant predicate is part of the predicate, so the key
   * scope is the tenant and never global.
   */
  async findIdempotencyRecord(
    operation: string,
    key: string,
    tx?: SaleTx
  ): Promise<IdempotencyRecordRow | null> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.idempotencyRecord.findFirst({ where: { tenantId, operation, key } });
  }

  /**
   * Appends the `(tenant, operation, key)` idempotency record that makes an
   * identical replay return the prior result instead of a `409` (DEC-024).
   * `tenantId` is resolved from the request context and placed LAST, so a rogue
   * property cannot re-scope the row. The record is append-only: there is no
   * update and no delete (PRD §41).
   */
  async createIdempotencyRecord(
    data: IdempotencyRecordCreateData,
    tx?: SaleTx
  ): Promise<IdempotencyRecordRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.idempotencyRecord.create({
      data: {
        operation: data.operation,
        key: data.key,
        fingerprint: data.fingerprint,
        resultSaleId: data.resultSaleId,
        tenantId,
      },
    });
  }

  /**
   * Applies the `DRAFT` → `CANCELLED` transition of one sale of the caller's
   * active tenant.
   *
   * This write is the BACKSTOP of the cancel serialization, not its primary
   * mechanism: {@link lockById}'s header row lock is what makes a concurrent
   * second cancel observe the committed status. The write is still conditional
   * on the STORED status being `DRAFT`, so if that status were ever not `DRAFT`
   * the statement affects zero rows and returns `false`, which the service maps
   * to the same stable `409 CONFLICT` as any other non-`DRAFT` sale. It never
   * deletes the sale and never touches its lines.
   */
  async cancel(id: string, tx?: SaleTx): Promise<boolean> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const result = await client.sale.updateMany({
      where: { id, tenantId, status: "DRAFT" },
      data: { status: "CANCELLED" },
    });
    return result.count > 0;
  }
}
