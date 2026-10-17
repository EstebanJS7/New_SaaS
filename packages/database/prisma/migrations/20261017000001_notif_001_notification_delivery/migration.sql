-- NOTIF-001 (EPIC-17 WU-B). The notification delivery aggregate and its queue
-- contract.
--
-- Adds the tenant-scoped `notification_delivery` table PRD §24 needs before any
-- channel can send anything: the record of one INTENDED notification, with the
-- explicit lifecycle, the dedupe key and the `scheduled_at` that make the epic's
-- one hard requirement (idempotent reminders, cancelled when the appointment is
-- cancelled) enforceable rather than aspirational.
--
-- This migration is strictly additive: it creates four enum types and one table
-- with its indexes, constraints and triggers. It alters no other table, changes
-- no existing column, writes no row and drops nothing.
--
-- The enums are declared with `CREATE TYPE` rather than extended with
-- `ALTER TYPE ... ADD VALUE`. All four are NEW types, and a value appended by
-- `ALTER TYPE ... ADD VALUE` is not usable as an enum literal inside the same
-- transaction -- PostgreSQL runs every Prisma migration in ONE transaction --
-- which is why `CREATE TYPE` is both the correct and the safe form for the
-- literal comparisons in the CHECKs and in the guard below.
--
-- The record holds REFERENCES, never content. There is deliberately no payload
-- column: the message is built at send time from the authoritative rows the
-- source reference names, so a stored snapshot could only go stale, and
-- [[NOTIF-003]] requires that a reschedule before delivery cannot produce a
-- reminder carrying an old time. The recipient is likewise a reference; the
-- RESTRICTED contact datum is resolved at send time and never persisted here
-- (PRD §41, DEC-061).
--
-- The source coordinates are the `audit_log` shape -- a typed id pair with no
-- foreign key -- because the sources span EPIC-07's appointments and EPIC-16's
-- fiscal documents, and a fourth domain must not need this table's schema
-- changed. Tenant safety is therefore an obligation of the WRITE path, which
-- validates that the source exists in the caller's tenant before inserting; the
-- `(tenant_id, source_type, source_id)` index is what makes that read cheap.
--
-- "At most one live delivery per intent" is a DATABASE property, not an
-- application convention: it is carried by the PARTIAL unique index
-- `notification_delivery_tenant_id_dedupe_key_key` on (tenant_id, dedupe_key)
-- WHERE status <> 'CANCELLED', declared as raw SQL because Prisma cannot express
-- partial indexes (the invoice-per-sale and fiscal-document-per-invoice keys are
-- the precedents). A cancelled delivery therefore falls outside the index and
-- releases its key, while two live deliveries for one intent stay impossible.
--
-- The database additionally enforces the invariants the application layer must
-- respect:
--   * the lifecycle graph: `SCHEDULED -> QUEUED | SENDING | CANCELLED`,
--     `QUEUED -> SENDING | CANCELLED`, `SENDING -> SENT | FAILED`, and nothing
--     out of `SENT`, `FAILED` or `CANCELLED`;
--   * `SENT` and `CANCELLED` rows are frozen outright -- a terminal delivery is
--     not editable state;
--   * the identity columns are fixed at insert: a mutable `dedupe_key` would make
--     the unique index meaningless, and a mutable `channel` would mean a message
--     could be sent through a channel the record never declared;
--   * a status never disagrees with its own timestamps: `sent_at` is present
--     exactly when the row is `SENT`, and `cancelled_at` and
--     `cancellation_reason` exactly when it is `CANCELLED`;
--   * a failure explains itself: `FAILED` requires a `last_error_code`, a `SENT`
--     row carries none, and an error code only exists on `SENDING` (a retryable
--     failure that BullMQ will retry) or `FAILED`;
--   * `attempt_count` never decreases, and the claim lease `last_attempt_at` is
--     never cleared and never rewound -- a rewound lease is a stolen claim, and a
--     stolen claim is a second message to an actual recipient;
--   * a delivery cannot be deleted.

CREATE TYPE "notification_channel" AS ENUM ('EMAIL', 'WHATSAPP');
CREATE TYPE "notification_delivery_status" AS ENUM (
  'SCHEDULED',
  'QUEUED',
  'SENDING',
  'SENT',
  'FAILED',
  'CANCELLED'
);
CREATE TYPE "notification_source_type" AS ENUM ('APPOINTMENT', 'FISCAL_DOCUMENT');
CREATE TYPE "notification_recipient_type" AS ENUM ('CUSTOMER');

