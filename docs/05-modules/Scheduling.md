---
type: module
module: scheduling
status: implemented
updated: 2026-09-25
---

# Module — Scheduling

## Responsibility

Staff-only, tenant- and branch-scoped appointment scheduling for the veterinary
vertical: an `Appointment` assigned to an in-tenant `VETERINARIAN`
`TenantMembership`, anchored to an in-tenant Patient and Branch, scheduled
inside the professional's availability and governed by a typed conflict policy.
An appointment may OPTIONALLY carry one in-tenant, active `SERVICE` catalog item
(EPIC-09 WU4); the reference is convenience metadata and never changes how the
appointment is scheduled.

## Does Not Own

- Portal booking/approval (EPIC-08).
- Catalog administration — item CRUD, deactivation, prices, taxes and rates —
  and Catalog labels/Branding (EPIC-09). Scheduling only READS an active
  `SERVICE` item; it never creates, updates or prices one.
- Recurring appointments/blocks, reminders, or internal appointment events.
- A separate practitioner entity, branch administration, or clinical-encounter
  linkage.
- Patient, Customer, Branch or Membership identity (owned by Core).

## Public Capabilities

- Create, read, list and reschedule branch-scoped appointments.
- OPTIONALLY attach one in-tenant, active `SERVICE` catalog item on create or
  reschedule, and filter the agenda by that reference (EPIC-09 WU4).
- Six named lifecycle commands (`confirm`, `arrive`, `start`, `complete`,
  `cancel`, `no-show`); terminal rows are immutable.
- Filtered agenda reads and `options` (tenant branches + VETERINARIAN
  memberships).
- Availability, one-off-block and `conflictPolicy` configuration through the
  typed `scheduling` tenant-settings namespace.
- An authenticated staff HTTP surface plus web proxies and a semantic-token
  agenda that shades the times outside the selected professional's availability
  windows and their one-off blocks in its day and week views (display only;
  DEC-009).

## Main Entities

- `Appointment` — `tenantId`, `branchId`, `patientId`,
  `professionalMembershipId`, optional `serviceId`, `status`, `startAt`/`endAt`
  (UTC `TIMESTAMPTZ(3)`), `version`, timestamps.
- `AppointmentStatus` enum — `SCHEDULED`, `CONFIRMED`, `ARRIVED`, `IN_PROGRESS`,
  `COMPLETED`, `CANCELLED`, `NO_SHOW`.

## State Transitions

```text
SCHEDULED  --confirm-->  CONFIRMED  --arrive-->  ARRIVED  --start-->  IN_PROGRESS  --complete-->  COMPLETED
SCHEDULED  --cancel-->   CANCELLED
CONFIRMED  --cancel-->   CANCELLED
CONFIRMED  --no-show-->  NO_SHOW
ARRIVED    --no-show-->  NO_SHOW
```

`COMPLETED`, `CANCELLED` and `NO_SHOW` are terminal. Reschedule is allowed only
from `SCHEDULED`/`CONFIRMED`; transitions use `status` predicates and reschedule
additionally uses the `version` predicate.

## Permissions

- `scheduling.appointment.read` — list/get/options/availability.
- `scheduling.appointment.manage` — create and reschedule.
- `scheduling.appointment.transition` — the six lifecycle commands.
- `scheduling.settings.manage` — availability/block/policy writes (owned by the
  `tenant-settings` capability).
- Route-by-route permission pins live in
  `apps/api/src/rbac/route-contract.probe.test.ts`; the service re-asserts each
  permission as defense in depth.

## API

- `GET|POST /appointments` — the list accepts the optional `serviceId` filter
  below; the create body accepts the optional `serviceId` reference.
- `GET /appointments/options`
- `GET /appointments/availability?branchId&professionalMembershipId&date&durationMinutes[&stepMinutes]`
  — the free-slot read added by DEC-007. `durationMinutes` and `stepMinutes` are
  integers in `5..480`; `stepMinutes` defaults to `durationMinutes` and must be
  `>=` it, so the returned slots are ordered and non-overlapping. The response
  is
  `{ date, branchId, professionalMembershipId, durationMinutes, stepMinutes, timeZone, basis, slots: [{ startAt, endAt }] }`
  with UTC instants.
