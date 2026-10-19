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
- [ ] **WU-A — [[REP-001]] the report data prerequisites.** Three event
      timestamps, the catalog threshold, the two clinical due dates, their
      writers and their validators. Migration + backfill.
- [ ] **WU-B — [[REP-002]] the reporting foundation.** `resolveReportPeriod`,
      the report contract, the `reports.*` permissions, the route pins and one
      reference report end to end.
- [ ] **WU-C — [[REP-003]] the commercial reports.**
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

_Empty until WU-A lands._
