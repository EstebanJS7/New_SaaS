---
id: CASH-003
type: story
title: Cash session close
epic: EPIC-13
status: done
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
branch: feat/epic-13-cash-data-foundation
created: 2026-09-30
updated: 2026-10-01
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

- [x] Closing an in-tenant `OPEN` session computes expected server-side, stores
      expected/count/difference on the session, marks it `CLOSED` and writes one
      audit row. Evidence: the mixed-kind close case of both the API and the
      live-PostgreSQL suites, with the audit row carrying field NAMES only.
- [x] The expected formula is
      `opening_amount + SALE + INCOME + DEPOSIT - REFUND - EXPENSE - WITHDRAWAL ± ADJUSTMENT`.
      Evidence: `cashMovementSign` and `computeCashCloseAmounts` in
      `cash.expected-amount.ts`, covered by their own 15 unit tests, and the
      live close over a movement mix that exercises every kind and both
      `ADJUSTMENT` directions.
- [x] Close takes a session row lock, gates on `OPEN` and performs a conditional
      update so concurrent close/movement/sale-completion races cannot produce a
      stale close record. Evidence: `CashRepository.lockById`'s
      `SELECT ... FOR UPDATE`, the conditional `WHERE status = 'OPEN'` write,
      and the live concurrency case proving one `201` and one stable `409` under
      a real `cash_session` row-lock overlap.
- [x] A session with zero movements can close. Evidence: the zero-movement case,
      where expected equals the opening amount and the difference is negative
      when the drawer is short.
- [x] `CLOSED` is terminal: no reopen route exists, a second close is rejected
      and later movement inserts are rejected by the database trigger. Evidence:
      the second-close `409`, the movement-create `409` against a closed
      session, and the raw-insert trigger probe.
- [x] The route enforces authentication, tenant context, `cash.session.close`,
      `cash` capability and byte-equivalent foreign/unknown `404`s. Evidence:
      the live byte-equivalent `404` case, which is the first time the session
      half of the cross-tenant guarantee is exercisable over HTTP.
- [x] Rejected close attempts persist no close fields and no audit row.
      Evidence: the second-close and `404` cases of both suites.
- [x] Tenant isolation is enforced when applicable. Evidence: the
      byte-equivalent foreign/unknown session `404` and the tenant-scoped
      session read.
- [x] Backend authorization is enforced when applicable. Evidence: the
      `cash.session.close` pin in the route-contract probe and the permission
      and capability sweeps.
- [x] Required loading/error/empty/success UX exists. Evidence: not applicable;
      [[CASH-004]] owns the staff surface.
- [x] Required audit exists. Evidence: one `cash.session.closed` row per
      accepted close.
- [x] Tests required by the Story pass. Evidence: the verification block below.

## Domain Invariants

- Close is an explicit business transition, not a generic status patch.
- Expected cash is derived from immutable movement rows and the opening amount.
- Close results are immutable accounting facts after the transition.

## API

### Added

