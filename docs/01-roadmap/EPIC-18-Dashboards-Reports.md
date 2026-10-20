---
id: EPIC-18
type: epic
title: Dashboards and Reports
status: in-progress
priority: medium
depends_on:
  - EPIC-04
  - EPIC-05
  - EPIC-06
  - EPIC-09
  - EPIC-10
  - EPIC-11
  - EPIC-12
  - EPIC-13
prd_sections:
  - "9"
  - "9.1"
  - "18"
  - "19"
  - "20"
  - "31"
created: 2026-10-19
updated: 2026-10-19
---

# EPIC-18 — Dashboards and Reports

## Objective

Make the tenant's own operational record readable: eleven report views over the
Core and Veterinary ledgers PRD §31 asks for, a staff home that summarises them,
and a CSV export of any one of them.

The epic answers a question the system can currently only answer one row at a
time. Every confirmed sale, cash movement, stock movement and clinical record is
already persisted, immutable and tenant-scoped; no surface aggregates any of
them, and PRD §31 is the approved scope that says they should.

## What this epic discovered before writing anything

An exploration of the implemented schema, not the PRD, produced the real
starting point. PRD §31 asks for eleven reports; **three of them have no data
source today**:

```text
report                missing                                  decision
sales by period       sale has no completed_at                 DEC-064
purchases             purchase has no received_at               DEC-064
cash close            cash_session has no closed_at             DEC-064
low stock             no threshold exists anywhere              DEC-065
upcoming/overdue      clinical_vaccination and                 DEC-065
vaccines              clinical_deworming store only
upcoming deworming    administered_at
```

A `sale` created on Monday and completed on Wednesday is indistinguishable from
one that was abandoned, and `updated_at` is not an event time. A vaccination has
an administration date and no next due date, so "overdue" is not computable. And
no table anywhere holds a low-stock threshold — `docs/05-modules/Inventory.md`
defers it to this epic by name.

The epic therefore begins with its own prerequisites ([[REP-001]]) rather than
approximating them. The accepted decisions are [[DEC-062]] (gating and surface),
[[DEC-063]] (period and timezone), [[DEC-064]] (event timestamps), [[DEC-065]]
(catalog and clinical prerequisites) and [[DEC-066]] (synchronous CSV).

## Scope

- Eleven report views, each reading a ledger or an immutable row, never a
  mutable balance:
  - **Core** — sales by period, payment methods, sales by product/service, cash
    session close, cash movements, stock, low stock, purchases.
  - **Veterinary** — consultations, new patients, upcoming/overdue vaccines,
    upcoming deworming.
- The schema prerequisites those views need: `sale.completed_at`,
  `purchase.received_at`, `cash_session.closed_at`,
  `catalog_item.low_stock_threshold`, `clinical_vaccination.next_due_at`,
  `clinical_deworming.next_due_at`.
- The `reports.*` permission family, its seed rows and its RBAC route pins.
- A bounded report read contract: a tenant-zone period, presets and a bounded
  custom range ([[DEC-063]]).
- The staff dashboard at `/app` and the reports surface at `/app/reports`
  ([[DEC-062]]).
- The narrow clinical entry surface the due reports depend on: recording a
  vaccination or a deworming treatment with its due date, and correcting it
  ([[REP-010]], [[DEC-067]]).
- Synchronous, bounded CSV export of any report ([[DEC-066]]).
- Tenant isolation for every new read, with the cross-tenant UUID answering
  `404`.
- Playwright specs in `apps/e2e` for the dashboard and the reports surface.

## Out of Scope

- **No cache, no materialized view, no report engine, no query builder.**
  Reports are explicit Prisma aggregates against indexed columns. `AGENTS.md`'s
  complexity budget requires a measured need before any of that, and there is
  none: the MVP has no tenant with a data volume that justifies it.
- **No scheduled or delivered reports.** Nothing emails a CSV.
- **No asynchronous or unbounded export.** [[DEC-066]] caps it and [[TD-051]]
  names the gap.
- **No feature-code gate.** [[DEC-062]] leaves the module ungated at the
  entitlement layer; `advanced_reports` stays unspent.
- **No branch dimension.** `DEC-020` made cash tenant-wide and `sale`,
  `purchase` and `stock_movement` carry no `branch_id`; a per-branch report has
  nothing to group by. [[TD-052]] records what a branch dimension would need.
- **No charting library and no new dependency.** The dashboard is semantic
  tokens, `Card` composition and numeric summaries — not a charting package.
