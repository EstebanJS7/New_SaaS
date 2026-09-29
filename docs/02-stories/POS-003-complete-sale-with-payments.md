---
id: POS-003
type: story
title: Complete sale with payments
epic: EPIC-12
status: done
priority: high
depends_on:
  - POS-001
  - POS-002
  - EPIC-10
prd_sections:
  - "5"
  - "7"
  - "9"
  - "10"
  - "16"
  - "18"
  - "19"
  - "20"
  - "27"
  - "28"
  - "29"
  - "40"
  - "41"
permissions:
  - sales.complete
branch: feat/epic-12-sale-completion
created: 2026-09-27
updated: 2026-09-27
---

# POS-003 — Complete sale with payments

## Objective

Deliver PRD §18's `CompleteSale` command: one explicit, tenant-scoped, atomic
and idempotent command that validates the draft's totals, its payments and its
stock, writes the signed negative `SALE` stock movements through the [[EPIC-10]]
ledger under the ledger's serialization protocol, writes one `SALE` cash
movement for each CASH payment through the [[POS-002]] cash foundation, freezes
the line snapshot, records the PRD §19 payments, marks the sale `COMPLETED` and
writes audit — or persists nothing at all.

Payments of the six PRD §19 methods sum to the sale total exactly, with no
change, tendered amount, overpayment or customer credit modelled ([[DEC-029]]).
Idempotency uses both mechanisms of [[DEC-024]]: a persisted tenant-scoped
idempotency record and a header row lock with a conditional `DRAFT`-only
transition.

This is the epic's central command and its only stock writer. It is therefore
the slice that [[TD-016]] names as the next stock writer after EPIC-11
receiving.

## Context

- PRD §18 enumerates the atomic `Complete Sale` steps — validates totals,
  validates payments, validates stock, creates stock movements, updates stock
  balances, creates cash movements for CASH payments, marks completed, audits —
  and states "Must be idempotent".
- PRD §19 permits multiple payments per sale across the six methods and states
  that invoice and payment are separate concepts. PRD §20 defines the cash
  movement kinds and the one-`OPEN`-session rule.
- The inventory ledger is binding: `StockMovement` is the auditable source of
  truth, quantities are signed, movements are created confirmed and immutable,
  and `StockBalance` is a transactional projection with one row per
  `(tenant, item)` under a fixed `BLOCK` negative-stock policy.
- `docs/05-modules/Inventory.md` and [[TD-016]] make the serialization protocol
  mandatory for every stock writer:
  `stockSerializationLockKey(tenantId, catalogItemId)` is acquired **before**
  reading or writing `stock_balance`.
- The shipped EPIC-11 receiving command is the concurrency precedent
  ([[DEC-014]]): a header `SELECT ... FOR UPDATE` lock first, a post-lock status
  re-read, and a conditional status write as the backstop that turns a
  concurrent replay into a stable `409`.
- The stock movement enum is pinned to `ADJUSTMENT` and `PURCHASE` today; its
  comment reserves `SALE` for EPIC-12 and says it arrives additively, so the
  enum extension belongs to this Story.

## In Scope

- `packages/database/prisma/schema.prisma` — the additive `SALE` value on the
  `stock_movement_type` enum, the `Payment` model with a `payment_method` enum
  mapping the six PRD §19 methods, and the tenant-scoped idempotency record with
  its unique `(tenant, operation, key)`.
- A planned additive migration under `packages/database/prisma/migrations/`,
  plus the `packages/database/src/schema-*.test.ts` gate updates.
- `apps/api/src/sales/` — the completion command on the module established by
  [[POS-001]]: the `sales.complete` permission, the strict contract, the
  transaction, the idempotency seam, the DTO and the controller.
- The ledger integration seam: signed negative movements via the [[EPIC-10]]
  repository, the per-`(tenant, item)` advisory lock, the balance projection
  update and the co-committed audit row, all in one transaction.
- The cash integration seam: the `OPEN` session resolved server-side and one
  `SALE` movement per CASH payment through the [[POS-002]] module.
- The frozen line snapshot write and the payment-sum-equals-total validation.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the completion route and
  its permission pin.
- `packages/database/src/reference-seed.ts` — the `sales.complete` key and its
  role matrix, with the reconciled seed-count probe.