CREATE TABLE "notification_delivery" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "channel" "notification_channel" NOT NULL,
  "status" "notification_delivery_status" NOT NULL DEFAULT 'SCHEDULED',
  "dedupe_key" TEXT NOT NULL,
  "source_type" "notification_source_type" NOT NULL,
  "source_id" UUID NOT NULL,
  "recipient_type" "notification_recipient_type" NOT NULL,
  "recipient_id" UUID NOT NULL,
  "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_attempt_at" TIMESTAMPTZ(3),
  "last_error_code" TEXT,
  "last_error_message" TEXT,
  "sent_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "cancellation_reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("id"),

  -- A key is the intent's identity, so an empty one is not a key. The upper
  -- bound keeps a caller from parking an unbounded blob in an indexed TEXT
  -- column; the format is the domain's business and is built in code.
  CONSTRAINT "notification_delivery_dedupe_key_check"
    CHECK (char_length("dedupe_key") > 0 AND char_length("dedupe_key") <= 200),

  CONSTRAINT "notification_delivery_attempt_count_check"
    CHECK ("attempt_count" >= 0),

  -- The biconditionals are written as `(status = X) = (column IS NOT NULL)` so
  -- BOTH directions are asserted by one expression: a terminal timestamp without
  -- its status, and a status without its timestamp, are each refused. Neither
  -- operand can be NULL -- `status` is NOT NULL and `IS NOT NULL` never yields
  -- NULL -- so the comparison is total.
  CONSTRAINT "notification_delivery_sent_at_check"
    CHECK (("status" = 'SENT') = ("sent_at" IS NOT NULL)),
  CONSTRAINT "notification_delivery_cancelled_at_check"
    CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)),
  CONSTRAINT "notification_delivery_cancellation_reason_check"
    CHECK (("status" = 'CANCELLED') = ("cancellation_reason" IS NOT NULL)),

  CONSTRAINT "notification_delivery_failed_reason_check"
    CHECK ("status" <> 'FAILED' OR "last_error_code" IS NOT NULL),
  CONSTRAINT "notification_delivery_sent_reason_check"
    CHECK ("status" <> 'SENT' OR "last_error_code" IS NULL),
  -- A retryable failure leaves the row in `SENDING` for BullMQ's next attempt and
  -- records what happened; a non-retryable one lands on `FAILED`. There is no
  -- third status an error code belongs to, so a code anywhere else is a bug the
  -- database refuses at the write that caused it.
  CONSTRAINT "notification_delivery_error_code_status_check"
    CHECK ("last_error_code" IS NULL OR "status" IN ('SENDING', 'FAILED'))
);

-- Prisma cannot express a partial index, so the intent key lives here. `CANCELLED`
-- is the only status that releases it: a `FAILED` delivery keeps its key, because
-- a retry must be a re-attempt of the SAME intent and never a second record.
CREATE UNIQUE INDEX "notification_delivery_tenant_id_dedupe_key_key"
  ON "notification_delivery" ("tenant_id", "dedupe_key")
  WHERE "status" <> 'CANCELLED';

CREATE UNIQUE INDEX "notification_delivery_tenant_id_id_key"
  ON "notification_delivery" ("tenant_id", "id");
CREATE INDEX "notification_delivery_tenant_id_status_idx"
  ON "notification_delivery" ("tenant_id", "status");
CREATE INDEX "notification_delivery_tenant_id_source_type_source_id_idx"
  ON "notification_delivery" ("tenant_id", "source_type", "source_id");
CREATE INDEX "notification_delivery_tenant_id_scheduled_at_idx"
  ON "notification_delivery" ("tenant_id", "scheduled_at");

ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION "notification_delivery_no_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'a notification delivery cannot be deleted; cancel it instead'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "notification_delivery_no_delete_trigger"
  BEFORE DELETE ON "notification_delivery" FOR EACH ROW EXECUTE FUNCTION "notification_delivery_no_delete"();

-- `SENT` and `CANCELLED` are terminal, and terminal means frozen: a resolved
-- delivery is not editable state. `FAILED` is deliberately NOT in this list. It
-- has no outgoing edge in the guard, so it cannot move, but it stays writable in
-- place -- and that is the lesson BILL-001 paid for, where a header guard made a
-- transition impossible because the broader graph did not exist yet. If a re-drive
-- is ever approved it becomes a `FAILED` edge plus a change to this trigger, as a
-- decision rather than as an accident.
CREATE OR REPLACE FUNCTION "notification_delivery_terminal_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" IN ('SENT', 'CANCELLED') THEN
    RAISE EXCEPTION 'a terminal notification delivery cannot be updated'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "notification_delivery_terminal_immutable_trigger"
  BEFORE UPDATE ON "notification_delivery" FOR EACH ROW EXECUTE FUNCTION "notification_delivery_terminal_immutable"();

