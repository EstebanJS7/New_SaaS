-- Additive migration: EPIC-12 POS-002 cash data foundation.
--
-- Adds the minimum tenant-scoped PRD §20 Cash model that makes PRD §18's
-- CompleteSale satisfiable (DEC-020): `cash_register`, `cash_session` and
-- `cash_movement`, plus the two enums they need. This migration is strictly
-- additive: it creates two enums, three tables and their
-- indexes/constraints/triggers, alters no existing table and inserts no rows —
-- a cash register, session or movement is user data, not seed data.
--
-- The movement enum is added additively with `SALE` only (DEC-020). The six
-- remaining PRD §20 kinds — `REFUND`, `INCOME`, `EXPENSE`, `WITHDRAWAL`,
-- `DEPOSIT` and `ADJUSTMENT` — stay reserved for EPIC-13, which owns their
-- commands, and are appended by that epic rather than reordered or removed.
-- Session close, the expected/counted difference, cash reversals and the full
-- cash UI are equally out of scope: nothing in this migration or in this slice
-- writes a movement at all — POS-003 does, inside the CompleteSale transaction.
--
-- There is deliberately NO `branch_id` (DEC-020): cash is tenant-wide, exactly
-- like the tenant-wide stock decision.
--
-- Foreign keys are RESTRICT everywhere. Tenant ownership is carried by the
-- composite shape `(tenant_id, id)` on all three tables, so a session can only
-- reference a register of the SAME tenant and a movement can only reference a
-- register and a session of the SAME tenant:
--   * `cash_session(tenant_id, register_id) -> cash_register(tenant_id, id)`
--   * `cash_session(tenant_id, opened_by_membership_id)
--        -> tenant_membership(tenant_id, id)`
--   * `cash_movement(tenant_id, register_id) -> cash_register(tenant_id, id)`
--   * `cash_movement(tenant_id, session_id) -> cash_session(tenant_id, id)`
-- The opener is a MEMBERSHIP of the same tenant rather than a global
-- `user_profile` reference, so the database guarantees the opener belongs to the
-- session's tenant (the 2026-09-29 DEC-020 subsequent-scope note).
--
-- The database additionally enforces the aggregate invariants the application
-- layer must respect:
--   * only ONE `OPEN` session exists per register. The mechanism is the explicit
--     PARTIAL unique index `cash_session_one_open_per_register_key` on
--     (tenant_id, register_id) WHERE status = 'OPEN', declared as raw SQL
--     because Prisma cannot express partial indexes (the supplier tax-id key is
--     the precedent). A concurrent second open is therefore rejected by
--     PostgreSQL rather than by a service check, which PRD §20 requires. Closed
--     sessions fall outside the index entirely, so any number of them coexist.
--   * a register name is non-empty and bounded to 1..200 characters, and is
--     unique per tenant;
--   * the session OPENING AMOUNT is non-negative (`>= 0`): `0.00` is allowed
--     because a register may open with an empty drawer, and a negative opening
--     amount is not a representable drawer;
--   * a movement amount is non-zero (`<> 0`). The SIGN is owned by the movement
--     kind rather than by the caller, so the column never encodes the direction
--     twice;
--   * confirmed cash records are IMMUTABLE. There is no draft state in cash, so
--     every session and every movement is a confirmed record: an unconditional
--     `BEFORE DELETE` trigger raises `restrict_violation` on `cash_session` and
--     on `cash_movement`. `cash_movement` additionally carries a `BEFORE UPDATE`
--     trigger rejecting any update, so a confirmed movement is immutable rather
--     than merely undeletable; an incorrect movement is corrected by a
--     compensating movement (PRD §20, PRD §40), never by an edit or a delete.
--
-- Data classification: register names, session statuses, cash amounts and the
-- optional movement reason are INTERNAL (PRD §41); logs and audit carry ids and
-- field names only — never a payload.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Cash movement kind (PRD §20, DEC-020), pinned to exactly one value for this
-- epic: `SALE`. It is the only kind EPIC-12 writes (POS-003 appends it inside
-- the CompleteSale transaction); `REFUND`, `INCOME`, `EXPENSE`, `WITHDRAWAL`,
-- `DEPOSIT` and `ADJUSTMENT` stay reserved for EPIC-13. Evolve additively only.
CREATE TYPE "cash_movement_type" AS ENUM ('SALE');

