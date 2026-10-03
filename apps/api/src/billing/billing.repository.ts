import { Inject, Injectable } from "@nestjs/common";
// Value import (not `import type`): `PrismaService` is the DI token, and
// `Prisma` provides the exact `Decimal` type of the copied line decimals.
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";

/**
 * Lifecycle values pinned by schema enum `invoice_status` (PRD §21, DEC-038).
 * Kept as a local literal union so this boundary stays decoupled from the
 * generated client namespace (structural compatibility only).
 */
export type InvoiceStatusValue = "DRAFT" | "CONFIRMED" | "CANCELLED";

/**
 * Persistence row for one tenant-scoped invoice line as the read boundary sees
 * it. `quantity` is an exact `Decimal(10, 3)` and the four money amounts are
 * exact `Decimal(14, 2)` — `Prisma.Decimal` at runtime, a plain exact string in
 * the in-memory fake — and are NEVER coerced to a JavaScript float. Every value
 * is a verbatim copy of the source `SaleLine` snapshot (DEC-038).
 */
export interface InvoiceLineRow {
  id: string;
  tenantId: string;
  invoiceId: string;
  catalogItemId: string;
  position: number;
  description: string;
  rateCode: string;
  unitPrice: Prisma.Decimal | string;
  quantity: Prisma.Decimal | string;
  lineTotal: Prisma.Decimal | string;
  taxableBase: Prisma.Decimal | string;
  taxAmount: Prisma.Decimal | string;
  /** Append-only snapshot rows carry `createdAt` ONLY (no `updatedAt`). */
  createdAt: Date;
}

/**
 * Persistence row for a tenant-scoped invoice WITH its line set. Reads always
 * load the lines, so a caller never has to make a second query to describe the
 * document. `number`/`confirmedAt` are nullable and agree by the schema's
 * `number iff confirmed` rule, and `cancelReason` is present exactly for a
 * `CANCELLED` invoice (DEC-039/DEC-043). There is deliberately no stored total:
 * the DTO sums the immutable lines instead.
 */
