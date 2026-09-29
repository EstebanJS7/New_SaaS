---
type: module
status: implemented
epic: EPIC-12
updated: 2026-09-29
---

# Cash

The cash module owns the minimal PRD §20 model that makes a counter sale
satisfiable: the registers, the sessions opened against them and the immutable
movements that record money entering or leaving a drawer. It is the foundation
[[POS-002]] shipped inside EPIC-12, deliberately smaller than the Cash epic, and
it exists because EPIC-13 depends on EPIC-12: a CASH sale cannot write its cash
movement if the foundation ships only in the later epic ([[DEC-020]]).

Cash is a Core Business domain. It knows about money, registers and sessions,
and it knows nothing about pets, clinical records or fiscal documents.

## Owned tables

| Table           | Purpose                                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cash_register` | A tenant-scoped drawer: `name` (unique per tenant, 1..200 characters) and `is_active`. There is deliberately **no** `branch_id`.                                                  |
| `cash_session`  | A period of operation for one register: `status` (`OPEN` / `CLOSED`), `opened_at`, `opened_by_membership_id` and the required `opening_amount` (`DECIMAL(14,2)`, `0.00` allowed). |
| `cash_movement` | An immutable movement: its `type` (today only `SALE`), its `amount` (`DECIMAL(14,2)`, non-zero) and its register and session.                                                     |

Every table carries the tenant composite ownership key `(tenant_id, id)` and a
`RESTRICT` reference to its tenant. The session references its register through
`(tenant_id, register_id)` and its opener through
`(tenant_id, opened_by_membership_id)` against
`tenant_membership(tenant_id, id)`, so **both** are guaranteed same-tenant by
the database rather than by a service check. A cross-tenant UUID is one
byte-equivalent `404`.

## Routes

| Route                  | Permission             | Contract                                                                                                                       |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /cash/registers`  | `cash.read`            | The tenant's registers, newest first with an id tiebreaker.                                                                    |
| `POST /cash/registers` | `cash.register.create` | Create a register; a duplicate tenant-scoped name is a stable `409` from the real index.                                       |
| `GET /cash/sessions`   | `cash.read`            | The tenant's sessions; optional `status` filter, no implicit default.                                                          |
| `POST /cash/sessions`  | `cash.session.open`    | Open one session for an in-tenant register with its opening amount (`201`); a second open for that register is a stable `409`. |

There is no `PATCH`, no `DELETE` and no close route. The already-seeded
`cash.session.close` key stays reserved for EPIC-13 and is consumed by nothing.
Each route asserts the `cash` capability through `EntitlementsService.has`
before its granular permission, reads included.

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
  correction is a compensating movement, and the six compensating kinds belong
  to EPIC-13.
- **No cash balance is mutated directly.** A register's expected amount is
  derived from its movements; there is no balance column.
- **The opening amount is required** so the expected/counted comparison at close
  has a baseline: the cash already in the drawer is part of the record, not an
  implicit assumption.
- **The opener is server-owned.** `opened_by_membership_id` is resolved from the
  request context; it is never read from the body, and the composite foreign key
  makes a foreign opener unrepresentable.
- **The movement kind is additive.** `SALE` was appended by [[POS-003]]'s
  migration; `REFUND`, `INCOME`, `EXPENSE`, `WITHDRAWAL`, `DEPOSIT` and
  `ADJUSTMENT` are absent from the applied enum and reserved for EPIC-13. Values
  are appended, never reordered or removed.

## What the sale writes here

[[Sales]]' completion command resolves the tenant's **single** `OPEN` session
server-side when the payment set contains a CASH payment, and writes exactly one
`cash_movement` of type `SALE` per CASH payment, whose amount equals that
payment and which records the session and its register so the attribution is
auditable. Zero open sessions is a stable `409` naming the absence and more than
one is a different stable `409` naming the ambiguity ([[DEC-020]]); a sale paid
entirely by other means writes no cash movement.

## Does Not Own

- **Session close, the expected amount, the counted amount and the stored or
  audited difference** — EPIC-13.
- **`REFUND`, `INCOME`, `EXPENSE`, `WITHDRAWAL`, `DEPOSIT` and `ADJUSTMENT`
  movements and cash reversals** — EPIC-13; PRD §40's "cash compensating
  movement" is part of the deferred correction boundary ([[DEC-023]],
  [[TD-018]]).
- **The cash UI, cash reports and reconciliation** — EPIC-13 and EPIC-18. The
  staff POS surface consumes the read and session-open routes only.
- **A Branch, Warehouse or location dimension** — cash is tenant-wide, matching
  the stock decision.
- **Automatic retention or purge of a confirmed cash record** — PRD §41.
- **Hard delete of a register.** A register is deactivated; only sessions and
  movements carry an unconditional delete rejection.

## Audit and classification

One co-committed audit row per accepted mutation (`cash.register.created`,
`cash.session.opened`) with the actor, the record id and
`{ schemaVersion, changedFields }` carrying field names only. Reads are never
audited. Register names, amounts, statuses and the opener reference are
INTERNAL.

## Tests

- `packages/database/src/schema-cash.test.ts` — the two enums (and the six
  reserved kinds asserted absent), the three tables, the scales, the ownership
  uniques, the partial index predicate, the CHECKs, the three triggers and the
  absence of a `branch_id`.
- `apps/api/src/cash/cash.integration.test.ts` — the guard chain and the
  capability gate, the register create with its bounds and duplicate `409`, the
  session open with a zero and a non-zero opening amount, the invalid-body
  sweeps, the audit shape and the proof that the surface writes no movement,
  sale or stock row.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the EPIC-12 cash-foundation
  block, including the partial unique index proven by a rolled-back raw insert
  and by a concurrent second open, the composite foreign keys, the immutability
  triggers and the cross-tenant `404`. The applied-schema invariants were
  additionally re-proven by the parent's own rolled-back SQL probes.

## Known limitations

- No close command exists until EPIC-13, so an `OPEN` session stays open and a
  register can only be reused if that later slice closes it. Consequently a
  tenant that opens two registers at once cannot attribute a CASH sale until one
  session is closed.
- No route addresses a single session by id, so the cross-tenant `404` for a
  session is guaranteed by the composite foreign keys and the list isolation
  rather than exercised over HTTP.
- The in-memory test boundary cannot enforce the partial unique index or the
  composite foreign keys, so both are proven against real PostgreSQL.