- Tenant isolation, atomicity, idempotency, immutability and validation tests,
  plus durable live-PostgreSQL evidence for the completion transaction, the CASH
  payment path and the concurrent double-complete.
- This Story and the epic record.

## Out of Scope

- **The sale aggregate, its lines and its pricing** — [[POS-001]]. This Story
  consumes the draft and freezes its snapshot.
- **The cash registers, sessions and the session-open command** — [[POS-002]].
  This Story consumes the `OPEN` session; it does not open or close one.
- **Session close, the expected/counted difference, the six remaining cash
  movement kinds, cash reversals and the cash UI** — EPIC-13.
- **Sale reversal and payment refund.** PRD §40 names "Sale
  cancellation/reversal" and "Payment refund/reversal" as core correction cases,
  but [[DEC-023]] defers them: a `COMPLETED` sale is immutable,
  `POST /sales/:id/cancel` on a completed sale stays reserved, and
  `POST /payments/:id/refund` is not implemented ([[TD-018]]).
- **Invoices, billing and invoice numbering** — EPIC-14. This Story emits no
  invoice; the frozen snapshot is what EPIC-14 later consumes.
- **Fiscal documents and fiscal providers** — EPIC-15 and EPIC-16. This Story
  makes no external call and holds no transaction open while waiting on one.
- **Change, a tendered amount, overpayment, customer credit or accounts
  receivable** — [[DEC-029]] and EPIC-14.
- **Discounts, appointment links and patient links** — [[DEC-028]].
- **Barcode/SKU item identification** — [[DEC-025]] and [[TD-019]].
- **A staff browser surface** — [[POS-004]].
- **Automatic destructive retention of idempotency rows or any confirmed
  financial record** — PRD §41 ([[TD-020]]).
- **Stock transfers and any Branch, Warehouse or location dimension.**
- **Hard delete of a sale, a line, a payment or a ledger row.**
- **A new Decision record or an ADR** — outside this Story's file surface.

## Acceptance Criteria

- [x] Completion is one explicit command, never a generic status write, and the
      only status it produces is `COMPLETED`. It ships as
      `POST /sales/:id/complete` behind `sales.complete`; no `PATCH` and no
      `DELETE` route exists on the sale, payment or cash surface.
- [x] The command validates the sale is `DRAFT`; a sale that is already
      `COMPLETED` or is `CANCELLED` is a stable `409 CONFLICT` that persists
      nothing — except an identical idempotency replay, which returns the prior
      result under the criterion below instead of a conflict.
- [x] The command is atomic: stock movements, balance updates, cash movements,
      the frozen line snapshot, the payment rows, the status change and exactly
      one audit row are co-committed in one transaction, and any rejection
      persists nothing — no movement, no balance change, no cash effect, no
      payment row, no status change and no audit row.
- [x] Each completing line creates exactly one signed **negative** `SALE`
      `StockMovement` through the [[EPIC-10]] ledger seam; no balance is mutated
      outside the ledger and no movement is created unconfirmed.
- [x] Every completion stock write acquires
      `stockSerializationLockKey(tenantId, catalogItemId)` **before** reading or
      writing `stock_balance` ([[TD-016]]), the projection equals the ledger's
      signed sum after the command, and the fixed `BLOCK` policy rejects an
      output that would drive the projection negative. The sale header row lock
      is taken first and the item advisory locks follow in ascending
      `catalogItemId` order.
- [x] The sale total is the sum of the frozen line totals and the payments sum
      to that total exactly; a payment set that does not sum exactly is rejected
      server-side before any write, and money uses `Decimal(14, 2)` with
      quantities at `Decimal(10, 3)` ([[DEC-021]], [[DEC-029]]).
- [x] A sale may carry several payments across the six PRD §19 methods (`CASH`,
      `CARD`, `BANK_TRANSFER`, `QR`, `CHECK`, `OTHER`), each recording its
      method and amount; no change, tendered amount, overpayment or customer
      credit is modelled anywhere ([[DEC-029]]).
- [x] A CASH payment requires an `OPEN` session resolved server-side inside the
      same transaction and never from the request body; a CASH payment with no
      `OPEN` session is a stable rejection that persists nothing, and each CASH
      payment writes exactly one `SALE` cash movement whose amount equals the
      CASH payment amount ([[DEC-020]]).
