---
id: REP-007
type: story
title: The CSV export
epic: EPIC-18
status: planned
priority: medium
depends_on:
  - REP-003
  - REP-004
  - REP-005
  - REP-006
prd_sections:
  - "31"
  - "41"
permissions:
  - reports.export
branch: feat/epic-18-dashboards-reports
created: 2026-10-19
updated: 2026-10-19
---

# REP-007 — The CSV export

## Objective

Let a tenant take any report out as a file: one CSV per report, synchronously,
bounded, and behind its own permission.

## Context

PRD §31's last line is "Initial export: CSV" and says nothing about transport.
[[DEC-066]] chose synchronous and bounded, and records why the queued
alternative is deferred rather than refused.

There is no CSV code anywhere in the repository — no `text/csv`, no `.csv`, no
serializer, no storage client. There is, however, a BFF pattern to follow: the
web app's twelve proxies were unified on text buffering and
`docs/10-qa/RELEASE-CHECKLIST.md` records why, with [[TD-050]] tracking the
streamed-body case that was already identified.

The export is the one path where aggregated data leaves the API as a file, so it
is also the one path where data classification has to be stated. A report is
INTERNAL tenant data; the veterinary due reports carry CONFIDENTIAL patient
identity and are exported under the same permission that guards reading them,
with no clinical free text ([[REP-006]]).

`reports.export` is a **separate** permission from `reports.read` ([[DEC-062]]):
reading a table on screen and exfiltrating it as a file are different decisions,
and a role may reasonably be allowed the first and not the second.

## In Scope

- A CSV serializer: RFC 4180 quoting, `\n` line endings, UTF-8, an explicit
  header row, decimal strings preserved verbatim, no locale-dependent
  formatting.
- `GET /reports/:reportCode/export` for every report delivered by
  [[REP-002]]–[[REP-006]], reusing that report's service method and period
  resolution.
- The hard row cap and its stable refusal error.
- `Content-Disposition` with a filename carrying the report code and its
  resolved period.
- The web BFF export proxy following the established text-buffering pattern.
- Data classification and logging notes: no row content is logged, and the
  export is audited at the level the module documentation records.

## Out of Scope

- Asynchronous export, object storage, signed URLs ([[DEC-066]], [[TD-051]]).
- XLSX, PDF or any other format.
- Export of a report the epic does not ship.
- Any export of clinical free text — the source reports do not carry it.

## Acceptance Criteria

- [ ] `GET /reports/:reportCode/export` returns `200 text/csv; charset=utf-8`
      with a `Content-Disposition` attachment filename for every shipped report.
- [ ] The header row is explicit and stable per report; the column order is a
      documented contract, not incidental.
- [ ] Money and quantity values are emitted exactly as their decimal string —
      `1234.50` is never `1234.5`, `"1,234.50"` or `1234.5`.
- [ ] A field containing a comma, a double quote or a newline is quoted and its
      quotes doubled, per RFC 4180.
- [ ] An empty period produces a file with a header row and no data rows — not
      an empty body and not an error.
- [ ] A period whose row count exceeds the cap returns its stable error code and
      **no partial file**.
- [ ] The export route requires `reports.export`; `reports.read` alone is not
      enough, and the test asserts both refusals separately.
- [ ] The export is tenant-scoped: the file never contains another tenant's
      rows.
- [ ] The web BFF proxy buffers text and the response arrives intact in the
      browser.
- [ ] Tests required by the Story pass.

## Domain Invariants

- The export is a rendering of the report, never a second query: the same
  service method produces both, and a test asserts their row sets are equal for
  one period.
- No number is reformatted. A CSV that rounds money is a business defect.
- No row content is logged (data classification: INTERNAL; patient identity:
  CONFIDENTIAL).
- The cap is a module constant, never a request parameter.

## API

### Added

```text
GET /reports/:reportCode/export?period=…|from=&to=
  -> 200 text/csv; charset=utf-8
         Content-Disposition: attachment; filename="<report>-<from>-<to>.csv"
  -> 400 the four REPORTS_PERIOD_* codes, plus REPORTS_EXPORT_TOO_LARGE
  -> 403 missing reports.export
  -> 404 unknown reportCode
```

### Changed

```text
None — the report routes themselves are unchanged.
```

## Database

### Migration

```text
None.
```

### Models/Tables

- Reads exactly what the exported report reads. No new table access.

## UI

- One "Export CSV" action per report on the surface [[REP-008]] builds, wired to
  the BFF proxy route.
- The action is hidden when the caller lacks `reports.export` — UX only; the
  backend refuses regardless.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- Unit: the serializer — a comma, a quote, a newline, an empty string, a decimal
  string and a value that would be tempting to reformat.
- Unit: the header-per-report contract.
- Unit: the empty period produces a header-only file.
- Unit: the cap refusal produces no partial output.
- Unit: report rows and export rows are equal for one period (the single-query
  invariant).
- Integration: media type, `Content-Disposition`, 403 for `reports.read` without
  `reports.export`, 400 for a malformed period, 404 for an unknown code.
- Tenant isolation: an export never contains another tenant's rows.
- Web: the BFF proxy route returns the buffered CSV and its headers.

## Known Limitations

- The cap is fixed; a tenant above it cannot export without narrowing the
  period.
- No streaming backpressure: the API buffers the file it returns. Recorded with
  [[TD-051]].

## Technical Debt

- [[TD-051]] — asynchronous export above the row cap.

## Decisions / ADRs

- [[DEC-066]] — synchronous and bounded.
- [[DEC-062]] — `reports.export` as a distinct permission.

## Files / Modules

- `apps/api/src/reporting/export/` — serializer, cap, route
- `apps/web/src/app/api/reports/[reportCode]/export/route.ts` — the BFF proxy
- `docs/05-modules/Reporting.md` — the export contract and its column order

## Completion Notes

_Status must remain non-done until all required gates pass._