- `GET|PUT /appointments/:id` (reschedule body `{startAt, endAt, version}` plus
  the optional `serviceId` below)
- `POST /appointments/:id/{confirm|arrive|start|complete|cancel|no-show}`
- `GET|PUT /settings/scheduling` — typed namespace (availability, blocks,
  `conflictPolicy`).
- `GET /api/scheduling/[...path]` and `GET|PUT /api/settings/[...path]` —
  authenticated staff web proxies with strict route/query allowlists and only
  the staff session cookie forwarded.

## Appointment service association (EPIC-09 WU4)

`Appointment.serviceId` is an OPTIONAL reference to a tenant-scoped
`CatalogItem` of kind `SERVICE`. The field is nullable, so every appointment
that predates EPIC-09 — staff and portal alike — keeps working and is never
rewritten; the migration only adds the column, its composite tenant FK and its
index.

| Concern             | Behavior                                                                                                                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create / reschedule | `serviceId` is optional. Absent on create means no service. On reschedule, absent leaves the stored reference untouched and an explicit `null` clears it.                                                                                      |
| Validation          | A present value must resolve to an in-tenant, ACTIVE `SERVICE` item. Unknown or foreign UUIDs are the byte-equivalent `404 NOT_FOUND`; an in-tenant inactive or wrong-kind item is `400 VALIDATION_FAILED`. Nothing is persisted on rejection. |
| Agenda filter       | `GET /appointments?serviceId=<uuid>` returns only appointments carrying exactly that reference. Omitting the parameter adds no predicate, so every existing query keeps its behavior.                                                          |
| Response            | The allowlisted DTO gains `serviceId` plus a small read-only `service` projection of the item's identity (`id`, `name`, `kind`).                                                                                                               |
| Duration            | `durationMinutes` remains the explicit caller-supplied parameter of DEC-007. No code path derives, defaults or overwrites it from the service.                                                                                                 |
| Monetary values     | No price, tax, rate or currency value is read or projected. The batched identity read selects `id`, `name` and `kind` only, and the DTO carries no amount.                                                                                     |
| Portal              | The portal booking-request body stays `.strict()` and gains no service field; no portal surface exposes service selection.                                                                                                                     |

The reference is rendered from ONE batched catalog read per result set (never
one query per appointment). A link that points at an item later deactivated
still renders its identity; only new or changed links are validated against
`isActive`.

## Availability read (DEC-007)

The free-slot endpoint is a hint, never a reservation, and its contract is
**one-way**: every slot it offers is a slot `POST /appointments` accepts, and
the converse deliberately does not hold. It hides bookable slots in four cases,
each documented in `appointment-availability.ts`:

1. an active overlap when `conflictPolicy` is `ALLOW`, where the write path
   would permit the double booking;
2. starts off the requested step grid;
3. times outside the `07:00–21:00` fallback range used when the professional has
   no availability windows configured for the branch (the write path treats that
   case as unrestricted, so the read offers the practical subset);
4. the second occurrence of an ambiguous wall time during a fall-back fold.

`basis` reports `CONFIGURED_WINDOWS` or `DEFAULT_DAY_RANGE` so a caller can tell
which day extent was used. Windows configured for the pair but absent on the
requested weekday yield zero slots, matching the write path's rejection. The
read calls the same `isWithinAvailability`, `intersectsBlock`, anchor assertions
and active-status overlap predicate as the write path instead of re-deriving
them, uses one appointment query for the whole day, writes nothing (no
appointment, no booking request, no audit row) and takes the tenant only from
the request context.

## Staff agenda availability overlay (DEC-009)

