---
type: module
module: scheduling
status: implemented
updated: 2026-09-15
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

- `scheduling.appointment.read` — list/get/options.
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
- `GET|PUT /appointments/:id` (reschedule body `{startAt, endAt, version}`)
- `POST /appointments/:id/{confirm|arrive|start|complete|cancel|no-show}`
- `GET|PUT /settings/scheduling` — typed namespace (availability, blocks,
  `conflictPolicy`).
- `GET /api/scheduling/[...path]` and `GET|PUT /api/settings/[...path]` —
  authenticated staff web proxies with strict route/query allowlists and only
  the staff session cookie forwarded.

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
