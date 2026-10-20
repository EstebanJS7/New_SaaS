-- REP-001 (EPIC-18 WU-A2, DEC-065). The two OPT-IN inputs PRD §31's reports read
-- and the schema never had.
--
-- `catalog_item` carried `tracks_stock` and nothing to compare a balance
-- against: `stock_balance.quantity` is a number with no threshold beside it, so
-- "low stock" was not computable at all — not approximately, not with a default.
-- `clinical_vaccination` and `clinical_deworming` carried the ADMINISTRATION
-- instant and nothing forward-looking, so "upcoming and overdue vaccines" and
-- "upcoming deworming" had no data source either. Both facts are tenant data
-- decided per item and per animal; neither is derivable from anything stored.
--
-- Strictly additive: three nullable columns, one CHECK constraint and two
-- indexes. No column is altered or dropped, no table is created, no constraint
-- is removed.
--
-- Nullable, because BOTH inputs are opt-in and NULL is a distinct state:
-- `low_stock_threshold` NULL means "this item is not monitored" and the
-- low-stock report SKIPS the item instead of inventing a threshold, so an
-- unmonitored item never surfaces as a false shortage. `next_due_at` NULL means
-- "no due date was recorded": the veterinarian who administers the vaccine or
-- deworming knows the interval, the system does not, and neither report derives
-- one. The two write surfaces (catalog item create/update, clinical vaccination
-- and deworming create/update) accept the values as optional.
--
-- There is deliberately NO BACKFILL, and it is not an omission. The fact was
-- never recorded: no column, no event and no audit row anywhere holds a
-- threshold or a due date for an existing row, and the nearest available
-- substitute would be an invention (a threshold guessed from current stock makes
-- every item appear exactly at its limit; a due date computed from an interval
-- is the revaccination protocol engine DEC-065 rejects). Existing rows therefore
-- stay NULL and the low-stock, upcoming-vaccine, overdue-vaccine and
-- upcoming-deworming reports start EMPTY BY DESIGN rather than by failure —
-- the honest first-run state a tenant opts out of by setting one threshold or
-- one due date.
ALTER TABLE "catalog_item" ADD COLUMN "low_stock_threshold" DECIMAL(10,3);
ALTER TABLE "clinical_vaccination" ADD COLUMN "next_due_at" TIMESTAMPTZ(3);
ALTER TABLE "clinical_deworming" ADD COLUMN "next_due_at" TIMESTAMPTZ(3);

-- The threshold is a QUANTITY, at the stock ledger's own `Decimal(10,3)` scale,
-- and a non-positive one is meaningless: zero would report every item at or
-- below stock zero while a negative value can never be reached. The API rejects
-- a non-positive threshold with `400 VALIDATION_FAILED`; this CHECK is the
-- database-level backstop so the same rule cannot be bypassed by a direct write,
-- following `clinical_weight_quantity_positive` and the stock quantity CHECKs.
ALTER TABLE "catalog_item" ADD CONSTRAINT "catalog_item_low_stock_threshold_positive"
  CHECK ("low_stock_threshold" IS NULL OR "low_stock_threshold" > 0);

-- Tenant-leading range scans: both due-date reports are scoped to one tenant and
-- filtered on `next_due_at`, so `(tenant_id, next_due_at)` serves the upcoming
-- horizon and the overdue branch without a full-tenant heap scan. The existing
-- `(tenant_id, patient_id)` indexes answer per-patient record lists and cannot
-- substitute for these.
--
-- `catalog_item` gets NO index on `low_stock_threshold`: the low-stock report
-- compares the column against each row's `stock_balance.quantity`, a predicate on
-- values rather than a range over the column, so an index on it would be dead
-- weight on every catalog write.
CREATE INDEX "clinical_vaccination_tenant_id_next_due_at_idx" ON "clinical_vaccination"("tenant_id", "next_due_at");
CREATE INDEX "clinical_deworming_tenant_id_next_due_at_idx" ON "clinical_deworming"("tenant_id", "next_due_at");
