-- Additive migration: EPIC-14 BILL-001 invoice data foundation.
--
-- Adds the tenant-scoped invoice aggregate PRD §21 requires, on top of the
-- EPIC-12 sale foundation (DEC-038, DEC-039, DEC-040): the `invoice` header with
-- its `DRAFT`/`CONFIRMED`/`CANCELLED` lifecycle, the immutable `invoice_line`
-- snapshot that consumes the sale's frozen `SaleLine` rows verbatim, and the
-- per-tenant `invoice_number_sequence` counter the confirm transaction advances.
--
-- This migration is strictly additive: it creates one enum and three tables
-- with their indexes, constraints and triggers. It alters no other table,
-- changes no existing column, writes no row and drops nothing — an invoice, its
-- lines and its numbering counter are user data, never seed data.
--
-- The aggregate is FISCAL-FREE (DEC-042): no fiscal status, fiscal document,
-- provider, queue or submission column exists here, so PRD §21's "Invoice is
-- distinct from fiscal status" holds by that absence. PRD §22 and EPIC-15 own
-- the fiscal surface, and `fiscal.invoice.issue` stays reserved for it
-- (DEC-040). Billing also performs NO money arithmetic (DEC-021, DEC-038): every
-- `invoice_line` amount is a copy of the frozen sale line, which is why the
-- header carries no stored total that could disagree with them.
--
-- The enum is declared with `CREATE TYPE` rather than extended with
-- `ALTER TYPE ... ADD VALUE`. `invoice_status` is a NEW type, and a value
-- appended by `ALTER TYPE ... ADD VALUE` is not usable as an enum literal inside
-- the same transaction — PostgreSQL runs every Prisma migration in ONE
-- transaction — so `CREATE TYPE` is both the correct and the safe form for the
-- literal comparisons in the CHECKs below.
--
-- "At most one LIVE invoice per sale" is a DATABASE property, not an
-- application convention: it is carried by the PARTIAL unique index
-- `invoice_tenant_id_sale_id_key` on (tenant_id, sale_id)
-- WHERE status <> 'CANCELLED', declared as raw SQL because Prisma cannot
-- express partial indexes (the supplier tax-id key and the one-OPEN-session cash
-- key are the precedents). A cancelled invoice therefore falls outside the index
-- and releases its sale for a corrected replacement (DEC-043), which is exactly
-- what DEC-038's "fixing a wrong draft means cancelling it and creating a new
-- invoice from a new sale" requires, while two live invoices for one sale stay
-- impossible.
--
-- Foreign keys are RESTRICT everywhere. Tenant ownership is carried by the
-- composite shape `(tenant_id, id)` on all three tables, so an invoice can only
-- reference a sale and a customer of the SAME tenant and a line can only
-- reference an invoice and a catalog item of the SAME tenant:
--   * `invoice(tenant_id, sale_id) -> sale(tenant_id, id)`
--   * `invoice(tenant_id, customer_id) -> customer(tenant_id, id)`
--   * `invoice_line(tenant_id, invoice_id) -> invoice(tenant_id, id)`
--   * `invoice_line(tenant_id, catalog_item_id) -> catalog_item(tenant_id, id)`
-- `invoice_line.rate_code` additionally carries a RESTRICT reference to the
-- GLOBAL `tax_rate(code)` unique column, exactly like `sale_line`, so the
-- snapshot can only name a seeded rate and a rate an invoice used can never be
-- deleted.
--
-- The database additionally enforces the invoice invariants the application
-- layer must respect:
--   * the numbering biconditional (DEC-039): `number` and `confirmed_at` are
--     present or absent TOGETHER, and an allocated number is strictly positive;
--   * the lifecycle consistency of the three states: a `DRAFT` carries no
--     confirmation timestamp, a `CONFIRMED` invoice requires one, `cancelled_at`
--     is set exactly when the invoice is `CANCELLED`, and a cancelled invoice
--     must explain itself;
--   * a series is non-blank, a line quantity is STRICTLY POSITIVE, and every
--     line money amount and the line position are non-negative;
--   * the numbering counter can never fall below 1;
--   * immutability is CONDITIONAL for the header and UNCONDITIONAL for the
--     snapshot. The invoice is immutable from creation at every status
--     (DEC-038), so a `BEFORE DELETE` and a `BEFORE UPDATE` trigger reject a row
--     that is no longer `DRAFT`. The update trigger is deliberately CONDITIONAL:
--     Prisma writes `updated_at`, so an unconditional `BEFORE UPDATE` trigger
--     would block the `DRAFT -> CONFIRMED` transition itself. An `invoice_line`
--     has no draft state and no edit path at all, so its `BEFORE UPDATE` and
--     `BEFORE DELETE` triggers reject any change whatsoever; a wrong document is
--     corrected by cancelling it (DEC-043), never by rewriting a frozen amount
--     (PRD §40);
--   * an allocated number is NEVER reallocated: a change to a non-NULL number is
--     rejected, so a cancelled confirmed invoice keeps its number permanently
--     (DEC-039, DEC-043);
--   * `invoice_number_sequence` carries NO trigger at all: that row is MEANT to
--     be updated by the allocation, and a counter that could not advance could
--     not allocate.
--
-- Data classification: the invoice's references to a customer and to a sale are
-- CONFIDENTIAL, while its money amounts, status, series and number are
-- INTERNAL (PRD §41); logs and audit carry ids and field names only — never a
-- payload.

