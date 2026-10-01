-- Additive migration: EPIC-14 BILL-003 invoice header guard tightening (TD-023).
--
-- Replaces the BODY of `invoice_no_update_unless_permitted_transition` so the
-- header guard constrains not only WHICH status transition is legal but also
-- WHICH columns that transition may change (PRD §21, DEC-038, DEC-043).
--
-- The defect it closes is the one TD-023 records: the guard read `OLD."status"`
-- and `NEW."status"` and compared nothing else, so a permitted transition was
-- free to rewrite the document's identity while it moved the status — a
-- cancellation could re-point the invoice to another sale or another customer,
-- change its currency or its series, or move `created_at`, and the database
-- would accept it. `number` was already protected during any transition by
-- `invoice_number_never_reallocated`, and the `invoice_line` snapshot is guarded
-- unconditionally; the header was the remaining gap, so the "immutable from
-- creation" rule (DEC-038) rested on the application writing only the intended
-- columns instead of on the schema.
--
-- The replacement keeps the existing transition allow-list exactly as it was —
-- any update of a `CANCELLED` row is rejected, `DRAFT -> DRAFT` is rejected, and
-- only `DRAFT -> CONFIRMED`, `DRAFT -> CANCELLED` and `CONFIRMED -> CANCELLED`
-- pass — and then adds one ownership clause: a PERMITTED transition may only
-- change the columns that transition owns. `tenant_id`, `id`, `sale_id`,
-- `customer_id`, `currency`, `series` and `created_at` belong to no transition
-- and must be `IS NOT DISTINCT FROM` their old values, and `confirmed_at` is
-- owned by `DRAFT -> CONFIRMED` ALONE, which is what keeps a cancelled invoice's
-- original confirmation time intact. `updated_at` stays freely writable because
-- Prisma writes it on confirm and on cancel, and `cancelled_at`/`cancel_reason`
-- stay writable on the cancellation path because the existing CHECKs already tie
-- both to the `CANCELLED` status. `number` keeps its own guard and `status` keeps
-- the allow-list, so no column gains a second authority.
--
-- This migration is strictly additive: it replaces ONE function body with
-- `CREATE OR REPLACE FUNCTION` and does nothing else. It alters no table, adds
-- no column, creates no index, constraint or trigger, writes no row and drops
-- nothing.
--
-- The `invoice_no_update_unless_permitted_transition_trigger` declared by
-- `20261001000001_billing_invoice_foundation` is NOT recreated: it resolves the
-- function by NAME, so replacing the body is enough and the trigger keeps its
-- exact timing and event. `invoice_no_update_unless_permitted_transition` and
-- `invoice_number_never_reallocated` both fire as `BEFORE UPDATE ... FOR EACH
-- ROW`, so the tightened guard is the first of the two alphabetically and its
-- message is the one a caller sees for a column it owns.
--
-- The replacement is safe because the previous body is not yet a shipped
-- contract: `20261001000001_billing_invoice_foundation` belongs to the
-- UNRELEASED EPIC-14 slice and nothing outside BILL-003 writes these
-- transitions — the `confirm` and `cancel` commands of the same work unit are
-- the FIRST writers, and they change exactly the columns the transitions own.
-- No existing row is rewritten or revalidated by this migration: replacing a
-- function constrains only FUTURE `UPDATE` statements, so every already-stored
-- invoice keeps its stored values untouched, and a close of TD-023 that landed
-- as a data migration would have been the riskier change. PostgreSQL runs every
-- Prisma migration in ONE transaction under `prisma migrate deploy`, so this
-- file carries no explicit `BEGIN`/`COMMIT`.
--
-- Data classification: no column is added or reclassified here. The invoice's
-- references to a customer and to a sale remain CONFIDENTIAL while its money
-- amounts, status, series and number remain INTERNAL (PRD §41). Every rejection
-- message names a COLUMN rather than a stored value:
-- logs and audit carry ids and field names only — never a payload.

-- TD-023: the header guard's replacement body. The transition allow-list below
-- is byte-for-byte the shipped one; the ownership clause after it is what makes
-- the "immutable from creation" rule a schema property for the columns no
-- transition owns. Evolve additively only.
CREATE OR REPLACE FUNCTION "invoice_no_update_unless_permitted_transition"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'CANCELLED' THEN
    RAISE EXCEPTION 'a cancelled invoice is terminal and cannot be updated'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'DRAFT' THEN
    RAISE EXCEPTION 'a draft invoice is immutable; confirm or cancel it instead of editing it'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NOT (
    (OLD."status" = 'DRAFT' AND NEW."status" IN ('CONFIRMED', 'CANCELLED'))
    OR (OLD."status" = 'CONFIRMED' AND NEW."status" = 'CANCELLED')
  ) THEN
    RAISE EXCEPTION 'an issued invoice is immutable; only cancellation is permitted'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- From here on the update IS a permitted transition. Ownership: the document
  -- keeps its identity, its source sale, its customer, its currency, its series
  -- and its creation timestamp through every transition, so a cancellation can
  -- never become a rewrite of the document it cancels (DEC-038, DEC-043).
  IF NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id" THEN
    RAISE EXCEPTION 'a permitted transition cannot move an invoice to another tenant'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'a permitted transition cannot change the invoice id'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."sale_id" IS DISTINCT FROM OLD."sale_id" THEN
    RAISE EXCEPTION 'a permitted transition cannot re-point an invoice to another sale'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."customer_id" IS DISTINCT FROM OLD."customer_id" THEN
    RAISE EXCEPTION 'a permitted transition cannot change the invoice customer'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."currency" IS DISTINCT FROM OLD."currency" THEN
    RAISE EXCEPTION 'a permitted transition cannot change the invoice currency'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."series" IS DISTINCT FROM OLD."series" THEN
    RAISE EXCEPTION 'a permitted transition cannot change the invoice series'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'a permitted transition cannot change the invoice creation timestamp'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- `confirmed_at` is owned by the confirmation ALONE (DEC-039): only
  -- `DRAFT -> CONFIRMED` may write it, so a cancellation of an issued invoice
  -- keeps the original confirmation time it is evidence of. A `DRAFT ->
  -- CANCELLED` row has no confirmation to move.
  IF NEW."confirmed_at" IS DISTINCT FROM OLD."confirmed_at"
    AND NOT (OLD."status" = 'DRAFT' AND NEW."status" = 'CONFIRMED') THEN
    RAISE EXCEPTION 'a permitted transition cannot change the invoice confirmation timestamp'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
