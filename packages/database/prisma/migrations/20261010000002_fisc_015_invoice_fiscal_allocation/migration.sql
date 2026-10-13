-- Additive EPIC-16 FISC-015 WU-B: the fiscal number's authorisation, persisted
-- beside the invoice it numbers. Nothing else.
--
-- [[DEC-056]] decided that the fiscal number is allocated AT INVOICE
-- CONFIRMATION, from the tenant's timbrado range, INSIDE the confirmation
-- transaction, with the range's identity persisted beside the invoice — so a
-- confirmed invoice carries ONE authorised number and the worker READS the
-- authorisation instead of reconstructing a range key a confirmed invoice cannot
-- recover. This migration ships the row that decision persists.
--
-- 1. **A new tenant-scoped table, one row per invoice**, and NOT columns on
--    `invoice`. `invoice` is Billing's aggregate and its columns are Billing's
--    lifecycle; this is fiscal data that happens to be 1:1 with it, so it lives
--    where the fiscal aggregates live and reaches the invoice through a
--    composite tenant-ownership FK — the shape `fiscal_document` already uses.
--    The 1:1 is enforced by a unique index on `(tenant_id, invoice_id)`.
-- 2. **The identity is denormalized, and deliberately so.** The timbrado number,
--    the establishment, the point of expedition and the document type are copied
--    from the range at allocation time. They are what the worker would otherwise
--    have to reconstruct, and a snapshot is the honest record of the
--    authorisation a document was issued under.
-- 3. **The row is written once.** A number is burnt the moment it is handed out
--    (Manual §6.5, baseline §12), so the allocation is append-only: the migration
--    rejects every UPDATE and every DELETE, exactly like `invoice_line`.
-- 4. **A number cannot be handed out twice under one range.** The range's own
--    compare-and-swap counter is the mechanism; this index is the invariant's
--    last line of defence, in the database rather than in a service.
--
-- Protocol citations, all from `docs/06-fiscal/SIFEN-BASELINE.md`:
--
--   tdNumDoc       length=7, never all zero  §21.3  and §22.9, where the CDC's own
--                                                  composition reads `C007 dNumDoc
--                                                  7  completar con ceros a la
--                                                  izquierda hasta 7 dígitos`
--   tdSerieNum     [A-Z]{2}                  §21.3  NULL is the initial range the
--                                                  Manual consumes first (§13/§10.5)
--   tdEst/tdPunExp [0-9]{3}                  §21.3  zero-padded to three digits
--   tiTiDE         1|4-7|9|10                §21.5  1 is Factura electrónica
--   tdNumTim       exactly eight digits      §21.3  the timbrado number
--
-- No existing table, column, constraint or row is rewritten, and no index is
-- added to an existing table: the composite FK targets the invoice's own
-- `invoice_tenant_id_id_key`, and the range is referenced by its primary key.
-- No backfill is required either — an invoice confirmed before this unit simply
-- has no row here, which is the state the reader already reports as `null`.

CREATE TABLE "invoice_fiscal_allocation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "range_id" UUID NOT NULL,
  "timbrado_number" VARCHAR(8) NOT NULL,
  "establishment_id" UUID NOT NULL,
  "expedition_point" VARCHAR(3) NOT NULL,
  "document_type" SMALLINT NOT NULL,
  "series" VARCHAR(2),
  "document_number" VARCHAR(7) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invoice_fiscal_allocation_pkey" PRIMARY KEY ("id"),
  -- `tdNumTim`: exactly eight digits, never all zero.
  CONSTRAINT "invoice_fiscal_allocation_timbrado_number_tdNumTim"
    CHECK ("timbrado_number" ~ '^[0-9]{8}$' AND "timbrado_number" <> '00000000'),
  -- `tdPunExp`: three digits, zero-padded.
  CONSTRAINT "invoice_fiscal_allocation_expedition_point_tdPunExp"
    CHECK ("expedition_point" ~ '^[0-9]{3}$'),
  -- `tiTiDE`'s own set, the same one the range carries.
  CONSTRAINT "invoice_fiscal_allocation_document_type_tiTiDE"
    CHECK ("document_type" IN (1, 4, 5, 6, 7, 9, 10)),
  -- `tdSerieNum`, with NULL for the initial range.
  CONSTRAINT "invoice_fiscal_allocation_series_tdSerieNum"
    CHECK ("series" IS NULL OR "series" ~ '^[A-Z]{2}$'),
  -- `tdNumDoc`: seven digits, zero-padded, never all zero.
  CONSTRAINT "invoice_fiscal_allocation_document_number_tdNumDoc"
    CHECK ("document_number" ~ '^[0-9]{7}$' AND "document_number" <> '0000000')
);

