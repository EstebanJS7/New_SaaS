---
id: CASH-002
type: story
title: Cash movement commands
epic: EPIC-13
status: review
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
branch: feat/epic-13-cash-data-foundation
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

- [x] The seeded permission catalog adds exactly `cash.movement.create`, moving
      51 → 52, with OWNER/ADMIN/CASHIER grants. Evidence: `reference-seed.ts`,
      the reconciled `reference-seed.test.ts` pin, and the live database probe
      reporting 52 permissions with the key held by exactly ADMIN, CASHIER and
      OWNER.
- [x] Authenticated staff with `cash.movement.create` and the `cash` capability
      can create each non-sale movement kind against an `OPEN` in-tenant
      session. Evidence: the six-kind case of the
      `EPIC-13 cash movement command application-path isolation` block.
- [x] Missing permission, missing capability, invalid body, foreign ids, unknown
      ids and closed sessions are stable rejections that persist no movement and
      no audit row. Evidence: the `403`, `400`, `404` and `409` cases of
      `cash.integration.test.ts` and their live counterparts.
- [x] Amounts are positive non-zero Decimal money values; `ADJUSTMENT` carries
      an explicit direction; the type-owned sign map follows [[DEC-030]].
      Evidence: the amount pattern and zero guard in `cash.zod.ts`, the
      exclusive `cash_movement_direction_required` CHECK, and the two
      rolled-back live probes for the illegal direction combinations.
- [x] Required reasons are validated by the API and backed by the database
      constraint from [[CASH-001]]. Evidence: the `superRefine` in
      `cash.zod.ts`, the service re-assertion, the
      `cash_movement_reason_required` CHECK and the live INCOME-without-reason
      case.
- [x] Accepted movements are immutable and write exactly one audit row with no
      CONFIDENTIAL/RESTRICTED payload logging. Evidence: the live audit
      assertion over `cash.movement.created` carrying field NAMES only.
- [x] Tenant isolation is enforced when applicable. Evidence: the
      byte-equivalent foreign/unknown session `404` case over real HTTP.
- [x] Backend authorization is enforced when applicable. Evidence: the
      deny-by-default `POST /cash/movements` pin in the route-contract probe and
      the permission and capability sweeps.
- [x] Required loading/error/empty/success UX exists. Evidence: not applicable;
      this Story ships no UI, which [[CASH-004]] owns.
- [x] Required audit exists. Evidence: one `cash.movement.created` row
      co-committed with each accepted movement.
- [x] Tests required by the Story pass. Evidence: the verification block below.

## Domain Invariants

- Cash movements are append-only ledger entries.
- The caller never supplies tenant authority.
- Manual/corrective movements explain themselves with a reason; `INCOME` is the
  one accepted kind whose reason stays optional ([[DEC-032]]).
- `SALE` cannot be forged through this command; it is written only by sale
  completion.
- Sale/payment reversal orchestration is not hidden inside this command.

## API

### Added

