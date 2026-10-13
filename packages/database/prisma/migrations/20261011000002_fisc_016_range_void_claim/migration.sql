-- FISC-016 WU-D correction: the void is claimed before the provider is asked,
-- and the claim is IN FLIGHT while it is being awaited.
--
-- The claim needs states the first void migration did not have: a range held by
-- an in-flight submission (`VOIDING`) and a void record that is written before
-- the call (`PENDING`) and enters flight (`IN_FLIGHT`) with a lease. All three
-- are appended, never reordered. On PostgreSQL 16 a new enum value may be added
-- inside the deployment's transaction but not USED in that same transaction, so
-- this file only adds the values and mentions neither in a constraint; the use
-- is the application's.
--
-- The lease is what separates "in flight" from "stale": a claim whose
-- `claimed_at` is older than the application's window may be adopted, so a
-- deadline cannot wedge a range forever, while a live lease is refused by name.

ALTER TYPE "fiscal_timbrado_range_status" ADD VALUE 'VOIDING';
ALTER TYPE "fiscal_range_void_outcome" ADD VALUE 'PENDING';
ALTER TYPE "fiscal_range_void_outcome" ADD VALUE 'IN_FLIGHT';

-- The claim's identity: each adoption bumps it, and the settlement CASes on it.
ALTER TABLE "fiscal_range_void" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;

-- The in-flight claim's lease: the instant the record entered IN_FLIGHT.
ALTER TABLE "fiscal_range_void" ADD COLUMN "claimed_at" TIMESTAMPTZ(3);

-- The claim's lifecycle, and the only transitions the append-only guard admits:
-- written PENDING, flipped to IN_FLIGHT before the provider is asked, adopted
-- only with a refreshed lease and the next attempt, closed exactly once.
CREATE OR REPLACE FUNCTION "fiscal_range_void_no_update"()
RETURNS TRIGGER AS $$
BEGIN
  -- The claim's own entry into flight, inside the transaction that claims the
  -- range and before any provider call.
  IF OLD."outcome"::text = 'PENDING' AND NEW."outcome"::text = 'IN_FLIGHT'
     AND NEW."claimed_at" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- The adoption's compare-and-swap on a STALE in-flight claim: the attempt
  -- advances and the lease is refreshed while the claim stays open.
  IF OLD."outcome"::text = 'IN_FLIGHT' AND NEW."outcome"::text = 'IN_FLIGHT'
     AND NEW."attempt" = OLD."attempt" + 1
     AND OLD."claimed_at" IS NOT NULL AND NEW."claimed_at" > OLD."claimed_at" THEN
    RETURN NEW;
  END IF;
  -- The settlement: the in-flight claim closes exactly once, with the answer.
  IF OLD."outcome"::text = 'IN_FLIGHT'
     AND NEW."outcome"::text IN ('VOIDED', 'REJECTED', 'CONFIGURATION_ERROR', 'TRANSIENT_FAILURE') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'a range void is written once and cannot be updated'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
