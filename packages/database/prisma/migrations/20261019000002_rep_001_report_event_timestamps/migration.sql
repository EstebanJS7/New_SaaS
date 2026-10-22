-- REP-001 (EPIC-18 WU-A1, DEC-064). The three BUSINESS-EVENT instants a period
-- report needs and the schema never recorded.
--
-- `sale`, `purchase` and `cash_session` each carry a lifecycle status and the
-- row's `created_at`/`updated_at`, but nothing recorded WHEN the transition
-- that makes the row matter actually happened. A sale created Monday and
-- completed Wednesday was only distinguishable by reading `updated_at` and
-- hoping nothing had touched the row since: an invariant nothing enforces, and
-- one that does not even generalize to `cash_movement`, which is append-only
-- and has no `updated_at` at all. "Sales by period" (PRD §31) therefore could
-- not be answered from stored facts.
--
-- Strictly additive: three nullable `TIMESTAMPTZ(3)` columns on three existing
-- tables, three indexes for the tenant-leading range scans the reports run, and
-- one backfill. No column is altered or dropped, no table is created, no
-- constraint is removed.
--
-- Nullable, because the instant exists only for a row that reached its terminal
-- state: `completed_at` is NULL while a sale is `DRAFT` and stays NULL forever
-- for a `CANCELLED` sale (a cancellation is not revenue), `received_at` is NULL
-- while a purchase is `DRAFT` and for a `CANCELLED` purchase, and `closed_at`
-- is NULL while a cash session is `OPEN`. The columns are written by the
-- commands that already own those transitions -- CompleteSale (EPIC-12,
-- DEC-023), the receive command (EPIC-11, DEC-014) and the cash close command
-- (EPIC-13, DEC-031) -- inside the transaction that performs them and inside a
-- conditional `updateMany` that pins the pre-transition status. Because that
-- predicate can only match a row still in its pre-terminal state, the instant
-- is written exactly once and can never be restamped, so no guard trigger is
-- needed on top of the terminal immutability the tables already carry.
ALTER TABLE "sale" ADD COLUMN "completed_at" TIMESTAMPTZ(3);
ALTER TABLE "purchase" ADD COLUMN "received_at" TIMESTAMPTZ(3);
ALTER TABLE "cash_session" ADD COLUMN "closed_at" TIMESTAMPTZ(3);

-- One-time reconciliation of PRE-EXISTING rows, terminal rows only.
--
-- `updated_at` is exact for exactly the rows this touches: `COMPLETED`,
-- `RECEIVED` and `CLOSED` are terminal, no command transitions out of them or
-- rewrites such a row, and the sale/purchase DELETE triggers refuse the
-- terminal rows outright while a cash session is never deletable at all. The
-- last write to a terminal row is therefore the transition that produced it.
-- Every other row is left NULL: a draft never had a business instant and
-- inventing one is worse than an empty report. The `IS NULL` predicate keeps
-- the statement idempotent, and it never runs again on a row a command wrote.
UPDATE "sale" SET "completed_at" = "updated_at" WHERE "status" = 'COMPLETED' AND "completed_at" IS NULL;
UPDATE "purchase" SET "received_at" = "updated_at" WHERE "status" = 'RECEIVED' AND "received_at" IS NULL;
UPDATE "cash_session" SET "closed_at" = "updated_at" WHERE "status" = 'CLOSED' AND "closed_at" IS NULL;

-- Tenant-leading range scans: every report is scoped to one tenant and filtered
-- on the business instant, so `(tenant_id, <instant>)` serves the period scan
-- without a full-tenant heap scan. The existing `(tenant_id, status)` indexes
-- answer the status-filtered lists and cannot substitute for these.
CREATE INDEX "sale_tenant_id_completed_at_idx" ON "sale"("tenant_id", "completed_at");
CREATE INDEX "purchase_tenant_id_received_at_idx" ON "purchase"("tenant_id", "received_at");
CREATE INDEX "cash_session_tenant_id_closed_at_idx" ON "cash_session"("tenant_id", "closed_at");