The staff agenda's day and week views shade the times outside the selected
professional's configured availability windows, plus their one-off blocks. The
behaviour is **display only**: it never feeds FullCalendar's `selectConstraint`,
`eventConstraint` or `overlap`. The write path requires the whole appointment
inside ONE window and rejects one-off blocks; `businessHours` is a union of
ranges, so it cannot express the one-window rule, and a forbidden block cannot
be handed directly to `selectConstraint` as an allowed range. Equivalent logic
could be enforced with custom allow callbacks or computed allowed ranges, but
reusing this display overlay as the enforcement source would make the calendar a
second, wrong source of truth. Enforcing it would let staff select a range the
API rejects with `409 CONFLICT`; the API stays the source of truth.

The overlay is derived from the `(membershipId, branchId)` pair in the typed
`scheduling` namespace and is **tri-state**:

- no windows for the pair → the write path is unrestricted → shade **nothing**;
- windows for the pair but none on the weekday → the day is unavailable → shade
  the **whole day**;
- windows on the weekday → shade the **complement** of those windows.

FullCalendar realizes the last two through `businessHours` (its non-business
complement), so an omitted weekday is shaded in full. One-off blocks are mapped
to `display: "background"` events (there is no `backgroundEvents` option in
FullCalendar 6). Because `businessHours` is calendar-global while windows carry
a `branchId`, the overlay requires a selected branch and professional; otherwise
it is hidden and a hint asks staff to pick one.