-- Cash session lifecycle (PRD §20), pinned to exactly these two states. A
-- session is created OPEN by the session-open command and reaches CLOSED only
-- through the EPIC-13 close command. Evolve additively only.
CREATE TYPE "cash_session_status" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "cash_register" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  -- Operator-facing drawer name, required and bounded to 1..200 characters.
  "name" VARCHAR(200) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cash_register_pkey" PRIMARY KEY ("id"),
  -- Required drawer name, 1..200 characters. The column already caps the upper
  -- bound; the CHECK adds the non-empty lower bound and keeps one authoritative
  -- length rule in the DDL that the register-create DTO mirrors.
  CONSTRAINT "cash_register_name_length" CHECK (char_length("name") BETWEEN 1 AND 200)
);

CREATE TABLE "cash_session" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "register_id" UUID NOT NULL,
  "status" "cash_session_status" NOT NULL DEFAULT 'OPEN',
  "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- The opener, resolved server-side from the authenticated request context and
  -- backed by the composite RESTRICT reference to tenant_membership below.
  "opened_by_membership_id" UUID NOT NULL,
  -- Required opening amount (the 2026-09-29 DEC-020 subsequent-scope note):
  -- DECIMAL(14,2) NOT NULL, 0.00 allowed, negative rejected by the CHECK. It is
  -- the baseline PRD §20's server-computed expected amount at close is compared
  -- against.
  "opening_amount" DECIMAL(14,2) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cash_session_pkey" PRIMARY KEY ("id"),
  -- A drawer cannot open with a negative opening amount: 0.00 stays allowed.
  CONSTRAINT "cash_session_opening_amount_non_negative" CHECK ("opening_amount" >= 0)
);

CREATE TABLE "cash_movement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "register_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "type" "cash_movement_type" NOT NULL,
  -- Exact money on the reference scale; the sign is owned by the movement kind.
  "amount" DECIMAL(14,2) NOT NULL,
  -- OPTIONAL free-text explanation, bounded. The only kind this epic writes is
  -- SALE, which is self-describing; the kinds that need an explanation
  -- (INCOME, EXPENSE, ADJUSTMENT) arrive with EPIC-13.
  "reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cash_movement_pkey" PRIMARY KEY ("id"),
  -- A zero movement is never meaningful: `SALE` is positive and the reserved
  -- kinds carry their own sign, so zero is rejected rather than stored.
  CONSTRAINT "cash_movement_amount_non_zero" CHECK ("amount" <> 0)
);

-- Tenant-ownership key: the target of the composite register FKs from
-- `cash_session` and `cash_movement`, so a session or a movement can only
-- reference a register of the SAME tenant.
CREATE UNIQUE INDEX "cash_register_tenant_id_id_key" ON "cash_register"("tenant_id", "id");

-- One register name per tenant: a registry whose two drawers shared one name
-- would make the register ambiguous to the operator. tenant_id leads the key,
-- so the same name in another tenant is a different register.
CREATE UNIQUE INDEX "cash_register_tenant_id_name_key" ON "cash_register"("tenant_id", "name");

-- Tenant-ownership key: the target of the composite session FK from
-- `cash_movement`.
CREATE UNIQUE INDEX "cash_session_tenant_id_id_key" ON "cash_session"("tenant_id", "id");