-- Invoice lifecycle (PRD §21, DEC-038), pinned to exactly these three states.
-- `DRAFT` is created from a completed sale by BILL-002; `CONFIRMED` and
-- `CANCELLED` are reachable only through the explicit BILL-003 commands, and
-- `CANCELLED` is terminal. Evolve additively only.
CREATE TYPE "invoice_status" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

CREATE TABLE "invoice" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  -- The ONE completed sale this invoice bills (DEC-038): NOT NULL, so an
  -- invoice with no source sale is not a representable state in this epic.
  "sale_id" UUID NOT NULL,
  -- OPTIONAL customer inherited from the sale (DEC-028, DEC-038). NULL is valid
  -- through column nullability (MATCH SIMPLE), so a walk-in sale's invoice is
  -- never rejected for lacking a customer.
  "customer_id" UUID,
  -- One ISO 4217 currency inherited from the source sale; never read from a
  -- request body (DEC-022, DEC-038). No conversion exists.
  "currency" VARCHAR(3) NOT NULL,
  "status" "invoice_status" NOT NULL DEFAULT 'DRAFT',
  -- Numbering series (DEC-039): NOT NULL with a database default of 'A'. One
  -- series per tenant in this epic; multi-series is not modelled.
  "series" VARCHAR(8) NOT NULL DEFAULT 'A',
  -- Allocated number: NULL until confirmation, and NULL forever for an invoice
  -- cancelled from DRAFT (DEC-039, DEC-043).
  "number" INTEGER,
  "confirmed_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "cancel_reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invoice_pkey" PRIMARY KEY ("id"),
  -- DEC-039: a number exists exactly when a confirmation does. The
  -- biconditional makes a numbered draft and an unnumbered confirmation equally
  -- unrepresentable, so the allocation point and its evidence always agree. It
  -- also lets an invoice cancelled from DRAFT keep no number at all.
  CONSTRAINT "invoice_number_iff_confirmed" CHECK (("number" IS NULL) = ("confirmed_at" IS NULL)),
  -- An allocated number identifies a document: zero and negatives are not
  -- allocatable numbers.
  CONSTRAINT "invoice_number_positive" CHECK ("number" IS NULL OR "number" > 0),
  CONSTRAINT "invoice_series_not_blank" CHECK (length(btrim("series")) > 0),
  -- The three lifecycle states keep their timestamps consistent with each other.
  CONSTRAINT "invoice_draft_not_confirmed" CHECK ("status" <> 'DRAFT' OR "confirmed_at" IS NULL),
  CONSTRAINT "invoice_confirmed_requires_timestamp" CHECK ("status" <> 'CONFIRMED' OR "confirmed_at" IS NOT NULL),
  CONSTRAINT "invoice_cancelled_at_matches_status" CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)),
  -- DEC-043: a cancelled invoice explains itself; the reason is bounded by the
  -- column and non-blank by this predicate.
  CONSTRAINT "invoice_cancel_reason_present" CHECK ("status" <> 'CANCELLED' OR ("cancel_reason" IS NOT NULL AND length(btrim("cancel_reason")) > 0))
);

