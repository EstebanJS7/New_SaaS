---
id: TD-011
type: tech-debt
title: Map concurrent Patient primary-promotion index violation to CONFLICT
status: open
severity: medium
related_epics:
  - EPIC-05
related_stories:
  - PAT-002
created: 2026-09-11
updated: 2026-09-11
---

# TD-011 — Map concurrent Patient primary-promotion index violation to CONFLICT

## Context

The exactly-one-active-primary invariant is enforced by two layers:

- the immediate partial unique index `patient_guardian_primary_active_key`
  (`at most one`), and
- the two `DEFERRABLE INITIALLY DEFERRED` constraint triggers (`at least one`).

`PatientsService.setPrimaryGuardian` (and `updateGuardian(isPrimary:true)`,
`createGuardian(isPrimary:true)`) deliberately demotes the current primary
before promoting the replacement, so a **sequential** primary promotion is a
demote-then-promote swap that succeeds (`2xx`); it never returns `409`. The
`409 CONFLICT` contract belongs to the _sole-primary-removal_ and
_activation-without-primary_ invariants instead —
`updateGuardian(isPrimary:false)` or `deactivateGuardian` on an active Patient's
primary, and `PUT /patients/:id` activation without an active primary. This debt
is only about the concurrent race, where the losing promotion's
`patient_guardian.updateMany` hits the partial unique index.

H1 live-PostgreSQL coverage (`apps/api/test/live-pg-isolation.e2e-spec.ts`, task
5.1) added a concurrency probe for two
`POST /patients/:patientId/guardians/:id/primary` promotions on the same active
Patient over real HTTP against real PostgreSQL 16. The probe is deterministic,
not timing-based: it holds a `SELECT … FOR UPDATE` row lock on the current
primary guardian from a barrier transaction, starts both promotions, polls
`pg_stat_activity` until both are provably blocked at the shared
`demoteActivePrimary` UPDATE (`wait_event_type = 'Lock'`), and only then
releases the barrier. Because both transactions cross the same demote boundary
before either commits, the race is guaranteed to exercise the partial index.
Observed behavior, reproduced on every run:

- the invariant holds — the final state has **exactly one** active primary
  guardian, never zero and never two, so the partial index + deferred trigger
  are correct; and
- exactly one promotion returns `201`, while the losing transaction's
  `patient_guardian.updateMany` fails with Prisma `P2002` ("Unique constraint
  failed on the fields: (`patient_id`)"), which the `GlobalExceptionFilter` maps
  to the generic `INTERNAL` (`500`) envelope because it is not a `DomainError`.

## Debt

Under genuine concurrency, a primary-promotion race surfaces a `500 INTERNAL`
for the losing write. The sequential promotion path never conflicts this way —
it demotes the current primary and promotes the replacement as a swap — so there
is no "equivalent sequential conflict" already returning `409`. The `409` here
is the contract TD-011 proposes to _choose_ for the race, not an existing
single-writer status. Clients cannot distinguish "retryable conflict" from a
server fault, and the mismatch is only visible in live-PostgreSQL evidence
(TD-006) because the in-memory harness never interleaves.

## Why It Is Safe to Defer

- The database invariant is **not** violated: the at-most-one side is atomic
  (partial unique index) and the at-least-one side is re-checked at commit by
  the deferred triggers. No corrupted Patient/guardian state can commit.
- Every single-writer (sequential) path is internally consistent: promotion is a
  demote-then-promote swap, and `409` is returned only for the
  sole-primary-removal/deactivation and activation-without-primary invariants.
  Concurrency is required to observe the `500`.
- No acceptance criterion requires a specific concurrent-conflict status today;
  the spec only requires the write to fail and the invariant to be preserved.

## Risk

Low. Two staff promoting different guardians on the same Patient within the same
instant can see an opaque `500` that the proposed resolution would map to `409`.
No data-integrity risk; the guardian state remains exactly-one.

## Proposed Resolution

Map the specific PostgreSQL unique-violation on
`patient_guardian_primary_active_key` (Prisma `P2002` scoped to the `patient_id`
target) to a stable `CONFLICT` domain response at the Patients application
boundary (for example in `PatientsService`'s primary-promotion transactions, or
a narrowly scoped Prisma-error translator for the patients module). Do **not**
add a blanket "all P2002 → 409" translation. Re-run the deterministic H1
concurrency probe and assert exactly one `201`, one `409 CONFLICT`, and the
single remaining active primary.

## Trigger / Target

Before any multi-writer Patient editing surface ships, and mandatory before
production deployment of EPIC-05.

## Verification After Resolution

- [ ] Concurrent primary-promotion probe returns one `201` and one `409` (never
      `500`) with the invariant intact.
- [ ] The single-writer `409 CONFLICT` paths (sole-primary removal/deactivation,
      activation without a primary) keep returning `409`; sequential promotion
      stays a demote-then-promote `2xx` swap.
- [ ] The mapping is scoped to the Patient primary index only; no other unique
      violation changes status.
