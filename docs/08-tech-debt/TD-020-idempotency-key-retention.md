---
id: TD-020
type: tech-debt
title: Idempotency records grow without a retention policy
status: open
severity: low
related_epics:
  - EPIC-12
related_stories:
  - POS-003
created: 2026-09-27
updated: 2026-09-27
---

# TD-020 — Idempotency records grow without a retention policy

## Context

PRD §18 requires `Complete Sale` to be idempotent, and [[DEC-024]] decides the
mechanism: a persisted, tenant-scoped idempotency record unique per
`(tenant, operation, key)` holding the request fingerprint and a reference to
the stored result, together with a header row lock and a conditional
`WHERE status = 'DRAFT'` transition. The same key with the same fingerprint
returns the prior result and never completes a second time; the same key with a
different fingerprint is a stable conflict.

[[DEC-024]] also decides that retention of idempotency rows is a **recorded
limitation**: there is no destructive retention until an approved retention
policy exists, because PRD §41 forbids automatic destructive retention of
confirmed financial, ledger and audit data before an explicit approved
policy/legal review.

Verified current state in this repository (2026-09-27):

- No idempotency table or helper exists anywhere in the repository.
- PRD §41 forbids automatic destructive retention for confirmed financial,
  ledger and audit data before an approved policy exists.
- `docs/03-architecture/DATA-CLASSIFICATION-RETENTION.md` and
  `docs/03-architecture/REVERSALS-CORRECTIONS.md` fix the classification and the
  `Idempotency-Key` conventions the record must follow.
- No retention, archival or purge job exists anywhere in the application, and no
  tenant-settings namespace carries a retention window.

## Debt

Every accepted completion that carries an `Idempotency-Key` inserts a record
that is never removed. The rows accumulate with the tenant's sale volume and
with every client retry that supplies a fresh key, so the table grows
monotonically and has no bound, no TTL, no archival step and no cleanup job.

The debt is deliberately incurred rather than accidental: PRD §41 forbids the
automatic purge that would otherwise bound the table, and [[DEC-024]] chose the
persisted record because the row lock alone cannot let a client distinguish its
own retry from another actor's completion. The cost is therefore storage, index
maintenance and a growing table, not a correctness gap.

## Why It Is Safe to Defer

- The table is small per row and indexed by `(tenant, operation, key)`, so read
  and write performance stay predictable at the volumes EPIC-12 targets.
- Nothing in the epic's acceptance criteria depends on retention: the same-key
  replay contract is satisfied by keeping the row, and deleting it early would
  weaken that contract rather than strengthen it.
- The classification rule is already satisfied: the record holds a request
  fingerprint and a result reference rather than a sensitive payload, so it
  carries no CONFIDENTIAL or RESTRICTED content that would make its retention
  urgent.
- Retention without an approved policy would violate PRD §41, so shipping a
  purge now would create a compliance risk in exchange for an unbounded-table
  risk that has not materialized.

## Risk

- Unbounded growth is a slow operational cost: the table, its unique index and
  any backup need to absorb rows that no longer serve a replay window, and the
  cost grows with the tenant's sale volume rather than staying flat.
- A future cleanup is a destructive operation on a financial-adjacent table, so
  it needs the policy work, the classification review and the auditability that
  PRD §41 requires rather than a hurried delete.
- The window is undefined, so a client retrying after an arbitrarily long delay
  currently gets the prior result while a future purge could turn the same retry
  into a conflict; the boundary must be decided with the policy rather than
  discovered in production.
- Without this record, the growing table reads as an oversight rather than a
  recorded limitation.

## Proposed Resolution

1. An approved retention policy is established first, covering the retention
   window for idempotency records, the classification of their contents and the
   auditability of the cleanup, as PRD §41 requires.
2. The cleanup, once the policy exists, removes only records older than the
   approved window, in bounded batches, tenant-scoped and observable, and never
   removes a confirmed financial, ledger or audit record.
3. The replay contract states what happens outside the window, so a client
   retrying after the window gets a documented outcome rather than an
   undocumented change of behavior.
4. The policy window is documented in the sales module documentation and in
   [[DEC-024]], and the cleanup is proven by a test that a record inside the
   window still returns the prior result.

## Trigger / Target

An approved retention policy for idempotency records, or the first operational
need to bound the table (size, backup time or query cost), whichever arrives
first. No cleanup ships before the policy exists.

## Verification After Resolution

- [ ] An approved retention policy exists and is referenced by the sales module
      documentation before any cleanup ships.
- [ ] The cleanup removes only idempotency records older than the approved
      window and removes no confirmed financial, ledger or audit record.
- [ ] A replay inside the retention window still returns the prior result and
      completes no second time.
- [ ] A replay outside the window has a documented, stable outcome rather than
      an undocumented behavior change.
- [ ] The cleanup is tenant-scoped, bounded and observable, and its behavior is
      covered by a test.
- [ ] [[DEC-024]] and this record are updated together when the retention policy
      is approved, and this record is closed only then.