export interface InvoiceRow {
  id: string;
  tenantId: string;
  saleId: string;
  customerId: string | null;
  currency: string;
  status: InvoiceStatusValue;
  series: string;
  number: number | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  lines: InvoiceLineRow[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Write payload for one line of {@link BillingRepository.create}. There is
 * deliberately NO `tenantId` and NO `invoiceId` field: both are resolved by the
 * inserting method, so a caller argument cannot re-scope a line. The money and
 * quantity values are passed through EXACTLY as the frozen `SaleLine` read
 * returned them — no conversion, no re-rounding and no arithmetic.
 */
export interface InvoiceLineWriteData {
  readonly catalogItemId: string;
  readonly position: number;
  readonly description: string;
  readonly rateCode: string;
  readonly unitPrice: Prisma.Decimal | string;
  readonly quantity: Prisma.Decimal | string;
  readonly lineTotal: Prisma.Decimal | string;
  readonly taxableBase: Prisma.Decimal | string;
  readonly taxAmount: Prisma.Decimal | string;
}

/**
 * Write payload for {@link BillingRepository.create}. There is deliberately NO
 * `tenantId` field (tenant identity comes from the request context), NO `status`
 * field (a new invoice is `DRAFT` by schema default), NO `series` field (the
 * database default `"A"` applies) and NO `number` field (a number is allocated
 * only at confirmation, DEC-039). The `saleId`, `customerId` and `currency` are
 * the source sale's own coordinates, resolved server-side (DEC-038).
 */
export interface InvoiceCreateData {
  readonly saleId: string;
  readonly customerId: string | null;
  readonly currency: string;
  readonly lines: readonly InvoiceLineWriteData[];
}

/**
 * Status predicate the tenant-scoped invoice reads and the `updateMany`
 * transitions may build: one lifecycle value (the confirm gate) or the `in` set
 * the cancellation gate needs, because cancellation is admitted from BOTH
 * `DRAFT` and `CONFIRMED` (DEC-043). Declared as a local union so this boundary
 * stays decoupled from the generated client namespace.
 */
export type InvoiceStatusFilter =
  InvoiceStatusValue | { readonly in: readonly InvoiceStatusValue[] };

/** Predicate fields the tenant-scoped invoice reads are allowed to build. */
export interface InvoiceWhere {
  id?: string;
  tenantId: string;
  status?: InvoiceStatusFilter;
}

/**
 * The filters the tenant-scoped invoice list accepts. There is deliberately no
 * `tenantId` (resolved from the request context), no `saleId` and no
 * pagination: the shipped sales/cash lists take an optional `status` only, and
 * an unbounded list is a recorded limitation rather than a silent cap.
 */
export interface InvoiceListFilters {
  status?: InvoiceStatusValue;
}

/**
 * Ordering clauses the invoice list builds: `createdAt` newest first with `id`
 * ascending as the stable tie-breaker (the sales/cash list convention).
 */
export interface InvoiceOrderBy {
  createdAt?: "asc" | "desc";
  id?: "asc" | "desc";
}

/**
 * The line-relation `include` both header reads declare: the document's own
 * frozen reading order, never an unordered relation read. The created row is
 * returned through this same include, so the write response and every later read
 * describe the lines identically.
 */
export interface InvoiceLinesInclude {
  lines: { orderBy: { position: "asc" | "desc" } };
}

/** Single declared include instance: position ascending, byte-identical on every read. */
const INVOICE_LINES_BY_POSITION: InvoiceLinesInclude = {
  lines: { orderBy: { position: "asc" } },
};

/**
 * Structural contract for the invoice delegates this boundary needs. The
 * generated client and the in-memory test fake both satisfy it, keeping this
 * repository independent of the generated model namespace (the
 * sales/cash/purchase convention). There is deliberately NO `update` and NO
 * `delete`: the invoice is immutable from creation and its lifecycle belongs to
 * BILL-003 (DEC-038/DEC-043).
 */
export interface InvoiceDelegate {
  findFirst: (args: {
    where: InvoiceWhere;
    include: InvoiceLinesInclude;
  }) => Promise<InvoiceRow | null>;
  findMany: (args: {
    where: InvoiceWhere;
    include: InvoiceLinesInclude;
    orderBy: readonly InvoiceOrderBy[];
  }) => Promise<InvoiceRow[]>;
  create: (args: {
    data: {
      saleId: string;
      customerId: string | null;
      currency: string;
      tenantId: string;
      lines: { create: readonly InvoiceLineWriteData[] };
    };
    include: InvoiceLinesInclude;
  }) => Promise<InvoiceRow>;
  /**
   * The CONDITIONAL status transition of the confirm command (BILL-003): a
   * filter-shaped update, exactly like the sale `complete` backstop, so the
   * stored status itself is the guard. `@updatedAt` writes `updated_at`, which
   * is why it is not part of `data`; `confirmedAt` is written ONLY here.
   *
   * BILL-003 W3's cancellation reuses this ONE delegate: its `status` predicate
   * is the `in` set `{ DRAFT, CONFIRMED }` and its `data` writes only
   * `cancelledAt` and `cancelReason` — never `number` or `confirmedAt`, which
   * belong to the confirmation (the W1 header guard rejects a transition that
   * moves a column it does not own).
   */
  updateMany: (args: {
    where: InvoiceWhere;
    data: {
      status?: InvoiceStatusValue;
      number?: number;
      confirmedAt?: Date;
      cancelledAt?: Date;
      cancelReason?: string;
    };
  }) => Promise<{ count: number }>;
}

/**
 * Raw-SQL seam for the transaction-scoped invoice row lock and the atomic
 * number allocation. Declared structurally (the sales/cash raw-seam convention)
 * so the generated client and the shared in-memory boundary both satisfy it.
 * The in-memory boundary models `SELECT ... FOR UPDATE` as a plain read and the
 * allocation as its own result, because a synchronous map cannot interleave; the
 * real serialization proof stays live-PostgreSQL-owned.
 */
export interface BillingRawClient {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
}

/**
 * Structural contract for the ONE catalog read creation performs. `SaleLine`
 * carries no description, so `invoice_line.description` is copied from
 * `catalog_item.name`; the names of every line item are resolved in ONE
 * tenant-predicated query (no N+1) and only the two fields the document needs
 * are selected.
 */
export interface BillingCatalogItemDelegate {
  findMany: (args: {
    where: { tenantId: string; id: { in: readonly string[] } };
    select: { id: true; name: true };
  }) => Promise<{ id: string; name: string }[]>;
}

/**
 * The one Fiscal read Billing's cancellation transaction needs: "does this
 * invoice have a live fiscal document?" Declared structurally so the real
 * Prisma client and the in-memory boundary both satisfy it, and so Billing
 * keeps its one-way dependency on the Fiscal APPLICATION boundary only
 * (DEC-051, D5) — it never imports the Fiscal package or its persistence types.
 */
export interface BillingFiscalDocumentReadDelegate {
  findFirst(args: {
    where: { tenantId: string; invoiceId: string; status: { not: "CANCELLED" } };
  }): Promise<{ id: string } | null>;
}

/**
 * The delegate set this repository touches. Doubles as the optional transaction
 * seam: the audited service passes its open transaction handle here so the
 * invoice, its lines and its audit row co-commit.
 */
export interface BillingTx extends BillingRawClient {
  invoice: InvoiceDelegate;
  catalogItem: BillingCatalogItemDelegate;
  fiscalDocument: BillingFiscalDocumentReadDelegate;
}

/** Single stable message behind every invoice 404 — byte-equivalence by construction. */
export const INVOICE_NOT_FOUND_MESSAGE = "Invoice was not found.";

/**
 * Stable `409 CONFLICT` message for an allocation that returned a non-positive
 * value. A number below 1 is not a representable invoice number (the schema's
 * `invoice_number_positive` CHECK and the counter's own positivity guarantee),
 * so it is a data-integrity anomaly: the command refuses to write it rather
 * than persisting an invalid document.
 */
export const INVOICE_NUMBER_ALLOCATION_FAILED_MESSAGE =
  "The invoice number could not be allocated.";

/**
 * Single stable message behind every unresolved invoice-line catalog item. The
 * composite RESTRICT foreign key makes this unreachable in real PostgreSQL, so
 * it is a data-integrity anomaly: the document must never be written with a
 * fabricated description, and the command rolls back instead.
 */
export const INVOICE_CATALOG_ITEM_NOT_FOUND_MESSAGE = "An invoice line catalog item was not found.";

/**
 * Tenant-safe data access for the tenant-scoped `Invoice` aggregate (EPIC-14
 * BILL-002).
 *
 * Contract: every query carries the tenant predicate IMPLICITLY via
 * `requestContext.requireTenantId()`. Call sites never hand-write tenant filters
 * and cannot forget them; when no tenant authority was resolved server-side,
 * `requireTenantId()` throws FORBIDDEN before any database call happens. Zero
 * matching rows ⇒ `DomainError("NOT_FOUND")` with ONE shared message, so a
 * foreign invoice is indistinguishable from a missing one and the service
 * renders a byte-equivalent 404.
 *
 * The SOURCE sale is read through the sibling {@link SaleRepository} — it is
 * tenant-predicated and already throws the shared sale 404, so this module never
 * defines a second sale-not-found message. BILL-003's confirm command adds the
 * transaction-scoped header lock, the atomic number allocation and the
 * conditional `DRAFT -> CONFIRMED` write; nothing here writes a payment, a cash
 * movement, a stock movement or any fiscal state.
 */
@Injectable()
export class BillingRepository {
  constructor(
    // Explicit @Inject token keeps DI resolution token-based while the PARAM
    // type stays the narrow delegate set this boundary actually needs.
    @Inject(PrismaService) private readonly prisma: BillingTx,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService
  ) {}

  /**
   * Creates one invoice WITH its verbatim snapshot lines in the CALLER'S active
   * tenant. `tenantId` is resolved from the request context and placed LAST in
   * the payload, so even a rogue property on `data` cannot re-scope the insert;
   * the nested line create inherits the tenant and invoice ids from the parent,
   * so no line can land in another tenant or another document. The status is the
   * schema default (`DRAFT`), the series is the database default (`"A"`) and no
   * `number` is written: BILL-002 never allocates one (DEC-039).
   */
  async create(data: InvoiceCreateData, tx?: BillingTx): Promise<InvoiceRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.invoice.create({
      data: {
        saleId: data.saleId,
        customerId: data.customerId,
        currency: data.currency,
        tenantId,
        lines: {
          create: data.lines.map((line) => ({
            catalogItemId: line.catalogItemId,
            position: line.position,
            description: line.description,
            rateCode: line.rateCode,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            lineTotal: line.lineTotal,
            taxableBase: line.taxableBase,
            taxAmount: line.taxAmount,
          })),
        },
      },
      include: INVOICE_LINES_BY_POSITION,
    });
  }

  /**
   * One invoice of the caller's active tenant by id, WITH its lines in position
   * order. The tenant predicate rides along in the same WHERE clause, so a
   * foreign id falls through to the shared NOT_FOUND path instead of leaking
   * existence.
   */
  async findById(id: string, tx?: BillingTx): Promise<InvoiceRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const row = await client.invoice.findFirst({
      where: { id, tenantId },
      include: INVOICE_LINES_BY_POSITION,
    });
    if (!row) {
      throw new DomainError("NOT_FOUND", INVOICE_NOT_FOUND_MESSAGE);
    }
    return row;
  }

