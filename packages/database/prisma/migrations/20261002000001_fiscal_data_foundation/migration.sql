-- Additive EPIC-15 FISC-002 fiscal persistence foundation (DEC-046/049/050).
-- Creates the two fiscal enums and the tenant-scoped fiscal_document table;
-- no existing table or row is changed, and no seed, route, provider or worker
-- is introduced. No secret material is stored. Provider references and
-- request/response snapshots are CONFIDENTIAL; lifecycle state and attempt
-- counters are INTERNAL (PRD §41). Logs and audit carry IDs and field names
-- only, never provider payloads or stored values.
--
-- FiscalDocument deliberately does not duplicate invoice series, number,
-- currency, customer or money snapshots. Confirmed invoices are immutable;
-- consumers read the source through the composite tenant-ownership FK. Retries
-- update this row rather than creating an attempts table. The status transition
-- allow-list is out of scope and belongs to FISC-004.
--
-- At most one non-cancelled document exists per invoice. A cancelled row falls
-- outside the partial unique index; explicit cancellation must precede a new
-- issuance. All references are RESTRICT and tenant ownership is composite.
--
-- The cancellation biconditional mirrors the invoice number rule: a CANCELLED
-- document always carries cancelled_at and no other status may carry it, so the
-- timestamp and the state cannot disagree. No external-id/status coupling is
-- enforced here: an earlier draft coupled external_id to a fixed set of states,
-- which would have rejected the legitimate SUBMITTED -> APPROVED -> CANCELLED
-- path and would have over-constrained FISC-004's transition flow (the TD-023
-- lesson). Provider-reference consistency belongs to FISC-004.

CREATE TYPE "fiscal_provider" AS ENUM ('THIRD_PARTY', 'SIFEN_DIRECT', 'FAKE');
CREATE TYPE "fiscal_document_status" AS ENUM ('PENDING', 'QUEUED', 'SENDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ERROR', 'CANCEL_PENDING', 'CANCELLED');

CREATE TABLE "fiscal_document" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "provider" "fiscal_provider" NOT NULL,
  "status" "fiscal_document_status" NOT NULL DEFAULT 'PENDING',
  "external_id" TEXT,
  "cdc" TEXT,
  "xml_storage_key" TEXT,
  "kude_storage_key" TEXT,
  "request_snapshot" JSONB,
  "response_snapshot" JSONB,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_attempt_at" TIMESTAMPTZ(3),
  "last_error_code" TEXT,
  "last_error_message" TEXT,
  "submitted_at" TIMESTAMPTZ(3),
  "resolved_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_document_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fiscal_document_attempt_count_non_negative" CHECK ("attempt_count" >= 0),
  CONSTRAINT "fiscal_document_cancelled_at_iff_cancelled" CHECK (("cancelled_at" IS NULL) = ("status" <> 'CANCELLED'))
);

-- The ownership key must exist before the composite invoice FK targets it.
CREATE UNIQUE INDEX "fiscal_document_tenant_id_id_key" ON "fiscal_document"("tenant_id", "id");
CREATE INDEX "fiscal_document_tenant_id_status_idx" ON "fiscal_document"("tenant_id", "status");
CREATE INDEX "fiscal_document_tenant_id_invoice_id_idx" ON "fiscal_document"("tenant_id", "invoice_id");
CREATE UNIQUE INDEX "fiscal_document_tenant_id_invoice_id_key" ON "fiscal_document"("tenant_id", "invoice_id") WHERE "status" <> 'CANCELLED';

ALTER TABLE "fiscal_document" ADD CONSTRAINT "fiscal_document_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fiscal_document" ADD CONSTRAINT "fiscal_document_tenant_id_invoice_id_fkey"
  FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "invoice"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION "fiscal_document_no_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'a fiscal document cannot be deleted; cancel it instead'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "fiscal_document_no_delete_trigger"
  BEFORE DELETE ON "fiscal_document" FOR EACH ROW EXECUTE FUNCTION "fiscal_document_no_delete"();

-- A cancelled document is fully terminal. Only CANCELLED is enforced here:
-- whether an APPROVED or REJECTED row may still move is a property of the
-- transition graph, which FISC-004 owns. Enforcing broader terminal immutability
-- before that graph exists would repeat the BILL-001 defect, where a header
-- guard made CONFIRMED -> CANCELLED impossible.
CREATE OR REPLACE FUNCTION "fiscal_document_cancelled_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'CANCELLED' THEN
    RAISE EXCEPTION 'a cancelled fiscal document cannot be updated'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "fiscal_document_cancelled_immutable_trigger"
  BEFORE UPDATE ON "fiscal_document" FOR EACH ROW EXECUTE FUNCTION "fiscal_document_cancelled_immutable"();

CREATE OR REPLACE FUNCTION "fiscal_document_identity_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id" THEN
    RAISE EXCEPTION 'a fiscal document tenant_id cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'a fiscal document id cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."invoice_id" IS DISTINCT FROM OLD."invoice_id" THEN
    RAISE EXCEPTION 'a fiscal document invoice_id cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."provider" IS DISTINCT FROM OLD."provider" THEN
    RAISE EXCEPTION 'a fiscal document provider cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'a fiscal document created_at cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "fiscal_document_identity_immutable_trigger"
  BEFORE UPDATE ON "fiscal_document" FOR EACH ROW EXECUTE FUNCTION "fiscal_document_identity_immutable"();

CREATE OR REPLACE FUNCTION "fiscal_document_provider_refs_write_once"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."external_id" IS NOT NULL AND NEW."external_id" IS DISTINCT FROM OLD."external_id" THEN
    RAISE EXCEPTION 'a fiscal document external_id is write-once' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."cdc" IS NOT NULL AND NEW."cdc" IS DISTINCT FROM OLD."cdc" THEN
    RAISE EXCEPTION 'a fiscal document cdc is write-once' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "fiscal_document_provider_refs_write_once_trigger"
  BEFORE UPDATE ON "fiscal_document" FOR EACH ROW EXECUTE FUNCTION "fiscal_document_provider_refs_write_once"();

CREATE OR REPLACE FUNCTION "fiscal_document_attempts_monotonic"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."attempt_count" < OLD."attempt_count" THEN
    RAISE EXCEPTION 'a fiscal document attempt_count cannot decrease' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "fiscal_document_attempts_monotonic_trigger"
  BEFORE UPDATE ON "fiscal_document" FOR EACH ROW EXECUTE FUNCTION "fiscal_document_attempts_monotonic"();
