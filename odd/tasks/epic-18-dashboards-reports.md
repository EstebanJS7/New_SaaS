# EPIC-18 — Dashboards and Reports (feature tasks)

PRD §31 asks for eleven reports, a CSV export and — by the epic's name — a
dashboard. The system has none of it, and, more importantly, **three of the
eleven reports have no data source**, which the exploration established by
reading `packages/database/prisma/schema.prisma` rather than the PRD.

## What exists / what does not

```text
exists        eleven upstream domains, all `done`
              immutable ledgers: sale, payment, cash_movement, stock_movement
              transactional projections: stock_balance
              immutable-once-terminal aggregates: sale, purchase, cash_session,
                clinical_encounter (closed_at already present)
              one platform timezone: TENANT_TIME_ZONE = "America/Asuncion"
              a typed tenant-settings registry and an entitlement check
              twelve seeded feature codes, `advanced_reports` among them
              sixteen permission families, none of them reports
              a BFF proxy layer unified on text buffering
does not      any reporting/analytics/dashboard route, module or permission
exist         any CSV, export or download path
              any aggregate query over the ledgers — every read is one row or one
                bounded list
              sale.completed_at, purchase.received_at, cash_session.closed_at
              catalog_item.low_stock_threshold
              clinical_vaccination.next_due_at, clinical_deworming.next_due_at
```

The last three lines are the reason this feature starts with [[REP-001]] and not
with a report.

## Decisions that bind this feature

| Decision    | What it fixes                                                               |
| ----------- | --------------------------------------------------------------------------- |
| [[DEC-062]] | No feature-code gate, `reports.read`/`reports.export`, one aggregation path |
| [[DEC-063]] | Periods in `TENANT_TIME_ZONE`, five presets plus a 366-day bounded range    |
| [[DEC-064]] | `completed_at` / `received_at` / `closed_at` become the reporting truth     |
| [[DEC-065]] | Per-item low-stock threshold; staff-entered clinical due date               |
| [[DEC-066]] | Synchronous bounded CSV, no queue, no storage                               |

## The report inventory

```text
report                      source                              story
sales by period             sale.completed_at + sale_line       REP-003
payment methods             payment.method + payment.amount     REP-003
sales by product/service    sale_line + catalog_item.kind       REP-003
cash session close          cash_session.closed_at              REP-004
cash movements              cash_movement                       REP-004
purchases                   purchase.received_at                REP-004
stock                       stock_balance + stock_movement       REP-005
low stock                   stock_balance + threshold           REP-005
consultations               clinical_encounter.closed_at        REP-006
new patients                patient.created_at                  REP-006
vaccines up/overdue         clinical_vaccination.next_due_at    REP-006
deworming upcoming          clinical_deworming.next_due_at      REP-006
```

## Work units

Each work unit is one commit carrying its tests and documentation.

- [ ] **WU-0 — the planning record.** This file, the epic, [[REP-001]] through
      [[REP-009]] and [[DEC-062]]–[[DEC-066]]. No source.
- [ ] **WU-A — [[REP-001]] the report data prerequisites.** Two migrations.
      **WU-A1** (done) the three business-event instants and their writers.
      **WU-A2** (done) the catalog threshold, the two clinical due dates, their
      validators and the catalog form.
- [x] **WU-B — [[REP-002]] the reporting foundation.** `resolveReportPeriod`,
      the report contract, the `reports.*` permissions, the route pins and one
      reference report end to end. _Done: see the evidence log._
- [x] **WU-C — [[REP-003]] the commercial reports.** _Done: see the evidence
      log._
- [ ] **WU-D — [[REP-004]] the cash and purchase reports.**
- [ ] **WU-E — [[REP-005]] the inventory reports.**
- [ ] **WU-F — [[REP-006]] the veterinary reports.**
- [ ] **WU-G — [[REP-007]] the CSV export.**
- [ ] **WU-H — [[REP-008]] the staff surfaces and the e2e lane.**
- [ ] **WU-I — [[REP-009]] the epic closure and evidence.**

## Review workload

Nine work units, each a self-contained commit. The two riskiest are **WU-A**,
because it touches five already-`done` epics' write paths, and **WU-G**, because
it is the only path where a report's data leaves the API as a file.

## Evidence log

Recorded per work unit as it lands: the commit, the test counts it moved, and
anything it could not verify. A work unit closes only when its own gates were
observed green.

### WU-A1 — the three business-event instants

Commit `WU-A1` on `feat/epic-18-dashboards-reports`.

- Migration `20261019000002_rep_001_report_event_timestamps`: three nullable
  `TIMESTAMPTZ(3)` columns, three tenant-leading range indexes, and a backfill
  from `updated_at` restricted to terminal rows with an `IS NULL` guard.
- One assignment each inside the three existing conditional `updateMany`
  terminal writes, so the instant is stamped exactly once and never rewritten.
- Additive ISO-or-null projection on `SaleResponse`, `PurchaseResponse` and
  `CashSessionResponse`; the in-memory fixture models the field in both halves
  of its whitelist. The `apps/web` cash mirror and its four fixtures follow.
