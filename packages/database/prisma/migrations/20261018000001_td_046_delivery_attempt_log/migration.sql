-- TD-046 (EPIC-17). The delivery attempt log.
--
-- Adds `notification_delivery_attempt`: what the delivery row's SUMMARY cannot answer.
-- The delivery keeps a count, the last attempt's instant and its bounded reason, which is
-- the right shape for "did it work" — retrying is BullMQ's retry, not a domain transition.
-- This table is for the other question: a message that failed three times, with three
-- different reasons, and an operator who needs the sequence rather than the last line.
--
-- It is strictly additive: one new enum type, one new table with its constraint and its
-- trigger. It alters no existing table, changes no column, writes no row and drops
-- nothing.
--
-- THE CONTENT DECISION, which is the reason this table took a Story's record to justify:
-- it stores the SAME reason the delivery row already bounds (`reason_code`,
-- `reason_message`), and it stores the provider's raw error NOWHERE. The raw text is
-- RESTRICTED material this epic has kept out of every stored field, every DTO and every
-- log line; and it would need sanitizing anyway, because a provider's error can echo the
-- destination or the body — at which point it is not raw and the diagnostic value is gone.
--
-- THE ROW IS APPEND-ONLY, enforced here rather than by convention: a trigger refuses
-- UPDATE and DELETE outright. An attempt happened once. A log that can be edited is not a
-- log, and the value of this table is entirely in being the sequence that actually
-- occurred.
--
-- The enum is declared with `CREATE TYPE` rather than `ALTER TYPE ... ADD VALUE` because
-- it is a NEW type: a value appended inside a transaction cannot be used as an enum
-- literal in that same transaction, and Prisma runs every migration in ONE transaction
-- (the notification-delivery migration's rule, applied again here).

CREATE TYPE "notification_attempt_outcome" AS ENUM ('SENT', 'FAILED');

CREATE TABLE "notification_delivery_attempt" (
  "id"             UUID                       NOT NULL DEFAULT gen_random_uuid(),
  "delivery_id"    UUID                       NOT NULL,
  "attempt_number" INTEGER                    NOT NULL,
  "outcome"        "notification_attempt_outcome" NOT NULL,
  "reason_code"    TEXT,
  "reason_message" TEXT,
  "occurred_at"    TIMESTAMPTZ(3)             NOT NULL,
  "created_at"     TIMESTAMPTZ(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_delivery_attempt_pkey" PRIMARY KEY ("id"),
  -- The biconditional the delivery row also carries: a failure explains itself, and a
  -- success carries no reason. A `SENT` row with a reason, or a `FAILED` row without one,
  -- is a record that disagrees with itself.
  CONSTRAINT "notification_delivery_attempt_reason_biconditional" CHECK (
    ("outcome" = 'FAILED' AND "reason_code" IS NOT NULL)
    OR ("outcome" = 'SENT' AND "reason_code" IS NULL AND "reason_message" IS NULL)
  ),
  -- 1-based, and never zero or negative: an attempt number is a position in a sequence.
  CONSTRAINT "notification_delivery_attempt_number_positive" CHECK ("attempt_number" >= 1)
);

-- One row per attempt, ever. A duplicate would mean the same attempt was recorded twice,
-- which is exactly the confusion this table exists to remove.
CREATE UNIQUE INDEX "notification_delivery_attempt_delivery_id_attempt_number_key"
  ON "notification_delivery_attempt" ("delivery_id", "attempt_number");

-- The unique index above already serves "this delivery's attempts, in order"; no second
-- index is added for a read that does not exist yet.

-- The cascade is a FENCE RATHER THAN A WORKFLOW, and the live run of this migration is
-- what established it: `notification_delivery` carries its own `no_delete` guard (a
-- delivery is cancelled, never removed), so this clause can never fire today. It is
-- declared anyway so that a future migration which DOES make a delivery removable cannot
-- silently orphan a log -- and it means the attempt log is, in practice, as permanent as
-- the delivery it belongs to. That is the correct property for a log.
ALTER TABLE "notification_delivery_attempt"
  ADD CONSTRAINT "notification_delivery_attempt_delivery_id_fkey"
  FOREIGN KEY ("delivery_id") REFERENCES "notification_delivery" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only. Both operations are refused with their own message, so a reader of the log
-- can tell what was attempted — an edit and a removal are different mistakes.
CREATE OR REPLACE FUNCTION "notification_delivery_attempt_append_only"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a delivery attempt cannot be deleted: the log is the sequence that occurred' USING ERRCODE = 'restrict_violation';
  END IF;
  RAISE EXCEPTION 'a delivery attempt cannot be edited: the log is the sequence that occurred' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "notification_delivery_attempt_append_only_trigger"
  BEFORE UPDATE OR DELETE ON "notification_delivery_attempt" FOR EACH ROW EXECUTE FUNCTION "notification_delivery_attempt_append_only"();
