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
- [x] **WU-D — [[REP-004]] the cash and purchase reports.** _Done: see the
      evidence log._
- [x] **WU-E — [[REP-005]] the inventory reports.** _Done: see the evidence
      log._
- [x] **WU-F — [[REP-006]] the veterinary reports.** Two commits: **WU-F1**
      consultations + new patients; **WU-F2** the two due reports. _Done._
- [x] **WU-G — [[REP-007]] the CSV export.** _Done: see the evidence log._
- [x] **WU-H — [[REP-010]] the clinical record entry surface.** _Done: see the
      evidence log._ deworming: list, create and correct, on the proxy and
      permissions that already ship ([[DEC-067]]). Lands BEFORE REP-008, whose
      empty state links here.
- [ ] **WU-I — [[REP-008]] the staff surfaces and the e2e lane.**
- [ ] **WU-J — [[REP-009]] the epic closure and evidence.**

## Review workload

Nine work units, each a self-contained commit. The two riskiest are **WU-A**,
because it touches five already-`done` epics' write paths; **WU-G**, because it
is the only path where a report's data leaves the API as a file; and **WU-H**,
because it is the only unit that adds UI a human types clinical data into.

Inserted after the epic opened ([[DEC-067]]): **WU-H is [[REP-010]]**, and the
two units after it were renumbered `WU-I`/`WU-J` so the letters keep execution
order.

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

### WU-D — the cash and purchase reports

Commit `WU-D` on `feat/epic-18-dashboards-reports`.

- `GET /reports/cash-sessions` reads `CLOSED` sessions dated by `closedAt` and
  asserts `counted - expected = difference` per row with `Decimal.equals()`,
  refusing loudly with the session id when the three stored amounts disagree.
- `GET /reports/cash-movements` dates each movement by its own `createdAt` and
  resolves the sign by **importing `cashMovementSign`** from the cash domain — a
  second copy of DEC-030's switch would be a second opinion about the same
  money. One test case per movement kind plus `ADJUSTMENT` in both directions,
  and the net checked against an independently recomputed signed sum.
- `GET /reports/purchases` reads `RECEIVED` rows dated by `receivedAt`, resolves
  suppliers in one batched tenant-predicated read, and carries **no money field
  and no total** — asserted structurally, because the aggregate owns neither and
  a total from `unitCost` would be invented.
- No `currency` on either cash response: the Cash domain has no currency column.
  The Story's own API sketch said otherwise and was corrected.
- The in-memory fake gained `closedAt` / `createdAt` / `receivedAt` ranges and
  `supplier.id.in` **implemented in the filters**, plus one shared half-open
  predicate (`matchesHalfOpenInstant`) so the `>= gte` / `< lt` / NULL-matches-
  nothing rule has a single implementation instead of five copies.
- Gates: api **1432 → 1478** (+46); format/lint/typecheck/build green.

**Skipped:** the `apps/e2e` lane (no UI in this work unit).

### WU-E — the inventory reports

Commit `WU-E` on `feat/epic-18-dashboards-reports`.

- `GET /reports/stock` reports the CURRENT `stock_balance` quantity beside the
  PERIOD's `inbound`/`outbound`/`net` from the `stock_movement` ledger. The DTO,
  the docs and the real-database proof all state that these are different
  questions: one item read
  `quantity 10.000 / inbound 20.000 / outbound 8.000 / net 12.000`, and the
  difference is a movement outside the period.
- `stock_movement.quantity` is already signed, so `outbound` is reported as a
  POSITIVE magnitude — the stored sign already says the direction. No movement
  type owns the sign here, unlike cash.
- `GET /reports/low-stock` takes **no query at all** and refuses any key, so a
  period cannot be silently ignored on a current-state report. The comparison is
  `<=` (at the threshold is already low) and a NULL threshold is skipped before
  any comparison.
- **Fixed a defect found in this work unit:** `thresholdsConfigured` was derived
  from the balanced items, so a tenant whose only thresholded item had never
  moved was told "nobody configured anything". It is now its own existence probe
  over `catalog_item`, with a regression test.
- The balance-versus-ledger equality is proven as a TEST invariant and confirmed
  on real PostgreSQL (`balance === all-time ledger sum: true`), because the
  runtime movement read is period-bounded and cannot assert it live.
- Gates: api **1478 → 1520** (+42); format/lint/typecheck/build green.

**Skipped:** the `apps/e2e` lane (no UI in this work unit).

### WU-F1 — consultations and new patients

Commit `WU-F1` on `feat/epic-18-dashboards-reports`.

- `GET /reports/consultations` reads `CLOSED` encounters by `closedAt` with a
  minimal `select` (`id`, `closedAt`, `amendsEncounterId`) and **never** reads
  clinical free text. An amendment is a `CLOSED` row with a non-NULL
  `amendsEncounterId`: it is counted in `amendmentCount` and skipped, so it
  reaches neither the consultation count nor the buckets. Both figures come from
  one read over one half-open range.
- `GET /reports/new-patients` reads `Patient.createdAt` and deliberately has no
  `isActive` predicate, because soft deactivation does not unfact a
  registration.
- Both bucket by the LOCAL day through the shared `tenantCalendarDate` helper.
- **The fixture was missing `amendsEncounterId` entirely.** Without it
  `undefined !== null` would have won and every consultation would have been
  counted as an amendment — a false green in the unit's most important
  assertion.
