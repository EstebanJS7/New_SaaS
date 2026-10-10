-- Additive migration: EPIC-16 FISC-012 WU-F — the reconciliation's query marker.
--
-- `fiscal_document` gains `next_query_at`, the instant the reconciliation sweep
-- may next query the provider about a document it handed over (ADR-007 §5). It
-- exists so the sweep's own cadence (`FISCAL_SUBMISSION_SWEEP_INTERVAL_MS`,
-- 60 seconds) cannot become the provider's cadence: without it, every
-- `SUBMITTED` row would match on every sweep and be queried once a minute, while
-- §23.7's Guide recommends the first batch query ten minutes after reception and
-- later intervals "no menores a 10 minutos".
--
-- The backfill writes that first instant for rows that were already `SUBMITTED`
-- when the column arrived: `COALESCE(submitted_at, created_at) + interval
-- '10 minutes'`. The interval mirrors `SIFEN_BATCH_POLL_INTERVAL_MS` from
-- `packages/fiscal`, whose source is §23.7's Guide recommendation above. A
-- migration cannot import a TypeScript constant, so the interval is written here
-- as the literal `interval '10 minutes'` and this comment names the constant it
-- mirrors; a migration is applied once and never edited, so a future change to
-- the constant would be carried forward by a new migration.
--
-- The index is the sweep's own selection. The sweep is global, not per tenant,
-- so `status` leads the index (equality) and `next_query_at` follows (range,
-- including the NULLs of "never queried"). It is not partial because
-- `next_query_at IS NULL` is part of the selection.
--
-- Additive: one nullable column, one index and one bounded UPDATE over rows that
-- were already `SUBMITTED`. It creates or drops no table, adds or changes no
-- other column, touches no enum, constraint, trigger or guard body, and rewrites
-- no row outside the backfill's own predicate.

ALTER TABLE "fiscal_document" ADD COLUMN "next_query_at" TIMESTAMPTZ(3);

UPDATE "fiscal_document"
SET "next_query_at" = COALESCE("submitted_at", "created_at") + interval '10 minutes'
WHERE "status" = 'SUBMITTED' AND "next_query_at" IS NULL;

CREATE INDEX "fiscal_document_status_next_query_at_idx" ON "fiscal_document"("status", "next_query_at");
