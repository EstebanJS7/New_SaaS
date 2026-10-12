-- Additive EPIC-16 FISC-016 WU-D: the record of a voided numbering range.
--
-- Voiding a range is a fiscal operation in its own right, not a local edit: the
-- emitter tells the tax administration that the numbers of an authorised range
-- **will not be used**. The schema asserts nothing about such a range — no
-- `dNumIn <= dNumFin`, no containment inside the timbrado, no match between the
-- document type and the timbrado (`SIFEN-BASELINE.md` §25.7) — so every one of
-- those rules is the operation's, and this table is the record that proves it
-- happened.
--
-- Four decisions are encoded here:
--
-- 1. **The operation voids the range's REMAINING TAIL** — `next_number ..
--    range_to` — and never the numbers already consumed. `fiscal_timbrado_range.
--    next_number` is documented "Never lowered: a consumed number is burnt", and
--    a number is burnt because it is part of a CDC that a rejected DE keeps
--    (Manual §6.5, baseline §12). A void that covered a consumed number would be
--    a lie about the tenant's own history, so the interval's lower bound is the
--    counter and the caller supplies only a reason.
-- 2. **The terminal status is the existing `RETIRED`.** Its own comment already
--    describes this operation — "An operator stopped using it. Kept as the
--    permanent record: its consumed numbers are burnt and can never be
--    reissued" — so no enum value is added. `range_status` below records the
--    status the attempt left the range in, which is what makes the record and
--    the flip checkable against each other.
-- 3. **The row is append-only.** A void that reached a provider is history: the
--    migration rejects every UPDATE and every DELETE, exactly like
--    `invoice_fiscal_allocation` and `invoice_line`.
-- 4. **One row per attempt.** `outcome` carries the provider's answer, so a void
--    the provider refused is recorded as faithfully as one it accepted — an
--    operator reading the tenant's history sees that the numbers were offered
--    and refused, which a success-only record could not say.
--
-- Protocol citations, all from `docs/06-fiscal/SIFEN-BASELINE.md`:
--
--   dNumIn/dNumFin  `tdNumDE`, 1..9999999 emitted zero-padded   §25.3, §21.3
--   mOtEve          `tmotEve`, 5..500                           §25.3
--   dEst/dPunExp    `[0-9]{3}`                                  §25.3
--   the event's iTiDE is `tiTiDEEv` (1..9), the DE's `tiTiDE` is (1,4,5,6,7,9,10)
--                                                                §25.2
--
-- No existing table, column, constraint or row is rewritten, no index is added
-- to an existing table, and no backfill is required: a range voided before this
-- unit simply has no row here.

CREATE TYPE "fiscal_range_void_outcome" AS ENUM (
  'VOIDED',
  'REJECTED',
  'CONFIGURATION_ERROR',
  'TRANSIENT_FAILURE'
);

CREATE TABLE "fiscal_range_void" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "range_id" UUID NOT NULL,
  -- The voided interval, as integers: the EMITTED form is `tdNumDE`'s
  -- zero-padded seven digits, produced at the edge like `dNumDoc` is.
  "from_number" INTEGER NOT NULL,
  "to_number" INTEGER NOT NULL,
  -- `mOtEve`, `tmotEve`: 5..500. The column holds exactly the text that
  -- travelled as the event's reason, so its domain is the facet's.
  "reason" VARCHAR(500) NOT NULL,
  -- The provider's answer. `VOIDED` is the accepted one; the other three are a
  -- refusal this client can classify, and none of them is "pending" — a void is
  -- answered in the call that carries it.
  "outcome" "fiscal_range_void_outcome" NOT NULL,
  -- The answer's own result code, carried verbatim: §25.5 records that no
  -- retrieved source enumerates the event family's codes, so a code this client
  -- has never seen is stored as itself. Our own client-side codes (a deadline, a
  -- skipped document stage) travel through the same column.
  "reason_code" TEXT,
  -- The service's own message, kept apart from the operator's `reason`.
  "provider_reason" TEXT,
  -- The provider's handle for the operation it accepted, when its answer carried
  -- one. `xs:long`-shaped, so TEXT rather than a numeric type.
  "provider_reference" TEXT,
  -- The range's status as the attempt left it. `RETIRED` when this operation
  -- performed the flip; unchanged when the provider refused, which is why it is
  -- recorded rather than assumed.
  "range_status" "fiscal_timbrado_range_status" NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fiscal_range_void_pkey" PRIMARY KEY ("id"),
  -- `dNumIn <= dNumFin` is OURS: the schema admits a reversed range and the
  -- operation would void nothing.
  CONSTRAINT "fiscal_range_void_interval_ordered" CHECK ("from_number" <= "to_number"),
  -- `tdNumDE`'s own bounds, which `tdNumDoc` shares: 1..9999999, never zero.
  CONSTRAINT "fiscal_range_void_from_number_tdNumDE"
    CHECK ("from_number" BETWEEN 1 AND 9999999),
  CONSTRAINT "fiscal_range_void_to_number_tdNumDE"
    CHECK ("to_number" BETWEEN 1 AND 9999999),
  -- `tmotEve`: 5..500.
  CONSTRAINT "fiscal_range_void_reason_tmotEve"
    CHECK (length("reason") BETWEEN 5 AND 500),
  -- The status flip and this record are one transaction, so the two cannot
  -- disagree: an accepted void cannot leave its range ACTIVE. The implication
  -- runs one way only — a refusal leaves the range wherever it already was, and
  -- a concurrent actor may have moved it.
  CONSTRAINT "fiscal_range_void_voided_left_the_range_unusable"
    CHECK ("outcome" <> 'VOIDED' OR "range_status" <> 'ACTIVE')
);

-- The reader's index: one range's voids, newest first, within one tenant.
CREATE INDEX "fiscal_range_void_tenant_id_range_id_created_at_idx"
  ON "fiscal_range_void"("tenant_id", "range_id", "created_at");

ALTER TABLE "fiscal_range_void"
  ADD CONSTRAINT "fiscal_range_void_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The range this record names. Referenced by its primary key because
-- `fiscal_timbrado_range` carries no `(tenant_id, id)` key to composite against;
-- a range cannot be deleted (its own no-delete trigger), so this reference can
-- never dangle.
ALTER TABLE "fiscal_range_void"
  ADD CONSTRAINT "fiscal_range_void_range_id_fkey"
  FOREIGN KEY ("range_id") REFERENCES "fiscal_timbrado_range"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The ownership check the composite FK above cannot state, because the key it
-- would need does not exist: the range must exist in THIS tenant. A trigger
-- rather than a CHECK because the invariant spans two tables, and it is the same
-- ground `invoice_fiscal_allocation` stands on.
CREATE OR REPLACE FUNCTION "fiscal_range_void_range_belongs_to_tenant"()
RETURNS TRIGGER AS $$
DECLARE
  owning_tenant UUID;
BEGIN
  SELECT "tenant_id" INTO owning_tenant
    FROM "fiscal_timbrado_range"
   WHERE "tenant_id" = NEW."tenant_id" AND "id" = NEW."range_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'timbrado range % does not belong to tenant %',
      NEW."range_id", NEW."tenant_id"
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "fiscal_range_void_range_belongs_to_tenant_trigger"
  BEFORE INSERT ON "fiscal_range_void" FOR EACH ROW
  EXECUTE FUNCTION "fiscal_range_void_range_belongs_to_tenant"();

-- A void that reached a provider is history, not a draft: no UPDATE and no
-- DELETE, for every caller including a migration.
CREATE OR REPLACE FUNCTION "fiscal_range_void_no_update"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'a range void is written once and cannot be updated'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "fiscal_range_void_no_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'a range void cannot be deleted; the operation happened'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "fiscal_range_void_no_update_trigger"
  BEFORE UPDATE ON "fiscal_range_void" FOR EACH ROW
  EXECUTE FUNCTION "fiscal_range_void_no_update"();

CREATE TRIGGER "fiscal_range_void_no_delete_trigger"
  BEFORE DELETE ON "fiscal_range_void" FOR EACH ROW
  EXECUTE FUNCTION "fiscal_range_void_no_delete"();