- Gates: api **1520 → 1551** (+31); format/lint/typecheck/build green.
- Proven on real PostgreSQL: 2 consultations + 1 amendment from 3 read rows,
  buckets `06-05=1`/`06-10=1`, and the `2026-06-11T02:00Z` encounter bucketing
  to `06-10`. `keys read: amendsEncounterId,closedAt,id` demonstrates the
  redaction.

**Skipped:** `apps/e2e` (no UI in this work unit).

**WU-F2 must first add a `clinicalDeworming` delegate to the fixture** — it does
not exist, and the deworming due report cannot be exercised through
`bootTestApp()` without it.

### WU-F2 — the two due reports

Commit `WU-F2` on `feat/epic-18-dashboards-reports`.

- `GET /reports/vaccines-due` and `GET /reports/deworming-due`: no period, an
  optional `horizonDays` defaulting to 30 with an integer shape and a `1..365`
  bound, and a `.strict()` query so a period key is refused rather than ignored.
- **The horizon runs through the shared helpers only.** `shiftCalendarDays` is
  now exported from `report.period.ts` so the horizon cannot grow a second
  `+ days * 86400000`. `horizonEndInstant` is the tenant day AFTER the horizon,
  so a due date on the last horizon day is included.
- **No lower bound, deliberately**: an overdue vaccination is overdue however
  old, and the row cap is the honest failure rather than a truncated list that
  looks complete.
- **Classification compares calendar dates in the tenant zone, not instants**,
  and **due today is UPCOMING**. Rows are ordered `nextDueAt` ascending, so
  overdue comes first — the order the practice works through.
- **The fixture gained the `clinicalDeworming` delegate that never existed**,
  plus an optional `patientId` and a `nextDueAt` filter on
  `clinicalVaccination`.
- Gates: api **1551 → 1588** (+37); format/lint/typecheck/build green.
- Proven on real PostgreSQL with three due dates one day apart around the
  boundary: `2026-10-18 -> OVERDUE`, `2026-10-19 -> UPCOMING` (today),
  `2026-11-18 -> UPCOMING` (exactly on the horizon), while `+31 days` and a NULL
  due date are excluded. The projection stays minimal.

**Skipped:** `apps/e2e` (no UI in this work unit). Both reports stay empty until
[[REP-010]] ships the entry surface.

### WU-G — the CSV export

Commit `WU-G` on `feat/epic-18-dashboards-reports`.

- **One route**, `GET /reports/:reportCode/export`, driven by a single
  definitions table that owns the query contract, the column order and the
  filename per code. Twelve handlers would have been twelve chances for one to
  accept the wrong query.
- The export calls the report's OWN service method, so export rows and report
  rows are the same rows by construction; an integration test compares the
  parsed CSV against the JSON field for field.
- Hand-written RFC 4180 serializer: quoting on `,` `"` `\n` `\r` with doubled
  inner quotes, `\n` endings, UTF-8 no BOM, explicit header always, and **no
  value reformatted** — a decimal string leaves verbatim, a `null` renders
  empty.
- The cap is checked BEFORE serialization, so an over-cap request yields no
  partial file.
- **`reports.export` and `reports.read` are conjunctive in one direction.** The
  route declares the export key and the report's method re-asserts the read key,
  so `reports.export` can never be a side door to data the caller cannot read.
  The implementation had this right and the delegation spec had it wrong; the
  Story and [[DEC-062]] now state the conjunction explicitly so nobody "fixes"
  it later.
- Gates: api **1588 → 1634**, web **1164 → 1172**; format/lint/typecheck/build
  green.
- A real CSV was produced from real PostgreSQL: `2569.00` survived verbatim, and
  an item name containing both a comma and embedded quotes came out as
  `"Gasa ""sterile"", 10cm"`. An empty period is the header line and nothing
  else.

**Skipped:** the `apps/e2e` lane (Docker unavailable); the browser path is
covered by the BFF unit suite.

### WU-H — the clinical record entry surface

Commit `WU-H` on `feat/epic-18-dashboards-reports`.

- **The first work unit in the epic with no backend change.** The API routes,
  the BFF allowlist and `vet.clinical.*` all shipped in EPIC-06 and were never
  consumed by a staff screen; what was missing was a client module and a form.
- `clinical-api.ts` gains the list/create/update trio for vaccinations and
  deworming, with `nextDueAt?: string | null` on update.
- `clinical-records.tsx` renders both kinds in the existing patient workspace:
  list, create, correct, and an explicit remove-the-due-date control that sends
  exactly `{ nextDueAt: null }` — nothing else is resubmitted, so clearing a
  wrong date cannot rewrite the name or the administration instant in the same
  write.
- An absent due date renders as "No due date recorded", because DEC-065 made
  NULL a real state and the due reports depend on telling it apart from a date.
- Date entry is `<input type="datetime-local">`, the agenda's control. A
  hand-rolled date-only "midnight UTC" would have made the due report bucket the
  row to the previous local day.
- **A wrong path in my own brief was caught here**: the spec said
  `apps/e2e/tests/`, which does not exist — `playwright.config.ts` pins
  `testDir: "./specs"` and both tsconfig and lint target `specs/**/*`. The
  worker stopped rather than write a spec the lane would never discover, and the
  file went to `apps/e2e/specs/`. The Story and this log now use the real path.
- Gates: web **1172 → 1212** (+40), api 1634, database 549;
  format/lint/typecheck/ build green, and `apps/e2e` typecheck+lint pass so the
  spec is statically valid.

**Not verified:** the `apps/e2e` lane cannot run here (no Docker, no built apps,
no database). The spec is written, statically valid and explicitly unrun.