- [x] A completed payment is immutable and refunds stay deferred ([[DEC-023]],
      [[DEC-029]]).
- [x] Idempotency uses both mechanisms of [[DEC-024]]: (a) a tenant-scoped
      record unique per `(tenant, operation, key)` holding the request
      fingerprint and a reference to the stored result, where the same key with
      the same fingerprint returns the prior result instead of a `409` and never
      completes a second time, and the same key with a different fingerprint is
      a stable conflict; and (b) a `SELECT ... FOR UPDATE` header row lock with
      a post-lock status re-read and a conditional `WHERE status = 'DRAFT'`
      write, so a replay without a key is a stable `409` that persists nothing.
      The key scope is the tenant, never global, and the key travels through the
      `Idempotency-Key` header.
- [x] Concurrent completion attempts on the same `DRAFT` sale admit exactly one
      `201`: two attempts carrying _different_ idempotency keys, or none, leave
      the loser with a stable `409` and no second movement, second payment or
      second audit row, while two attempts carrying the _same_ key and the same
      request fingerprint both return the prior result and complete exactly
      once.
- [x] A `COMPLETED` sale and its lines and payments are immutable: no `PATCH`,
      no `DELETE`, no second completion, and a database-level delete rejection
      that keeps the record readable.
- [x] The command resolves the sale in the caller's tenant: a cross-tenant or
      unknown sale UUID is one byte-equivalent `404`, and a foreign reference
      persists nothing.
- [x] The route enforces authentication, server-side tenant context and the
      `sales.complete` permission re-asserted by the service before data access,
      plus the `sales` entitlement through `EntitlementsService.has`; a missing
      permission or a tenant without the capability is a stable `403` that
      persists nothing, and the frontend gate is UX only ([[DEC-026]]).
- [x] All request bodies are strict allowlisted contracts that reject unknown
      keys; `tenantId` is never read from body, query or route; no Prisma model
      crosses the HTTP boundary.
- [x] Completion is audited with the actor, the sale id and stable field names
      only (PRD §27); exactly one audit row is co-committed per accepted
      completion, no CONFIDENTIAL or RESTRICTED payload is logged and no payment
      detail is written into the audit metadata (PRD §41).
- [x] `stock_movement_type` gains `SALE` additively and `cash_movement_type`
      already carries `SALE` from [[POS-002]]; existing values and behavior are
      unchanged and no existing migration is rewritten.
- [x] The new permission key and role matrix are seeded, and the seed-count
      probe is reconciled: `sales.complete` is held by `OWNER`, `ADMIN` and
      `CASHIER`; this Story takes the seeded count **50 → 51** with
      `sales.complete`, inside the epic's **43 → 51** total ([[DEC-026]] and its
      2026-09-29 subsequent-scope note).
- [x] Tenant isolation tests exist for the completion path, authorization and
      validation tests cover the route, and the live-PostgreSQL suite proves
      atomicity, the signed-negative ledger effect, the CASH payment path, the
      idempotent replay, immutability and the concurrent double-complete race.
- [x] Required lint, typecheck, test, integration and build checks pass, and the
      merged branch carries its CI receipt (run `36592652167` green on both
      required checks).

## Domain Invariants

- **Completion is the sale's only stock, cash and payment effect.** A `DRAFT`
  changes nothing; completion is the single transition that writes them.
- **Stock changes only through the ledger.** A movement is inserted confirmed
  and immutable; the balance is a projection updated in the same transaction;
  the projection never goes negative under the fixed `BLOCK` policy.
- **One serialized read-modify-write per `(tenant, item)`.** Concurrent writers
  touching the same item must not lose an update; the advisory lock is the
  mechanism the ledger's correctness rests on ([[TD-016]]).
- **Cash changes only through immutable movements.** A register's expected
  amount is derived, never mutated; no balance column is written directly.
- **Payments sum exactly to the total.** There is no partial payment state, no
  change and no credit ([[DEC-029]]).
- **Completion happens at most once.** The persisted idempotency record and the
  conditional `DRAFT`-only transition together guarantee it.
- **A `COMPLETED` sale is immutable.** No edit, delete, cancel or second
  completion returns it to `DRAFT`; a correction is a future compensating
  operation, never an edit.
- **Atomicity is all-or-nothing.** A failed completion leaves no partial stock,
  no cash movement, no payment row, no orphan movement and no audit row.
