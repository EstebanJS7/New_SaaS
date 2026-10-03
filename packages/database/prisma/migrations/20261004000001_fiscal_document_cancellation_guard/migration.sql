-- EPIC-15 FISC-005 cancellation edges. This replaces only the existing guard
-- body; its already-installed trigger resolves this function by name.
-- Every edge into CANCELLED must set cancelled_at; the FISC-002 biconditional
-- already enforces that invariant, so no redundant guard check is added.
-- SENDING -> CANCELLED stays excluded: a worker holds that claim and may be
-- mid-call, so cancelling underneath it would race the provider.
-- resolved_at remains an implication, not a biconditional: this permits
-- APPROVED -> CANCEL_PENDING -> CANCELLED while the resolution timestamp survives.
CREATE OR REPLACE FUNCTION "fiscal_document_transition_guard"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT (
      (OLD."status" = 'PENDING' AND NEW."status" IN ('QUEUED', 'SENDING', 'CANCELLED')) OR
      (OLD."status" = 'QUEUED' AND NEW."status" IN ('SENDING', 'CANCELLED')) OR
      (OLD."status" = 'SENDING' AND NEW."status" IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'ERROR')) OR
      (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('APPROVED', 'REJECTED', 'ERROR', 'CANCEL_PENDING')) OR
      (OLD."status" = 'APPROVED' AND NEW."status" = 'CANCEL_PENDING') OR
      (OLD."status" = 'REJECTED' AND NEW."status" = 'CANCELLED') OR
      (OLD."status" = 'ERROR' AND NEW."status" IN ('SENDING', 'CANCELLED')) OR
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
