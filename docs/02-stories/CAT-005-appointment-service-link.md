---
id: CAT-005
type: story
title: Appointment service link
epic: EPIC-09
status: in-progress
priority: high
depends_on:
  - EPIC-07
  - CAT-001
  - CAT-002
prd_sections:
  - "14"
  - "15"
permissions:
  - scheduling.appointment.read
  - scheduling.appointment.manage
branch: main
created: 2026-09-25
updated: 2026-09-25
---

# CAT-005 — Appointment service link

## Objective

Make PRD §14's agenda **service filter** real by letting staff OPTIONALLY attach
one in-tenant, active `SERVICE` catalog item to an appointment, project that
item's identity back on the appointment response, and filter the agenda by it —
without changing the caller-supplied duration DEC-007 fixed and without adding
any portal service selection.

This Story holds both halves of epic work unit **WU4**: the data/API slice
(`C1`) and the staff UI slice (`C2`) — the optional service selector on the
appointment surfaces, the agenda service filter and the service detail the
agenda renders. The scheduling web proxy now forwards `serviceId`, so the
browser filter reaches the API end to end.

## What shipped

| Layer         | Change                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database      | `appointment.service_id` — nullable `UUID`, composite `(tenant_id, service_id) -> catalog_item(tenant_id, id)` FK, `RESTRICT` on delete/update, `(tenant_id, service_id)` index.      |
| Migration     | `20260925000002_appointment_service` — additive only: one nullable column, its FK and its index. No backfill, no data mutation, no default.                                           |
| Validation    | `assertAppointmentServiceAnchor` — a present value must resolve to an in-tenant, ACTIVE `SERVICE` item.                                                                               |
| DTO           | `serviceId` plus a read-only `service` identity projection (`id`, `name`, `kind`).                                                                                                    |
| Agenda read   | Optional `serviceId` filter on `GET /appointments`.                                                                                                                                   |
| Staff UI      | An OPTIONAL service selector on the create and edit surfaces, populated from the staff catalog read filtered to active `SERVICE` items. Leaving it empty submits with no `serviceId`. |
| Agenda filter | A service filter beside the existing filters; it adds `serviceId` to the list query and leaves the filters, views and navigation unchanged.                                           |
| Agenda detail | Where an appointment carries a service, its NAME renders in the list row, the calendar event content and the Manage panel; no price, tax, rate or currency renders anywhere.          |
| Client seam   | The agenda reuses the catalog client (`listCatalogItems`) and projects every item to `{id, name}`, so no catalog monetary field can reach the selector or the filter.                 |
| Web proxy     | `ALLOWED_QUERY_KEYS` in the scheduling proxy gains exactly `serviceId`; every other key and every drop rule is unchanged, and the route test pins the widened list by exact URL.      |

## Error convention (reused, not invented)

The optional reference uses the SAME convention the neighboring appointment
anchors already use, so it introduces no new code or envelope:

| Reference state                             | Result                    | Message                   |
| ------------------------------------------- | ------------------------- | ------------------------- |
| Unknown UUID                                | `404 NOT_FOUND`           | `Service was not found.`  |
| Item owned by another tenant                | `404 NOT_FOUND`           | `Service was not found.`  |
| In-tenant item that is inactive             | `400 VALIDATION_FAILED`   | the anchor's rule message |
| In-tenant item of a kind other than SERVICE | `400 VALIDATION_FAILED`   | the anchor's rule message |
| Absent / explicit `null`                    | accepted, no catalog read | —                         |

A foreign or unknown UUID is byte-equivalent to a missing one, exactly like the
Branch/Patient/membership anchors. `kind = SERVICE` and `isActive` are
application rules, not database constraints, mirroring the VETERINARIAN role
rule the professional anchor enforces.

## In Scope

- `packages/database/prisma/schema.prisma` — the nullable `serviceId` on
  `Appointment`, its composite tenant FK and its `CatalogItem` back-relation.
- `packages/database/prisma/migrations/20260925000002_appointment_service/` —
  the additive migration.
- `packages/database/src/scheduling.test.ts` — textual DDL/schema gates.
- `apps/api/src/scheduling/appointment-invariants.ts` — the anchor guard and the
  optional service field on the shared reschedule compare-and-set.