-- THE one-OPEN-session rule (PRD §20, DEC-020). Explicit PARTIAL unique index,
-- declared as raw SQL because Prisma cannot express partial indexes, exactly
-- like the supplier tax-id key: the `WHERE status = 'OPEN'` predicate leaves
-- CLOSED sessions outside the index entirely, so any number of closed sessions
-- coexist per register while a second OPEN row for the same (tenant, register)
-- is rejected by the database. This is a database property rather than an
-- application convention so no second writer can forget it.
CREATE UNIQUE INDEX "cash_session_one_open_per_register_key" ON "cash_session"("tenant_id", "register_id") WHERE "status" = 'OPEN';

-- Tenant list lookup: `(tenant_id, status)` serves the status-filtered session
-- list without a second scan. It enforces nothing; the one-OPEN rule above does.
CREATE INDEX "cash_session_tenant_id_status_idx" ON "cash_session"("tenant_id", "status");

-- Tenant-ownership key, mirroring every other tenant-scoped aggregate.
CREATE UNIQUE INDEX "cash_movement_tenant_id_id_key" ON "cash_movement"("tenant_id", "id");

ALTER TABLE "cash_register" ADD CONSTRAINT "cash_register_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "cash_session" ADD CONSTRAINT "cash_session_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: a session can only reference a register of the
-- SAME tenant, and the register can never be hard-deleted out from under it.
ALTER TABLE "cash_session" ADD CONSTRAINT "cash_session_tenant_id_register_id_fkey"
  FOREIGN KEY ("tenant_id", "register_id") REFERENCES "cash_register"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: the opener must be a membership of the SAME
-- tenant, so a foreign-tenant operator is not a representable state and a
-- membership that opened a session can never be hard-deleted out from under it
-- (the 2026-09-29 DEC-020 subsequent-scope note). A global `user_profile`
-- reference could not guarantee this.
ALTER TABLE "cash_session" ADD CONSTRAINT "cash_session_tenant_id_opened_by_membership_id_fkey"
  FOREIGN KEY ("tenant_id", "opened_by_membership_id") REFERENCES "tenant_membership"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: a movement can only reference a register of
-- the SAME tenant.
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_tenant_id_register_id_fkey"
  FOREIGN KEY ("tenant_id", "register_id") REFERENCES "cash_register"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: a movement can only reference a session of the
-- SAME tenant, so a movement of tenant A can never attach to tenant B's drawer.
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_tenant_id_session_id_fkey"
  FOREIGN KEY ("tenant_id", "session_id") REFERENCES "cash_session"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Confirmed cash records are immutable, and there is no draft state in cash:
-- a session is a confirmed record from the moment it is opened.
CREATE OR REPLACE FUNCTION "cash_session_no_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'a cash session cannot be hard-deleted; sessions are confirmed records'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cash_session_no_delete_trigger"
  BEFORE DELETE ON "cash_session"
  FOR EACH ROW EXECUTE FUNCTION "cash_session_no_delete"();

CREATE OR REPLACE FUNCTION "cash_movement_no_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'a confirmed cash movement cannot be deleted; correct it with a compensating movement'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cash_movement_no_delete_trigger"
  BEFORE DELETE ON "cash_movement"
  FOR EACH ROW EXECUTE FUNCTION "cash_movement_no_delete"();

-- Slice-level strengthening of the story's delete-trigger guarantee: a
-- confirmed movement is immutable, not merely undeletable, so an UPDATE is
-- rejected too. PRD §20 states that confirmed movements are immutable and PRD
-- §40 corrects an incorrect movement with a compensating movement; allowing an
-- in-place edit would make the ledger the derived expected amount rests on a
-- mutable record and would let a stored amount silently change.
CREATE OR REPLACE FUNCTION "cash_movement_no_update"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'a confirmed cash movement is immutable; correct it with a compensating movement'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cash_movement_no_update_trigger"
  BEFORE UPDATE ON "cash_movement"
  FOR EACH ROW EXECUTE FUNCTION "cash_movement_no_update"();
