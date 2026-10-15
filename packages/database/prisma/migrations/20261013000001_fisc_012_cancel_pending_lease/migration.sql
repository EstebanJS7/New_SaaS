-- TD-033 item 5 (FISC-012's cancel path). A cancel that ends in
-- TRANSIENT_FAILURE -- the deadline or a transport failure -- means the request
-- was made and its fate is unknown, which is exactly what CANCEL_PENDING
-- describes. Parking the document there stops a second attempt from reaching the
-- tax administration while the first one's outcome is unknown; the lease is what
-- keeps that state from being a wedge, because past the window a retry is
-- legitimate rather than a race.
--
-- This replaces the guard with the body installed by
-- 20261008000001_fiscal_document_provider_reference -- the LAST migration to
-- define it, which is what carries the provider_reference never-clear clause --
-- plus two additions: the CANCEL_PENDING -> CANCEL_PENDING edge, and the lease
-- check below it. It also widens the incoming edges to CANCEL_PENDING: the cancel
-- command admits a REJECTED, ERROR, PENDING or QUEUED document, and a timeout on
-- any of those is the same "submitted, fate unknown" state as one from SUBMITTED
-- or APPROVED. Refusing those edges would abort the transaction that carries the
-- audit row and last_error_*, which is the evidence of the failed attempt.
--
-- The worker's sweep is deliberately untouched: it walks SUBMITTED, and a parked
-- cancellation is not a submission, so nothing here adds an index or a scheduling
-- marker for CANCEL_PENDING. An automatic reconciliation would need an event query
-- the retrieved sources do not describe.
ALTER TABLE "fiscal_document" ADD COLUMN "cancel_pending_since" TIMESTAMPTZ(3);

CREATE OR REPLACE FUNCTION "fiscal_document_transition_guard"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT (
      (OLD."status" = 'PENDING' AND NEW."status" IN ('QUEUED', 'SIGNING', 'SENDING', 'CANCELLED', 'CANCEL_PENDING')) OR
      (OLD."status" = 'QUEUED' AND NEW."status" IN ('SIGNING', 'SENDING', 'CANCELLED', 'CANCEL_PENDING')) OR
      (OLD."status" = 'SIGNING' AND NEW."status" IN ('SENDING', 'ERROR')) OR
      (OLD."status" = 'SENDING' AND NEW."status" IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'ERROR')) OR
      (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('APPROVED', 'REJECTED', 'ERROR', 'CANCEL_PENDING')) OR
      (OLD."status" = 'APPROVED' AND NEW."status" = 'CANCEL_PENDING') OR
      (OLD."status" = 'REJECTED' AND NEW."status" IN ('CANCELLED', 'CANCEL_PENDING')) OR
      (OLD."status" = 'ERROR' AND NEW."status" IN ('SIGNING', 'SENDING', 'CANCELLED', 'CANCEL_PENDING')) OR
      (OLD."status" = 'CANCEL_PENDING' AND NEW."status" = 'CANCELLED') OR
      (OLD."status" = 'CANCEL_PENDING' AND NEW."status" = 'CANCEL_PENDING')
    ) THEN
      RAISE EXCEPTION 'fiscal document transition from % to % is not allowed', OLD."status", NEW."status"
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  -- TD-033 item 5. The status-change block above never runs for a same-status
  -- update, so the lease's invariant needs its own check: the record of when a
  -- parked cancellation's fate became unknown may never be CLEARED and never be
  -- REWOUND. A row that carries no lease at all may take its first lease, which
  -- keeps a row parked before this column existed from being a wedge.
  --
  -- An unchanged lease is admitted, and it has to be: SQL cannot tell a write
  -- that sets the same value from one that never mentions the column, and the
  -- terminal outcomes (`REJECTED`, `CONFIGURATION_ERROR`) are exactly that --
  -- they carry `last_error_*` and no lease, and they must be persistable on a
  -- row that is already parked. That is why NULL -> NULL is admitted too: a row
  -- parked before this column existed carries no lease at all, and a terminal
  -- write still has to land on it. The policy that an ATTEMPT always refreshes
  -- the lease lives in the API, which writes one on every submission; this check
  -- only keeps a lease that EXISTS from moving backwards or vanishing.
  IF OLD."status" = 'CANCEL_PENDING' AND NEW."status" = 'CANCEL_PENDING'
    AND ((OLD."cancel_pending_since" IS NOT NULL AND NEW."cancel_pending_since" IS NULL)
      OR (OLD."cancel_pending_since" IS NOT NULL
        AND NEW."cancel_pending_since" IS NOT NULL
        AND NEW."cancel_pending_since" < OLD."cancel_pending_since")) THEN
    RAISE EXCEPTION 'fiscal document cancel_pending_since may never be cleared or rewound'
      USING ERRCODE = 'restrict_violation';
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