- `apps/api/src/scheduling/appointment.dto.ts` — the request fields, the
  response projection and the allowlist.
- `apps/api/src/scheduling/appointment.service.ts` — anchor validation, the
  batched identity read, the agenda filter and the create/reschedule wiring.
- `apps/api/src/scheduling/appointments.controller.ts` — the `serviceId` query
  filter.
- `apps/api/src/scheduling/*.test.ts` and
  `apps/api/test/support/in-memory-database.ts` — coverage and the boundary
  fake.
- `apps/web/src/app/(app)/app/agenda/agenda-api.ts` — the optional `serviceId`
  and `service` identity projection on the appointment types, the `serviceId`
  list filter and the optional service on the create/reschedule inputs.
- `apps/web/src/app/(app)/app/agenda/agenda.tsx` — the selector on both
  appointment surfaces, the agenda service filter, the honest degradation of a
  failed catalog read and the Manage-panel rendering.
- `apps/web/src/app/(app)/app/agenda/agenda-views.tsx` — the service NAME in the
  list row and the calendar event content.
- `apps/web/src/app/(app)/app/agenda/agenda-api.test.ts`,
  `agenda-calendar.test.ts` and `agenda.test.tsx` — the client, mapping and
  component coverage.
- `apps/web/src/app/api/scheduling/[[...path]]/route.ts` — the shared query
  allowlist widened by exactly `serviceId`.
- `apps/web/src/app/api/scheduling/[[...path]]/route.test.ts` — the widened
  allowlist pinned by exact URL plus the drop rule.
- `docs/05-modules/Scheduling.md` — the implemented behavior.
- This Story and the epic's Stories entry.

## Out of Scope

- **Deriving duration from a service**, service-based pricing, recurring
  appointments or blocks, reminders (EPIC-17) and clinical-encounter linkage.
- **Portal service selection.** The portal booking-request body stays
  `.strict()` and gains no service field; no portal DTO or route changes.
- **Catalog administration.** Scheduling only READS catalog items; the catalog
  module, its permissions, routes and DTOs are untouched.
- Live-PostgreSQL evidence (WU5).

## Acceptance Criteria

- [x] `Appointment.service_id` is nullable and tenant-scoped through a composite
      `(tenant_id, service_id) -> catalog_item(tenant_id, id)` FK with
      `ON DELETE/UPDATE RESTRICT`, plus a `(tenant_id, service_id)` index.
- [x] The migration is additive: it adds one nullable column, its FK and its
      index. There is no backfill, no default and no data mutation, so every
      existing appointment stays valid and is never rewritten.
- [x] `serviceId` is OPTIONAL on create and on reschedule. Absent on create
      means no service; on reschedule, absent leaves the stored reference
      untouched and an explicit `null` clears it.
- [x] A present reference must resolve to an in-tenant, ACTIVE `SERVICE` item;
      unknown, foreign, inactive and wrong-kind references are rejected and
      persist nothing, using the existing anchor convention (`404 NOT_FOUND` /
      `400 VALIDATION_FAILED`).
- [x] The response projection gains `serviceId` plus a read-only `service`
      identity projection (`id`, `name`, `kind`) and NO price, tax, rate or
      currency value. The existing DTO allowlist pin is widened deliberately.
- [x] The agenda list accepts an optional `serviceId` filter and returns only
      matching appointments; omitting it adds no predicate, so existing query
      behavior is unchanged.
- [x] The appointment create and edit surfaces offer an OPTIONAL service
      selector populated from the staff catalog read filtered to active
      `SERVICE` items; leaving it empty submits the appointment with no
      `serviceId`, so the reference is never a validation requirement.
- [x] The agenda accepts a service filter beside the existing branch,
      professional and status filters and adds `serviceId` to the list query
      without changing the views or navigation.
- [x] A linked service is rendered by NAME in the list row, the calendar event
      content and the Manage panel, and no price, tax, rate or currency value
      appears on the agenda.
- [x] A failed catalog read degrades to an empty selector with a clear message;
      the appointment still saves without a service and the client invents no
      permission rule from the failure.
- [x] The scheduling web proxy forwards `serviceId` so the browser filter
      reaches the API; the route test pins the widened allowlist by exact URL
      and keeps its unknown-key drop rule, so no other key was loosened.
