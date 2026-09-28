---
id: POS-002
type: story
title: Cash register and session foundation
epic: EPIC-12
status: planned
priority: high
depends_on:
  - EPIC-02
prd_sections:
  - "5"
  - "7"
  - "9"
  - "10"
  - "20"
  - "27"
  - "28"
  - "29"
  - "41"
permissions:
  - cash.read
  - cash.session.open
branch:
created: 2026-09-27
updated: 2026-09-27
---

# POS-002 — Cash register and session foundation

## Objective

Deliver the minimum PRD §20 Cash model that makes PRD §18's `CompleteSale`
satisfiable: a tenant-scoped `CashRegister`, `CashSession` and `CashMovement`,
the one-`OPEN`-session-per-register rule enforced in the database by a partial
unique index, and a minimal session-open command. [[DEC-020]] fixes this
boundary deliberately: EPIC-13 Cash depends on EPIC-12, so a CASH sale cannot
create its cash movement if the foundation ships only in the later epic.

The cash movement type is extended additively with `SALE` only. The six
remaining PRD §20 kinds — `REFUND`, `INCOME`, `EXPENSE`, `WITHDRAWAL`, `DEPOSIT`
and `ADJUSTMENT` — stay reserved for EPIC-13, under the same additive discipline
the inventory enum already documents. Session close, the expected/counted
difference, cash reversals and the full cash UI are out of scope.

## Context

- PRD §20 defines the three Cash entities, the seven movement kinds, the rule
  "only one OPEN session per register", the immutability of confirmed movements
  and a close that computes the expected amount on the server and stores or
  audits the difference.
- `docs/01-roadmap/ROADMAP.md:24` lists EPIC-13 Cash as `planned` depending on
  EPIC-12, so Cash is genuinely downstream of the sale command; that dependency
  is why [[DEC-020]] pulls the minimum foundation forward.
- The `cash` feature code is one of the twelve seeded feature codes
  (`packages/database/src/reference-seed.ts:299`) and `cash.session.close` is
  already seeded (`reference-seed.ts:87`) while being consumed by no route.
- No `CashRegister`, `CashSession`, `CashMovement` model and no
  `CashMovementType` enum exists today; no cash module exists under
  `apps/api/src/`.
- [[DEC-020]] therefore decides that the register, the session, the movement,
  the `SALE` movement kind, the partial unique index and the session-open
  command belong to this Story, and everything else to EPIC-13.

## In Scope

- `packages/database/prisma/schema.prisma` — the `CashRegister`, `CashSession`
  and `CashMovement` models, a `cash_movement_type` enum carrying `SALE` only, a
  session status enum carrying `OPEN` and `CLOSED`, the tenant composite
  ownership keys, the `RESTRICT` references, the immutability guarantee for a
  confirmed movement and the partial unique index on
  `(tenant, register) WHERE status = 'OPEN'`.
- A planned additive migration under `packages/database/prisma/migrations/`,
  plus a `packages/database/src/schema-cash.test.ts` gate.
- `apps/api/src/cash/` — the permission contract, allowlisted DTOs, strict Zod
  contracts, the tenant-safe repository, the session-open command, the read
  routes, the service, the controller and the module, plus its registration in
  `apps/api/src/app.module.ts` and the corresponding tables in the suite's
  shared in-memory boundary.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the new routes and their
  per-route permission pins.
- `packages/database/src/reference-seed.ts` — the `cash.read` and
  `cash.session.open` keys and their role matrix, with the reconciled seed-count
  probe.
- Tenant isolation, authorization, validation and concurrency tests over the
  real guard chain, plus durable live-PostgreSQL coverage proving the partial
  unique index against real PostgreSQL.
- This Story and the epic record.

## Out of Scope

- **Session close, the expected/counted amount and the stored or audited
  difference** — EPIC-13. The already-seeded `cash.session.close` key stays
  reserved and is consumed by no EPIC-12 route.
- **The six remaining cash movement kinds** — `REFUND`, `INCOME`, `EXPENSE`,
  `WITHDRAWAL`, `DEPOSIT` and `ADJUSTMENT` stay reserved for EPIC-13
  ([[DEC-020]]).