- **Every write belongs to exactly one tenant.** Tenant identity comes only from
  the server-side request context; a cross-tenant UUID is a `404`.
- **Money and quantities use `Decimal`.** Never a float.

## API

### Added

```text
POST /sales/:id/complete   →   sales.complete
```

One explicit transition command on the `apps/api/src/sales/` module. It is the
only new route: no `PATCH`, no `DELETE` and no generic status write exist
anywhere on the surface. The request body is the payment set — one or more
payments, each with a PRD §19 method and an amount — under a strict allowlisted
contract; any supplied `tenantId` or `status` key is rejected as
`400 VALIDATION_FAILED`, and the optional `Idempotency-Key` header follows the
`docs/03-architecture/REVERSALS-CORRECTIONS.md` convention. A successful
completion returns the completed sale (`201`); a replay without a key and a
non-`DRAFT` sale that is not an identical idempotency replay are the stable
`409 CONFLICT`, while an identical replay returns the prior completed sale.

### Changed

```text
stock_movement_type   — gains the additive SALE value.
```

The existing inventory adjustment and EPIC-11 receiving routes and their
behavior are unchanged; only the movement-type enum gains a value.

## Database

### Migration

Planned additive migration `20260927000003_sale_completion`: one
`ALTER TYPE "stock_movement_type" ADD VALUE 'SALE'`, the `payment_method` enum,
the `payment` table and the tenant-scoped idempotency table. It alters no
existing table, rewrites no existing migration and — following the EPIC-11
receiving precedent — only appends the enum value, so the plain single-statement
form applies on the supported PostgreSQL 16. This Story creates it as its first
work unit.

### Models/Tables

- `StockMovement.type` — gains `SALE` (`stock_movement_type`). Quantity stays
  `DECIMAL(10, 3)`, signed, non-zero, immutable, with the no-delete trigger
  unchanged. A completion writes one negative `SALE` movement per line.
- `Payment` (table `payment`) — tenant-scoped child of the sale. Planned
  columns: `id`, `tenant_id`, `sale_id`, `method` (`payment_method`), `amount`
  (`DECIMAL(14,2)`), timestamps. There is deliberately no `tendered_amount`, no
  `change`, no `refunded_amount` and no customer credit column ([[DEC-029]]).
- Idempotency record (table planned, for example `idempotency_record`) —
  tenant-scoped, unique per `(tenant_id, operation, key)`, holding the request
  fingerprint and a reference to the stored result. It carries no automatic
  purge ([[DEC-024]], [[TD-020]]).

| Guarantee                | Planned shape                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| Payment methods          | `payment_method` pinned to `CASH`, `CARD`, `BANK_TRANSFER`, `QR`, `CHECK`, `OTHER`          |
| Tenant scope             | `RESTRICT` tenant FKs on the payment and idempotency tables                                 |
| Ownership is composite   | `(tenant_id, id)` unique; `payment` references `sale(tenant_id, id)` through a composite FK |
| Idempotency uniqueness   | unique `(tenant_id, operation, key)` with a fingerprint column and a result reference       |
| Positive money           | `CHECK (amount > 0)` on the payment                                                         |
| Immutable confirmed rows | A delete-rejection guarantee on a `COMPLETED` sale and its lines and payments               |

The exact table, index and constraint list is a slice-level implementation
choice inside approved scope and follows the sibling migration shapes.

## UI

- None. [[POS-004]] owns the completion flow and its distinct outcomes.
- If UI is changed later, reusable components must use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

Implemented and committed on `feat/epic-12-sale-completion` as three work units.

**D1 — data layer (`91e712d`).** The additive `SALE` value on
`stock_movement_type`, the `payment_method` enum pinned to the six PRD §19
methods, the tenant-scoped `payment` table with its positive-amount CHECK and
the two conditional delete/update triggers that read the owning sale's status,
and the tenant-scoped `idempotency_record` with its unique
`(tenant_id, operation, key)`, its 64-character fingerprint and its
`result_sale_id` reference. The additive migration
`20260927000003_sale_completion` applies it, `schema-sales.test.ts` and
`schema-inventory.test.ts` gate it (the latter now derives the effective literal
set `{ADJUSTMENT, PURCHASE, SALE}` from the creating migration plus both
additive ones), `schema-clinical.test.ts` tracks the ownership-key inventory 17
→ 19, and the `sales.complete` key moves the seeded count **50 → 51**.