- [x] `durationMinutes` remains the explicit caller-supplied parameter from
      DEC-007; no code path derives it from the selected service.
- [x] The portal booking-request body remains `.strict()` with no service field,
      and no portal surface exposes service selection.
- [ ] Live-PostgreSQL and migration-application evidence — unexecuted:
      PostgreSQL `127.0.0.1:5433` and Redis `6380` are unreachable, so the
      migration was not applied and `pnpm db:seed`, `pnpm db:live-verify` and
      `pnpm test:live-pg` did not run.

## Domain Invariants

- **The reference stays optional.** `service_id` is nullable; no appointment is
  required to carry one and existing rows are untouched by the migration.
- **The service never sets the duration.** `startAt`/`endAt` remain the caller's
  explicit parameters; nothing reads the service to compute a span.
- **No catalog value crosses into scheduling.** The batched read selects `id`,
  `name` and `kind` only, so no price, tax, rate or currency column can be read.
- **Ownership is enforced twice.** The composite FK rejects a cross-tenant
  reference at the database, and the anchor guard returns the byte-equivalent
  `404` before anything is written.
- **Deactivation is not a link change.** An item deactivated after linking still
  renders its identity on reads; only a new or changed link is validated against
  `isActive`.

## Decided

- **`kind = SERVICE` and `isActive` are application rules, not FK/CHECK
  constraints.** `is_active` is mutable through catalog deactivation, so a
  database predicate would need a trigger and could still not express "valid at
  link time". The write path is the only place a link is created or changed, so
  the anchor guard is the single authority — the same shape as the VETERINARIAN
  role rule.
- **An absent reschedule `serviceId` leaves the stored reference untouched; an
  explicit `null` clears it.** This matches the catalog update convention
  (`null`-clears / absent-untouched) instead of making an omitted key mean
  "clear" or "keep the old value" implicitly.
- **The linked item's missing read is an `INTERNAL`, not a silent `null`.** The
  composite tenant FK plus the catalog DELETE rejection guarantee the referenced
  row exists in the same tenant, so a miss is a scoping defect and fails loudly
  instead of emitting a `serviceId` with no `service`.
- **The service identity projection carries `kind`.** It is the item's identity
  and lets a reader self-describe the link; it is not a monetary dimension and
  the projection deliberately omits every price/rate field.
- **The agenda reuses the catalog client and projects every item to
  `{id, name}`.** `listCatalogItems({ kind: "SERVICE", isActive: true })` is the
  only catalog read the agenda makes, and the projection is what keeps price,
  tax, rate and currency structurally out of the selector and the filter — no
  second catalog client exists to drift from it.
- **The agenda filter is server-side.** It adds the `serviceId` query key
  exactly like the branch/professional/status filters instead of narrowing the
  already-fetched page in memory, so the API stays the single filtering
  authority.
- **Clearing the selector is an explicit `null`; a calendar drag omits the
  key.** The edit surface sends `serviceId: <id>` or `serviceId: null`, while a
  drag/resize sends no `serviceId`, matching the API's absent-untouched /
  `null`-clears convention.
- **The edit surface offers a linked item absent from the active list as the
  current selection.** A link created before deactivation still renders on
  reads, so dropping it from the selector would silently turn "keep the link"
  into "clear the link".
- **A failed catalog read is not a permission state.** The selector stays empty
  and says the list could not be loaded; the client maps the failure to no
  permission model, and the appointment remains creatable without a service.
- **The linked service is displayed from the appointment's own `service`
  projection.** No extra catalog read is needed to render it, so the agenda
  shows only the identity the API already allowlisted.
- **The proxy allowlist widens by exactly one key.** `serviceId` joins
  `ALLOWED_QUERY_KEYS`; the list stays shared by every route, so a key that does
  not apply to a reached route is still forwarded and refused by the API's own
  validation. Adding the key is what makes the server-side filter reachable from
  the browser, and the route test's exact-URL assertion — not the proxy source —
  is the pin that would fail if the key were removed or the list loosened.

## API

### Added

```text
None. No new route is introduced.
```

### Changed

```text
GET  /appointments       optional `serviceId` query filter (agenda)
POST /appointments       optional `serviceId` in the create body
PUT  /appointments/:id   optional `serviceId` in the reschedule body
+ ->     all appointment responses now carry `serviceId` and `service`
```

