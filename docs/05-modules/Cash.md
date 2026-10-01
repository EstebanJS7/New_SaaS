---
type: module
status: implemented
epic: EPIC-13
updated: 2026-10-01
---

# Cash

The cash module owns PRD §20: the registers, the sessions opened against them,
the immutable movements that record money entering or leaving a drawer, the
close that compares the server-computed expected amount with the counted amount,
and the staff workspace that operates all of it.

EPIC-12 shipped the minimum foundation a counter sale needs — the three tables,
one `OPEN` session per register and the `SALE` movement the sale completion
writes — because EPIC-13 depends on EPIC-12 and a CASH sale cannot write its
cash movement if the foundation ships only in the later epic ([[DEC-020]]).
EPIC-13 completed it: the six remaining movement kinds, the close with its
stored and audited difference, the standalone movement commands and the cash
surfaces.

Cash is a Core Business domain. It knows about money, registers and sessions,
and it knows nothing about pets, clinical records or fiscal documents.

## Owned tables

| Table           | Purpose                                                                                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cash_register` | A tenant-scoped drawer: `name` (unique per tenant, 1..200 characters) and `is_active`. There is deliberately **no** `branch_id`.                                                                                                                                                      |
| `cash_session`  | A period of operation for one register: `status` (`OPEN` / `CLOSED`), `opened_at`, `opened_by_membership_id`, the required `opening_amount` (`DECIMAL(14,2)`, `0.00` allowed) and, once closed, the stored `expected_amount`, `counted_amount` and `difference_amount` ([[DEC-031]]). |
| `cash_movement` | An immutable movement: its `type` (all seven PRD §20 kinds), its `amount` (`DECIMAL(14,2)`, positive, non-zero), the optional `direction` an `ADJUSTMENT` requires, its optional `reason` and its register and session.                                                               |

Every table carries the tenant composite ownership key `(tenant_id, id)` and a
`RESTRICT` reference to its tenant. The session references its register through
`(tenant_id, register_id)` and its opener through
`(tenant_id, opened_by_membership_id)` against
`tenant_membership(tenant_id, id)`, so **both** are guaranteed same-tenant by
the database rather than by a service check. A cross-tenant UUID is one
byte-equivalent `404`.

## Routes

| Route                           | Permission             | Contract                                                                                                                                                                                                                                                         |
| ------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /cash/registers`           | `cash.read`            | The tenant's registers, newest first with an id tiebreaker.                                                                                                                                                                                                      |
| `POST /cash/registers`          | `cash.register.create` | Create a register; a duplicate tenant-scoped name is a stable `409` from the real index.                                                                                                                                                                         |
| `GET /cash/sessions`            | `cash.read`            | The tenant's sessions with their close amounts; optional `status` filter, no implicit default.                                                                                                                                                                   |
| `POST /cash/sessions`           | `cash.session.open`    | Open one session for an in-tenant register with its opening amount (`201`); a second open for that register is a stable `409`.                                                                                                                                   |
| `POST /cash/sessions/:id/close` | `cash.session.close`   | Close one `OPEN` session (`201`): the body carries only `countedAmount`, and the response returns the stored expected, counted and difference amounts. A second close is a stable `409` ([[DEC-036]]).                                                           |
| `GET /cash/movements`           | `cash.read`            | The tenant's movements, newest first with an id tiebreaker; an optional `sessionId` narrows them.                                                                                                                                                                |
| `POST /cash/movements`          | `cash.movement.create` | Create one standalone non-sale movement (`201`), or replay it (`200`) when the required `Idempotency-Key` repeats an identical request. The body accepts `sessionId`, `type`, a positive `amount`, a `reason` where required and an ADJUSTMENT-only `direction`. |

There is no `PATCH`, no `DELETE` and no reopen anywhere on the surface. Each
route asserts the `cash` capability through `EntitlementsService.has` before its
granular permission, reads included.

## Invariants

- **One `OPEN` session per register is a database property**, enforced by the
  partial unique index `cash_session_one_open_per_register_key` on
  `(tenant_id, register_id) WHERE status = 'OPEN'`, not by a service pre-check
  that a second writer could forget. A concurrent second open fails the index
  and the service maps that violation to a stable `409`.
- **Confirmed sessions and movements are immutable.** Delete triggers reject a
  hard delete of a session and of a movement, and a `BEFORE UPDATE` trigger
  rejects any edit of a confirmed movement — an in-place change of the ledger
  the expected amount derives from is refused rather than merely undeletable. A
  correction is a compensating movement.
- **No cash balance is mutated directly.** A register's expected amount is
  derived from its movements; there is no balance column.
- **The movement kind owns the sign** ([[DEC-030]]): amounts stay positive, so
  `SALE`, `INCOME` and `DEPOSIT` add, `REFUND`, `EXPENSE` and `WITHDRAWAL`
  subtract, and `ADJUSTMENT` follows its explicit `direction`. The exclusive
  `cash_movement_direction_required` CHECK requires a direction for `ADJUSTMENT`
  and forbids it on every other kind.
- **A movement explains itself.** `reason` is required by a `CHECK` for
  `REFUND`, `EXPENSE`, `WITHDRAWAL`, `DEPOSIT` and `ADJUSTMENT`, and optional
  for `SALE` and `INCOME` ([[DEC-032]]). The predicate compares `type` as text,
  so the values appended by a migration are never used as enum literals inside
  the transaction that added them.
