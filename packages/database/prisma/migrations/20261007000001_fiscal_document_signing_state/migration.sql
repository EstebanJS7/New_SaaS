-- Additive migration: EPIC-16 FISC-009 signing state.
--
-- `fiscal_document_status` gains `SIGNING`, and the transition guard admits the
-- three edges that make it a stage rather than a label:
--
--   QUEUED  -> SIGNING      the worker claims the document to sign it
--   SIGNING -> SENDING      the signature is produced, the submission follows
--   SIGNING -> ERROR        signing failed, and the failure is ours, not the
--                           provider's
--
-- `SIGNING -> CANCELLED` is EXCLUDED for the same reason `SENDING -> CANCELLED`
-- is: a worker holds that claim and may be mid-work, so cancelling underneath it
-- would race the signer. This is why `SIGNING` is a claim like `SENDING`, not a
-- label attached to one.
--
-- `DEC-047` omitted this stage deliberately while a fake stood in for the
-- provider; FISC-009 is the story that returns it.
--
-- TRANSACTION NOTE: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction
-- block on PostgreSQL 11 and older, and on PostgreSQL 12+ it may run inside a
-- transaction as long as the new value is NOT used in that same transaction.
-- The function below mentions `'SIGNING'` only inside a PL/pgSQL body, which is
-- stored as source and is not resolved against the enum at creation time, so it
-- does not count as a use. The supported server is PostgreSQL 16, and the
-- applied value and its edges are proven against a live PostgreSQL 16 by the
-- fiscal live-database evidence.
--
-- This migration alters the enum and one function body. It creates or drops no
-- table, adds or changes no column, rewrites no row, and touches no other
-- constraint or trigger.

ALTER TYPE "fiscal_document_status" ADD VALUE IF NOT EXISTS 'SIGNING';

-- Replaces only the guard's body; its already-installed trigger resolves this
-- function by name, so no trigger is recreated.
CREATE OR REPLACE FUNCTION "fiscal_document_transition_guard"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT (
      (OLD."status" = 'PENDING' AND NEW."status" IN ('QUEUED', 'SIGNING', 'SENDING', 'CANCELLED')) OR
      (OLD."status" = 'QUEUED' AND NEW."status" IN ('SIGNING', 'SENDING', 'CANCELLED')) OR
      (OLD."status" = 'SIGNING' AND NEW."status" IN ('SENDING', 'ERROR')) OR
      (OLD."status" = 'SENDING' AND NEW."status" IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'ERROR')) OR
      (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('APPROVED', 'REJECTED', 'ERROR', 'CANCEL_PENDING')) OR
      (OLD."status" = 'APPROVED' AND NEW."status" = 'CANCEL_PENDING') OR
      (OLD."status" = 'REJECTED' AND NEW."status" = 'CANCELLED') OR
      (OLD."status" = 'ERROR' AND NEW."status" IN ('SIGNING', 'SENDING', 'CANCELLED')) OR
      (OLD."status" = 'CANCEL_PENDING' AND NEW."status" = 'CANCELLED')
    ) THEN
      RAISE EXCEPTION 'fiscal document transition from % to % is not allowed', OLD."status", NEW."status"
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status"
    AND NEW."status" IN ('APPROVED', 'REJECTED') AND NEW."resolved_at" IS NULL THEN
    RAISE EXCEPTION 'fiscal document resolved_at is required when entering APPROVED or REJECTED'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."external_id" IS NOT NULL AND NEW."external_id" IS NULL THEN
    RAISE EXCEPTION 'fiscal document external_id cannot be cleared' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."cdc" IS NOT NULL AND NEW."cdc" IS NULL THEN
    RAISE EXCEPTION 'fiscal document cdc cannot be cleared' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."submitted_at" IS NOT NULL AND NEW."submitted_at" IS NULL THEN
    RAISE EXCEPTION 'fiscal document submitted_at cannot be cleared' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."resolved_at" IS NOT NULL AND NEW."resolved_at" IS NULL THEN
    RAISE EXCEPTION 'fiscal document resolved_at cannot be cleared' USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
