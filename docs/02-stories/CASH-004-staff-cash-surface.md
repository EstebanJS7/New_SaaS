---
id: CASH-004
type: story
title: Staff Cash surface
epic: EPIC-13
status: planned
priority: high
depends_on:
  - CASH-002
  - CASH-003
prd_sections:
  - "10"
  - "20"
  - "28"
permissions:
  - cash.read
  - cash.register.create
  - cash.session.open
  - cash.movement.create
  - cash.session.close
branch:
created: 2026-09-30
updated: 2026-09-30
---

# CASH-004 — Staff Cash surface

## Objective

Give staff an operational Cash workspace for registers, sessions, manual
movements and close, while preserving backend authorization as the authority and
using reusable UI with semantic design tokens.

## Context

EPIC-12's POS surface colocated `cash-api.ts` under the sales route because no
Cash UI existed. [[DEC-037]] brings the Cash UI into EPIC-13 and moves the Cash
client module to the Cash-owned surface.

## In Scope

- Cash route and navigation entry following the existing staff app convention.
- Register list/create and session list/open flows.
- Movement list and create flow for every EPIC-13 movement type.
- Close flow with expected/count/difference display.
- Loading, empty, error, success, permission-denied and entitlement-denied
  states.
- Move the Cash client module out of the sales route and update POS imports
  without changing POS behavior.

## Out of Scope

- Browser-side authorization as a source of truth; frontend checks are UX only.
- Cash reports and dashboards — EPIC-18.
- Sale reversal/payment refund UI — [[TD-018]].
- Brand-specific colors, fonts, logos or Veterinary-specific styling.

## Acceptance Criteria

- [ ] Staff can list and create cash registers through the UI.
- [ ] Staff can list sessions and open a session with an opening amount.
- [ ] Staff can list movements and create each non-sale movement type with the
      required fields.
- [ ] Staff can close an `OPEN` session, see expected/count/difference and see
      stable outcomes for success, validation errors and conflicts.
- [ ] The surface covers loading, empty, error, success, permission-denied and
      entitlement-denied states.
- [ ] The Cash client module is moved to a Cash-owned location and the existing
      POS surface imports it from there without behavior changes.
- [ ] Frontend permission/capability checks are UX only; backend failures are
      handled and displayed without trusting client tenant authority.
- [ ] Reusable components use semantic design tokens only and no
      Veterinary-specific brand literals.
- [ ] Tenant isolation is enforced when applicable.
- [ ] Backend authorization is enforced when applicable.
- [ ] Required loading/error/empty/success UX exists.
- [ ] Required audit exists.
- [ ] Tests required by the Story pass.

## Domain Invariants

- The browser never supplies tenant authority.
- UI state does not grant permission; it only reflects backend outcomes.
- Cash actions remain explicit commands, not generic patches.

## API

### Added

```text
None yet
```

### Changed

```text
None yet
```

The story consumes the Cash API built by [[CASH-002]] and [[CASH-003]].

## Database

### Migration

```text
None yet
```

### Models/Tables

- None directly. The story uses existing Cash API responses.

## UI

- Planned staff route under the existing app shell convention, likely
  `apps/web/src/app/(app)/app/cash/` unless implementation finds a stronger
  repository precedent.
- The route owns the Cash client module and exports shared calls consumed by the
  POS surface.
- All reusable components must use semantic tokens.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- Planned component/route tests for cash states, forms, validation and command
  outcomes.
- Planned regression coverage for the POS import path after moving the Cash
  client module.

## Known Limitations

- If the app shell still lacks browser-side entitlement data, the navigation
  gate limitation must be documented while the backend remains authoritative.

## Technical Debt

- None planned.

## Decisions / ADRs

- [[DEC-037]] — Cash UI scope.
- [[DEC-034]] — permission keys consumed by the surface.

## Files / Modules

- `apps/web/src/app/(app)/app/cash/`
- `apps/web/src/app/(app)/app/sales/`
- `docs/01-roadmap/EPIC-13-Cash.md`

## Completion Notes

_Status must remain non-done until all required gates pass._