-- One allocation per invoice. The confirmation transaction is the only writer,
-- and this is what makes a second row for the same invoice unrepresentable.
--
-- There is deliberately no `(tenant_id, id)` key: the convention exists so other
-- tables can composite-FK to an aggregate, nothing references this leaf row, and
-- the composite key that carries the tenant is `(tenant_id, invoice_id)` — which
-- is also the target of the FK to the invoice.
CREATE UNIQUE INDEX "invoice_fiscal_allocation_tenant_id_invoice_id_key"
  ON "invoice_fiscal_allocation"("tenant_id", "invoice_id");

-- One number per range. The range's counter is the mechanism; this index is the
-- invariant itself, so a defect that handed the same number out twice could not
-- be persisted. The series is the range's own state (a rollover opens a new
-- row), which is why the tuple does not carry it.
CREATE UNIQUE INDEX "invoice_fiscal_allocation_one_number_per_range_key"
  ON "invoice_fiscal_allocation"("tenant_id", "range_id", "document_number");

ALTER TABLE "invoice_fiscal_allocation"
  ADD CONSTRAINT "invoice_fiscal_allocation_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: the invoice must be in the SAME tenant, so a
-- cross-tenant allocation is unrepresentable rather than merely rejected by a
-- service.
ALTER TABLE "invoice_fiscal_allocation"
  ADD CONSTRAINT "invoice_fiscal_allocation_tenant_id_invoice_id_fkey"
  FOREIGN KEY ("tenant_id", "invoice_id")
  REFERENCES "invoice"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The authorisation itself. A range cannot be deleted (its own no-delete
-- trigger), so an allocation can never lose the row it names.
ALTER TABLE "invoice_fiscal_allocation"
  ADD CONSTRAINT "invoice_fiscal_allocation_range_id_fkey"
  FOREIGN KEY ("range_id") REFERENCES "fiscal_timbrado_range"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The range's own key already carries a composite FK to its establishment, so
-- the establishment is NOT referenced a second time here: two references that
-- can disagree are worse than one, and the identity guard below is what keeps
-- the denormalized copy faithful.
--
-- The guard is a TRIGGER rather than a CHECK because the invariant spans two
-- tables, and it is what buys the composite FK the range cannot offer: the range
-- row must exist in THIS tenant and carry the SAME authorisation identity the
-- allocation recorded — the timbrado number, the establishment, the point, the
-- document type and the fiscal series. A caller that paired a range with the
-- wrong key, that reached for another tenant's range id, or that recorded a
-- series the authorisation does not carry, is refused at the database. The
-- per-column pattern CHECKs above are then defense in depth rather than the
-- first line: agreement with a range whose own CHECKs pin those patterns is
-- what makes them unreachable independently.
CREATE OR REPLACE FUNCTION "invoice_fiscal_allocation_matches_range"()
RETURNS TRIGGER AS $$
DECLARE
  authorized_timbrado TEXT;
  authorized_establishment UUID;
  authorized_point TEXT;
  authorized_document_type SMALLINT;
  authorized_series TEXT;
BEGIN
  SELECT "timbrado_number", "establishment_id", "expedition_point", "document_type", "series"
    INTO authorized_timbrado, authorized_establishment, authorized_point, authorized_document_type,
         authorized_series
    FROM "fiscal_timbrado_range"
   WHERE "tenant_id" = NEW."tenant_id" AND "id" = NEW."range_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'timbrado range % does not belong to tenant %',
      NEW."range_id", NEW."tenant_id"
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF authorized_timbrado IS DISTINCT FROM NEW."timbrado_number"
     OR authorized_establishment IS DISTINCT FROM NEW."establishment_id"
     OR authorized_point IS DISTINCT FROM NEW."expedition_point"
     OR authorized_document_type IS DISTINCT FROM NEW."document_type"
     OR authorized_series IS DISTINCT FROM NEW."series" THEN
    RAISE EXCEPTION 'the allocation of invoice % does not match the authorisation of range %',
      NEW."invoice_id", NEW."range_id"
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "invoice_fiscal_allocation_matches_range_trigger"
  BEFORE INSERT ON "invoice_fiscal_allocation" FOR EACH ROW
  EXECUTE FUNCTION "invoice_fiscal_allocation_matches_range"();

-- A number is burnt the moment it is handed out, so the allocation is a record
-- and never a draft: no UPDATE and no DELETE, for every caller including a
-- migration.
CREATE OR REPLACE FUNCTION "invoice_fiscal_allocation_no_update"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'a fiscal number allocation is written once and cannot be updated'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "invoice_fiscal_allocation_no_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'a fiscal number allocation cannot be deleted; the number is burnt'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "invoice_fiscal_allocation_no_update_trigger"
  BEFORE UPDATE ON "invoice_fiscal_allocation" FOR EACH ROW
  EXECUTE FUNCTION "invoice_fiscal_allocation_no_update"();

CREATE TRIGGER "invoice_fiscal_allocation_no_delete_trigger"
  BEFORE DELETE ON "invoice_fiscal_allocation" FOR EACH ROW
  EXECUTE FUNCTION "invoice_fiscal_allocation_no_delete"();
