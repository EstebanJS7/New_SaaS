---
id: CASH-002
type: story
title: Cash movement commands
epic: EPIC-13
status: planned
priority: high
depends_on:
  - CASH-001
prd_sections:
  - "9"
  - "10"
  - "20"
  - "27"
  - "28"
  - "29"
  - "40"
permissions:
  - cash.read
  - cash.movement.create
branch:
created: 2026-09-30
updated: 2026-09-30
---

# CASH-002 — Cash movement commands

## Objective

Add explicit Cash commands that create standalone non-sale cash movements
against an `OPEN` in-tenant session, with reason, audit, tenant isolation,
authorization and the type-owned sign convention.

## Context

PRD §20 names seven movement kinds. EPIC-12 writes only `SALE` movements from
sale completion. [[DEC-033]] keeps sale reversal and payment refund out of this
epic, so EPIC-13's movement commands are standalone Cash operations and do not
link to Sales or Payments.

## In Scope

- Add `cash.movement.create` to the seed catalog and OWNER/ADMIN/CASHIER role
  matrix.
- Create movements for `REFUND`, `INCOME`, `EXPENSE`, `WITHDRAWAL`, `DEPOSIT`
  and `ADJUSTMENT` against an `OPEN` session.
- Validate positive amount, required reason, and explicit `ADJUSTMENT`
  direction.
- Resolve tenant/session/register server-side; reject foreign or closed
  sessions.
- Audit accepted movement creation and prove rejected attempts persist nothing.

## Out of Scope

- Writing `SALE` movements from POS; that remains the Sales completion path.
- Close command and expected-counted calculation persistence — [[CASH-003]].
- Sale reversal, stock compensation or `POST /payments/:id/refund` — [[TD-018]].
- Cash UI — [[CASH-004]].

## Acceptance Criteria

- [ ] The seeded permission catalog adds exactly `cash.movement.create`, moving
      51 → 52, with OWNER/ADMIN/CASHIER grants.
- [ ] Authenticated staff with `cash.movement.create` and the `cash` capability
      can create each non-sale movement kind against an `OPEN` in-tenant
      session.
- [ ] Missing permission, missing capability, invalid body, foreign ids, unknown
      ids and closed sessions are stable rejections that persist no movement and
      no audit row.
- [ ] Amounts are positive non-zero Decimal money values; `ADJUSTMENT` carries
      an explicit direction; the type-owned sign map follows [[DEC-030]].
- [ ] Required reasons are validated by the API and backed by the database
      constraint from [[CASH-001]].
- [ ] Accepted movements are immutable and write exactly one audit row with no
      CONFIDENTIAL/RESTRICTED payload logging.
- [ ] Tenant isolation is enforced when applicable.
- [ ] Backend authorization is enforced when applicable.
- [ ] Required loading/error/empty/success UX exists.
- [ ] Required audit exists.
- [ ] Tests required by the Story pass.

## Domain Invariants

- Cash movements are append-only ledger entries.
- The caller never supplies tenant authority.
- Manual/corrective movements explain themselves with a reason.
- Sale/payment reversal orchestration is not hidden inside this command.

## API

### Added

Planned command route, exact path to be fixed during implementation following
existing route conventions:

```text
POST /cash/movements
```

### Changed

```text
None yet
```

## Database

### Migration

No additional migration beyond CASH-001 is expected except permission seeds, but
implementation may add indexes only if tests prove a concrete need.

### Models/Tables

- `CashMovement` — new rows for the six non-sale kinds.
- Permission seed catalog — `cash.movement.create`.

## UI

- None in this story; [[CASH-004]] builds the staff surface.
- If UI is changed, confirm reusable components use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- Planned API integration tests for every movement kind, guard branch and audit.
- Planned route-contract tests for `cash.movement.create`.
- Planned live-PostgreSQL no-residue and closed-session cases.

## Known Limitations

- Sale reversal and payment refund remain unavailable until [[TD-018]] lands.

## Technical Debt

- None planned.

## Decisions / ADRs

- [[DEC-030]] — movement sign convention.
- [[DEC-032]] — reason requirement.
- [[DEC-033]] — correction boundary.
- [[DEC-034]] — permission key and role matrix.

## Files / Modules

- `packages/database/src/reference-seed.ts`
- `apps/api/src/cash/`
- `apps/api/src/rbac/route-contract.probe.test.ts`
- `apps/api/test/live-pg-isolation.e2e-spec.ts`
- `docs/01-roadmap/EPIC-13-Cash.md`

## Completion Notes

_Status must remain non-done until all required gates pass._
