---
id: TD-023
type: tech-debt
title: The invoice header guard constrains the status transition only
status: open
severity: low
related_epics:
  - EPIC-14
related_stories:
  - BILL-001
  - BILL-003
created: 2026-10-01
updated: 2026-10-01
---

# TD-023 — The invoice header guard constrains the status transition only

## Context

`invoice_no_update_unless_permitted_transition` is the database guard that keeps
the invoice header immutable from creation (PRD §21, [[DEC-038]]). It reads
`OLD."status"` and `NEW."status"` and permits exactly three transitions —
`DRAFT -> CONFIRMED`, `DRAFT -> CANCELLED` and `CONFIRMED -> CANCELLED` —
rejecting every other update including any update of a `CANCELLED` row.

Verified current state in this repository (2026-10-01):

- The guard is defined in
  `packages/database/prisma/migrations/20261001000001_billing_invoice_foundation/migration.sql`
  and proven against the live database in the
  `EPIC-14 billing application-path isolation` block of
  `apps/api/test/live-pg-isolation.e2e-spec.ts`.
- `number` is additionally protected during a permitted transition by
  `invoice_number_never_reallocated`, which rejects an update where
  `OLD."number" IS NOT NULL AND NEW."number" IS DISTINCT FROM OLD."number"`.
  That trigger is a live guard on the cancellation path, not decoration: an
  update that cancels a `CONFIRMED` invoice while also rewriting `number` passes
  the header guard and is rejected by it.
- `currency` and `confirmed_at` have no equivalent guard. During a permitted
  transition the header guard does not compare them, so the database would
  accept a cancellation that also changed the invoice's currency or moved its
  confirmation timestamp.
- `invoice_line` is unaffected: its snapshot columns are guarded
  unconditionally.
- BILL-001 is `review` and its native review is closed and approved; BILL-003
  owns the `POST /invoices/:id/cancel` command that will be the only writer of
  these transitions.

## Debt

The database enforces _which_ transitions are legal but not _which columns_ may
change during one, so part of the "immutable from creation" rule ([[DEC-038]])
rests on the application writing only the intended columns instead of on the
schema. The gap is narrow — `number` is already guarded, and the planned command
sets only `status`, `cancelled_at` and `cancel_reason` — but it is real, and a
data foundation should not rely on its only caller being well behaved.

## Why It Is Safe to Defer

- No route writes the aggregate yet, so no caller can reach the gap: BILL-002
  and BILL-003 own the first writers.
- `number`, the field whose change would be materially harmful (a rewritten
  number breaks the `(tenant_id, series, number)` allocation guarantee), is
  already rejected during any transition by `invoice_number_never_reallocated`.
- `currency` is inherited once from the sale and `confirmed_at` is audit
  metadata; a change to either is a data-integrity defect rather than a path to
  a wrong money amount, because the header carries no stored total by design.
- Every current acceptance criterion of BILL-001 still holds: the three
  transitions are reachable, the four impossible ones are rejected, and the
  approved candidate is unchanged by this record.

## Risk

- A future writer that updates the whole row from a DTO — the common shape a
  generic update path takes — could rewrite `currency` or `confirmed_at` during
  a cancellation without any database objection, and the change would be
  invisible to the audit row unless the caller records the changed fields.
- If the gap is closed by adding a per-column comparison later, existing rows
  are unaffected, so the fix is additive; but a review that notices the gap
  first may report it as a defect rather than as this record.

## Proposed Resolution

Extend the header guard (or add a companion trigger) so that a permitted
transition also asserts the columns it must not move: `currency`, `confirmed_at`
and `created_at` must be `IS NOT DISTINCT FROM` their old values, and a
`CONFIRMED -> CANCELLED` update must leave `number` and `confirmed_at`
untouched. That makes the "immutable from creation" rule a schema property for
the fields the transition does not own, matching how `invoice_line` is guarded.
Add the corresponding live probes for the rejected shapes, including the
`changed-field` audit consequence.

## Trigger / Target

Address it in the slice that owns the cancel command, [[BILL-003]], so the guard
and its only caller land together with their tests; or earlier if any other
writer appears. Owner: the EPIC-14 implementation slices, not a separate epic.

## Verification After Resolution

- [ ] A live probe proves a permitted transition that also changes `currency`,
      `confirmed_at` or `created_at` is rejected at the database.
- [ ] A live probe proves `CONFIRMED -> CANCELLED` keeps the allocated `number`
      and the original `confirmed_at`.
- [ ] The three permitted transitions and the rejected ones keep their existing
      probes, so the tightened guard does not narrow the state machine.
- [ ] This record is `resolved` or superseded by the change that closed it.