- Tests: three exact-once/replay cases (null before, value after, original value
  preserved through the refusal path) plus `completedAt`/`receivedAt` staying
  `null` on a cancelled row.
- Gates: format, lint, typecheck and build green; `pnpm test` green with api
  **1349 → 1352**; live PostgreSQL **266/266** with all 50 migrations applied on
  a disposable PostgreSQL 16.
- Found and recorded [[TD-054]]: the live-PG lane is timezone-dependent and
  `America/Asuncion` is the zone that breaks it.

**Skipped:** the `apps/e2e` lane — Docker is unavailable in this environment and
this work unit adds no UI.

### WU-A2 — the two opt-in inputs

Commit `WU-A2` on `feat/epic-18-dashboards-reports`.

- Migration `20261019000003_rep_001_catalog_and_clinical_inputs`:
  `catalog_item.low_stock_threshold` with a `> 0` CHECK, and `next_due_at` on
  both clinical record tables with `(tenant_id, next_due_at)` indexes. No
  backfill: the fact was never recorded, so the reports start empty by design.
- The threshold travels as an exact decimal **string** (`> 0`, up to 7 integer
  digits and 3 decimals), nullable where an explicit `null` means "stop
  monitoring"; the catalog form gains the field.
- The due date reuses the file's own `isoDate` validator and is clearable with
  an explicit `null` on update, because a due date can be wrong as well as
  absent.
- **Scope correction, recorded rather than silently expanded:** the Story
  originally claimed the vaccination and deworming _forms_ would gain the field.
  No such form exists — the staff clinical workspace handles encounters only,
  and the five specialized record kinds are API-only on the staff surface. The
  field therefore landed on the API, and the missing staff entry surface is
  [[TD-055]]. Without either one, both due reports stay empty for every tenant,
  and that is stated in the Story's limitations.
- Gates: api **1352 → 1361**, web **1160 → 1164**, format/lint/typecheck/build
  green, live PostgreSQL re-run **266/266** with all 51 migrations applied.

**Skipped:** a clinical record form (it does not exist to extend, and building
one is [[EPIC-06]] surface), and the `apps/e2e` lane (no UI beyond the catalog
field, and Docker is unavailable here).

### WU-B — the reporting foundation

Commit `WU-B` on `feat/epic-18-dashboards-reports`.

- `apps/api/src/reporting/report.period.ts` owns every calendar-date→instant
  conversion: five presets plus a `from`/`to` calendar pair resolved in
  `TENANT_TIME_ZONE` to a half-open `[fromInstant, toInstant)` range, with a
  366-day bound. Two-pass `Intl` offset resolution with `hourCycle: "h23"`.
- All rejections are `VALIDATION_FAILED` with distinct stable messages. The
  error registry is a frozen closed union, so no `REPORTS_PERIOD_*` code was
  invented — the Story was corrected on that point before implementation.
- `REPORT_SALE_ROW_LIMIT` refuses rather than returning a silently truncated
  aggregate. Aggregation is `Prisma.Decimal` in TypeScript, not SQL: the
  in-memory fake's `$queryRaw` is a deliberate lock allowlist that throws on
  anything else, and a report query added to it would be a second aggregation
  engine that could agree with the code and still be wrong.
- `reports.read` seeded to all six roles and `reports.export` to OWNER/ADMIN
  only (read-wide / write-to-owning-roles, the `notifications.delivery.read`
  precedent). Catalog 62 → 64.
- Gates: api **1361 → 1405** (+44), database **548 → 549**,
  format/lint/typecheck/ build green.
- **Corrected a premise in [[DEC-063]]:** Paraguay abolished DST, so
  `America/Asuncion` has been permanently `-03` since 2024-10-06T04:00:00Z
  (tzdata 2025c, verified by scanning 2018–2030). The DST assertion uses the
  historical 2024-10 window; the resolver stays offset-correct rather than
  assuming the fixed offset.

**Skipped:** the `apps/e2e` lane (no UI in this work unit).

### WU-C — the commercial reports

Commit `WU-C` on `feat/epic-18-dashboards-reports`.

- `GET /reports/payment-methods` groups the period's payments by `method` and
  reports `amount` plus `shareOfGross` (`amount.div(totalGross).toFixed(4)`).
- `GET /reports/sales-by-product-service` groups lines by `catalogItemId`, sums
  quantity on scale 3 and money on scale 2, and resolves names and kinds in one
  tenant-predicated catalog read.
- The completed-sale predicate now has ONE implementation
  (`readCompletedSales`), with the two public reads as wrappers that name their
  `include`; a relation the caller did not load throws `INTERNAL` rather than
  reading as empty.
- **The cross-report invariant is proven by string equality**: `"2430.00"` in
  all three reports, and explicitly not `"2430.0000000000005"`. `Sales.md` says
  payments sum exactly to the sale total and a sale's total derives from its
  lines; this is the test that makes three endpoints agree on one revenue.
- Gates: api **1405 → 1429** (+24); format/lint/typecheck/build green.

**Skipped:** the `apps/e2e` lane (no UI in this work unit).
