-- Additive migration: EPIC-16 FISC-010 WU-D — the provider's operation handle.
--
-- `fiscal_document` gains `provider_reference`, the handle a provider returns
-- when it accepts a document into its processing queue instead of resolving it
-- in the same answer (ADR-007 §2). It is deliberately NOT `external_id`: that
-- column is the provider's reference for the DOCUMENT and is known only once the
-- document resolves, while this one names the OPERATION that carried it, and one
-- operation may carry many documents. It is written by the same conditional
-- update that enters `SUBMITTED`, together with `submitted_at`, so a worker
-- restart between the provider's answer and the next reconciliation pass cannot
-- lose the handle — an in-memory batch number is a lost batch number, and the
-- recovery path is a fallback rather than a plan (ADR-007 §4, §5).
--
-- The handle is never cleared, so it joins the four existing non-clearing
-- columns and the guard's body is replaced to say so. Its already-installed
-- trigger resolves this function by name, so no trigger is recreated, and every
-- edge of the state machine is carried forward verbatim: this migration adds no
-- transition and removes none.
--
-- This migration adds one nullable column and replaces one function body. It
-- creates or drops no table, changes no other column, rewrites no row, touches
-- no enum value and touches no other constraint or trigger. No backfill: no row
-- has ever carried a handle, because until now nothing could write one.

ALTER TABLE "fiscal_document" ADD COLUMN "provider_reference" TEXT;

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
  IF OLD."provider_reference" IS NOT NULL AND NEW."provider_reference" IS NULL THEN
    RAISE EXCEPTION 'fiscal document provider_reference cannot be cleared' USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
