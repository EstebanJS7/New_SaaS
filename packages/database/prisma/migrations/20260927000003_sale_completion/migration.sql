-- Additive migration: EPIC-12 POS-003 sale completion data foundation.
--
-- Adds the two tables PRD §18's CompleteSale command needs (DEC-024, DEC-029) —
-- the tenant-scoped `payment` rows of PRD §19 and the tenant-scoped
-- `idempotency_record` — plus the `payment_method` enum, and appends the
-- additive `SALE` value to `stock_movement_type`. This migration is strictly
-- additive: it creates one enum, two tables and their indexes/constraints/
-- triggers, appends one enum value, alters no other existing table and inserts
-- no rows — a payment or an idempotency record is user data, not seed data.
--
-- TRANSACTION NOTE: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction
-- block on PostgreSQL 11 and older, and on PostgreSQL 12+ it may run inside a
-- transaction as long as the new value is NOT used in that same transaction.
-- This migration only adds the value and never references it, and the supported
-- server is PostgreSQL 16, so the plain single-statement form below is applied
-- by `prisma migrate deploy` as-is, exactly like the EPIC-11 receiving
-- precedent. The applied value is proven against a live PostgreSQL by the
-- completion live-database evidence.
--
-- There is deliberately NO `tendered_amount`, no `change`, no `refunded_amount`
-- and no customer-credit column (DEC-029): the operator enters the exact amount
-- that enters the register, the payments must sum to the sale total exactly,
-- and a refund is the deferred compensating operation of DEC-023 rather than a
-- stored field. The idempotency table carries no automatic purge (TD-020): PRD
-- §41 forbids a destructive retention policy before one is approved, so the
-- rows accumulate instead.
--
-- Foreign keys are RESTRICT everywhere. Tenant ownership is carried by the
-- composite shape `(tenant_id, id)` on both tables, so a payment and an
-- idempotency record can only reference a sale of the SAME tenant:
--   * `payment(tenant_id, sale_id) -> sale(tenant_id, id)`
--   * `idempotency_record(tenant_id, result_sale_id) -> sale(tenant_id, id)`
--
-- The database additionally enforces the aggregate invariants the application
-- layer must respect:
--   * a payment amount is STRICTLY POSITIVE (`amount > 0`), and the operation
--     token and the idempotency key are non-empty and bounded, so a stored
--     record always means something;
--   * idempotency uniqueness is `(tenant_id, operation, key)`, so the key scope
--     is the tenant rather than global and a replay is a database property
--     instead of a service convention;
--   * immutability is CONDITIONAL on the sale status (DEC-023), exactly like
--     `sale_line`: a `BEFORE DELETE` AND a `BEFORE UPDATE` trigger on `payment`
--     raise `restrict_violation` ONLY while the owning sale is COMPLETED or
--     CANCELLED, so a draft's payment rows stay reconcilable while a confirmed
--     payment is immutable and readable.
--
-- Data classification: payment amounts and the operation token, key and
-- fingerprint are INTERNAL (PRD §41); logs and audit carry ids and field names
-- only — never a payload.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- The additive negative-output movement kind EPIC-12 POS-003 writes: one signed
-- negative `SALE` movement per completing line. `ADJUSTMENT` and `PURCHASE`
-- keep their original positions and behaviour; `TRANSFER_*` and the
-- `*_REVERSAL` compensations stay reserved for later slices.
ALTER TYPE "stock_movement_type" ADD VALUE 'SALE';

-- PRD §19 payment method (DEC-029), pinned to exactly the six values the PRD
-- lists, in its order. A new tender kind is appended additively.
CREATE TYPE "payment_method" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'QR', 'CHECK', 'OTHER');

CREATE TABLE "payment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "sale_id" UUID NOT NULL,
  "method" "payment_method" NOT NULL,
  -- Exact money on the reference scale; the CHECK rejects a non-positive value.
  "amount" DECIMAL(14,2) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_pkey" PRIMARY KEY ("id"),
  -- A payment of zero or less is never meaningful (DEC-029): the payments must
  -- sum to the sale total exactly, and a negative payment is a refund, which is
  -- a deferred compensating operation rather than a stored row.
  CONSTRAINT "payment_amount_positive" CHECK ("amount" > 0)
);