- **No CSV import.** That is [[EPIC-19]].
- **No revaccination protocol engine.** [[DEC-065]] adds a staff-entered due
  date, not immunology the system would have to assume.
- **No clinical record module.** [[REP-010]] builds the entry path for the two
  kinds whose due date this epic introduced, and nothing else. Treatments,
  studies and weights stay API-only ([[TD-055]], narrowed by [[DEC-067]]) —
  building them here would be a UI epic hung off a reporting epic's closure.

## Acceptance Criteria

- [ ] All eleven PRD §31 reports exist, are tenant-scoped and answer `404` for
      another tenant's identity.
- [ ] Every monetary and quantity aggregate is computed in `Decimal`/NUMERIC and
      returned as a decimal string, never a float.
- [ ] Report periods resolve in `TENANT_TIME_ZONE` per [[DEC-063]], and the
      boundary cases are covered by tests: a range crossing a DST offset change,
      an empty range, an inverted range and a range exactly on a period edge.
- [ ] Each report's query has a bounded contract with an explicit maximum row or
      range size.
- [ ] CSV export is synchronous, bounded, `text/csv`, and streams through the
      web BFF using the established buffering pattern.
- [ ] `reports.read` and `reports.export` exist in `PERMISSION_SEEDS`, are
      mapped to roles and are enforced by the backend, not by the UI.
- [ ] The dashboard at `/app` and the reports surface at `/app/reports` render
      loading, empty, error, success and permission-denied states using semantic
      branding tokens only.
- [ ] Playwright specs cover the dashboard and one report end to end.
- [ ] Documentation: `docs/05-modules/Reporting.md`, the Story files, the
      Decisions, the tech debt, the changelog and the roadmap row.
- [ ] Format, lint, typecheck, build and the full test set are green.

## Stories

- [[REP-001]] — The report data prerequisites.
- [[REP-002]] — The reporting foundation: period, contract, permissions, and
  sales by period as the reference implementation.
- [[REP-003]] — The commercial reports: payment methods and sales by
  product/service.
- [[REP-004]] — The cash and purchase reports.
- [[REP-005]] — The inventory reports.
- [[REP-006]] — The veterinary reports.
- [[REP-007]] — The CSV export.
- [[REP-010]] — The clinical record entry surface (vaccinations and deworming).
- [[REP-008]] — The staff surfaces.
- [[REP-009]] — The epic closure and evidence.

## Dependencies

All eight upstream domains are `done`: Customers (EPIC-04), Patients (EPIC-05),
Clinical (EPIC-06), Catalog/Taxes (EPIC-09), Inventory (EPIC-10),
Suppliers/Purchases (EPIC-11), POS/Payments (EPIC-12) and Cash (EPIC-13).

The roadmap row reads "depends on prior domains", which is satisfied. What it
does not say, and what [[REP-001]] carries, is that **this epic is a consumer of
five other epics' write paths**: it adds a column to `sale`, `purchase`,
`cash_session`, `catalog_item`, `clinical_vaccination` and `clinical_deworming`,
so five already-`done` epics each gain a one-line writer change. [[DEC-064]] and
[[DEC-065]] declare those crossings rather than smuggling them in as report
plumbing.

## Exit Criteria

- [ ] Lint/typecheck/tests/build required for the Epic are green.
- [ ] Documentation is current.
- [ ] `docs/10-qa/CI-EVIDENCE.md` carries the closure block with the CI run id.
- [ ] The roadmap row reads `done`, with the evidence-based closure note.
- [ ] Every deferred item is a named Tech Debt, not a silent gap.

## Decisions / ADRs

- [[DEC-062]] — Reports are ungated by feature code; `reports.*` RBAC family;
  the dashboard reuses the report queries.
- [[DEC-063]] — Periods resolve in `TENANT_TIME_ZONE`; presets plus a bounded
  custom range.
- [[DEC-064]] — Business-event timestamps become the reporting truth.
- [[DEC-065]] — The catalog receives a per-item low-stock threshold and Clinical
  receives a staff-entered next due date.
- [[DEC-066]] — CSV export is synchronous and bounded.

## Technical Debt

Named at kickoff, resolved or carried at closure:

- [[TD-051]] — Asynchronous export above the CSV row cap.
- [[TD-052]] — The branch dimension the finance ledgers do not carry.
- [[TD-053]] — Report query performance beyond directed indexes.