CREATE TABLE "invoice_line" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "catalog_item_id" UUID NOT NULL,
  -- Invoice-local line order (DEC-038): non-negative and unique per invoice.
  "position" INTEGER NOT NULL,
  -- Frozen line description copied verbatim from the source sale line.
  "description" VARCHAR(200) NOT NULL,
  -- Frozen stable rate code (DEC-021, DEC-038), e.g. `EXEMPT`/`IVA_5`/`IVA_10`,
  -- backed by the RESTRICT reference to the global `tax_rate(code)` unique
  -- column declared below.
  "rate_code" VARCHAR(20) NOT NULL,
  "unit_price" DECIMAL(14,2) NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL,
  "line_total" DECIMAL(14,2) NOT NULL,
  "taxable_base" DECIMAL(14,2) NOT NULL,
  "tax_amount" DECIMAL(14,2) NOT NULL,
  -- Append-only snapshot rows are written once — no `updated_at` by design.
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invoice_line_pkey" PRIMARY KEY ("id"),
  -- A saved line always means something: a zero or negative quantity is
  -- rejected at the database, mirroring DEC-021's strictly-positive rule.
  CONSTRAINT "invoice_line_quantity_positive" CHECK ("quantity" > 0),
  -- The frozen money amounts can never be negative (DEC-021, DEC-038).
  CONSTRAINT "invoice_line_unit_price_non_negative" CHECK ("unit_price" >= 0),
  CONSTRAINT "invoice_line_line_total_non_negative" CHECK ("line_total" >= 0),
  CONSTRAINT "invoice_line_taxable_base_non_negative" CHECK ("taxable_base" >= 0),
  CONSTRAINT "invoice_line_tax_amount_non_negative" CHECK ("tax_amount" >= 0),
  -- The reading order of a document with no natural key: positions start at 0.
  CONSTRAINT "invoice_line_position_non_negative" CHECK ("position" >= 0),
  CONSTRAINT "invoice_line_description_not_blank" CHECK (length(btrim("description")) > 0)
);

CREATE TABLE "invoice_number_sequence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  -- Numbering series (DEC-039): NOT NULL with a database default of 'A'.
  "series" VARCHAR(8) NOT NULL DEFAULT 'A',
  -- The next number to allocate (DEC-039). This row is MEANT to be updated by
  -- the confirm transaction, which is why no trigger is declared on this table.
  "next_value" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invoice_number_sequence_pkey" PRIMARY KEY ("id"),
  -- Allocation can only advance: a counter below 1 would hand out a number the
  -- `invoice_number_positive` CHECK would refuse.
  CONSTRAINT "invoice_number_sequence_next_value_positive" CHECK ("next_value" >= 1)
);

-- Tenant-ownership key: the target of the composite invoice FK from
-- `invoice_line`, so a line can only reference an invoice of the SAME tenant.
CREATE UNIQUE INDEX "invoice_tenant_id_id_key" ON "invoice"("tenant_id", "id");

-- The allocation uniqueness key (DEC-039): one number per (tenant, series).
-- UNCONDITIONAL, because a number that was handed out can never be handed out
-- again — not even by a cancelled row (DEC-043). `number` is nullable and
-- PostgreSQL keeps NULLs distinct inside a unique index, so any number of
-- unnumbered drafts coexist under one series.
CREATE UNIQUE INDEX "invoice_tenant_id_series_number_key" ON "invoice"("tenant_id", "series", "number");

-- At most one LIVE invoice per sale. The partial predicate is what makes a
-- CANCELLED invoice fall outside the index entirely and release its sale,
-- exactly as DEC-043 requires; two `DRAFT` or `CONFIRMED` invoices for one sale
-- are rejected by PostgreSQL rather than by a service check. This is a database
-- property so no second writer can forget it, and it is raw SQL because Prisma
-- cannot express a partial index.
CREATE UNIQUE INDEX "invoice_tenant_id_sale_id_key" ON "invoice"("tenant_id", "sale_id") WHERE "status" <> 'CANCELLED';

-- Tenant list lookup: `(tenant_id, status)` serves the status-filtered invoice
-- list without a second scan. It enforces nothing; the partial index above does.
CREATE INDEX "invoice_tenant_id_status_idx" ON "invoice"("tenant_id", "status");

-- Tenant-ownership key, mirroring every other tenant-scoped aggregate.
CREATE UNIQUE INDEX "invoice_line_tenant_id_id_key" ON "invoice_line"("tenant_id", "id");

-- One line per position inside one invoice: the deterministic reading order of
-- the frozen snapshot. tenant_id leads the key, so the same position may appear
-- in another tenant's invoice and in another invoice.
CREATE UNIQUE INDEX "invoice_line_tenant_id_invoice_id_position_key"
  ON "invoice_line"("tenant_id", "invoice_id", "position");

-- Tenant-ownership key, mirroring every other tenant-scoped aggregate.
CREATE UNIQUE INDEX "invoice_number_sequence_tenant_id_id_key" ON "invoice_number_sequence"("tenant_id", "id");

