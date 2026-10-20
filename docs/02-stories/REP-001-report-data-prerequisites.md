---
id: REP-001
type: story
title: The report data prerequisites
epic: EPIC-18
status: in-progress
priority: high
depends_on: []
prd_sections:
  - "31"
permissions: []
branch: feat/epic-18-dashboards-reports
created: 2026-10-19
updated: 2026-10-19
---

# REP-001 — The report data prerequisites

## Objective

Give the reports the three facts the schema never recorded: when a sale was
completed, when a purchase was received, when a cash session was closed — plus
the two inputs PRD §31 assumes and no table holds, a low-stock threshold and a
clinical due date.

## Context

This Story exists because the exploration of
`packages/database/prisma/schema.prisma` contradicted the PRD's assumptions. PRD
§31 names eleven reports; three of them are not computable:

- `sale` carries `status` and `created_at`/`updated_at` but **no** completion
  instant, so "sales by period" cannot distinguish a draft from revenue.
- `purchase` has `status RECEIVED` and no receipt instant.
- `cash_session` has `status CLOSED`, the three close amounts and **no** close
  instant.
- No table anywhere holds a low-stock threshold.
- `clinical_vaccination` and `clinical_deworming` store `administered_at` and
  nothing forward-looking, so "upcoming/overdue" is not computable.

Decisions: [[DEC-064]] and [[DEC-065]]. Both crossings are declared there — this
Story adds one assignment inside three existing terminal transactions and one
optional field on two existing write surfaces. It adds **no** transition, no
route and no report.

## In Scope

- `sale.completed_at`, `purchase.received_at`, `cash_session.closed_at`:
  nullable `TIMESTAMPTZ(3)`, written by the command that owns the transition,
  indexed for the report range scans, backfilled from `updated_at` for rows
  already terminal.
- `catalog_item.low_stock_threshold`: nullable `DECIMAL(10,3)` with a `> 0`
  CHECK, plus the optional field on the catalog item create and update contract.
- `clinical_vaccination.next_due_at` and `clinical_deworming.next_due_at`:
  nullable `TIMESTAMPTZ(3)`, indexed on `(tenant_id, next_due_at)`, plus the
  optional field on the two existing registration requests.
- The additive response-contract change: the three aggregates expose their new
  instant in their read DTOs.
- The migration and its backfill.

## Out of Scope

- No report, no route, no permission, no UI. [[REP-002]] onwards.
- No change to any state machine, status enum or transition rule.
- No backfill of `next_due_at` or `low_stock_threshold` — the fact was never
  recorded, and inventing it is worse than an empty report ([[DEC-065]]).
- No revaccination protocol engine and no tenant-level threshold default
  ([[DEC-065]]).

## Acceptance Criteria

- [ ] The three event instants are written inside the transaction that performs
      their transition, and are NULL before it.
- [ ] A repeated terminal command leaves the original instant intact — asserted
      on the refusal path, not assumed.
- [ ] The three instants are exposed in their aggregates' read DTOs.
- [ ] `low_stock_threshold` is accepted, validated `> 0`, and returned on the
      catalog item read contract.
- [ ] `next_due_at` is accepted and returned on both clinical record contracts.
- [ ] The backfill sets each instant from `updated_at` **only** for rows already
      in a terminal state, and leaves every other row NULL.
- [ ] Each of the five new read axes has an index that serves a tenant range
      scan.
- [ ] Tenant isolation: no new read path exists, and the existing write paths
      keep their composite tenant FKs.
- [ ] Backend authorization is unchanged — this Story adds no route.
- [ ] Required loading/error/empty/success UX: N/A, no UI in this Story.
- [ ] Required audit: the terminal commands' existing audit rows are unchanged.
- [ ] Tests required by the Story pass.

## Domain Invariants

- A terminal aggregate remains immutable; the new column is written exactly
  once, in the same transaction that makes it terminal.
- Money and quantities stay `Decimal`/NUMERIC; `low_stock_threshold` follows the
  ledger's `Decimal(10,3)` quantity scale.
- No new nullable column may become the sole justification for a non-indexed
  range scan.
- Existing rows gain no fabricated history.

## API

### Added

```text
None — no route, no endpoint.
```

### Changed