| Route                  | Permission             | Contract                                                                                                                                                                                                                                                                                     |
| ---------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /cash/movements` | `cash.movement.create` | Create one standalone non-sale movement (`201`). The body accepts `sessionId`, `type` (the six non-sale kinds), a positive `amount`, an optional `reason` and an ADJUSTMENT-only `direction`; the register is derived server-side and the response is an allowlisted DTO with no `tenantId`. |

Rejections are stable: `400` for an unknown key, `SALE`, a non-positive or
non-decimal amount, a missing required reason, a missing `ADJUSTMENT` direction
or a direction on another kind; `403` for a missing permission or a tenant
without the `cash` capability; the shared byte-equivalent `404` for a foreign or
unknown session; and `409` for a session that is not `OPEN`, including a session
that closes concurrently and is refused by the database trigger.

### Changed

```text
None yet
```

## Database

### Migration

Additive migration `20260930000002_cash_movement_commands`: the
`cash_movement_direction` enum, the nullable `cash_movement.direction` column
and the exclusive `cash_movement_direction_required` CHECK. It creates one enum,
one nullable column and one constraint, writes no row and drops nothing. The
command itself needs no further schema.

### Models/Tables

- `CashMovement` — gains the nullable `direction`, required exactly for
  `ADJUSTMENT` and forbidden for every type-owned kind.
- Permission seed catalog — the new `cash.movement.create` key.

## UI

- None in this story; [[CASH-004]] builds the staff surface.
- If UI is changed, confirm reusable components use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

Implemented and committed on `feat/epic-13-cash-data-foundation` as three work
units.

**W1 — data layer (`15633f0`).** The additive
`20260930000002_cash_movement_commands` migration adds the
`cash_movement_direction` enum (`INCREASE`/`DECREASE`), the nullable
`cash_movement.direction` column and the exclusive
`cash_movement_direction_required` CHECK, which requires a direction for
`ADJUSTMENT` and forbids it for every other kind. The CHECK compares `type` as
text, so the six movement kinds appended by the previous migration are never
used as enum literals inside a migration transaction. The Prisma schema mirrors
the enum and the optional field, and `cash.movement.create` is seeded for
OWNER/ADMIN/CASHIER, moving the pinned catalog 51 → 52.

**W2 — command (`943c301`).** `POST /cash/movements` in `apps/api/src/cash/`: a
strict create body, the `cash` entitlement asserted before the granular
permission, the session resolved in-tenant with the register derived from the
session row, an `OPEN`-only state gate with the closed-session trigger violation
translated to the same stable `409`, one immutable movement row with a positive
amount, one co-committed `cash.movement.created` audit row carrying field NAMES
only, and an allowlisted response DTO.

**W3 — live coverage (`456a33d`).** The
`EPIC-13 cash movement command application-path isolation` block in
`apps/api/test/live-pg-isolation.e2e-spec.ts`, plus the reconciliation of the
two applied-schema assertions the migration invalidated and the applied-schema
coverage for the new enum, column and constraint.

## Verification

Run locally on 2026-09-30 on `feat/epic-13-cash-data-foundation`, with the root
`.env` exported and schema-less `DATABASE_URL` / `DATABASE_URL_TEST`.

```text
pnpm --filter @newsaas/database exec vitest run src/schema-cash.test.ts src/reference-seed.test.ts -> passed, 2 files / 71 tests
pnpm --filter @newsaas/database test                                                            -> passed, 17 files / 361 tests
set -a && source .env && set +a && pnpm --filter @newsaas/database db:deploy                    -> passed, 27 migrations applied, including 20260930000002 on a database that already held cash rows
set -a && source .env && set +a && pnpm --filter @newsaas/database db:seed                      -> passed; live catalog 52 permissions, cash.movement.create held by exactly ADMIN, CASHIER and OWNER
pnpm --filter @newsaas/api test                                                                  -> passed, 75 files / 1069 tests
pnpm --filter @newsaas/api test:live-pg                                                          -> passed, 109 tests
pnpm typecheck                                                                                   -> passed
pnpm lint                                                                                        -> passed
pnpm format-check                                                                                -> passed
git diff --check                                                                                 -> passed
```

One lint error introduced during the slice — an `as CashMovementRow` assertion
in the new integration case — was replaced with the non-null assertion the lint
rule requires, and the now-unused type import was removed.

## Tests Added

- `apps/api/src/cash/cash.integration.test.ts` — **27 tests**, 10 of them new:
  each accepted kind with its co-committed audit row, the reason rules including
  INCOME without a reason, the direction exclusivity and the `SALE` rejection,
  the amount guard, the masked foreign/unknown session `404`, the closed-session
  `409`, the permission and capability sweeps and the INERT proof.
- `apps/api/src/rbac/route-contract.probe.test.ts` — **20 tests**; this slice
  pins `POST /cash/movements` in the deny-by-default inventory and in
  `CASH_PERMISSION_BY_ROUTE`.
- `packages/database/src/schema-cash.test.ts` — **44 tests**, 8 of them new: the
  direction enum literals, the nullable non-defaulted column, the exact
  exclusive CHECK text, the absence of an enum-literal cast, additivity, and the
  schema-level enum and field.
- `packages/database/src/reference-seed.test.ts` — **27 tests**; the pinned
  count moves 51 → 52 and a new case pins the key and its role matrix.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — **109 tests**, 9 of them the
  new EPIC-13 movement-command block.

## Known Limitations

- The command ships no UI; [[CASH-004]] owns the staff surface.
- `SALE` movements cannot be created through this command by design; they remain
  the sale-completion write path ([[DEC-020]], [[DEC-033]]).
- Sale reversal and payment refund remain unavailable until [[TD-018]] lands.
- The Story is locally complete and in `review`, but it is not marked `done`
  until it receives the required CI/PR receipt.

## Technical Debt

- None planned.

## Decisions / ADRs

- [[DEC-030]] — movement sign convention: type-owned sign with positive amounts
  and the dedicated `ADJUSTMENT` direction.
- [[DEC-032]] — reason requirement: mandatory for every kind but `INCOME`.
- [[DEC-033]] — correction boundary: standalone cash movements only.
- [[DEC-034]] — permission key and role matrix.

## Files / Modules

- `packages/database/prisma/migrations/20260930000002_cash_movement_commands/`
- `packages/database/prisma/schema.prisma`
- `packages/database/src/schema-cash.test.ts`
- `packages/database/src/reference-seed.ts`
- `packages/database/src/reference-seed.test.ts`
- `apps/api/src/cash/`
- `apps/api/src/rbac/route-contract.probe.test.ts`
- `apps/api/test/support/in-memory-database.ts`
- `apps/api/test/live-pg-isolation.e2e-spec.ts`
- `docs/01-roadmap/EPIC-13-Cash.md`

## Completion Notes

Local implementation and verification are complete on
`feat/epic-13-cash-data-foundation`. Status is `review`; `done` remains reserved
for merged, CI-backed closure.
