-- NCE-001 / DEC-090: the Nota de Crédito Electrónica that compensates a
-- confirmed, SIFEN-approved invoice when its sale is reversed (DEC-089 §3).
--
-- Additive only. The credited invoice is never touched: it stays CONFIRMED, and
-- its fiscal document stays APPROVED. The note is a NEW document with its own
-- fiscal number, drawn from a timbrado range for document type 5, and its own
-- fiscal_document row, which the existing submission pipeline sends.

-- 1. The note. Header and fiscal number in one append-only row: a note exists
--    only on the fiscal path, so its number is allocated in the same
--    transaction that writes it and there is no "unnumbered draft" state.
--    The credit is TOTAL (DEC-089 §1): the items are the invoice's own frozen
--    lines, so no line table exists and F014 equals the invoice's by
--    construction, which is what rule 2417 (the notes may not exceed the
--    factura) requires.
CREATE TABLE "credit_note" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "sale_reversal_id" UUID NOT NULL,
  -- `E401 iMotEmi`, `tiMotEmi` [1-8].
  "motive" SMALLINT NOT NULL,
  -- INTERNAL free text: the reversal's own reason, copied so the note is
  -- self-describing. Never sent to SIFEN.
  "reason" VARCHAR(500) NOT NULL,
  -- `H004 dCdCDERef`: the CDC of the APPROVED factura electrónica it credits.
  "associated_cdc" VARCHAR(44) NOT NULL,
  -- The allocation's identity, as `invoice_fiscal_allocation` records it.
  "range_id" UUID NOT NULL,
  "timbrado_number" VARCHAR(8) NOT NULL,
  "establishment_id" UUID NOT NULL,
  "expedition_point" VARCHAR(3) NOT NULL,
  "document_type" SMALLINT NOT NULL,
  "series" VARCHAR(2),
  "document_number" VARCHAR(7) NOT NULL,
  "issued_by_user_profile_id" UUID NOT NULL,
  -- `D002 dFeEmiDE`'s source.
  "issued_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "credit_note_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "credit_note_motive_tiMotEmi" CHECK ("motive" BETWEEN 1 AND 8),
  CONSTRAINT "credit_note_reason_not_blank" CHECK (btrim("reason") <> ''),
  -- `tCDC`, and H001a/2414: a note may only reference a Factura electrónica.
  CONSTRAINT "credit_note_associated_cdc_is_fe"
    CHECK ("associated_cdc" ~ '^01[0-9]{7}[0-9A-D][0-9]{34}$'),
  CONSTRAINT "credit_note_document_type_nce" CHECK ("document_type" = 5),
  CONSTRAINT "credit_note_timbrado_number_tdNumTim"
    CHECK ("timbrado_number" ~ '^[0-9]{8}$' AND "timbrado_number" <> '00000000'),
  CONSTRAINT "credit_note_expedition_point_tdPunExp" CHECK ("expedition_point" ~ '^[0-9]{3}$'),
  CONSTRAINT "credit_note_series_tdSerieNum" CHECK ("series" IS NULL OR "series" ~ '^[A-Z]{2}$'),
  CONSTRAINT "credit_note_document_number_tdNumDoc"
    CHECK ("document_number" ~ '^[0-9]{7}$' AND "document_number" <> '0000000')
);

CREATE UNIQUE INDEX "credit_note_tenant_id_id_key" ON "credit_note"("tenant_id", "id");
-- Total credit: one note per invoice, and one per reversal.
CREATE UNIQUE INDEX "credit_note_tenant_id_invoice_id_key" ON "credit_note"("tenant_id", "invoice_id");
CREATE UNIQUE INDEX "credit_note_tenant_id_sale_reversal_id_key"
  ON "credit_note"("tenant_id", "sale_reversal_id");
-- One number per range, exactly like the invoice allocation.
CREATE UNIQUE INDEX "credit_note_one_number_per_range_key"
  ON "credit_note"("tenant_id", "range_id", "document_number");

ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_tenant_id_invoice_id_fkey"
  FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "invoice"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_tenant_id_sale_reversal_id_fkey"
  FOREIGN KEY ("tenant_id", "sale_reversal_id") REFERENCES "sale_reversal"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_range_id_fkey"
  FOREIGN KEY ("range_id") REFERENCES "fiscal_timbrado_range"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_issued_by_user_profile_id_fkey"
  FOREIGN KEY ("issued_by_user_profile_id") REFERENCES "user_profile"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The range must be THIS tenant's and carry the identity recorded (the same