```text
GET  /sales/:id                    response gains completedAt
GET  /purchases/:id                response gains receivedAt
GET  /cash/sessions/:id            response gains closedAt
POST /catalog          (request)   optional lowStockThreshold
PUT  /catalog/:id      (request)   optional lowStockThreshold
GET  /catalog, /catalog/:id        response gains lowStockThreshold
POST /patients/:patientId/clinical/vaccinations   optional nextDueAt
POST /patients/:patientId/clinical/deworming      optional nextDueAt
GET  /patients/:patientId/clinical/vaccinations   response gains nextDueAt
GET  /patients/:patientId/clinical/deworming      response gains nextDueAt
```

## Database

### Migration

This Story lands as **two** migrations, one per work unit, so each commit is
self-contained and reviewable on its own.

**Part 1 — WU-A1: the three business-event instants.**
`migrations/20261019000002_rep_001_report_event_timestamps/`:

```text
  ALTER TABLE sale            ADD COLUMN completed_at TIMESTAMPTZ(3);
  ALTER TABLE purchase        ADD COLUMN received_at  TIMESTAMPTZ(3);
  ALTER TABLE cash_session    ADD COLUMN closed_at    TIMESTAMPTZ(3);

  -- backfill, terminal rows only, idempotent via IS NULL
  UPDATE sale         SET completed_at = updated_at WHERE status = 'COMPLETED' AND completed_at IS NULL;
  UPDATE purchase     SET received_at  = updated_at WHERE status = 'RECEIVED'  AND received_at  IS NULL;
  UPDATE cash_session SET closed_at    = updated_at WHERE status = 'CLOSED'    AND closed_at    IS NULL;

  -- indexes
  CREATE INDEX sale_tenant_id_completed_at_idx         ON sale         (tenant_id, completed_at);
  CREATE INDEX purchase_tenant_id_received_at_idx      ON purchase     (tenant_id, received_at);
  CREATE INDEX cash_session_tenant_id_closed_at_idx    ON cash_session (tenant_id, closed_at);
```

**Part 2 — WU-A2: the two opt-in inputs.** A second migration in the same Story:

```text
  ALTER TABLE catalog_item         ADD COLUMN low_stock_threshold DECIMAL(10,3);
  ALTER TABLE clinical_vaccination ADD COLUMN next_due_at TIMESTAMPTZ(3);
  ALTER TABLE clinical_deworming   ADD COLUMN next_due_at TIMESTAMPTZ(3);

  CREATE INDEX ... ON clinical_vaccination (tenant_id, next_due_at);
  CREATE INDEX ... ON clinical_deworming   (tenant_id, next_due_at);

  ALTER TABLE catalog_item ADD CONSTRAINT catalog_item_low_stock_threshold_positive
    CHECK (low_stock_threshold IS NULL OR low_stock_threshold > 0);
```

### Models/Tables

- `Sale` → `sale` (+`completed_at`)
- `Purchase` → `purchase` (+`received_at`)
- `CashSession` → `cash_session` (+`closed_at`)
- `CatalogItem` → `catalog_item` (+`low_stock_threshold`)
- `ClinicalVaccination` → `clinical_vaccination` (+`next_due_at`)
- `ClinicalDeworming` → `clinical_deworming` (+`next_due_at`)

## UI

- The catalog item form gains one optional numeric field, and the vaccination
  and deworming forms gain one optional date field. Both are existing forms; no
  new screen.
- Reusable components keep consuming semantic branding tokens; no literal brand
  colour, radius or font.

## Implementation Summary

**Part 1 (WU-A1) implemented; part 2 (WU-A2) pending.**

Part 1 — commit `WU-A1` on `feat/epic-18-dashboards-reports`:

- `sale.completed_at`, `purchase.received_at` and `cash_session.closed_at` are
  nullable `TIMESTAMPTZ(3)` columns with tenant-leading range indexes, applied
  by migration `20261019000002_rep_001_report_event_timestamps`.
- Each instant is written by **one** assignment inside the existing conditional
  `updateMany` of its terminal command (`sales.repository.complete`,
  `purchases.repository.receive`, `cash.repository.close`). Those predicates pin
  the pre-transition status, so the instant is written exactly once and can
  never be restamped — no guard trigger is needed on top of the terminal
  immutability the tables already carry.
- The three read DTOs project the instant as an ISO 8601 string or `null`, and
  the in-memory test fixture models it in both halves of its whitelist (the
  declared `data` type _and_ the persistence branch) with `null` initialisation
  on create.
