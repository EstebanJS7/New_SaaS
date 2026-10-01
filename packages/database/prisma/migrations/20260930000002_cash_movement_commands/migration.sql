-- Additive migration: EPIC-13 CASH-002 cash movement commands (data layer).
--
-- Adds the explicit ADJUSTMENT direction to the `cash_movement` ledger PRD §20
-- defines. PRD §20 names ADJUSTMENT beside the other cash movement kinds but
-- never says where the sign of a corrective amount lives; DEC-030 keeps every
-- stored amount POSITIVE and lets the movement TYPE own the sign, so the six
-- kinds other than ADJUSTMENT already imply their direction
-- (SALE/INCOME/DEPOSIT increase, REFUND/EXPENSE/WITHDRAWAL decrease) while an
-- ADJUSTMENT can go either way and must state it explicitly. This migration
-- adds the enum and the nullable column that carry that explicit choice; the
-- amount column is untouched and stays positive.
--
-- PostgreSQL runs each Prisma migration in ONE transaction under
-- `prisma migrate deploy`. The six remaining `cash_movement_type` values were
-- appended with `ALTER TYPE ... ADD VALUE` by
-- `20260930000001_cash_data_foundation`, and freshly appended enum values are
-- not safe to use as enum literals inside the same transaction that added them.
-- The CHECK below therefore compares `"type"::text` against 'ADJUSTMENT' as
-- TEXT and never casts 'ADJUSTMENT' to the `cash_movement_type` enum.
--
-- The column is NULLABLE and the exclusivity lives in the CHECK instead of a
-- NOT NULL: `direction` is REQUIRED exactly for `ADJUSTMENT`, whose sign cannot
-- be derived from its type, and must be NULL for every other kind, whose sign
-- the type already owns. The predicate is exclusive AND exhaustive — a row can
-- satisfy exactly one half, never both and never neither — so a second writer
-- cannot store an ADJUSTMENT without a direction or attach a direction to a
-- type-owned movement. The constraint is raw SQL because Prisma cannot express
-- a CHECK; the matching Prisma field documents the rule without modelling it.
--
-- This migration is strictly additive: it creates one enum, adds one nullable
-- column and adds one constraint. It alters no other table, writes no row and
-- drops nothing, and existing confirmed movements (all type-owned, so all
-- `direction IS NULL`) satisfy the new predicate as they stand. It is
-- deliberately NOT the CASH-002 command surface: no service, route or handler
-- for standalone movements ships with this slice.
--
-- Data classification: the movement direction is INTERNAL (PRD §41); logs and
-- audit carry ids and field names only — never a payload.

-- Explicit sign of an ADJUSTMENT (PRD §20, DEC-030): the one piece of direction
-- information a movement type cannot carry, because ADJUSTMENT is the only kind
-- that legitimately moves expected cash either way. The amount itself stays
-- positive for every kind. Evolve additively only.
CREATE TYPE "cash_movement_direction" AS ENUM ('INCREASE', 'DECREASE');

-- NULLABLE by design: required for ADJUSTMENT, forbidden for every other kind,
-- and that exclusivity is enforced by the CHECK below rather than by this
-- column, which must accept NULL for the six type-owned kinds.
ALTER TABLE "cash_movement" ADD COLUMN "direction" "cash_movement_direction";

-- DEC-030: the direction is owned by ADJUSTMENT alone. The two halves are
-- mutually exclusive AND jointly exhaustive — an ADJUSTMENT must carry a
-- direction and every other kind must NOT — so no row can satisfy both halves
-- and no row can fall outside the constraint. `type` is compared as text
-- because the six EPIC-13 enum values were appended by the previous migration
-- in its own transaction.
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_direction_required"
  CHECK (("type"::text = 'ADJUSTMENT' AND "direction" IS NOT NULL) OR ("type"::text <> 'ADJUSTMENT' AND "direction" IS NULL));
