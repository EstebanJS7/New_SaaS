---
id: REP-008
type: story
title: The staff surfaces — the dashboard and the reports workspace
epic: EPIC-18
status: in-progress
priority: medium
depends_on:
  - REP-003
  - REP-004
  - REP-005
  - REP-006
  - REP-007
prd_sections:
  - "31"
permissions:
  - reports.read
  - reports.export
branch: feat/epic-18-dashboards-reports
created: 2026-10-19
updated: 2026-10-19
---

# REP-008 — The staff surfaces

## Objective

Put the reports where staff will actually see them: a dashboard at `/app` that
summarises the day and the month, and a reports workspace at `/app/reports` that
lists every report, renders one with its period controls, and exports it.

## Context

`apps/web/src/app/(app)/app/page.tsx` is a placeholder that says so in its own
body: "Placeholder content. Real destinations arrive with later epics." This
Story is that later epic. [[DEC-062]] decided the dashboard is the reports
surface with another layout — **one aggregation path**, so a dashboard card and
its report call the same API route with the same period, and a test asserts it
rather than trusting the reviewer to notice a second query.

The shell already provides the sidebar, the brand resolution and the content
region; the reports workspace is a new destination inside it, not a new shell.
`docs/03-architecture/BRANDING-THEMING.md` applies: cards consume semantic
tokens (`bg-card`, `text-muted-foreground`, `border`) and never a literal brand
colour, radius or font.

Two first-run states are specific to this epic and must be rendered honestly:

- The low-stock report is empty for every tenant until a threshold is set
  ([[DEC-065]]).
- Both due reports are empty until a veterinarian enters a due date
  ([[DEC-065]]).

Neither is an error and neither may render as a blank panel. They explain why
they are empty and link to where the missing fact is entered.

[[TD-049]] and [[TD-050]] record the BFF body-handling gaps already found in
this layer; the new proxies follow the unified buffering pattern and do not add
to them.

## In Scope

- The dashboard at `/app`: period-scoped summary cards for gross sales, sale
  count, cash difference and low-stock count, each derived from the report API,
  plus the two first-run explanations where applicable.
- The reports workspace at `/app/reports`: the report index, and one report view
  with period controls (presets plus a custom range) that renders rows and the
  export action.
- The web BFF proxy routes for the reports the surfaces consume, following the
  unified text-buffering pattern.
- Loading, empty, error, success and permission-denied states for both surfaces.
- Playwright specs in `apps/e2e` covering the dashboard and one report end to
  end, including its CSV export.
- Replacement of the placeholder at `/app/page.tsx` and of its placeholder test.

## Out of Scope

- Any chart, sparkline or graph. No charting dependency is added; summaries are
  numbers in `Card` composition. A chart is a follow-up, not a requirement PRD
  §31 states.
- Any new shell, navigation paradigm or global state library.
- Scheduled reports, email delivery, or saved report configurations.
- Portal exposure. Reports are staff-only; the portal has its own surfaces and
  [[DEC-008]] keeps the identities separate.

## Acceptance Criteria

- [ ] `/app` renders the dashboard cards from the report API for the selected
      period, and no card issues a query the reports workspace does not use —
      asserted by a test on the shared data hook, not by convention.
- [ ] `/app/reports` lists every report the epic ships and opens each one.
- [ ] Period controls offer the five presets and a custom range; an over-long
      range surfaces the API's error message rather than a generic failure.
- [ ] The export action downloads a CSV file through the BFF proxy.
- [ ] The export action is hidden for a caller without `reports.export` and the
      API still refuses that caller (UX-only check, backend authoritative).
- [ ] The low-stock and due-report first-run states explain their emptiness and
      link to the surface where the missing fact is entered.
- [ ] Every state renders: loading, empty, error, success and permission-denied.
- [ ] Every component consumes semantic tokens only — no literal brand colour,
      radius or font — and the existing surface-integrity test covers the new
      files.
- [ ] Playwright covers the dashboard and one report with its CSV export.
- [ ] Tests required by the Story pass.

## Domain Invariants

- The UI never computes a total. Every number it renders came from the API; a
  client-side sum would be a second aggregation path ([[DEC-062]]).
- Money renders from a decimal string; no `Number()` conversion before display.
- The tenant and its permissions come from the session, never from a URL.

## API

### Added

```text
None in the API — this Story consumes REP-002…REP-007.

Web (BFF, buffered text):
GET /api/reports/sales-by-period
GET /api/reports/payment-methods
GET /api/reports/sales-by-product-service
GET /api/reports/cash-sessions
GET /api/reports/cash-movements
GET /api/reports/purchases
GET /api/reports/stock
GET /api/reports/low-stock
GET /api/reports/consultations
GET /api/reports/new-patients
GET /api/reports/vaccines-due
GET /api/reports/deworming-due
GET /api/reports/:reportCode/export
```

### Changed