- The admin-side `CashSession` mirror in `apps/web` and its four test fixtures
  were updated to keep the client type in step with the API.

Part 2 is not started.

## Verification

Part 1, run on `feat/epic-18-dashboards-reports` on 2026-10-19:

```text
pnpm format-check                          PASS
pnpm lint                                  PASS  (23/23 turbo tasks)
pnpm typecheck                             PASS  (23/23)
pnpm build                                 PASS  (13/13)
pnpm test                                  PASS  (23/23)
  api         101 files passed | 1 skipped   1352 passed | 266 skipped   (+3)
  web         110 files                      1160 passed
  database     30 files                       548 passed
  worker       17 files                       245 passed
  notifications 11 files                       84 passed
  shared                                       23 passed
  fiscal        36 files                      788 passed
  fiscal-persistence 10 files                 100 passed
  secret-store   5 files                       50 passed
  ui             6 files                       36 passed
```

**Live PostgreSQL, proven rather than skipped.** A disposable PostgreSQL 16
cluster was initialised locally and the `test:live-pg` lane run against it with
all 50 migrations applied: **266 passed (266)**, including the byte-exact DTO
key-set assertions for the sale, completed sale, purchase and cash-session
responses, which is what proves the additive projection did not widen or narrow
any contract by accident.

The first attempt at that run reported 265 passed / 1 failed on an unrelated
EPIC-15 fiscal case. It was diagnosed and is **preexisting, not caused by this
Story**: the fixture casts a zone-less literal to `timestamptz`, so the result
depends on the database server's timezone, and a cluster at `America/Asuncion`
violates two constraints where the test assumes one. Setting the cluster to UTC
turned it green with no other change. Recorded as [[TD-054]].

**Not verified:** the `apps/e2e` Playwright lane, which needs Docker and the
built apps; Docker is unavailable in this environment. This work unit adds no
UI, so no spec covers it.

## Tests Added

- Unit: the three terminal commands write the instant once, and refuse to
  rewrite it on a repeated call.
- Unit: catalog item validation rejects a non-positive threshold and accepts
  NULL.
- Unit: the clinical vaccination and deworming writers persist `nextDueAt`.
- Database: the migration applies on a disposable PostgreSQL; the backfill
  touches terminal rows only; the CHECK refuses zero and negative thresholds;
  the six indexes exist.
- DTO: the additive response fields serialize as ISO instants and decimal
  strings.

## Known Limitations

- No database CHECK ties the status to the instant: a raw SQL `UPDATE` could set
  `status = 'COMPLETED'` without `completed_at`. The guarantee is writer-side
  (the conditional predicate) plus the terminal-row delete triggers, not a
  constraint.
- The instant is stamped from the application clock. The repo has no injected
  clock, so "never rewritten" is proven by advancing real time between the first
  command and its replay rather than by a fixed clock.
- The in-memory fixture cannot model a real-database state that no longer exists
  — a terminal row with a `null` instant — but no fixture path creates one, and
  every terminal row in the tests is reached through the real command.
- The backfill is exact only because terminal rows are immutable. It is recorded
  as a documented assumption, and after this Story the columns are written by
  the commands rather than derived.
- Historical vaccination and deworming rows have no due date and will never
  appear in the due reports.
- Every item starts with a NULL threshold, so the low-stock report begins empty.

## Technical Debt

- [[TD-054]] — found while validating this Story: the live-PostgreSQL lane is
  not timezone-independent, and `America/Asuncion` (the tenant zone) is the
  value that breaks it. Preexisting, unrelated to this Story's columns, and
  invisible in CI.
- [[TD-053]] covers the query-performance question that follows.

## Decisions / ADRs

- [[DEC-064]] — event timestamps for sales, purchases and cash.
- [[DEC-065]] — the catalog threshold and the clinical due date.

## Files / Modules

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/<ts>_rep_001_report_event_timestamps/`
- `apps/api/src/sales/` — the `CompleteSale` transaction and its DTO
- `apps/api/src/purchases/` — the receive command and its DTO
- `apps/api/src/cash/` — the close command and its DTO
- `apps/api/src/catalog/` — item DTO and validation
- `apps/api/src/clinical/` — vaccination and deworming DTOs and records service
- `apps/web/src/app/(app)/app/catalog/` — the item form field
- `apps/web/src/app/(app)/app/patients/[id]/` — the clinical record forms

## Completion Notes

_Status must remain non-done until all required gates pass._
