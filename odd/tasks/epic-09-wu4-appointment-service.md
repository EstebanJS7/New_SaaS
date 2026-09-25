# EPIC-09 WU4 — Appointment service linkage and agenda filter

## Objective

Let staff attach an optional `SERVICE` catalog item to an appointment and filter
the agenda by that service, so the PRD §14 service filter becomes real — while
the appointment duration stays the caller-supplied parameter DEC-007 fixed and
the portal gains no service selection.

## Problem and why

`docs/05-modules/Scheduling.md` and DEC-007 both state the appointment boundary
deliberately exposes no service field and defer the Catalog relation to EPIC-09.
PRD §14 asks for a service filter in the agenda, and until now no epic owned it.
The catalog now exists, so the deferred relation can land.

## Scope and constraints

- In scope: a nullable service reference on `Appointment`, its migration and
  physical guarantees, API validation of that reference, the agenda list filter,
  the reconciled scheduling module documentation, and the Story for this slice.
- Hard boundaries carried in: the reference is OPTIONAL (existing appointments
  stay valid and are never rewritten); it must resolve to an in-tenant, active
  `SERVICE` item, and nothing else; appointment `durationMinutes` remains an
  explicit caller-supplied parameter and the service must not silently derive or
  overwrite it; the portal booking-request body stays strict and gains no
  service field; no Catalog price or tax reaches scheduling.
- Out of scope: deriving duration from a service, service-based pricing,
  recurring appointments or blocks, reminders (`EPIC-17`), clinical-encounter
  linkage, and the staff UI for the selector and filter (a later slice of this
  same unit).
- Preserve unrelated uncommitted work; do not push; commit only when the
  maintainer asks.
- TDD mode: disabled, source `openspec/config.yaml` `strict_tdd: false`; runner
  `pnpm test`.

## Tasks

- [x] C1: Data and API: the nullable service reference with its migration and
      tenant-scoped foreign key, API validation (in-tenant, active, `SERVICE`
      kind), the agenda list filter, the deliberately updated DTO allowlist pin,
      the reconciled module documentation, and the Story.
- [x] C2: Staff UI: the service selector on the appointment surface and the
      service filter in the agenda.
- [x] C3: Run focused and root checks over the unit and report every executed
      command with its observed result and anything that could not run.

## Acceptance criteria and checks

- An appointment may carry a service or carry none; creating or updating one
  without a service still works, and an existing row is unaffected by the
  migration.
- A service reference is accepted only when it resolves to an in-tenant, active
  `SERVICE` catalog item; an unknown, foreign, inactive or wrong-kind reference
  is rejected and persists nothing, using the same error convention the existing
  appointment anchors already use.
- The agenda list accepts a service filter and returns only matching
  appointments, without changing any existing query behavior.
- The service field appears in the appointment response projection deliberately,
  with the DTO allowlist pin updated on purpose rather than loosened by
  accident, and no price, tax or rate value crosses into scheduling.
- `durationMinutes` remains caller-supplied; no code path derives it from the
  selected service.
- The portal booking-request body remains strict and carries no service, and the
  portal gains no service surface.
- Focused and root checks are reported with exact commands and results; anything
  needing a live database is reported as unexecuted.

## Progress

- Planning: WU1–WU3 are complete. DEC-007 and the scheduling module doc both
  record the deferred relation. No source file written yet for this unit.
- Verification: pending.
- C1: `Appointment.serviceId` added as a nullable composite
  `(tenant_id, service_id)` reference to `catalog_item` with `Restrict`, plus
  the additive migration `20260925000002_appointment_service` (no backfill, no
  data mutation, no new unique target). The API accepts the reference optionally
  on create and update and resolves it to an in-tenant, ACTIVE `SERVICE` item:
  foreign or unknown is `404 NOT_FOUND`, inactive or wrong kind is
  `400 VALIDATION_FAILED`, matching the existing anchor convention. Only the
  item's identity crosses the boundary — the catalog seam selects `id`, `name`,
  `kind` and `isActive`, so no price, tax, rate or currency reaches scheduling.
  The agenda list gained an optional `serviceId` filter that adds no predicate
  when omitted. The shared appointment projection now carries `serviceId` and a
  small read-only `service` projection, so the portal booking-request approval
  response gained the same two keys and its exact-key pin was widened on purpose
  with maintainer authorization. `docs/05-modules/Scheduling.md` was reconciled
  and CAT-005 records the slice.
- Verification: green. Database build exit 0; API suite 69 files passed + 1
  skipped / 838 tests passed + 40 skipped (was 823, so +15 cases); database
  suite 13 files / 210 tests (was 204); API typecheck and lint clean; Prettier
  clean over every touched file; `git diff --check` clean. The portal
  booking-request body still contains no service field and no code path derives
  `durationMinutes` from the service.
- Execution note: the implementing worker was aborted mid-run after writing the
  tree, so the numbers above were produced by a fresh run of the gates over the
  written code, not by the worker's own report. The Story's verification block
  was corrected from "pending" to these observed results.
- C2: the agenda gained the optional service selector on both the create and
  manage surfaces, a service filter beside the existing ones, the linked service
  shown by NAME in the row and the calendar event, honest degradation when the
  catalog read fails, and the reconciled stale comment. It reuses the catalog
  client projection instead of duplicating one, and `durationMinutes` remains
  the explicit user-controlled input — nothing derives it from the service.
- C2 blocker resolved with maintainer authorization: the agenda filter needed
  `serviceId` in the scheduling proxy's `ALLOWED_QUERY_KEYS`, which did not
  include it, so the browser request would have dropped it. Exactly one key was
  added, the client-built URL and the forwarded URL are now pinned to the same
  string, and the drop rule for every other unknown key is intact.
- C3: Root gates green — `pnpm lint` (14 tasks), `pnpm typecheck` (14 tasks),
  `pnpm test` exit 0 (typescript-config 1/1, shared 3/16, ui 6/36, database
  13/210, worker 6/37, web 47/480, api 69 passed + 1 skipped / 838 passed + 40
  skipped), `pnpm build` (9 tasks), `pnpm format-check`, and both
  `git diff --check` variants.
- Verification: WU4 complete for every check this environment can run. Still
  unexecuted because no API server, PostgreSQL or Redis is reachable: the
  migration was never applied, no live query filtered by service ran, and
  Playwright stays deferred, so the browser-to-API path is proven as two pinned
  unit halves rather than a live click-through.
- Next: epic WU5 (live-PostgreSQL closure evidence and documentation), which is
  the only thing standing between this epic and an honest `done`.

## Verification evidence

- Pending for this unit. Earlier units' evidence lives in the three sibling WU
  documents.

## Notes

- `CatalogItem` already exposes `@@unique([tenantId, id])`, so the composite
  `(tenant_id, service_id)` foreign key this unit needs is available.
- The scheduling DTO allowlist and any appointment column pins are verified
  assertions, so widening them is part of the change and must be visible in the
  diff.