  /**
   * Row-locks one invoice HEADER of the caller's active tenant, identified by the
   * `(tenant_id, id)` pair, for the rest of the caller's open transaction.
   *
   * This is the PRIMARY serialization of the confirm command: the transaction
   * takes the header lock BEFORE its post-lock status read, so two concurrent
   * confirms of the SAME invoice serialize here — the loser blocks on this row
   * lock and its post-lock read then sees the winner's committed `CONFIRMED`
   * status and replays instead of allocating a second number. The lock is
   * transaction-scoped, so a rolled-back command leaves nothing locked.
   *
   * A zero-row match (unknown or foreign id, which by construction takes no
   * lock) is not an error here: the caller's subsequent tenant-scoped read is
   * what renders the shared byte-equivalent `404`. The in-memory boundary models
   * this as a plain read; the real interleaving is proven by the live-PostgreSQL
   * evidence owned by BILL-003 W3.
   */
  async lockById(id: string, tx?: BillingTx): Promise<void> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    // Explicit `::uuid` casts (the sale/cash row-lock precedent): Prisma binds
    // template values as `text`, so comparing them directly against the `uuid`
    // columns fails with `42883: operator does not exist: uuid = text`.
    await client.$queryRaw`
      SELECT "id" FROM "invoice"
      WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${id}::uuid
      FOR UPDATE
    `;
  }

  /**
   * Allocates the next invoice number for one `(tenant, series)` in the caller's
   * active tenant with ONE atomic statement that also CREATES the counter row
   * when the tenant has none (DEC-039).
   *
   * The upsert-and-increment shape is what removes the read-then-write window a
   * `SELECT ... FOR UPDATE` plus `UPDATE` pair would leave: a fresh row is
   * inserted with `next_value = 2` and returns `1`, while an existing row is
   * incremented and returns its PRE-increment value. Either way the row's own
   * lock is held for the rest of the transaction, so the allocation and the
   * `DRAFT -> CONFIRMED` transition commit together or not at all — a rolled
   * back confirm consumes no number.
   *
   * A non-positive or non-integer result is a data-integrity anomaly (the schema
   * forbids a number below 1), so it is refused with a stable `409` instead of
   * being written onto the invoice.
   */
  async allocateNumber(series: string, tx?: BillingTx): Promise<number> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const rows = (await client.$queryRaw`
      INSERT INTO "invoice_number_sequence" ("tenant_id", "series", "next_value")
      VALUES (${tenantId}::uuid, ${series}, 2)
      ON CONFLICT ("tenant_id", "series")
      DO UPDATE SET "next_value" = "invoice_number_sequence"."next_value" + 1,
                    "updated_at" = now()
      RETURNING "next_value" - 1
    `) as Record<string, unknown>[];
    // The statement returns exactly one row and exactly one (unnamed) column;
    // read it positionally so the arbitrary `?column?` alias cannot matter.
    const allocated = rows.length > 0 ? Number(Object.values(rows[0])[0]) : Number.NaN;
    if (!Number.isInteger(allocated) || allocated <= 0) {
      throw new DomainError("CONFLICT", INVOICE_NUMBER_ALLOCATION_FAILED_MESSAGE);
    }
    return allocated;
  }

  /**
   * Applies the `DRAFT` -> `CONFIRMED` transition of one invoice of the caller's
   * active tenant, writing the allocated number and the confirmation timestamp
   * (DEC-039).
   *
   * This write is the BACKSTOP of the confirm serialization, not its primary
   * mechanism: {@link lockById}'s header row lock is what makes a concurrent
   * second confirm observe the committed status. The write is still conditional
   * on the STORED status being `DRAFT`, so if that status were ever not `DRAFT`
   * the statement affects zero rows; the caller maps that to the stable `409`
   * instead of treating it as a success. Only `status`, `number` and
   * `confirmed_at` are written — the W1 header guard rejects a transition that
   * moves a column it does not own — and `updated_at` is handled by `@updatedAt`.
   */
  async markConfirmed(id: string, number: number, tx?: BillingTx): Promise<number> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const result = await client.invoice.updateMany({
      where: { id, tenantId, status: "DRAFT" },
      data: { status: "CONFIRMED", number, confirmedAt: new Date() },
    });
    return result.count;
  }

  /**
   * Applies the terminal `CANCELLED` transition of one invoice of the caller's
   * active tenant, writing the cancellation timestamp and the reason (DEC-043).
   *
   * This write is the BACKSTOP of the cancellation serialization, not its
   * primary mechanism: {@link lockById}'s header row lock is what makes a
   * concurrent second command observe the committed status. The write is still
   * conditional on the STORED status being `DRAFT` or `CONFIRMED`, so if that
   * status were ever not admissible the statement affects zero rows; the caller
   * maps that to the stable `409` instead of treating it as a success. Only
   * `status`, `cancelled_at` and `cancel_reason` are written — the W1 header
   * guard rejects a transition that moves a column it does not own — so the
   * allocated `number` and the original `confirmed_at` are RETAINED verbatim
   * (DEC-039, DEC-043), and `updated_at` is handled by `@updatedAt`.
   */
  async markCancelled(id: string, reason: string, tx?: BillingTx): Promise<number> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const result = await client.invoice.updateMany({
      where: { id, tenantId, status: { in: ["DRAFT", "CONFIRMED"] } },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
    });
    return result.count;
  }

  /**
   * The caller's active-tenant invoices, WITH their lines in position order.
   *
   * DETERMINISTIC ORDER: newest first by `createdAt`, with `id` ascending as the
   * tiebreaker for rows created in the same millisecond — an invoice carries no
   * ordering column of its own and `number` is NULL until confirmation, so this
   * pair is what makes the list stable across reads (the sales/cash list
   * convention). The optional `status` filter is applied on top of the implicit
   * tenant predicate; an omitted filter adds NO predicate, so this layer owns no
   * default visibility policy.
   *
   * There is deliberately NO pagination: the shipped sales/cash lists have none
   * either and an unbounded read is a recorded limitation of this slice, never a
   * silent cap.
   */
  async list(filters: InvoiceListFilters = {}, tx?: BillingTx): Promise<InvoiceRow[]> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.invoice.findMany({
      where: {
        tenantId,
        ...(filters.status !== undefined ? { status: filters.status } : {}),
      },
      include: INVOICE_LINES_BY_POSITION,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
  }

  /**
   * The names of the given catalog items in the CALLER'S active tenant, keyed by
   * item id, resolved in ONE tenant-predicated query — never one query per line.
   *
   * `invoice_line.description` is a NOT NULL snapshot and `SaleLine` carries no
   * description, so the source value is the catalog item's name. Every requested
   * id must resolve: a missing one is a data-integrity anomaly (the composite
   * RESTRICT foreign key makes it unrepresentable in real PostgreSQL) and MUST
   * NOT degrade to an empty or fabricated description, so it fails with a stable
   * CONFLICT and the whole command rolls back.
   */
  async readCatalogItemNames(
    catalogItemIds: readonly string[],
    tx?: BillingTx
  ): Promise<Map<string, string>> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const uniqueIds = [...new Set(catalogItemIds)];
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const rows = await client.catalogItem.findMany({
      where: { tenantId, id: { in: uniqueIds } },
      select: { id: true, name: true },
    });
    const names = new Map(rows.map((row) => [row.id, row.name]));

    for (const id of uniqueIds) {
      if (!names.has(id)) {
        throw new DomainError("CONFLICT", INVOICE_CATALOG_ITEM_NOT_FOUND_MESSAGE);
      }
    }

    return names;
  }
}
