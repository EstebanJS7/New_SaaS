-- SAL-REV-001 / DEC-089: reversal of a COMPLETED sale (PRD §40, TD-018).
--
-- A reversal is an explicit business operation, never an edit: the sale's lines,
-- payments and original ledger movements stay exactly as they were, and the
-- reversal ADDS compensating records that point back at what they compensate.
-- Everything here is additive; no existing row is rewritten.

-- 1. The compensating stock movement kind TD-018 reserved. A reversal returns the
--    sold quantity with a signed POSITIVE `SALE_REVERSAL` movement.
ALTER TYPE "stock_movement_type" ADD VALUE IF NOT EXISTS 'SALE_REVERSAL';

-- 2. The sale a ledger movement belongs to. Before this migration a `SALE` stock
--    or cash movement carried no reference to its sale, so a reversal could not
--    find what it compensates. From now on the completion and the reversal both
--    stamp it. Nullable because every other movement kind (purchases, manual
--    adjustments, cash income/expense) belongs to no sale, and because rows
--    written before this migration cannot be back-filled honestly.
ALTER TABLE "stock_movement" ADD COLUMN "sale_id" UUID;
ALTER TABLE "cash_movement" ADD COLUMN "sale_id" UUID;

ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_tenant_id_sale_id_fkey"
  FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sale"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_tenant_id_sale_id_fkey"
  FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sale"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "stock_movement_tenant_id_sale_id_idx" ON "stock_movement"("tenant_id", "sale_id");
CREATE INDEX "cash_movement_tenant_id_sale_id_idx" ON "cash_movement"("tenant_id", "sale_id");

-- 3. The reversal itself: who, when, why, and the cash session a cash refund was
--    paid out of. One per sale — the UNIQUE is what makes "a reversal cannot be
--    executed twice" a database fact rather than an application promise.
CREATE TABLE "sale_reversal" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "sale_id" UUID NOT NULL,
  -- INTERNAL free text, mandatory (PRD §40 "require reason").
  "reason" VARCHAR(500) NOT NULL,
  "reversed_by_user_profile_id" UUID NOT NULL,
  -- The OPEN session a CASH refund came out of; null when no payment was cash.
  "cash_session_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sale_reversal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sale_reversal_reason_not_blank" CHECK (btrim("reason") <> '')
);

CREATE UNIQUE INDEX "sale_reversal_tenant_id_id_key" ON "sale_reversal"("tenant_id", "id");
CREATE UNIQUE INDEX "sale_reversal_tenant_id_sale_id_key" ON "sale_reversal"("tenant_id", "sale_id");

ALTER TABLE "sale_reversal" ADD CONSTRAINT "sale_reversal_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sale_reversal" ADD CONSTRAINT "sale_reversal_tenant_id_sale_id_fkey"
  FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sale"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sale_reversal" ADD CONSTRAINT "sale_reversal_reversed_by_user_profile_id_fkey"
  FOREIGN KEY ("reversed_by_user_profile_id") REFERENCES "user_profile"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sale_reversal" ADD CONSTRAINT "sale_reversal_tenant_id_cash_session_id_fkey"
  FOREIGN KEY ("tenant_id", "cash_session_id") REFERENCES "cash_session"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 4. One refund record per original payment (PRD §40: "Payment original ↓
--    Refund/Reversal record"; the original payment is never changed). Same
--    method and amount as the payment it refunds, because this slice reverses
--    the WHOLE sale. A CASH refund points at the REFUND cash movement it wrote.
CREATE TABLE "payment_refund" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "sale_reversal_id" UUID NOT NULL,
  "method" "payment_method" NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "cash_movement_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_refund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_refund_amount_positive" CHECK ("amount" > 0),
  -- A cash refund always has its cash movement, and only a cash refund has one.
  CONSTRAINT "payment_refund_cash_movement_iff_cash"
    CHECK (("method" = 'CASH') = ("cash_movement_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "payment_refund_tenant_id_id_key" ON "payment_refund"("tenant_id", "id");
-- A payment is refunded at most once.
CREATE UNIQUE INDEX "payment_refund_tenant_id_payment_id_key" ON "payment_refund"("tenant_id", "payment_id");
-- A cash movement is the refund of at most one payment.
CREATE UNIQUE INDEX "payment_refund_tenant_id_cash_movement_id_key" ON "payment_refund"("tenant_id", "cash_movement_id");
CREATE INDEX "payment_refund_tenant_id_sale_reversal_id_idx" ON "payment_refund"("tenant_id", "sale_reversal_id");

ALTER TABLE "payment_refund" ADD CONSTRAINT "payment_refund_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payment_refund" ADD CONSTRAINT "payment_refund_tenant_id_payment_id_fkey"
  FOREIGN KEY ("tenant_id", "payment_id") REFERENCES "payment"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payment_refund" ADD CONSTRAINT "payment_refund_tenant_id_sale_reversal_id_fkey"
  FOREIGN KEY ("tenant_id", "sale_reversal_id") REFERENCES "sale_reversal"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payment_refund" ADD CONSTRAINT "payment_refund_tenant_id_cash_movement_id_fkey"
  FOREIGN KEY ("tenant_id", "cash_movement_id") REFERENCES "cash_movement"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 5. Both new tables are append-only, like the ledgers they sit beside.
CREATE OR REPLACE FUNCTION "sale_reversal_records_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sale_reversal_no_update_delete_trigger"
  BEFORE UPDATE OR DELETE ON "sale_reversal"
  FOR EACH ROW EXECUTE FUNCTION "sale_reversal_records_immutable"();

CREATE TRIGGER "payment_refund_no_update_delete_trigger"
  BEFORE UPDATE OR DELETE ON "payment_refund"
  FOR EACH ROW EXECUTE FUNCTION "sale_reversal_records_immutable"();
