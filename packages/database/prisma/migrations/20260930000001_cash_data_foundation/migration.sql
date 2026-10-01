-- Additive migration: EPIC-13 CASH-001 cash data foundation extension.
--
-- Extends the EPIC-12 Cash foundation without rewriting confirmed rows: appends
-- the six remaining PRD §20 movement kinds, stores close-result amounts on the
-- session, requires reasons for every non-SALE movement kind and prevents new
-- movements from being inserted into a CLOSED session.
--
-- PostgreSQL migrations run in one transaction under `prisma migrate deploy`.
-- New enum values added by `ALTER TYPE ... ADD VALUE` are therefore not used as
-- enum literals later in this same migration: the reason CHECK casts `type` to
-- text before comparing `SALE` and `INCOME`, which is transaction-safe while
-- preserving DEC-032's rule that INCOME does not require a reason.
--
-- Data classification: cash close amounts, movement types and movement reasons
-- are INTERNAL (PRD §41); logs and audit carry ids and field names only.

ALTER TYPE "cash_movement_type" ADD VALUE 'REFUND';
ALTER TYPE "cash_movement_type" ADD VALUE 'INCOME';
ALTER TYPE "cash_movement_type" ADD VALUE 'EXPENSE';
ALTER TYPE "cash_movement_type" ADD VALUE 'WITHDRAWAL';
ALTER TYPE "cash_movement_type" ADD VALUE 'DEPOSIT';
ALTER TYPE "cash_movement_type" ADD VALUE 'ADJUSTMENT';

ALTER TABLE "cash_session"
  ADD COLUMN "expected_amount" DECIMAL(14,2),
  ADD COLUMN "counted_amount" DECIMAL(14,2),
  ADD COLUMN "difference_amount" DECIMAL(14,2);

ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_reason_required"
  CHECK ("type"::text IN ('SALE', 'INCOME') OR ("reason" IS NOT NULL AND btrim("reason") <> ''));

CREATE OR REPLACE FUNCTION "cash_movement_no_insert_into_closed_session"()
RETURNS TRIGGER AS $$
DECLARE
  session_status "cash_session_status";
BEGIN
  SELECT "status"
    INTO session_status
    FROM "cash_session"
    WHERE "id" = NEW."session_id"
    FOR UPDATE;

  IF session_status = 'CLOSED' THEN
    RAISE EXCEPTION 'a cash movement cannot be inserted into a closed session'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cash_movement_no_insert_into_closed_session_trigger"
  BEFORE INSERT ON "cash_movement"
  FOR EACH ROW EXECUTE FUNCTION "cash_movement_no_insert_into_closed_session"();