The route-contract pins are unchanged: this slice adds no path or permission.
The portal routes, DTOs and permissions are untouched.

## Database

`20260925000002_appointment_service` adds, on `appointment`:

```sql
ALTER TABLE "appointment" ADD COLUMN "service_id" UUID;

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_tenant_id_service_id_fkey"
  FOREIGN KEY ("tenant_id", "service_id") REFERENCES "catalog_item"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "appointment_tenant_id_service_id_idx"
  ON "appointment"("tenant_id", "service_id");
```

The referenced unique key (`catalog_item_tenant_id_id_key`) already existed, so
this migration declares no new unique target. The migration is not applied
locally (PostgreSQL unreachable).

## Tests Added

- `apps/api/src/scheduling/appointment.dto.test.ts` — the widened allowlist pin
  (exactly `id`, `tenantId`, `branchId`, `patientId`,
  `professionalMembershipId`, `status`, `startAt`, `endAt`, `version`,
  `createdAt`, `updatedAt`, `serviceId`, `service`), the forbidden catalog
  internals and pricing keys, the identity-only nested projection, and the
  optional/nullable service field on both request schemas.
- `apps/api/src/scheduling/appointment.service.test.ts` — no service is a valid
  `null` state; an in-tenant active SERVICE is attached and projected; unknown
  and foreign references are `NOT_FOUND`; inactive and wrong-kind references are
  `VALIDATION_FAILED`; the duration is preserved verbatim when a service is
  attached; omitted leaves untouched and `null` clears; the agenda filter
  narrows while an omitted filter stays unfiltered; the create audit names
  `serviceId` only when a service is attached.
- `apps/api/src/scheduling/appointments.integration.test.ts` — the same cases at
  the HTTP boundary over the real guard chain, including the byte-equivalent
  cross-tenant `404`, the absence of any `referencePrice`/`taxRate` text in the
  response, and the agenda `serviceId` filter alongside the pre-existing
  filters.
- `apps/api/src/scheduling/booking-requests.integration.test.ts` — the shared
  `AppointmentResponse` key pin widened with `service`, `serviceId`; every other
  assertion is unchanged.
- `packages/database/src/scheduling.test.ts` — the migration is additive (one
  nullable column, composite FK, index, no backfill, no data mutation, no
  monetary or duration column, only `appointment` altered) and the schema
  declares the nullable reference with `CatalogItem`'s reverse relation.
- `apps/web/src/app/(app)/app/agenda/agenda-api.test.ts` — the optional
  `serviceId` list filter (forwarded when set, absent when omitted), the
  identity-only nested projection, and the optional service on the create and
  reschedule bodies including the explicit `null` clear and the
  drag-omits-the-key case.
- `apps/web/src/app/(app)/app/agenda/agenda-calendar.test.ts` — a service-linked
  appointment maps to the same four-key event payload, so the service never
  enters the calendar payload.
- `apps/web/src/app/(app)/app/agenda/agenda.test.tsx` — the selector population
  from active `SERVICE` items, creation with and without a service (no
  `serviceId` key when empty), the service filter narrowing the visible rows
  while the other filters stay, the service NAME in the list/Manage/event
  content with no price rendered, the explicit clear on reschedule, the
  linked-but-inactive current selection, and the failed-catalog degradation that
  still saves.
- `apps/web/src/app/api/scheduling/[[...path]]/route.test.ts` — the widened
  allowlist pinned by exact URL (the forwarded keys in allowlist order,
  `serviceId` included) together with the preserved unknown-key drop rule, plus
  the bare `?serviceId=<uuid>` query the agenda client builds.

## Verification

### WU4 C1 — data and API

```text
pnpm --filter @newsaas/database build ... exit 0 (Prisma Client generated from the
                                          current schema)
pnpm --filter @newsaas/api test ........ 69 files passed, 1 skipped; 838 tests
                                          passed, 40 skipped (was 823/40 before
                                          this slice: +15 cases)
pnpm --filter @newsaas/api typecheck ... clean (exit 0)
pnpm --filter @newsaas/api lint ........ clean (exit 0)
pnpm --filter @newsaas/database test ... 13 files / 210 tests passed (was 204)
pnpm exec prettier --check <files> ..... all matched files use Prettier code style
git diff --check ....................... clean (exit 0)
```

