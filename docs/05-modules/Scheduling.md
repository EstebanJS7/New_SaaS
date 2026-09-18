---
type: module
module: scheduling
status: implemented
updated: 2026-09-18
---

# Module — Scheduling

## Responsibility

Staff-only, tenant- and branch-scoped appointment scheduling for the veterinary
vertical: an `Appointment` assigned to an in-tenant `VETERINARIAN`
`TenantMembership`, anchored to an in-tenant Patient and Branch, scheduled
inside the professional's availability and governed by a typed conflict policy.

## Does Not Own

- Portal booking/approval (EPIC-08) and Catalog service relations or labels
  (EPIC-09); the appointment boundary exposes no user-facing service field.
- Recurring appointments/blocks, reminders, or internal appointment events.
- A separate practitioner entity, branch administration, or clinical-encounter
  linkage.
- Patient, Customer, Branch or Membership identity (owned by Core).

## Public Capabilities

- Create, read, list and reschedule branch-scoped appointments.
- Six named lifecycle commands (`confirm`, `arrive`, `start`, `complete`,
  `cancel`, `no-show`); terminal rows are immutable.
- Filtered agenda reads and `options` (tenant branches + VETERINARIAN
  memberships).
- Availability, one-off-block and `conflictPolicy` configuration through the
  typed `scheduling` tenant-settings namespace.
- An authenticated staff HTTP surface plus web proxies and a semantic-token
  agenda.

## Main Entities

- `Appointment` — `tenantId`, `branchId`, `patientId`,
  `professionalMembershipId`, `status`, `startAt`/`endAt` (UTC
  `TIMESTAMPTZ(3)`), `version`, timestamps.
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

- `GET|POST /appointments`
- `GET /appointments/options`
- `GET /appointments/availability?branchId&professionalMembershipId&date&durationMinutes[&stepMinutes]`
  — the free-slot read added by DEC-007. `durationMinutes` and `stepMinutes` are
  integers in `5..480`; `stepMinutes` defaults to `durationMinutes` and must be
  `>=` it, so the returned slots are ordered and non-overlapping. The response
  is
  `{ date, branchId, professionalMembershipId, durationMinutes, stepMinutes, timeZone, basis, slots: [{ startAt, endAt }] }`
  with UTC instants.
- `GET|PUT /appointments/:id` (reschedule body `{startAt, endAt, version}`)
- `POST /appointments/:id/{confirm|arrive|start|complete|cancel|no-show}`
- `GET|PUT /settings/scheduling` — typed namespace (availability, blocks,
  `conflictPolicy`).
- `GET /api/scheduling/[...path]` and `GET|PUT /api/settings/[...path]` —
  authenticated staff web proxies with strict route/query allowlists and only
  the staff session cookie forwarded.

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
- A tenancy composite `(tenant_id, …)` foreign key set plus an
  `end_at > start_at` CHECK and a DELETE-rejecting trigger enforce invariants at
  the database; the trigger is not bypassed by application code.
- Exactly one audit row is appended per mutation, co-committed in the same
  transaction with stable IDs and field names only.
- Availability/block violations and overlap rejection both return `409 CONFLICT`
  and persist nothing; no availability rows for a `(professional, branch)` means
  unrestricted.

## Security / Tenant Rules

- Tenant identity comes only from the server-side `RequestContextService`; a
  route- or body-supplied `tenantId` is never trusted.
- A foreign Patient/Branch/membership anchor or a foreign appointment UUID
  returns a byte-equivalent `404 NOT_FOUND` and persists nothing; an in-tenant
  non-VETERINARIAN professional is a `400 VALIDATION_FAILED`.
- Appointment DTOs are allowlisted and classified **CONFIDENTIAL**; Prisma
  models are never returned. The allowlist is exactly `id`, `tenantId`,
  `branchId`, `patientId`, `professionalMembershipId`, `status`, `startAt`,
  `endAt`, `version`, `createdAt`, `updatedAt` — no service/Catalog field and no
  patient name. Appointment details are not logged.

## Verification

- `apps/api/src/scheduling/{appointment.service,appointment.dto,appointments.integration}.test.ts`
  — transition/version predicates, tenant 404, non-VETERINARIAN 400,
  REJECT/ALLOW, availability/block, audit co-commit rollback, timezone/DST and
  the allowlisted CONFIDENTIAL DTO.
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
- WU5 durable run (2026-09-14): full live-PG suite **26/26 passed**;
  `@newsaas/api` suite **543 passed / 25 skipped**; API typecheck and lint
  green.
- `pnpm preflight` — PostgreSQL and Redis reachable (local services on the
  project `.env` ports).

## Related Stories

- EPIC-07 change: `openspec/changes/archive/2026-09-15-epic-07/`

## Related ADRs

- [[ADR-001 Modular Monolith]]
