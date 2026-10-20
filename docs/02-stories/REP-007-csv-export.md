---
id: REP-007
type: story
title: The CSV export
epic: EPIC-18
status: done
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

**The two keys are CONJUNCTIVE, in one direction only.** An export requires
BOTH: the route declares `reports.export`, and the report's own service method —
which the export must call, because the export and the report have to render the
same rows — re-asserts `reports.read` exactly as it does for the JSON route. So:

```text
reports.read only    -> refused  (403 at the export route)
reports.export only  -> refused  (403 at the report's own re-assertion)
both                 -> the file
neither              -> refused
```

That asymmetry is deliberate and is the whole point of having a second key:
`reports.export` must never become a way to obtain data the caller is not
allowed to READ. Granting the export key alone would make it exactly that — a
side door around the read permission — which is the opposite of what DEC-062
separated the keys for.

A consequence worth stating: the seed grants `reports.export` only to `OWNER`
and `ADMIN`, and both already hold `reports.read`, so the conjunction is
invisible in practice today. It becomes visible the moment somebody is granted
the export key without the read key, and at that point the refusal is the
correct answer.

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

- [x] `GET /reports/:reportCode/export` returns `200 text/csv; charset=utf-8`
      with a `Content-Disposition` attachment filename for every shipped report.
- [x] The header row is explicit and stable per report; the column order is a
      documented contract, not incidental.
- [x] Money and quantity values are emitted exactly as their decimal string —
      `1234.50` is never `1234.5`, `"1,234.50"` or `1234.5`.
- [x] A field containing a comma, a double quote or a newline is quoted and its
      quotes doubled, per RFC 4180.
- [x] An empty period produces a file with a header row and no data rows — not
      an empty body and not an error.
- [x] A period whose row count exceeds the cap returns its stable error code and
      **no partial file**.
- [x] The export route requires `reports.export`; `reports.read` alone is not
      enough, and the test asserts both refusals separately.
- [x] The export is tenant-scoped: the file never contains another tenant's
      rows.
- [x] The web BFF proxy buffers text and the response arrives intact in the
      browser.
- [x] Tests required by the Story pass.

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

Implemented on `feat/epic-18-dashboards-reports`.

- **ONE route, not twelve**: `GET /reports/:reportCode/export` driven by a
  single `REPORT_EXPORT_DEFINITIONS` table that owns, per code, the query
  contract, the column order and the filename. Twelve near-identical handlers
  would have been twelve chances for one of them to accept the wrong query
  shape.
  - Period reports reuse the shipped period schema and resolver; the two due
    reports reuse the shipped horizon schema and resolver; `low-stock` takes no
    query and refuses any key. No third contract was invented.
- **The export is a RENDERING, not a second query.** Every code calls the same
  `ReportingService` method the JSON route calls, and an integration test
  compares the parsed CSV against the JSON response field for field. A second
  query would make that agreement unverifiable.
- **The serializer is hand-written** (no dependency): RFC 4180 quoting on `,`,
  `"`, `\n` or `\r` with doubled inner quotes, `\n` line endings, UTF-8 with no
  BOM, an explicit header row always, and **no value reformatted** — a decimal
  string leaves verbatim and a `null` renders as an EMPTY field rather than
  `"null"`.
- **The cap is checked BEFORE serialization**, so an over-cap request produces
  no partial body rather than a truncated file. It is 10 000 data rows; the
  header is not counted, and the underlying report's own read cap still applies,
  so whichever fires first wins.
- **`reports.export` and `reports.read` are CONJUNCTIVE, in one direction**: the
  route declares the export key and the report's own method re-asserts the read
  key. `reports.read` alone is refused at the route; `reports.export` alone is
  refused at the service. That asymmetry is the reason the second key exists:
  **`reports.export` must never become a side door to data the caller cannot
  read.**
- The web BFF proxy validates the code against the same allowlist locally before
  any upstream call, forwards the staff cookie and `x-request-id`, buffers the
  body as TEXT, and forwards **both** `content-type` and `content-disposition` —
  without the latter the browser invents a filename.

## Verification

```text
pnpm format-check   PASS
pnpm lint           PASS  (23/23 turbo tasks)
pnpm typecheck      PASS  (23/23)
pnpm build          PASS  (13/13)
pnpm test           PASS  (23/23)
  api        114 files (111 landed + 3 new)      1634 passed | 266 skipped  (+46)
  web        111 files (110 landed + 1 new)      1172 passed               (+8)
  database    30 files                            549 passed
```

54 new tests: 13 serializer, 21 service, 11 integration, 1 RBAC pin and 8 BFF.

**A real CSV was produced from real PostgreSQL**, because the route tests run on
the in-memory fixture and a serializer that agrees with a fake proves nothing
about the values. Against a migrated database with one completed sale of two
lines:

```text
bucketDate,saleCount,net,tax,gross
2026-06-05,1,2569.00,0.00,2569.00

catalogItemId,name,kind,quantity,net,tax,gross
c0000000-…-0002,Consulta,SERVICE,1.000,100.00,0.00,100.00
c0000000-…-0001,"Gasa ""sterile"", 10cm",PRODUCT,2.000,2469.00,0.00,2469.00

empty period ->
bucketDate,saleCount,net,tax,gross
```

Three things to read in that output. `2569.00` survives the round trip exactly —
no float, no `2569`, no thousands separator. The item name containing a comma
AND embedded quotes is quoted and its quotes doubled, which is the RFC 4180 case
most serializers get wrong. And an empty period is a header line and nothing
else, not an empty body.

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

- The cap is fixed; a tenant above it must narrow the period. Recorded with
  [[TD-051]] as the trigger for the asynchronous path.
- **The export cap binds in practice only on `sales-by-product-service`**, whose
  row set is one per distinct item sold and has no read cap of its own; every
  other row-bearing report is already bounded below 10 000 by its own read cap.
  A tenant with 10 001 distinct items sold in one period gets a refusal rather
  than a file.
- **The web allowlist restates the API's report codes**, because no shared
  package was in scope. A drift means the browser refuses locally (`400`) a code
  the API would have accepted (`404` upstream) — a local refusal, never a wrong
  file.
- The BFF answers `400` for an unknown code while the API answers `404`, because
  the proxy refuses locally without an upstream call. The asymmetry is
  deliberate (no upstream request for an obviously invalid code) and is
  documented.
- No row content is ever logged; the file exists only in the response.
- The 10 000-row export cap is proven at the SERVICE level against a stub,
  because the in-memory fake ignores `take`; [[TD-056]] records that gap.
- The CSV samples above were corrected after independent verification: the first
  version showed four- and one-column files while the definitions emit seven and
  five. An illustration that does not match the contract teaches the wrong
  contract, which is why the samples are now copied from the real header rows.

## Technical Debt

- [[TD-051]] — asynchronous export above the row cap, with its trigger.

## Decisions / ADRs

- [[DEC-066]] — synchronous and bounded.
- [[DEC-062]] — `reports.export` as a distinct permission.

## Files / Modules

- `apps/api/src/reporting/export/` — serializer, cap, route
- `apps/web/src/app/api/reports/[reportCode]/export/route.ts` — the BFF proxy
- `docs/05-modules/Reporting.md` — the export contract and its column order

## Completion Notes

All required gates passed on 2026-10-19. The `apps/e2e` lane was not run (Docker
unavailable); the export's browser path is covered by the BFF unit suite
instead.