- **Cash reversals and compensating cash movements** — PRD §40 names "Cash
  compensating movement" as a core correction case; it is deferred with the rest
  of the correction boundary ([[DEC-023]]).
- **The full cash UI, cash reports and cash reconciliation** — EPIC-13 and
  EPIC-18.
- **The CASH payment path of `CompleteSale`** — [[POS-003]]. This Story ships
  the foundation and the open command; it writes no `SALE` movement itself.
- **The sale aggregate, its lines and its prices** — [[POS-001]].
- **Invoices, billing and fiscal documents** — EPIC-14, EPIC-15 and EPIC-16.
- **A Branch, Warehouse or location dimension.** Cash and stock stay tenant-wide
  ([[DEC-020]]).
- **Customer credit, accounts receivable or overpayment** — [[DEC-029]].
- **Automatic retention or purge of any confirmed cash record** — PRD §41.
- **Hard delete of a register, a session or a confirmed movement.**
- **A new Decision record or an ADR** — outside this Story's file surface.

## Acceptance Criteria

- [ ] `CashRegister`, `CashSession` and `CashMovement` are tenant-scoped with
      tenant composite ownership keys and `RESTRICT` tenant foreign keys; a
      cross-tenant or unknown UUID is one byte-equivalent `404`.
- [ ] "Only one OPEN session per register" is enforced in the database by a
      partial unique index, not by application convention, so a concurrent
      second open is rejected by the database rather than by a service check.
- [ ] `CashMovementType` gains `SALE` additively only; the six remaining PRD §20
      kinds are absent from the applied enum and stay reserved for EPIC-13, and
      no existing enum value is reordered or removed ([[DEC-020]]).
- [ ] The session-open command is the only write route; the cash surface exposes
      no `PATCH` and no `DELETE` route, and a confirmed movement is immutable at
      the database level.
- [ ] The session-open command resolves the caller's tenant server-side and
      never reads `tenantId` from body, query or route; the register is resolved
      in-tenant and a foreign or unknown register id is the shared `404`.
- [ ] Every cash route enforces authentication, server-side tenant context and a
      granular permission re-asserted by the service before data access, plus
      the `sales` entitlement through `EntitlementsService.has`; a missing
      permission or a tenant without the capability is a stable `403` that
      persists nothing, and the frontend gate is UX only ([[DEC-026]]).
- [ ] All request bodies are strict allowlisted contracts that reject unknown
      keys; `tenantId` is never read from body, query or route; no Prisma model
      crosses the HTTP boundary.
- [ ] Money uses `Decimal(14, 2)`, a movement amount is non-zero and the sign is
      owned by the movement kind rather than by the caller, and no cash balance
      is ever mutated directly: every amount change is a new immutable movement
      (PRD §20).
- [ ] The session-open command co-commits exactly one audit row carrying the
      actor, the session id, stable field names and
      `{ schemaVersion,     changedFields }` with no stored value; reads are not
      audited (PRD §27).
- [ ] This Story writes no stock movement, touches no `StockBalance`, creates no
      sale and creates no payment, and the already-seeded `cash.session.close`
      key is consumed by no route.
- [ ] The new permission keys and role matrix are seeded, and the seed-count
      probe is reconciled: `cash.read` is held by all six roles and
      `cash.session.open` by `OWNER`, `ADMIN` and `CASHIER`, within the epic
      total of 43 → 50 ([[DEC-026]]).
- [ ] Tenant isolation tests exist for the three new private aggregates,
      authorization and validation tests cover every new route, and durable
      live-PostgreSQL evidence proves the partial unique index, the
      byte-equivalent cross-tenant `404` and the immutability of a confirmed
      movement.
- [ ] Required lint, typecheck, test, integration and build checks pass.

## Domain Invariants

- **Only one OPEN session per register.** The rule is a database property
  enforced by a partial unique index, not an application convention a second
  writer could forget.
- **Confirmed cash movements are immutable.** An incorrect movement is corrected
  by a compensating movement, never by an edit or a delete; the compensating
  kinds belong to EPIC-13.