-- The identity of an intent is fixed when it is created. `dedupe_key` is the one
-- that carries weight: the partial unique index above is what makes a repeated
-- intent idempotent, and a mutable key would let a second row claim the same
-- intent under a new name. `scheduled_at` is here for the same reason the key
-- includes the window -- moving a scheduled delivery would silently re-time an
-- intent the recipient may already be expecting.
CREATE OR REPLACE FUNCTION "notification_delivery_identity_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id" THEN
    RAISE EXCEPTION 'a notification delivery tenant_id cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'a notification delivery id cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."channel" IS DISTINCT FROM OLD."channel" THEN
    RAISE EXCEPTION 'a notification delivery channel cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."dedupe_key" IS DISTINCT FROM OLD."dedupe_key" THEN
    RAISE EXCEPTION 'a notification delivery dedupe_key cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."source_type" IS DISTINCT FROM OLD."source_type" THEN
    RAISE EXCEPTION 'a notification delivery source_type cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."source_id" IS DISTINCT FROM OLD."source_id" THEN
    RAISE EXCEPTION 'a notification delivery source_id cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."recipient_type" IS DISTINCT FROM OLD."recipient_type" THEN
    RAISE EXCEPTION 'a notification delivery recipient_type cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."recipient_id" IS DISTINCT FROM OLD."recipient_id" THEN
    RAISE EXCEPTION 'a notification delivery recipient_id cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."scheduled_at" IS DISTINCT FROM OLD."scheduled_at" THEN
    RAISE EXCEPTION 'a notification delivery scheduled_at cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'a notification delivery created_at cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "notification_delivery_identity_immutable_trigger"
  BEFORE UPDATE ON "notification_delivery" FOR EACH ROW EXECUTE FUNCTION "notification_delivery_identity_immutable"();

-- The lifecycle guard. It constrains STATUS CHANGES only, which is deliberate and
-- load-bearing: a same-status update is how the claim's lease is refreshed and
-- how a retryable failure records its reason, and neither is a transition. That
-- is why `SENDING -> SENDING` needs no edge -- and why the terminal statuses get
-- their own trigger above instead of an absence of edges here.
--
-- `SCHEDULED -> SENDING` is admitted, not merely tolerated: the producer writes
-- `QUEUED` after the enqueue succeeds, and if that write is lost the job is in
-- the queue anyway. Refusing the edge would leave a genuinely pending job whose
-- claim the database rejects, which is a wedge, not a protection.
--
-- The lease clauses cannot refuse a legitimate write. Only the claim writes
-- `last_attempt_at`, and it always moves it forward; the terminal writes do not
-- touch it at all. What they stop is a CLEARED lease, which makes an owned claim
-- look abandoned, and a REWOUND one, which is the same thing with extra steps --
-- both end in a second worker claiming an attempt somebody else may be running,
-- and a second message to an actual recipient.
CREATE OR REPLACE FUNCTION "notification_delivery_transition_guard"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT (
      (OLD."status" = 'SCHEDULED' AND NEW."status" IN ('QUEUED', 'SENDING', 'CANCELLED')) OR
      (OLD."status" = 'QUEUED' AND NEW."status" IN ('SENDING', 'CANCELLED')) OR
      (OLD."status" = 'SENDING' AND NEW."status" IN ('SENT', 'FAILED'))
    ) THEN
      RAISE EXCEPTION 'notification delivery transition from % to % is not allowed', OLD."status", NEW."status"
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF NEW."attempt_count" < OLD."attempt_count" THEN
    RAISE EXCEPTION 'a notification delivery attempt_count cannot decrease'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."last_attempt_at" IS NOT NULL AND NEW."last_attempt_at" IS NULL THEN
    RAISE EXCEPTION 'a notification delivery last_attempt_at cannot be cleared'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."last_attempt_at" IS NOT NULL
    AND NEW."last_attempt_at" IS NOT NULL
    AND NEW."last_attempt_at" < OLD."last_attempt_at" THEN
    RAISE EXCEPTION 'a notification delivery last_attempt_at cannot be rewound'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "notification_delivery_transition_guard_trigger"
  BEFORE UPDATE ON "notification_delivery" FOR EACH ROW EXECUTE FUNCTION "notification_delivery_transition_guard"();
