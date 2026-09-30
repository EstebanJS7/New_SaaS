---
id: CASH-003
type: story
title: Cash session close
epic: EPIC-13
status: planned
priority: high
depends_on:
  - CASH-001
  - CASH-002
prd_sections:
  - "9"
  - "10"
  - "20"
  - "27"
  - "28"
  - "29"
  - "41"
permissions:
  - cash.read
  - cash.session.close
branch:
created: 2026-09-30
updated: 2026-09-30
---

# CASH-003 — Cash session close

## Objective

Implement the explicit cash session close command that computes expected cash on
the server, compares it with the counted amount, stores the difference and turns
the session into a terminal audited `CLOSED` record.

## Context

PRD §20 requires close to compute expected on the server and compare it with the
counted amount. EPIC-12 reserved `cash.session.close` but consumed it nowhere.
[[DEC-031]], [[DEC-035]] and [[DEC-036]] fix the close storage, serialization
and terminal-state behavior.

## In Scope

- `POST /cash/sessions/:id/close` behind `cash.session.close` and the `cash`
  capability.
- Counted amount validation and server-side expected calculation from
  `opening_amount` plus movement rows using [[DEC-030]]'s sign map.
- Session row lock, `OPEN` state gate, conditional close write and audit.
- Close with zero movements.
- Stable conflicts for already-closed sessions and stale races.
- Durable live-PostgreSQL coverage for close/movement interleavings.

## Out of Scope

- Reopen. `CLOSED` is terminal.
- Manual movement creation — [[CASH-002]].
- Cash UI — [[CASH-004]].
- Reports and reconciliation dashboards — EPIC-18.

## Acceptance Criteria

- [ ] Closing an in-tenant `OPEN` session computes expected server-side, stores
      expected/count/difference on the session, marks it `CLOSED` and writes one
      audit row.
- [ ] The expected formula is
      `opening_amount + SALE + INCOME + DEPOSIT - REFUND - EXPENSE - WITHDRAWAL ± ADJUSTMENT`.
- [ ] Close takes a session row lock, gates on `OPEN` and performs a conditional
      update so concurrent close/movement/sale-completion races cannot produce a
      stale close record.
- [ ] A session with zero movements can close.
- [ ] `CLOSED` is terminal: no reopen route exists, a second close is rejected
      and later movement inserts are rejected by the database trigger.
- [ ] The route enforces authentication, tenant context, `cash.session.close`,
      `cash` capability and byte-equivalent foreign/unknown `404`s.
- [ ] Rejected close attempts persist no close fields and no audit row.
- [ ] Tenant isolation is enforced when applicable.
- [ ] Backend authorization is enforced when applicable.
- [ ] Required loading/error/empty/success UX exists.
- [ ] Required audit exists.
- [ ] Tests required by the Story pass.

## Domain Invariants

- Close is an explicit business transition, not a generic status patch.
- Expected cash is derived from immutable movement rows and the opening amount.
- Close results are immutable accounting facts after the transition.

## API

### Added

```text
POST /cash/sessions/:id/close
```

### Changed

```text
None yet
```

## Database

### Migration

Uses the close-result fields and closed-session trigger from [[CASH-001]]. No
new table is expected.

### Models/Tables

- `CashSession` — writes close-result fields and terminal `CLOSED` status.
- `CashMovement` — read under the close transaction to compute expected amount.

## UI

- None in this story; [[CASH-004]] builds the close form and comparison view.
- If UI is changed, confirm reusable components use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- Planned close integration tests over authorization, capability, tenant
  isolation, formula, zero movements, conflicts and audit.
- Planned live-PostgreSQL race coverage for close versus movement writers and
  sale completion.

## Known Limitations

- None planned.

## Technical Debt

- None planned.

## Decisions / ADRs

- [[DEC-030]] — movement sign convention.
- [[DEC-031]] — close-result storage and audit.
- [[DEC-035]] — close serialization and closed-session guard.
- [[DEC-036]] — zero-movement close and terminal `CLOSED` state.

## Files / Modules

- `apps/api/src/cash/`
- `apps/api/src/rbac/route-contract.probe.test.ts`
- `apps/api/test/live-pg-isolation.e2e-spec.ts`
- `docs/01-roadmap/EPIC-13-Cash.md`

## Completion Notes

_Status must remain non-done until all required gates pass._