**D2 — the command (`441f72b`).** `POST /sales/:id/complete` in
`apps/api/src/sales/`: the entitlement-first gate, one transaction in the order
this Story fixes — header row lock, idempotency lookup, post-lock `DRAFT` gate,
in-memory snapshot recomputation, exact payment-sum validation, reference-state
gates, the server-resolved single open session, `BLOCK`-checked ledger writes
under ascending per-item advisory locks, the cash movements, the frozen
snapshot, the payment rows, the conditional status write, the idempotency record
and exactly one audit row — plus the strict contract, the allowlisted DTO with
its payments, the two additive `SALE` widenings in the inventory ledger's type
unions, the cash seams, the in-memory tables, the route pin and a 36-test
integration suite.

**D3 — live coverage (`2bb0f6c`).** Nine cases in
`apps/api/test/live-pg-isolation.e2e-spec.ts` proving the atomic completion with
the projection equal to the ledger's signed sum, the CASH payment path, both
CASH-session rejections, the idempotent replay, the concurrent
double-completion, the applied schema claims and the cross-tenant `404`.

The story's stale seed arithmetic was corrected to the accepted [[DEC-026]]
subsequent-scope note, and [[TD-016]] carries a dated status update recording
this slice as its third compliant stock writer.

## Verification

Run by the parent on this branch, with the root env exported and a schema-less
`DATABASE_URL_TEST` so the live suite is included rather than skipped.

```text
pnpm --filter @newsaas/database test          17 files / 346 tests passed
pnpm --filter @newsaas/api test               75 files / 1049 tests passed
pnpm --filter @newsaas/api test:live-pg       99 tests passed, 0 skipped
                                              (9 are the new completion cases)
pnpm --filter @newsaas/api typecheck          clean
pnpm --filter @newsaas/api lint               clean
pnpm format-check                             green repository-wide
```

The live database after `db:deploy` + `db:seed` shows **25 migrations applied**,
`stock_movement_type` = `ADJUSTMENT, PURCHASE, SALE`, `payment_method` = the six
PRD §19 methods, `payment` with its two conditional triggers and the
`(tenant_id, operation, key)` unique on `idempotency_record`, and **51** seeded
permissions with `sales.complete` held by `OWNER`, `ADMIN` and `CASHIER` only.

