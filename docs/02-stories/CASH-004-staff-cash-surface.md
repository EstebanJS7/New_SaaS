---
id: CASH-004
type: story
title: Staff Cash surface
epic: EPIC-13
status: done
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
branch: feat/epic-13-cash-data-foundation
created: 2026-09-30
updated: 2026-10-01
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

- The minimal `GET /cash/movements` read the movement list needs, behind the
  existing `cash.read` permission (the epic scope already lists the movement
  list; no read route existed).
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

- [x] Staff can list and create cash registers through the UI. Evidence: the
      register panel and its cases.
- [x] Staff can list sessions and open a session with an opening amount.
      Evidence: the session panel with its status filter and open form.
- [x] Staff can list movements and create each non-sale movement type with the
      required fields. Evidence: the movement panel, its validation mirroring
      `cash.zod.ts` (reason for every kind but `INCOME`, direction exactly for
      `ADJUSTMENT`) and the new `GET /cash/movements` read it consumes.
- [x] Staff can close an `OPEN` session, see expected/count/difference and see
      stable outcomes for success, validation errors and conflicts. Evidence:
      the close panel's `CloseOutcome` with both difference signs and the
      refusal branches.
- [x] The surface covers loading, empty, error, success, permission-denied and
      entitlement-denied states. Evidence: the listed branch coverage of each
      panel test.
- [x] The Cash client module is moved to a Cash-owned location and the existing
      POS surface imports it from there without behavior changes. Evidence: the
      move under `apps/web/src/app/(app)/app/cash/`; a repository search showed
      the module had NO consumer outside its own test, so no POS behavior could
      change and no import needed updating.
- [x] Frontend permission/capability checks are UX only; backend failures are
      handled and displayed without trusting client tenant authority. Evidence:
      the client sends no tenant id and the panels render the backend's own
      `403`/`404`/`409` outcomes.
- [x] Reusable components use semantic design tokens only and no
      Veterinary-specific brand literals. Evidence: the shared control classes
      in `cash-display.ts` and the `@newsaas/ui` primitives.
- [x] Tenant isolation is enforced when applicable. Evidence: not applicable to
      this Story's own code; the server resolves the tenant from the session
      cookie and the client never supplies one.
- [x] Backend authorization is enforced when applicable. Evidence: this Story
      adds no backend authorization of its own; the API routes it consumes keep
      their own guards.
- [x] Required loading/error/empty/success UX exists. Evidence: the panel state
      branches.
- [x] Required audit exists. Evidence: not applicable; this Story writes no data
      of its own and every command it issues is audited by the API.
- [x] Tests required by the Story pass. Evidence: the verification block below.

## Domain Invariants

- The browser never supplies tenant authority.
- UI state does not grant permission; it only reflects backend outcomes.
- Cash actions remain explicit commands, not generic patches.

## API

### Added

```text
GET /cash/movements        (the read the movement list needs; see the
                            slice-level resolution below)
```

### Changed

```text
None in this Story's own code. The web proxy /api/cash gains the movement list,
the movement create and the session close, and the client module moves out of the
sales route; the API contract itself is the one CASH-002 and CASH-003 shipped.
```

The Story consumes the Cash API built by [[CASH-002]] and [[CASH-003]], plus the
minimal movement read added here.

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

Implemented and committed on `feat/epic-13-cash-data-foundation` as three work
units.

**W1 — the movement read (`9796aa2`).** `GET /cash/movements` behind the
existing `cash.read` permission and the `cash` capability: an optional strict
`sessionId` filter, the tenant predicate always on top, newest-first ordering
with an `id` tiebreaker and the same allowlisted movement DTO the create route
returns.

**W2 — proxy and client (`f81cf5b`).** The authenticated `/api/cash` proxy grew
from four routes to seven (movement list, movement create, session close) while
keeping the no-`PATCH`/no-`DELETE` posture, the method gating and every existing
refusal; the caller-owned `Idempotency-Key` is forwarded only on the movement
command, and the body-refusal messages reuse the API's exact strings so a proxy
refusal stays byte-compatible with the upstream one. The Cash client moved from
the sales route into the Cash-owned route directory and gained `listMovements`,
`createMovement` and `closeSession`.

**W3 — the workspace (`2b0e3e9`).** The `/app/cash` page with its register,
session, movement and close panels, the shared display, validation and outcome
modules, the full state-branch coverage and the gated Cash navigation entry.

### Slice-level resolutions

- **The movement read.** The epic's approved scope already listed the movement
  list for the staff Cash UI, but EPIC-12 exposed only the register and session
  reads and CASH-002 added only the create, so this Story adds the smallest read
  that closes the gap: no new permission, no new capability and no product scope
  change.
- **The client move.** A repository search showed
  `apps/web/src/app/(app)/app/sales/cash-api.ts` had NO consumer outside its own
  test, so the move could not change POS behavior; nothing imports the old path.
- **The `Idempotency-Key`.** The API requires it on the movement create, so the
  proxy forwards it and the panel mints one key per attempt, reuses it while the
  attempt is unresolved and rotates it after a successful create. The client
  never mints it silently.
- **The close amounts.** Closing the session DTO gap on the web client
  (`expectedAmount`, `countedAmount`, `differenceAmount`) was required for the
  close outcome; the type now mirrors `CashSessionResponse`.

## Verification

Run locally on 2026-09-30 on `feat/epic-13-cash-data-foundation`.

```text
pnpm --filter @newsaas/web test                                                                   -> passed, 81 files / 939 tests
pnpm --filter @newsaas/web exec vitest run "src/app/(app)/app/cash" src/components/shell         -> passed, 12 files / 166 tests
pnpm --filter @newsaas/api test                                                                   -> passed, 76 files / 1107 tests
pnpm --filter @newsaas/api test:live-pg                                                           -> passed, 119 tests
pnpm typecheck                                                                                    -> passed
pnpm lint                                                                                         -> passed
pnpm build                                                                                        -> passed
pnpm format-check                                                                                 -> passed
git diff --check                                                                                  -> passed
```

One lint error introduced during the slice (a null check the rule prefers as
`??=`) was fixed before the commit.

## Tests Added

- `apps/web/src/app/(app)/app/cash/` — 135 tests across `cash-display`,
  `cash-validation`, `cash-outcome`, `register-panel`, `session-panel`,
  `movement-panel`, `close-panel` and `cash-surface`, plus the transport tests
  of the moved client.
- `apps/web/src/app/api/cash/[[...path]]/route.test.ts` — 25 tests covering the
  extended seven-route surface, the allowed and refused query and body keys, the
  `Idempotency-Key` forwarding and the unchanged no-`PATCH`/no-`DELETE` posture.
- `apps/web/src/components/shell/nav-sidebar.test.tsx` — the Cash entry and its
  capability-gated visibility.
- `apps/api/src/cash/cash.integration.test.ts` and
  `apps/api/test/live-pg-isolation.e2e-spec.ts` — the movement read coverage of
  W1.

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

Closed 2026-10-01. Implemented on `feat/epic-13-cash-data-foundation` and merged
into `main` as PR #84 (merge commit `5058d59`) with CI run
[`36800148919`](https://github.com/EstebanJS7/NewSaaS/actions/runs/36800148919)
green on both required checks. Every acceptance criterion is checked, the local
gates passed and the native review approved the candidate, so `status` is
`done`.

`done` means implementation closure only: it is never production readiness.