CREATE TABLE "idempotency_record" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  -- Stable command token, for example `sale.complete`.
  "operation" VARCHAR(64) NOT NULL,
  -- The caller-supplied `Idempotency-Key` header value, bounded.
  "key" VARCHAR(255) NOT NULL,
  -- SHA-256 hex of the canonical request body (DEC-024).
  "fingerprint" VARCHAR(64) NOT NULL,
  -- The stored result reference: the sale the operation produced.
  "result_sale_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id"),
  -- A blank operation token or key is never meaningful. The columns already cap
  -- the upper bounds; the CHECKs add the non-empty lower bound and keep one
  -- authoritative length rule in the DDL that the command DTO mirrors.
  CONSTRAINT "idempotency_record_operation_length" CHECK (char_length("operation") BETWEEN 1 AND 64),
  CONSTRAINT "idempotency_record_key_length" CHECK (char_length("key") BETWEEN 1 AND 255)
);

-- Tenant-ownership key: the target of the composite sale FK from `payment`, so
-- a payment can only reference a sale of the SAME tenant.
CREATE UNIQUE INDEX "payment_tenant_id_id_key" ON "payment"("tenant_id", "id");

-- Tenant-ownership key: the target of the composite result-sale FK from
-- `idempotency_record`.
CREATE UNIQUE INDEX "idempotency_record_tenant_id_id_key" ON "idempotency_record"("tenant_id", "id");

-- One record per (tenant, operation, key) (DEC-024): the replay key. tenant_id
-- leads it, so the same key in another tenant is a different record and the key
-- scope is the tenant, never global.
CREATE UNIQUE INDEX "idempotency_record_tenant_id_operation_key_key"
  ON "idempotency_record"("tenant_id", "operation", "key");

ALTER TABLE "payment" ADD CONSTRAINT "payment_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: a payment can only reference a sale of the
-- SAME tenant, and a sale can never be hard-deleted out from under its payments.
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenant_id_sale_id_fkey"
  FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sale"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: the stored result sale must be in the SAME
-- tenant, so a replay can never resolve a foreign-tenant sale.
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_tenant_id_result_sale_id_fkey"
  FOREIGN KEY ("tenant_id", "result_sale_id") REFERENCES "sale"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- CONDITIONAL immutability (DEC-023), mirroring the `sale_line` shape. A DELETE
-- is rejected ONLY while the owning sale is COMPLETED or CANCELLED, so a
-- payment belonging to a draft under construction stays reconcilable while a
-- confirmed payment stays immutable and readable. This is deliberately NOT the
-- unconditional trigger shape the catalog, supplier and cash tables use.
CREATE OR REPLACE FUNCTION "payment_no_delete_when_completed_or_cancelled"()
RETURNS TRIGGER AS $$
DECLARE
  parent_status "sale_status";
BEGIN
  SELECT "status" INTO parent_status
  FROM "sale"
  WHERE "tenant_id" = OLD."tenant_id" AND "id" = OLD."sale_id";

  IF parent_status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION
      'a payment of a completed or cancelled sale cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payment_no_delete_when_completed_or_cancelled_trigger"
  BEFORE DELETE ON "payment"
  FOR EACH ROW EXECUTE FUNCTION "payment_no_delete_when_completed_or_cancelled"();

-- The same conditional rule for UPDATE: a confirmed payment is IMMUTABLE rather
-- than merely undeletable, so a stored method or amount cannot silently change
-- while its sale is settled. A draft's payment row stays updatable.
CREATE OR REPLACE FUNCTION "payment_no_update_when_completed_or_cancelled"()
RETURNS TRIGGER AS $$
DECLARE
  parent_status "sale_status";
BEGIN
  SELECT "status" INTO parent_status
  FROM "sale"
  WHERE "tenant_id" = OLD."tenant_id" AND "id" = OLD."sale_id";

  IF parent_status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION
      'a payment of a completed or cancelled sale is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payment_no_update_when_completed_or_cancelled_trigger"
  BEFORE UPDATE ON "payment"
  FOR EACH ROW EXECUTE FUNCTION "payment_no_update_when_completed_or_cancelled"();

-- There is deliberately NO delete trigger on `idempotency_record`: nothing
-- purges these rows and PRD §41 forbids an automatic destructive retention
-- policy before one is approved (TD-020). An undeletable row would only block
-- the approved policy when it lands.