-- guard `invoice_fiscal_allocation` has), and the credited invoice must be
-- CONFIRMED: a draft or cancelled invoice has nothing a note could credit.
CREATE OR REPLACE FUNCTION "credit_note_insert_guard"()
RETURNS TRIGGER AS $$
DECLARE
  authorized_timbrado TEXT;
  authorized_establishment UUID;
  authorized_point TEXT;
  authorized_document_type SMALLINT;
  authorized_series TEXT;
  invoice_status TEXT;
BEGIN
  SELECT "timbrado_number", "establishment_id", "expedition_point", "document_type", "series"
    INTO authorized_timbrado, authorized_establishment, authorized_point, authorized_document_type,
         authorized_series
    FROM "fiscal_timbrado_range"
   WHERE "tenant_id" = NEW."tenant_id" AND "id" = NEW."range_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'timbrado range % does not belong to tenant %', NEW."range_id", NEW."tenant_id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF authorized_timbrado IS DISTINCT FROM NEW."timbrado_number"
     OR authorized_establishment IS DISTINCT FROM NEW."establishment_id"
     OR authorized_point IS DISTINCT FROM NEW."expedition_point"
     OR authorized_document_type IS DISTINCT FROM NEW."document_type"
     OR authorized_series IS DISTINCT FROM NEW."series" THEN
    RAISE EXCEPTION 'the credit note % does not match the authorisation of range %',
      NEW."id", NEW."range_id"
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT "status"::TEXT INTO invoice_status
    FROM "invoice" WHERE "tenant_id" = NEW."tenant_id" AND "id" = NEW."invoice_id";
  IF invoice_status IS DISTINCT FROM 'CONFIRMED' THEN
    RAISE EXCEPTION 'a credit note can only credit a CONFIRMED invoice'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "credit_note_insert_guard_trigger"
  BEFORE INSERT ON "credit_note" FOR EACH ROW EXECUTE FUNCTION "credit_note_insert_guard"();

CREATE OR REPLACE FUNCTION "credit_note_append_only"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'a credit note is written once: it cannot be updated or deleted'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "credit_note_no_update_trigger"
  BEFORE UPDATE ON "credit_note" FOR EACH ROW EXECUTE FUNCTION "credit_note_append_only"();
CREATE TRIGGER "credit_note_no_delete_trigger"
  BEFORE DELETE ON "credit_note" FOR EACH ROW EXECUTE FUNCTION "credit_note_append_only"();

-- 2. The note's fiscal document. It keeps `invoice_id` = the CREDITED invoice
--    (the pipeline, the receptor and the snapshot all hang off it) and adds the
--    note it carries. A row with `credit_note_id` NULL is the invoice's own FE,
--    exactly as before.
ALTER TABLE "fiscal_document" ADD COLUMN "credit_note_id" UUID;
ALTER TABLE "fiscal_document" ADD CONSTRAINT "fiscal_document_tenant_id_credit_note_id_fkey"
  FOREIGN KEY ("tenant_id", "credit_note_id") REFERENCES "credit_note"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- "One live document per invoice" now means one live FACTURA per invoice; the
-- note's document is counted on its own key.
DROP INDEX "fiscal_document_tenant_id_invoice_id_key";
CREATE UNIQUE INDEX "fiscal_document_tenant_id_invoice_id_key"
  ON "fiscal_document"("tenant_id", "invoice_id")
  WHERE "status" <> 'CANCELLED' AND "credit_note_id" IS NULL;
CREATE UNIQUE INDEX "fiscal_document_tenant_id_credit_note_id_key"
  ON "fiscal_document"("tenant_id", "credit_note_id")
  WHERE "status" <> 'CANCELLED' AND "credit_note_id" IS NOT NULL;

-- The note's document must carry the note's own invoice, and the link never
-- changes once written.
CREATE OR REPLACE FUNCTION "fiscal_document_credit_note_guard"()
RETURNS TRIGGER AS $$
DECLARE
  credited_invoice UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."credit_note_id" IS DISTINCT FROM OLD."credit_note_id"
       OR NEW."invoice_id" IS DISTINCT FROM OLD."invoice_id" THEN
      RAISE EXCEPTION 'a fiscal document cannot change the document it carries'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."credit_note_id" IS NOT NULL THEN
    SELECT "invoice_id" INTO credited_invoice
      FROM "credit_note" WHERE "tenant_id" = NEW."tenant_id" AND "id" = NEW."credit_note_id";
    IF credited_invoice IS DISTINCT FROM NEW."invoice_id" THEN
      RAISE EXCEPTION 'the credit note''s fiscal document must carry the credited invoice'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "fiscal_document_credit_note_guard_trigger"
  BEFORE INSERT OR UPDATE ON "fiscal_document" FOR EACH ROW
  EXECUTE FUNCTION "fiscal_document_credit_note_guard"();