- **The opening amount is required** so the expected/counted comparison at close
  has a baseline: the cash already in the drawer is part of the record, not an
  implicit assumption.
- **The opener is server-owned.** `opened_by_membership_id` is resolved from the
  request context; it is never read from the body, and the composite foreign key
  makes a foreign opener unrepresentable.
- **Close is a serialized, terminal transition.** It row-locks the session,
  gates on `OPEN`, computes the expected amount server-side, writes the three
  amounts with a conditional `WHERE status = 'OPEN'` update and audits in the
  same transaction ([[DEC-035]]). `CLOSED` is terminal: there is no reopen and a
  second close is a stable `409` ([[DEC-036]]). A session with zero movements
  closes with the opening amount as its expectation.
- **The movement kind is additive.** `SALE` was appended by [[POS-003]] and the
  six remaining kinds by EPIC-13; values are appended, never reordered or
  removed.

## The close arithmetic

`cash.expected-amount.ts` is the single place the close computation exists:

```text
expected   = opening_amount + SALE + INCOME + DEPOSIT
                             − REFUND − EXPENSE − WITHDRAWAL
                             ± ADJUSTMENT (INCREASE adds, DECREASE subtracts)
difference = counted_amount − expected_amount
```

It runs in `Decimal` at the `Decimal(14, 2)` scale with half-up rounding, so
money never becomes a JavaScript float, and the difference is negative when the
drawer is short.

## What the sale writes here

[[Sales]]' completion command resolves the tenant's **single** `OPEN` session
server-side when the payment set contains a CASH payment, and writes exactly one
`cash_movement` of type `SALE` per CASH payment, whose amount equals that
payment and which records the session and its register so the attribution is
auditable. Zero open sessions is a stable `409` naming the absence and more than
one is a different stable `409` naming the ambiguity ([[DEC-020]]); a sale paid
entirely by other means writes no cash movement. `SALE` cannot be forged through
`POST /cash/movements`: the command's contract excludes it.

## Staff surface

`/app/cash` is the staff workspace: the register list and creation, the session
list with its status filter and the open form, the movement ledger of the
selected session with the create form, and the close form with the
expected/counted comparison. Every backend call goes through the Cash client in
that route, which uses the authenticated `/api/cash` proxy; the browser supplies
no tenant authority and its permission and capability checks are UX only. The
movement create owns one `Idempotency-Key` per attempt and reuses it while the
attempt is unresolved, so a retry cannot double-post, and both command panels
are remounted when the selected session changes so no value can be carried
across sessions.

## Does Not Own

- **Sale reversal, sale cancellation compensation and payment refund** —
  [[TD-018]]. PRD §40's correction cases that span Sales, Inventory and Payment
  are a separate slice; cash has no reversal command of its own.
- **Cash reports, reconciliation views and dashboards** — EPIC-18.
- **A Branch, Warehouse or location dimension** — cash is tenant-wide, matching
  the stock decision.
- **Automatic retention or purge of a confirmed cash record** — PRD §41.
- **Hard delete of a register.** A register is deactivated; only sessions and
  movements carry an unconditional delete rejection.
- **The invoice and fiscal consequences of a cash movement** — Billing and the
  Fiscal domain.

## Audit and classification

One co-committed audit row per accepted mutation (`cash.register.created`,
`cash.session.opened`, `cash.movement.created`, `cash.session.closed`) with the
actor, the record id and `{ schemaVersion, changedFields }` carrying field names
only. Reads are never audited and no payload is logged. Register names, amounts,
statuses, reasons and the opener reference are INTERNAL.

## Tests

- `packages/database/src/schema-cash.test.ts` — the enums with their additive
  values, the three tables, the scales, the ownership uniques, the partial index
  predicate, the close columns, the reason and direction CHECKs, the insert
  guard and the three immutability triggers.
- `apps/api/src/cash/cash.expected-amount.test.ts` — the sign map, the expected
  amount, both difference signs and the exact scale.
- `apps/api/src/cash/cash.integration.test.ts` — the guard chain and the
  capability gate, the register create, the session open, the movement create
  with its reason, direction and idempotency rules, the close with its conflict
  branches, the invalid-body sweeps, the audit shape and the inert proofs.
- `apps/web/src/app/(app)/app/cash/*` — the client transport and the workspace
  panels with their loading, empty, error, success, permission-denied,
  entitlement-denied, validation, not-found and conflict states.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the EPIC-12 and EPIC-13
  blocks: the partial unique index, the composite foreign keys, the immutability
  triggers, the movement command end to end with its replay, the close under a
  real row lock, and the byte-equivalent cross-tenant `404`s including the
  session one the close route made addressable.

## Known limitations

- The navigation gate is declared (`requiredFeature: "cash"`) but dormant: the
  shell still has no browser-side entitlement source, so the backend remains the
  authority on what a tenant can do.
- The close takes no idempotency key: `CLOSED` is terminal, so a client that
  retries after a timeout reads the session to learn the outcome instead of
  receiving a replay ([[DEC-036]]).
- `cash-display.ts` imports the amount formatter from the sales surface client,
  the only cross-surface coupling; a shared money formatter is a pending
  refactor.
- The in-memory test boundary cannot enforce the partial unique index, the
  composite foreign keys or the CHECK constraints, so those are proven against
  real PostgreSQL; the workspace has no browser/E2E coverage.