| Route                           | Permission           | Contract                                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /cash/sessions/:id/close` | `cash.session.close` | Close one `OPEN` session (`201`). The body accepts only `countedAmount`, an exact non-negative `Decimal(14, 2)` literal. The response is the session DTO with `expectedAmount`, `countedAmount` and `differenceAmount` populated (all `null` while `OPEN`); `differenceAmount` is `counted - expected` and may be negative. |

Rejections are stable: `400` for an unknown body key, a non-UUID id, a missing,
negative or non-decimal `countedAmount`; `403` for a missing permission or a
tenant without the `cash` capability; the shared byte-equivalent `404` for a
foreign or unknown session; and `409` for a session that is not `OPEN`,
including a session closed concurrently and refused by the conditional write. A
second close is NEVER a replay ([[DEC-036]]): `CLOSED` is terminal.

### Changed

The `CashSessionResponse` DTO gains the three close amounts, so every existing
session read also carries them (`null` while `OPEN`). No route was removed and
no `PATCH`, `DELETE` or reopen was added.

## Database

### Migration

```text
None. This Story consumes the expected_amount, counted_amount and
difference_amount columns and the closed-session insert trigger that the
20260930000001_cash_data_foundation migration from CASH-001 already added.
```

The seeded permission catalog is likewise untouched: `cash.session.close` has
existed since EPIC-01 and is already granted to `OWNER`, `ADMIN` and `CASHIER`,
so the count stays 52 and only the route contract changes.

### Models/Tables

- `CashSession` — the close write sets the three close amounts and the terminal
  `CLOSED` status under a conditional `WHERE status = 'OPEN'`.
- `CashMovement` — read inside the close transaction to derive the expected
  amount.

## UI

- None in this story; [[CASH-004]] builds the close form and comparison view.
- If UI is changed, confirm reusable components use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

Implemented and committed on `feat/epic-13-cash-data-foundation` as one work
unit (`03e4d22`).

**Expected amount.** `apps/api/src/cash/cash.expected-amount.ts` is the single
place the close arithmetic exists: `cashMovementSign` owns the DEC-030 sign map
(`SALE`/`INCOME`/`DEPOSIT` add, `REFUND`/`EXPENSE`/`WITHDRAWAL` subtract,
`ADJUSTMENT` follows its explicit direction) and `computeCashCloseAmounts`
returns the expected amount and `counted - expected` at scale 2 with
`ROUND_HALF_UP`, using `Prisma.Decimal` throughout — never a JavaScript float.
Its colocated unit test covers every kind, both `ADJUSTMENT` directions, a
zero-movement session and both difference signs.

**Command.** `POST /cash/sessions/:id/close` in `apps/api/src/cash/`: the `cash`
entitlement then `cash.session.close`, one transaction that row-locks the
session by explicit `SELECT ... FOR UPDATE` (tenant-scoped and `::uuid`-cast,
mirroring `SaleRepository.lockById`), re-reads it in-tenant, rejects a
non-`OPEN` session with the stable `409`, derives the expected amount from the
session's movements, performs the conditional `WHERE status = 'OPEN'` write and
co-commits exactly one `cash.session.closed` audit row carrying field NAMES
only. A lost race affects zero rows and maps to the same stable `409`.

**DTO.** `CashSessionResponse` gains nullable `expectedAmount`, `countedAmount`
and `differenceAmount`, so every session read now carries them.

## Verification

Run locally on 2026-09-30 on `feat/epic-13-cash-data-foundation`, with the root
`.env` exported and schema-less `DATABASE_URL` / `DATABASE_URL_TEST`.

```text
pnpm --filter @newsaas/database test                                                              -> passed, 17 files / 361 tests
pnpm --filter @newsaas/api test                                                                   -> passed, 76 files / 1104 tests
pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts src/cash/cash.integration.test.ts src/cash/cash.expected-amount.test.ts -> passed, 37 + 15 tests
pnpm --filter @newsaas/api test:live-pg                                                           -> passed, 119 tests
pnpm typecheck                                                                                    -> passed
pnpm lint                                                                                         -> passed
pnpm format-check                                                                                 -> passed
git diff --check                                                                                  -> passed
```

## Tests Added

- `apps/api/src/cash/cash.expected-amount.test.ts` — **15 tests** over the sign
  map, the expected amount, the difference sign and the exact scale.
- `apps/api/src/cash/cash.integration.test.ts` — **37 tests**, 9 of them new:
  the mixed-kind close, the zero-movement close, the second close `409`, the
  injected lost race, the permission and capability sweeps, the masked
  foreign/unknown `404`, the invalid-body sweep, the audit shape and the route
  inventory.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the close route pinned in
  the deny-by-default inventory and in `CASH_PERMISSION_BY_ROUTE`.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — **119 tests**, 9 of them the
  new EPIC-13 close block, plus the reconciliation of the five assertions the
  DTO change invalidated.

## Known Limitations

- A second close is a stable `409` and never a replay: [[DEC-036]] makes
  `CLOSED` terminal, so the command accepts no idempotency key. A client that
  retries after a timeout must read the session to learn the outcome.
- The live close block asserts that exactly one raw `CLOSED` row in the whole
  database still carries `NULL` close amounts, which pins the earlier movement
  block's fixture by name and by that global count. A future block that commits
  a raw `CLOSED` session row must scope that assertion.
- The close arithmetic is proven at scale 2 with `ROUND_HALF_UP`; PYG has no
  minor unit in practice, so the rounding never triggers for the seeded
  currency, but it is exercised by the mixed-kind cases for currencies that do.

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

Closed 2026-10-01. Implemented on `feat/epic-13-cash-data-foundation` and merged
into `main` as PR #84 (merge commit `5058d59`) with CI run
[`36800148919`](https://github.com/EstebanJS7/NewSaaS/actions/runs/36800148919)
green on both required checks. Every acceptance criterion is checked, the local
gates passed and the native review approved the candidate, so `status` is
`done`.

`done` means implementation closure only: it is never production readiness.