Merged as pull request #80 with merge commit `dc7c429` on 2026-09-29, CI run
[`36592652167`](https://github.com/EstebanJS7/New_SaaS/actions/runs/36592652167)
green on the evaluated head `f3668f8` with both required checks passing
(`Database migrations` 1m13s, `Lint, Typecheck, Test, Build` 4m8s).

## Tests Added

Delivered; the counts below are the observed ones.

- `packages/database/src/schema-sales.test.ts` and
  `packages/database/src/schema-inventory.test.ts` — the effective additive enum
  literal set `{ADJUSTMENT, PURCHASE, SALE}` derived from the creating migration
  plus the two additive migrations, the `payment_method` enum, the payment and
  idempotency tables, the tenant composite keys, the
  `(tenant_id, operation, key)` unique and the delete-rejection guarantee.
- `apps/api/src/sales/sales.integration.test.ts` — the completion cases:
  permission and entitlement denial persisting nothing; a successful completion
  returning the completed sale with one negative `SALE` movement and projection
  per line, one cash movement per CASH payment, the frozen snapshot, the payment
  rows and exactly one audit row; a replay with and without an `Idempotency-Key`
  proving both [[DEC-024]] mechanisms; the same-key/different-fingerprint
  conflict; a payment set that does not sum exactly; a CASH payment without an
  `OPEN` session; an item that would drive the projection negative; the
  `DRAFT`-only `409`; the strict body rejecting unknown, `tenantId` and `status`
  keys; the header row lock taken before any item lock; and the absence of any
  `PATCH`/`DELETE` route.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the completion route in the
  deny-by-default survival inventory with its `sales.complete` pin.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — an EPIC-12 completion block
  against the booted AppModule and a disposable real PostgreSQL: the atomic
  completion with the projection equal to the ledger's signed sum and one audit
  row; the CASH payment path with its cash movement; the idempotent replay
  returning the prior result; the applied additive enum and the no-delete
  trigger; the byte-equivalent cross-tenant `404`; and two concurrent
  completions of the same sale under a proven header-row-lock overlap admitting
  exactly one `201` with one movement, one payment set and one audit row across
  both attempts.

## Known Limitations

- The in-memory boundary is single-threaded, so the HTTP suite pins the lock
  ordering and the loser's observable outcome but cannot prove the true
  interleaving; the live-PostgreSQL block proves the concurrent double-complete
  under a held header row lock.
- A line whose item does not track stock writes no movement and gets no stock
  validation, following the ledger's own `tracksStock` write-path gate rather
  than a rule of this command.
- The operator enters the exact amount that enters the register, so a physical
  change calculation happens outside the system ([[DEC-029]]).
- Planned: the shared in-memory boundary is single-threaded, so the HTTP suite
  can pin the lock ordering and the loser's observable outcome but cannot prove
  the true interleaving; the live-PostgreSQL block must prove the concurrent
  double-complete under a held header row lock.
- Planned: the operator enters the exact amount that enters the register, so a
  physical change calculation happens outside the system ([[DEC-029]]).

## Technical Debt

- **[[TD-016]] stays open and now records this call site.** This Story is the
  third stock writer after the adjustment and EPIC-11 receiving: it acquires
  `stockSerializationLockKey(tenantId, catalogItemId)` through the EPIC-10 seam
  before reading or writing `stock_balance`, after the sale header row lock and
  in ascending `catalogItemId` order. The record carries a dated 2026-09-29
  status update naming this slice rather than being silently closed, because the
  protocol is still a convention rather than a database-enforced guarantee.
- [[TD-018]] records the deferred sale reversal and payment refund
  ([[DEC-023]]); a mis-keyed counter sale cannot be corrected until that slice
  lands.
- [[TD-020]] records the idempotency-row retention limitation ([[DEC-024]]); PRD
  §41 forbids an automatic purge before an approved policy exists.
- No other debt record is planned.

## Decisions / ADRs

- Accepted Decision records govern this Story (accepted 2026-09-27):
  - [[DEC-020]] — the cash boundary: a CASH payment resolves the `OPEN` session
    server-side in the same transaction and writes one `SALE` movement equal to
    the CASH payment amount.
  - [[DEC-021]] — the tax arithmetic and the frozen per-line snapshot the
    completion transaction writes.
  - [[DEC-023]] — the transitions and the deferred reversal boundary: completion
    is `DRAFT -> COMPLETED` and the result is immutable.
  - [[DEC-024]] — `CompleteSale` idempotency: both the persisted record and the
    header row lock with a conditional transition.
  - [[DEC-026]] — the permission keys and the entitlement gate; this Story owns
    `sales.complete`.
  - [[DEC-029]] — payment composition and tender rules: several payments summing
    exactly, no change, overpayment or credit.
  - [[DEC-014]] — the EPIC-11 receiving precedent for the header-first lock
    order and the conditional status write, applied here as the replay backstop.
- An ADR is not expected: the command preserves the ledger, the transaction
  model and the approved stack.

## Resolutions accepted by the maintainer (2026-09-29)

Four contracts the story and its Decisions left open were confirmed before the
first write. Each is binding on this slice.

1. **Reference state is validated at completion.** An inactive catalog item or
   an inactive customer rejects the completion with a stable `409` that persists
   nothing, mirroring how [[DEC-014]] split the purchase draft from receiving:
   the draft does not check reference state and the authoritative step does.
   [[POS-001]] deliberately left this to this Story and recorded it that way.
   The item's currency is **not** re-validated, because the line was already
   priced when it joined the sale ([[DEC-022]]).
2. **Completion recomputes and writes the snapshot.** The `DRAFT` line already
   persists derived amounts (the POS-001 resolution), but completion re-derives
   `lineTotal`, `taxableBase` and `taxAmount` from the line's frozen inputs
   (`unitPrice`, `quantity`, `rateCode` against the global rate) and writes
   them, because [[DEC-021]] makes completion the step that computes and
   freezes. A `COMPLETED` sale is never recomputed again.
3. **A replay answers `200`, a fresh completion answers `201`.** Both return the
   completed sale; the status distinguishes "just completed" from "already
   completed" without changing the shape of the body ([[DEC-024]]).
4. **A CASH payment requires exactly one `OPEN` session in the tenant.** The
   sale carries no register reference and a tenant may hold several registers,
   so with more than one `OPEN` session there is no correct register to
   attribute the cash to; with none there is nowhere to attribute it. Zero open
   sessions is a stable `409` and more than one is a stable `409` that names the
   ambiguity, resolved server-side and never from the body ([[DEC-020]]). The
   movement records the session it used through `cash_movement.session_id`, so
   the attribution is auditable rather than guessed. EPIC-13's close removes the
   constraint's practical edge and [[POS-004]] is expected to surface both
   rejections as distinct outcomes.

Two further implementation choices recorded with them: the idempotency record's
result reference is the **sale id**, re-read inside the caller's tenant on
replay, rather than a stored response snapshot; and the record's `operation`
token is the stable string `sale.complete`. The idempotency lookup happens
**after** the header row lock, so a concurrent completion cannot slip between
the lookup and the write.

## Resolved by Decision

- **Replay and idempotency** — [[DEC-024]]: both the persisted idempotency
  record and the header row lock with a conditional `DRAFT`-only transition; the
  same key with the same fingerprint returns the prior result, a different
  fingerprint is a stable conflict, and a keyless replay is a stable `409`.
- **Payment composition and the exact-sum rule** — [[DEC-029]]: several payments
  across the six methods summing exactly to the total, with no change, tendered
  amount, overpayment or credit.
- **The CASH payment path** — [[DEC-020]]: an `OPEN` session resolved
  server-side, one `SALE` movement per CASH payment, and a CASH payment without
  a session rejected.
- **The snapshot and the totals validation** — [[DEC-021]]: the frozen per-line
  `rateCode`, `unitPrice`, `quantity`, `lineTotal`, `taxableBase` and
  `taxAmount`, with the total equal to the sum of the line totals.
- **Completion immutability and the correction boundary** — [[DEC-023]]: a
  `COMPLETED` sale is immutable and its correction is a future compensating
  operation.
- **Permission key and entitlement gate** — [[DEC-026]]: `sales.complete` held
  by `OWNER`, `ADMIN` and `CASHIER`, with the `sales` entitlement enforced on
  the route.
- **Lock order and the exact index and constraint list** — the header-first then
  ascending-`catalogItemId` order follows [[DEC-014]]'s precedent, and the exact
  table, index and constraint list is an implementation choice inside approved
  scope decided during the slice.

## Files / Modules

- `packages/database/prisma/schema.prisma` — the additive `SALE` stock movement
  value, the `PaymentMethod` enum, the `Payment` model and the idempotency
  record.
- `packages/database/prisma/migrations/20260927000003_sale_completion/` — the
  planned additive migration.
- `packages/database/src/schema-sales.test.ts` and
  `packages/database/src/schema-inventory.test.ts` — the planned schema gates.
- `apps/api/src/sales/` — the completion contract, service transaction,
  idempotency seam, controller and DTO.
- `apps/api/src/inventory/inventory.repository.ts` — the reused `lockItemStock`
  / `stockSerializationLockKey` seam.
- `apps/api/src/cash/` — the reused `OPEN` session resolution and movement
  write.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the route and permission
  pin.
- `packages/database/src/reference-seed.ts` — the `sales.complete` permission
  seed and matrix.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the planned durable completion
  evidence.
- `docs/08-tech-debt/TD-016-inventory-stock-serialization-protocol.md` — the
  recorded compliance call site.
- `docs/01-roadmap/EPIC-12-POS-Payments.md` — the epic record.

## Completion Notes

All twenty acceptance criteria are checked and the story is closed by the
merged, CI-backed receipt: pull request #80 merged as `dc7c429` with run
`36592652167` green on both required checks. `done` means **implementation
closure only, never production readiness**: [[TD-016]] stays open with this
slice recorded as its third compliant stock writer, [[TD-018]] keeps sale
reversal and payment refund deferred, [[TD-020]] keeps idempotency retention
unpurged, and EPIC-20 Production Hardening is untouched.

The one criterion the in-memory suite cannot prove is the true concurrent
interleaving, because the shared boundary is single-threaded; the live block
owns it. The header-before-item lock order is pinned by code order rather than
by an executable probe, because the fake models `SELECT ... FOR UPDATE` as a
plain read and records no lock ordering.