- **No cash balance is mutated directly.** The ledger is the source of truth and
  the register's expected amount is derived from it.
- **Every cash record belongs to exactly one tenant.** Tenant identity comes
  only from the server-side request context; a cross-tenant UUID is a `404`.
- **The movement enum is additive.** `SALE` is appended; the reserved kinds are
  added by the epic that owns their commands, never reordered or removed.
- **Money uses `Decimal`.** Never a float.

## API

### Added

Planned routes behind the two granular permissions. The surface is the session
open command and the two reads; there is deliberately **no** `PATCH` and **no**
`DELETE`, and no close route.

| Route                 | Permission          | Planned contract                                                                                       |
| --------------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /cash/registers` | `cash.read`         | The caller tenant's registers, newest first with an id tiebreaker.                                     |
| `GET /cash/sessions`  | `cash.read`         | The caller tenant's sessions with their register and status; optional `status` filter, no default.     |
| `POST /cash/sessions` | `cash.session.open` | Open one session for an in-tenant register (`201`); a second open for that register is a stable `409`. |

The reserved `cash.session.close` command belongs to EPIC-13 and is not
implemented by this Story.

### Changed

```text
None yet
```

No existing route is touched; only the new `cash_movement_type` enum value is
added by this Story's migration.

## Database

### Migration

Planned additive migration `20260927000002_cash_foundation`: the
`cash_movement_type` enum carrying `SALE`, the session status enum, three
tables, their indexes, constraints and the partial unique index on
`(tenant_id, register_id) WHERE status = 'OPEN'`. It alters no existing table
and inserts no rows. It is not created by this Story.

### Models/Tables

- `CashRegister` (table `cash_register`) — tenant-scoped register. Planned
  columns: `id` (`UUID` PK), `tenant_id` (`UUID NOT NULL`), `name`, `is_active`,
  timestamps. There is deliberately no `branch_id` ([[DEC-020]]).
- `CashSession` (table `cash_session`) — tenant-scoped session. Planned columns:
  `id`, `tenant_id`, `register_id`, `status` (`OPEN` | `CLOSED`), `opened_at`,
  `opened_by`, timestamps. The partial unique index enforces at most one `OPEN`
  row per `(tenant, register)`.
- `CashMovement` (table `cash_movement`) — immutable movement. Planned columns:
  `id`, `tenant_id`, `register_id`, `session_id`, `type` (`cash_movement_type`,
  `SALE` only), `amount` (`DECIMAL(14,2)`), `reason`, `created_at`.

| Guarantee                | Planned shape                                                                     |
| ------------------------ | --------------------------------------------------------------------------------- |
| Movement enum            | `cash_movement_type` with `SALE` only; the six others reserved for EPIC-13        |
| Session status           | `cash_session_status` pinned to `OPEN`, `CLOSED`                                  |
| Tenant scope             | `RESTRICT` tenant FKs on all three tables                                         |
| Ownership is composite   | `(tenant_id, id)` unique on each table                                            |
| Same-tenant references   | Composite FKs to `cash_register(tenant_id, id)` and `cash_session(tenant_id, id)` |
| One OPEN session         | Partial unique index on `(tenant_id, register_id) WHERE status = 'OPEN'`          |
| Immutable confirmed rows | A `BEFORE DELETE` trigger rejecting a hard delete of a session or a movement      |
| Non-zero money           | `CHECK (amount <> 0)` on the movement                                             |

The exact index and constraint list is a slice-level implementation choice
inside approved scope and follows the sibling migration shapes.

## UI

- None. EPIC-13 owns the cash UI; [[POS-004]] consumes the cash read and
  session-open routes as UX gates only.
- If UI is changed later, reusable components must use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

Planned coverage; none of it exists yet.

- `packages/database/src/schema-cash.test.ts` — the additive enum literal
  `{SALE}` and the absence of the six reserved kinds, the session status enum,
  the three tables, the composite ownership keys, the `RESTRICT` tenant and
  register/session foreign keys, the partial unique index definition, the
  non-zero amount `CHECK` and the delete-rejection trigger.
- `apps/api/src/cash/cash.integration.test.ts` — the read and write permission
  sweeps that persist nothing on denial, the `sales` entitlement `403`, the
  session open, the second-open `409`, the list and detail reads, the invalid
  body sweeps, the co-committed audit row with field names only, the
  byte-equivalent cross-tenant `404`, and the proof that no sale, stock, payment
  or close state is touched.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the three cash routes in
  the deny-by-default survival inventory and their per-route permission pins.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — an EPIC-12 cash-foundation
  block against the booted AppModule and a disposable real PostgreSQL: the
  session open with its audit row, the partial unique index proven by a raw
  concurrent second insert, the byte-equivalent cross-tenant `404` and the
  delete-rejection trigger.

## Known Limitations

- None yet; nothing is implemented.
- Planned: the shared in-memory boundary cannot enforce a partial unique index,
  so the live-PostgreSQL block must prove the one-`OPEN`-session rule against
  real PostgreSQL rather than by a service check.
- Planned: with no close command in EPIC-12, an `OPEN` session stays open until
  EPIC-13 ships close, so a register can only be reused if its session is closed
  by that later slice.

## Technical Debt

- [[TD-018]] records the deferred sale reversal and payment refund
  ([[DEC-023]]); cash reversals are part of the same deferred boundary.
- [[TD-016]] binds only the stock writers; this Story writes no stock and is not
  a call site.
- No new debt record is planned: the one-session rule is a database invariant
  from the first slice rather than an application convention, and the deferred
  close and remaining kinds are owned by EPIC-13 and recorded in [[DEC-020]]
  rather than hidden.

## Decisions / ADRs

- Accepted Decision records govern this Story (accepted 2026-09-27):
  - [[DEC-020]] — the `CompleteSale` cash boundary and the minimal Cash
    foundation: which cash entities, movement kinds, invariants and commands
    belong to EPIC-12 and which stay with EPIC-13.
  - [[DEC-026]] — sales permission keys, role matrix and the entitlement gate;
    this Story owns `cash.read` and `cash.session.open` and leaves the seeded
    `cash.session.close` reserved.
  - [[DEC-023]] — the deferred correction boundary; cash reversals wait with
    sale reversal and payment refund.
- An ADR is not expected: the cash foundation introduces no architecture change
  that the complexity budget gates.

## Resolved by Decision

- **The cash boundary** — [[DEC-020]]: EPIC-12 owns the register, the session,
  the movement, the `SALE` movement kind, the partial unique index and the
  session-open command; EPIC-13 owns close, the difference, the other six
  movement kinds, reversals and the UI.
- **The one-OPEN-session rule** — [[DEC-020]]: enforced in the database by a
  partial unique index rather than by application convention.
- **The Branch dimension** — [[DEC-020]]: no Branch, consistent with the
  tenant-wide stock decision.
- **Permission keys and entitlement gate** — [[DEC-026]]: `cash.read` and
  `cash.session.open` with their role matrix and the `sales` entitlement.
- **The exact index and constraint list** — an implementation choice inside
  approved scope, decided during the slice using the sibling migrations as
  precedent.

## Files / Modules

- `packages/database/prisma/schema.prisma` — the `CashMovementType` and
  `CashSessionStatus` enums and the three cash models.
- `packages/database/prisma/migrations/20260927000002_cash_foundation/` — the
  planned additive migration.
- `packages/database/src/schema-cash.test.ts` — the planned schema gate.
- `apps/api/src/cash/` — permissions, DTOs, Zod contracts, repository, service,
  controller and module.
- `apps/api/src/app.module.ts` — the planned `CashModule` registration.
- `apps/api/test/support/in-memory-database.ts` — the cash tables in the shared
  in-memory boundary.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the route and permission
  pins.
- `packages/database/src/reference-seed.ts` — the two `cash.*` permission keys
  and the role matrix.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the planned live-PostgreSQL
  block.
- `docs/01-roadmap/EPIC-12-POS-Payments.md` — the epic record.

## Completion Notes

_Status must remain non-done until all required gates pass._ This Story stays
`planned` while nothing exists; it may not be marked `done` until the schema,
the routes, the seed and the live-PostgreSQL evidence are merged with the
required CI checks green.