```text
/                            ->  the placeholder dashboard is replaced
```

## Database

### Migration

```text
None.
```

### Models/Tables

- None written. Read-only epic.

## UI

- `apps/web/src/app/(app)/app/page.tsx` — the dashboard, replacing the
  placeholder.
- `apps/web/src/app/(app)/app/reports/page.tsx` — the report index.
- `apps/web/src/app/(app)/app/reports/[reportCode]/page.tsx` — one report.
- Shared report components under `apps/web/src/components/reporting/`.
- Semantic branding tokens only; the surface-integrity test covers the new
  files.

## Implementation Summary

**Part 1 implemented (the BFF proxies and the reports workspace); part 2 (the
dashboard at `/app` and the Playwright specs) pending.**

Part 1 — commit `WU-I1`:

- **One GET-only catch-all proxy** at
  `apps/web/src/app/api/reports/[[...path]]`, driven by ONE local allowlist
  module that carries both the twelve codes and the query shape each accepts
  (`period`, `due`, `none`). The workspace catalogue and the proxy read the same
  module, so a code cannot drift inside the app.
  - An unknown code, an unknown query key, a `tenantId`, a wrong-shape key, a
    two-segment path and a missing session are ALL refused locally with no
    upstream call — a refusal never touches the network.
  - The export path is untouched. The build registers both routes as separate
    entries (`/api/reports/[[...path]]/route` and
    `/api/reports/[reportCode]/export/route`), which settles the precedence
    question structurally; the catch-all additionally 404s any path that is not
    exactly one known code, so the CSV can never be silently proxied as a JSON
    read.
- **The reports workspace**: an index of the twelve reports grouped Core (8) and
  Veterinary (4), and a per-report view whose controls are DERIVED from the
  report's query shape — five presets and a custom range for the nine period
  reports, a `horizonDays` control for the two due reports, and **no control at
  all** for `low-stock`, which sends no query. A half-typed custom range is
  never sent, and the export link always carries exactly the query being
  displayed.
- **Columns are derived from the response type, not declared twice.** Each
  report's header map is typed `Record<keyof Row, string>`, so a field added to,
  renamed in or removed from the mirrored DTO is a compile error until its
  header exists; the column ORDER comes from the payload's own key order, and a
  field the API starts sending renders under its raw key rather than being
  dropped. `ReportTable` is an exhaustive switch, so a thirteenth report will
  not compile until it has a table.
- **Three actionable empty states**, which is the point of the ordering
  decision: `low-stock` with `thresholdsConfigured: false` links to
  `/app/catalog` where a threshold is set; both due reports link to
  `/app/patients`, where [[REP-010]] landed the clinical record surface; and
  `low-stock` configured but clear says so without a link, because there is
  nothing to fix.
- Decimal strings render **verbatim** — the tests assert `"1234.50"` appears and
  that `1234.5` does not exist — and counts render as numbers.
- `Reports` joins the nav **without** a `requiredFeature`, per [[DEC-062]].

## Verification

```text
pnpm format-check   PASS
pnpm lint           PASS  (23/23 turbo tasks)
pnpm typecheck      PASS  (23/23)
pnpm build          PASS  (13/13)  — registers BOTH /api/reports routes
pnpm test           PASS  (23/23)
  web        117 files (112 landed + 5 new)      1268 passed  (+54)
  api        114 files                           1634 passed | 266 skipped
  database    30 files                            549 passed
```

54 new tests: 14 proxy, 11 api-client, 6 column derivation, 4 index and 19
report-view. The two pre-existing nav assertions that count the sidebar's
entries were updated for the new destination and now assert its `href` and its
absence of a feature gate.

## Tests Added

- Web unit: the dashboard data hook and the report view share one fetch path.
- Web unit: every state of both surfaces, including the two first-run
  explanations.
- Web unit: the export action is hidden without `reports.export`.
- Web unit: a decimal string renders verbatim.
- BFF: each proxy buffers text and forwards the API's error status.
- Playwright: the dashboard loads with seeded data; one report opens, changes
  its period and exports a CSV whose first line is the documented header.

## Known Limitations

- No charts.
- The dashboard's card set is fixed; a configurable dashboard is not in scope.

## Technical Debt

- [[TD-052]] — the branch dimension the finance ledgers do not carry, which also
  blocks any per-branch dashboard card.

## Decisions / ADRs

- [[DEC-062]] — one aggregation path.
- [[DEC-063]] — the period control shape.

## Files / Modules

- `apps/web/src/app/(app)/app/page.tsx`
- `apps/web/src/app/(app)/app/reports/`
- `apps/web/src/app/api/reports/`
- `apps/web/src/components/reporting/`
- `apps/e2e/tests/reports.spec.ts`
- `docs/05-modules/Reporting.md`

## Completion Notes

Part 1 gates passed on 2026-10-19; the Story stays `in-progress` until the
dashboard and the Playwright specs land.