Observed by the orchestrator session after the implementing worker was aborted
mid-run, so these numbers come from a fresh run of the gates over the written
tree rather than from the worker's own report. The widened `APPOINTMENT_KEYS`
pin is deliberate: the staff appointment projection is shared with the portal
booking-request approval response, so both surfaces now carry `serviceId` and
`service`.

Unexecuted here, and never reported as passing: `pnpm db:seed`,
`pnpm db:live-verify` and `pnpm test:live-pg`, because PostgreSQL
(`127.0.0.1:5433`) and Redis (`6380`) are unreachable. The migration was not
applied to any database.

### WU4 C2 — staff UI

```text
pnpm --filter @newsaas/web test .......... 47 files passed; 480 tests passed
pnpm --filter @newsaas/web typecheck ..... clean (exit 0)
pnpm --filter @newsaas/web lint .......... clean (exit 0)
pnpm exec prettier --check <touched files> all matched files use Prettier code style
git diff --check .......................... clean (exit 0)
```

The web package gained 12 cases for this slice: 2 client-contract cases, 1
calendar-mapping case, 8 agenda component cases and 1 proxy allowlist case (the
focused agenda suite grew from 80 to 91 while the whole package stands at 480).
The staff UI is proven against a mocked `fetch`, so it verifies the client
query, the rendered states and the request payloads; the proxy route test is
what proves the widened allowlist, and the two together cover the browser path
at the unit level.

Unexecuted here, and never reported as passing: the Playwright/E2E gate
(deferred as `TD-007`) and anything needing the API server, PostgreSQL
(`127.0.0.1:5433`) or Redis (`6380`), which are unreachable.

## Known Limitations

- The migration is authored and textually asserted but never applied to a live
  PostgreSQL instance in this environment, so the composite FK, the index and
  the additive column are proven as DDL, not as observed database behavior.
- The staff UI is verified against a mocked `fetch` and the proxy against its
  route handler in-process, so the browser-to-API path is proven as two unit
  halves, not as a live round trip. The Playwright/E2E gate stays deferred
  (`TD-007`).

## Next Step

WU4 C2 is implemented and unit-verified, including the proxy allowlist widening
that lets the browser service filter reach the API. WU5 then runs the
live-PostgreSQL and migration-application closure evidence, while the
Playwright/E2E gate stays deferred (`TD-007`).

## Files / Modules

- `packages/database/prisma/schema.prisma` — `Appointment.serviceId`, its
  composite tenant FK and `CatalogItem.appointments`.
- `packages/database/prisma/migrations/20260925000002_appointment_service/migration.sql`
  — the additive migration.
- `apps/api/src/scheduling/appointment-invariants.ts` —
  `assertAppointmentServiceAnchor` and the optional `serviceId` on the
  reschedule compare-and-set.
- `apps/api/src/scheduling/appointment.dto.ts` — request fields, the
  `AppointmentServiceProjection` and the response allowlist.
- `apps/api/src/scheduling/appointment.service.ts` — anchor validation, the
  batched catalog identity read and the agenda filter.
- `apps/api/src/scheduling/appointments.controller.ts` — the `serviceId` query
  filter.
- `apps/api/test/support/in-memory-database.ts` — the mirrored `serviceId`
  column, matcher, write payloads and the batched catalog read.
- `apps/web/src/app/(app)/app/agenda/agenda-api.ts` — the optional `serviceId`
  and `service` identity projection, the `serviceId` list filter and the
  optional service on the create/reschedule inputs.
- `apps/web/src/app/(app)/app/agenda/agenda.tsx` — the service selector, the
  agenda service filter and the service names rendering.
- `apps/web/src/app/(app)/app/agenda/agenda-views.tsx` — the service NAME in the
  list row and the calendar event content.
- `apps/web/src/app/(app)/app/agenda/{agenda-api,agenda-calendar}.test.ts` and
  `agenda.test.tsx` — the client, mapping and component coverage.
- `apps/web/src/app/api/scheduling/[[...path]]/route.ts` — the shared query
  allowlist widened by exactly `serviceId`.
- `apps/web/src/app/api/scheduling/[[...path]]/route.test.ts` — the proxy
  allowlist and drop-rule coverage.
- `docs/05-modules/Scheduling.md` — the implemented-behavior reconciliation.