-- The allocation scope of DEC-039: one counter row per (tenant, series).
CREATE UNIQUE INDEX "invoice_number_sequence_tenant_id_series_key" ON "invoice_number_sequence"("tenant_id", "series");

ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: an invoice can only bill a sale of the SAME
-- tenant, and the sale can never be hard-deleted out from under its invoice.
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenant_id_sale_id_fkey"
  FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sale"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: when a customer is present it must be in the
-- SAME tenant, and the customer can never be hard-deleted out from under an
-- invoice. OPTIONAL by column nullability (MATCH SIMPLE), so a customerless
-- invoice is a valid state (DEC-028, DEC-038).
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenant_id_customer_id_fkey"
  FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customer"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: a line can only belong to an invoice of the
-- SAME tenant. RESTRICT (never CASCADE), so a snapshot line is never removed
-- implicitly.
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_tenant_id_invoice_id_fkey"
  FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "invoice"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: a line can only reference a catalog item of
-- the SAME tenant.
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_tenant_id_catalog_item_id_fkey"
  FOREIGN KEY ("tenant_id", "catalog_item_id") REFERENCES "catalog_item"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- RESTRICT reference to the GLOBAL rate row (DEC-021, DEC-038): `rate_code` can
-- only name a seeded `tax_rate.code`, so an unknown or invalid code is not a
-- representable state, and a rate an invoice used can never be deleted or
-- renamed.
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_rate_code_fkey"
  FOREIGN KEY ("rate_code") REFERENCES "tax_rate"("code")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "invoice_number_sequence" ADD CONSTRAINT "invoice_number_sequence_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- CONDITIONAL immutability of the header (DEC-038). A DELETE is rejected ONLY
-- while the invoice is not `DRAFT`; a `DRAFT` may still be discarded before it
-- ever becomes a document. This is intentionally not the unconditional
-- `restrict_violation` shape the cash ledger uses.
CREATE OR REPLACE FUNCTION "invoice_no_delete_when_not_draft"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'an invoice that is not a draft cannot be deleted; cancel it instead'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "invoice_no_delete_when_not_draft_trigger"
  BEFORE DELETE ON "invoice"
  FOR EACH ROW EXECUTE FUNCTION "invoice_no_delete_when_not_draft"();

-- CONDITIONAL immutability of the header, and the reason the form matters: the
-- rejection is gated on the OLD status being non-`DRAFT`, so the
-- `DRAFT -> CONFIRMED` transition itself still passes. An UNCONDITIONAL
-- `BEFORE UPDATE` trigger would reject that very transition, because Prisma
-- writes `updated_at` and the confirmation is an update of the draft row.
CREATE OR REPLACE FUNCTION "invoice_no_update_when_not_draft"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'an invoice that is not a draft is immutable; cancel it and issue a corrected invoice'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "invoice_no_update_when_not_draft_trigger"
  BEFORE UPDATE ON "invoice"
  FOR EACH ROW EXECUTE FUNCTION "invoice_no_update_when_not_draft"();

-- DEC-039/DEC-043: an allocated number is permanent. A confirmed invoice keeps
-- its number after cancellation, so a stored number is never overwritten and a
-- later allocation can never collide with an earlier document. Only a NULL
-- number may be written for the first time, which is the confirmation itself.
CREATE OR REPLACE FUNCTION "invoice_number_never_reallocated"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."number" IS NOT NULL AND NEW."number" IS DISTINCT FROM OLD."number" THEN
    RAISE EXCEPTION 'an allocated invoice number is never reallocated'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "invoice_number_never_reallocated_trigger"
  BEFORE UPDATE ON "invoice"
  FOR EACH ROW EXECUTE FUNCTION "invoice_number_never_reallocated"();

-- UNCONDITIONAL immutability of the line snapshot (DEC-038, PRD §40). An
-- `invoice_line` has no draft state and no edit path: every column is a frozen
-- copy of the sale line, so an update would rewrite what a past document
-- charged. There is no status predicate to gate on, which is why this is the
-- unconditional shape.
CREATE OR REPLACE FUNCTION "invoice_line_no_update"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'an immutable invoice line snapshot cannot be updated; cancel the invoice and issue a corrected one'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "invoice_line_no_update_trigger"
  BEFORE UPDATE ON "invoice_line"
  FOR EACH ROW EXECUTE FUNCTION "invoice_line_no_update"();

CREATE OR REPLACE FUNCTION "invoice_line_no_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'an immutable invoice line snapshot cannot be deleted; cancel the invoice instead'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "invoice_line_no_delete_trigger"
  BEFORE DELETE ON "invoice_line"
  FOR EACH ROW EXECUTE FUNCTION "invoice_line_no_delete"();