**Unknown availability is never rendered as unrestricted.** When a pair IS
selected but the settings read fails, the day and week views shade nothing and
show a non-blocking warning that the pair's availability could not be loaded;
the agenda stays fully usable. The namespace is shape-checked at runtime before
it reaches the mapping (conflict policy, `availability`/`blocks` arrays, and
each entry's fields and orderings): a malformed payload is a
`MALFORMED_RESPONSE` that degrades to the same warning rather than crashing the
mapping or being silently treated as a pair with no windows. A malformed entry
fails the whole namespace — dropping it could make a restricted pair read as
unrestricted.

The pure mapping lives in
`apps/web/src/app/(app)/app/agenda/agenda-availability.ts`, the settings read in
`agenda-api.ts` (`getSchedulingSettings`), and the style layer maps
`--fc-non-business-color` and `--fc-bg-event-color`/`--fc-bg-event-opacity` to
semantic tokens.

## Events / Jobs

- None. `AppointmentConfirmed` and `AppointmentCancelled` are intentionally not
  emitted; lifecycle changes are explicit application commands.

## Invariants

- Under `REJECT`,
  `pg_advisory_xact_lock(hashtextextended(tenantId:membershipId))` wraps the
  overlap check and insert in one transaction, so concurrent overlapping creates
  serialize: one persists, the other returns `409 CONFLICT`. The lock query
  casts the `void` result to `text` because Prisma `$queryRaw` cannot
  deserialize `void` (P2010).
- A tenancy composite `(tenant_id, …)` foreign key set — including the OPTIONAL
  `(tenant_id, service_id)` reference to `catalog_item` — plus an
  `end_at > start_at` CHECK and a DELETE-rejecting trigger enforce invariants at
  the database; the trigger is not bypassed by application code.
- The service reference is a link only: it never derives, defaults or overwrites
  `durationMinutes`, and it carries no price, tax, rate or currency value.
- Exactly one audit row is appended per mutation, co-committed in the same
  transaction with stable IDs and field names only.
- Availability/block violations and overlap rejection both return `409 CONFLICT`
  and persist nothing; no availability rows for a `(professional, branch)` means
  unrestricted.

## Security / Tenant Rules

- Tenant identity comes only from the server-side `RequestContextService`; a
  route- or body-supplied `tenantId` is never trusted.
- A foreign Patient/Branch/membership anchor, a foreign `SERVICE` reference or a
  foreign appointment UUID returns a byte-equivalent `404 NOT_FOUND` and
  persists nothing; an in-tenant non-VETERINARIAN professional, an inactive
  service or a wrong-kind catalog item is a `400 VALIDATION_FAILED`.
- Appointment DTOs are allowlisted and classified **CONFIDENTIAL**; Prisma
  models are never returned. The allowlist is exactly `id`, `tenantId`,
  `branchId`, `patientId`, `professionalMembershipId`, `status`, `startAt`,
  `endAt`, `version`, `createdAt`, `updatedAt`, `serviceId` and a nested
  `service` object of `id`, `name`, `kind` — no catalog price, tax or rate value
  and no patient name. Appointment details are not logged.

## Verification

- `apps/api/src/scheduling/{appointment.service,appointment.dto,appointments.integration}.test.ts`
  — transition/version predicates, tenant 404, non-VETERINARIAN 400,
  REJECT/ALLOW, availability/block, audit co-commit rollback, timezone/DST, the
  allowlisted CONFIDENTIAL DTO, and the OPTIONAL service association: an
  in-tenant active `SERVICE` is accepted and projected as identity only, no
  service is a valid `null` state, unknown/foreign references are the
  byte-equivalent 404, inactive/wrong-kind references are 400, the service never
  derives the duration and the agenda service filter narrows without changing
  the other filters.
- `packages/database/src/scheduling.test.ts` — the
  `20260925000002_appointment_service` DDL is additive (one nullable
  `service_id` column, composite `(tenant_id, service_id)` FK, index, no
  backfill, no data mutation, no monetary or duration column) and the schema
  declares the nullable reference with `CatalogItem`'s reverse relation.
- `apps/api/src/scheduling/appointments-availability.integration.test.ts` —
  read-versus-write agreement in both directions, active statuses, `ALLOW`
  strict-subset, window and block boundaries, local-midnight and the real
  America/Asuncion 2024 spring-forward and fall-back transitions, tenant
  isolation and the no-write proof.
- `apps/api/src/scheduling/appointment-availability.test.ts` — the wall-clock
  conversion in isolation: a nonexistent local minute is refused (the assertion
  that fails if the gap guard is removed, which the HTTP suite cannot see) and
  an ambiguous minute resolves to its first occurrence.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` → "EPIC-07 scheduling
  application-path concurrency" — two concurrent overlapping creates for one
  professional against a disposable PostgreSQL 16 database, behind a
  deterministic advisory-lock barrier: exactly one persists and the other
  returns `409 CONFLICT`, with exactly one co-committed audit row.
- `apps/web/src/app/(app)/app/agenda/agenda-availability.test.ts` — the overlay
  tri-state (unrestricted shades nothing, unavailable shades the whole day,
  available shades the complement), the `businessHours` grouping by weekday and
  `HH:mm` bounds, and the one-off-block mapping (including a block on an
  unrestricted pair).
- `apps/web/src/app/(app)/app/agenda/agenda.test.tsx` — the overlay threaded
  into the FullCalendar props through the existing stub: the hint and no shading
  without a selected pair, the shading and block event with a selected pair, no
  shading for a pair with no windows, and the non-blocking warning (with the
  agenda still usable) when the selected pair's settings read fails or returns a
  malformed namespace. `agenda-api.test.ts` covers the settings proxy read, its
  envelope, and the runtime shape checks that reject a malformed namespace.
- WU5 durable run (2026-09-14): full live-PG suite **26/26 passed**;
  `@newsaas/api` suite **543 passed / 25 skipped**; API typecheck and lint
  green.
- `pnpm preflight` — PostgreSQL and Redis reachable (local services on the
  project `.env` ports).

## Related Stories

- EPIC-07 change: `openspec/changes/archive/2026-09-15-epic-07/`
- [[CAT-005 Appointment service link]] — EPIC-09 WU4: the OPTIONAL `SERVICE`
  association and the agenda service filter.

## Related ADRs

- [[ADR-001 Modular Monolith]]

## Related Decisions

- [[DEC-007 Agenda v2]] — accepted A1 → A3 → A2; its Option B (this overlay) was
  not selected there. DEC-009 adopts it explicitly as additive scope under PRD
  §14.
- [[DEC-009 Staff agenda availability overlay]]
