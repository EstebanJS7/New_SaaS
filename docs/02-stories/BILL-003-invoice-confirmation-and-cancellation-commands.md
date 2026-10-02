---
id: BILL-003
type: story
title: Invoice confirmation and cancellation commands
epic: EPIC-14
status: done
priority: high
depends_on:
  - BILL-001
  - BILL-002
prd_sections:
  - "9"
  - "10"
  - "21"
  - "22"
  - "27"
  - "28"
  - "29"
  - "39"
  - "40"
  - "41"
permissions:
  - billing.confirm
  - billing.cancel
branch: feat/epic-14-billing-invoice-commands
created: 2026-10-01
updated: 2026-10-01
---

# BILL-003 — Invoice confirmation and cancellation commands

## Objective

Deliver the two explicit Billing transitions PRD §21 requires: `confirm`
allocates the invoice number from the tenant's sequence inside the same
transaction that turns a `DRAFT` into `CONFIRMED`, and `cancel` moves a `DRAFT`
or `CONFIRMED` invoice to the terminal `CANCELLED` state with a reason and
audit. Neither command touches money, stock, cash or fiscal state.

## Context

- PRD §21 requires a transactional numbering sequence and lists `CANCELLED` as
  one of the three states; PRD §27 requires audit of invoice confirm and cancel,
  and PRD §40 lists invoice cancellation among the core correction cases.
- [[DEC-039]] allocates the number at confirmation under a row lock on the
  tenant's `invoice_number_sequence` row, so allocation and the state transition
  commit together or not at all, and an abandoned draft consumes no number.
- [[DEC-041]] makes confirm payload-free and state-guarded: it requires no
  `Idempotency-Key`, emits no `InvoiceConfirmed` event, and makes a retried call
  on an already `CONFIRMED` invoice a pure no-op returning the same
  representation.
- [[DEC-043]] ships cancellation in this epic from `DRAFT` and `CONFIRMED`,
  retains the allocated number, makes `CANCELLED` terminal, and performs no
  payment, stock, cash or fiscal side effect.
- [[DEC-038]] makes the invoice immutable from creation, so these two commands
  are the only transitions on the aggregate; there is no edit and no delete.
- The repository already serializes competing writers with row locks and
  conditional writes (EPIC-12 `CompleteSale`, EPIC-13 cash close), and
  `apps/api/src/billing/` does not exist yet.
- [[DEC-039]], [[DEC-040]], [[DEC-041]], [[DEC-042]], [[DEC-043]] and
  [[DEC-044]] were accepted on 2026-10-01 by the maintainer and are binding on
  this Story.

## In Scope

- `POST /invoices/:id/confirm` behind `billing.confirm` and the `billing`
  entitlement: an invoice row lock, a `DRAFT`-only gate, the number allocation
  from `invoice_number_sequence`, the conditional state write and exactly one
  audit row, all in one transaction ([[DEC-041]]).
- `POST /invoices/:id/cancel` behind `billing.cancel`: a required reason, the
  `DRAFT` or `CONFIRMED` gate, the terminal `CANCELLED` write with its
  cancellation timestamp, the retained number and exactly one audit row
  ([[DEC-043]]).
- Replay-safety by state: a retried confirm on an already `CONFIRMED` invoice
  and a repeated cancel on an already `CANCELLED` invoice return `200` with the
  same representation and write no second audit row.
- Stable conflict codes for confirm on a `CANCELLED` invoice and for any other
  invalid transition, with no residue.
- Byte-equivalent cross-tenant `404`s, the authentication, tenant and capability
  sweeps, and the route-contract pins for both commands.
- Durable live-PostgreSQL coverage, including the concurrent-confirm row-lock
  overlap and the audit assertions.
- This Story and the epic record.

## Out of Scope

- **The aggregate, the constraints, the triggers, the sequence table and the
  permission seeds** — [[BILL-001]].
- **Creation, reads and creation audit** — [[BILL-002]].
- **The staff Billing workspace and its confirm and cancel affordances** —
  [[BILL-004]].
- **Epic closure and module documentation** — [[BILL-005]].
- **A generic status patch, an invoice edit or an invoice delete.** No `PATCH`,
  no `PUT`, no `DELETE` and no reopen route exists at any status ([[DEC-038]],
  [[DEC-043]]).
- **Draft editing** — [[DEC-038]]; a wrong draft is cancelled and rebuilt.
- **Fiscal cancellation, fiscal events, fiscal providers and queued submission**
  — [[EPIC-15]], [[EPIC-16]] and [[DEC-042]]; `REVERSALS-CORRECTIONS` delegates
  fiscal cancellation to the Fiscal domain.
- **An `InvoiceConfirmed` event, an event dispatcher wiring or a queue
  producer** — [[DEC-041]] keeps the event with [[EPIC-15]], which consumes it.
- **Payment reversal, refunds, cash compensation and stock compensation** —
  [[TD-018]] and [[DEC-043]].
- **Portal invoices and documents** — deferred ([[DEC-044]]).
- **Printed invoice rendering, PDF export and official number formatting** —
  [[DEC-018]], [[DEC-039]] and [[DEC-044]].
- **Invoice reports and dashboards** — [[EPIC-18]].
- **Email or WhatsApp invoice delivery** — [[EPIC-17]].
- **Multi-branch or establishment-scoped numbering series** — [[DEC-039]].
- **Releasing, reusing or renumbering an allocated invoice number** —
  [[DEC-039]] and [[DEC-043]].
- **A PRD edit.** No decision here requires one.

## Acceptance Criteria

- [x] `POST /invoices/:id/confirm` locks the invoice row, gates on `DRAFT`,
      allocates the number from `invoice_number_sequence` inside the same
      transaction, sets `CONFIRMED` and writes exactly one audit row. Evidence:
      the API integration case, the live-PostgreSQL case and the audit
      assertion.
- [x] Two concurrent confirms of the same invoice admit exactly one confirmation
      and allocate exactly one number; the loser observes a stable conflict or a
      replay of the same representation, never a second number. Evidence: the
      live-PostgreSQL row-lock overlap case.
- [x] A retried `confirm` on an already `CONFIRMED` invoice returns `200` with
      the same representation and writes no second audit row, and `confirm` on a
      `CANCELLED` invoice is rejected. Evidence: the replay and rejection cases
      ([[DEC-041]]).
- [x] `POST /invoices/:id/cancel` accepts a reason, gates on `DRAFT` or
      `CONFIRMED`, sets `CANCELLED`, retains the allocated number and writes
      exactly one audit row; `CANCELLED` is terminal. Evidence: the
      draft-cancel, confirmed-cancel, repeat-cancel and terminal-state cases
      ([[DEC-043]]).
- [x] Cancellation performs no payment, cash, stock or fiscal side effect, and
      the implementation contains no Fiscal import. Evidence: the no-residue
      assertions and a repository search for fiscal imports in Billing.
- [x] Both commands enforce authentication, tenant context, `billing.confirm` /
      `billing.cancel`, the `billing` capability and byte-equivalent
      cross-tenant `404`s. Evidence: the authorization sweeps and the live
      cross-tenant cases.
- [x] No route accepts a generic status patch, and no route deletes an invoice.
      Evidence: the route-contract inventory.
- [x] Tenant isolation is enforced when applicable. Evidence: the
      byte-equivalent foreign/unknown invoice `404` cases and the
      tenant-predicated locked read inside the confirm transaction.
- [x] Backend authorization is enforced when applicable. Evidence: the
      deny-by-default route pins for both commands with their permission keys,
      plus the permission and capability sweeps.
- [x] Required loading/error/empty/success UX exists. Evidence: not applicable
      in this story, owned by [[BILL-004]].
- [x] Required audit exists. Evidence: exactly one `invoice.confirmed` row per
      accepted confirmation and one `invoice.cancelled` row per accepted
      cancellation, each carrying the actor, the invoice reference and field
      NAMES only, with no audit row for a rejection or a replay.
- [x] Tests required by the Story pass. Evidence: the integration suite, the
      route-contract probe, the live-PostgreSQL block and the repository gates
      are green in the merged work unit.

## Domain Invariants

- **A number is allocated only at confirmation.** The allocation and the `DRAFT`
  → `CONFIRMED` transition commit together or not at all, and an abandoned or
  cancelled draft consumes no number ([[DEC-039]]).
- **Invoice lines are immutable snapshots.** Neither command writes an
  `InvoiceLine`; the snapshot copied at creation is never recomputed
  ([[DEC-038]]).
- **Billing performs no money arithmetic** and writes no amount ([[DEC-038]]).
- **`CONFIRMED` and `CANCELLED` are immutable.** No edit, no delete, no status
  patch and no reopen; an allocated number is never released or reused
  ([[DEC-043]]).
- **`CANCELLED` is terminal.** A cancelled invoice cannot be confirmed or
  cancelled again into a different outcome ([[DEC-043]]).
- **The commands are replay-safe by their own state gate.** No stored
  idempotency record and no `Idempotency-Key` is required for a payload-free,
  conditionally guarded transition ([[DEC-041]]).
- **No side effect leaves Billing.** Confirmation and cancellation write no
  payment, cash, stock, ledger or fiscal record ([[DEC-042]], [[DEC-043]]).
- **The invoice is fiscal-free.** Billing imports no Fiscal provider, concrete
  or otherwise, and emits no fiscal event ([[DEC-042]]).
- **Tenant identity is server-owned.** No body, query or route value is treated
  as tenant authority, and a cross-tenant or unknown identifier is a
  byte-equivalent `404`.

## API

### Added

| Route                        | Permission        | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /invoices/:id/confirm` | `billing.confirm` | Confirm one `DRAFT` in-tenant invoice (`200`). The request carries no body and requires no `Idempotency-Key`. The transaction locks the invoice row, allocates the number from the tenant sequence and returns the invoice DTO with `series`, `number`, `status: CONFIRMED` and the confirmation timestamp. A repeat on an already `CONFIRMED` invoice returns `200` with the same representation; a `CANCELLED` invoice is a stable `409`. |
| `POST /invoices/:id/cancel`  | `billing.cancel`  | Cancel one `DRAFT` or `CONFIRMED` in-tenant invoice (`200`) with a required reason. The transaction keeps the allocated number, sets `CANCELLED` and returns the invoice DTO with the cancellation timestamp. A repeat on an already `CANCELLED` invoice returns `200` with the same representation.                                                                                                                                        |

Rejections are stable: `400` for an unknown body key or a missing, blank or
malformed reason; `403` for a missing permission or a tenant without the
`billing` capability; the shared byte-equivalent `404` for a foreign or unknown
invoice; and `409` for any invalid transition, including confirm on a
`CANCELLED` invoice and a lost concurrent-confirm race. No `PATCH`, no `PUT`, no
`DELETE` and no reopen route exists on the surface.

### Changed

```text
None yet
```

## Database

### Migration

```text
None yet
```

This Story consumes the `invoice_number_sequence` table and the constraints and
triggers [[BILL-001]] ships. It adds a migration only if the maintainer accepts
[[DEC-041]] Option B, which would make `IdempotencyRecord` store an invoice
result additively and add its schema test.

### Models/Tables

- `Invoice` — the confirm write sets `series`, `number`, `status` and the
  confirmation timestamp under a conditional `DRAFT`-only update; the cancel
  write sets `status`, the cancellation timestamp and the reason under a
  `DRAFT`-or-`CONFIRMED` gate.
- `InvoiceNumberSequence` — read under `SELECT ... FOR UPDATE` and incremented
  in the same transaction as the confirmation.
- `IdempotencyRecord` — **not** touched under [[DEC-041]] Option A; touched
  additively only if the maintainer chooses Option B.

## UI

- None. [[BILL-004]] owns the staff Billing surface and its confirm and cancel
  affordances.
- If UI is changed, confirm reusable components use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

Implemented and committed on `feat/epic-14-billing-invoice-commands` across
three work units, each reviewed and approved by the RDD native review before the
next one started:

- **W1 `c384f61`** — closes [[TD-023]]: the additive migration
  `20261001000002_invoice_header_guard_tightening` replaces the guard body so a
  permitted transition can only change the columns it owns.
- **W2 `d0ef051`** — `POST /invoices/:id/confirm`: the locked read, the atomic
  `INSERT ... ON CONFLICT ... RETURNING "next_value" - 1` allocation, the
  conditional transition, the replay-by-state and one co-committed
  `invoice.confirmed` audit row.
- **W3 `16fe4ec`** — `POST /invoices/:id/cancel` plus the durable
  live-PostgreSQL command block, including the proven concurrent-confirm
  overlap.

No migration for the commands themselves: [[BILL-001]] shipped the sequence
table and the guard, and this Story drives them through the HTTP surface.

## Verification

```text
pnpm --filter @newsaas/api exec vitest run src/billing/billing.integration.test.ts
  -> 32 tests passed

pnpm --filter @newsaas/api test          (DATABASE_URL_TEST exported)
  -> 77 files passed (77), 1173 tests passed (1173)
     the live-PostgreSQL spec runs INSIDE this suite when DATABASE_URL_TEST is
     set, so nothing is skipped; without it the same command reports
     76 files / 1020 tests passed / 144 skipped

pnpm --filter @newsaas/api test:live-pg  (schema-less DATABASE_URL)
  -> 153 passed (153), was 144 before this Story

pnpm --filter @newsaas/database test
  -> 18 files / 403 tests passed (W1 added 3)

pnpm --filter @newsaas/database db:deploy
  -> 29 migrations found; applied 20261001000002_invoice_header_guard_tightening

pnpm --filter @newsaas/database db:live-verify
  -> LIVE MIGRATION VERIFICATION PASSED, on a throwaway database

pnpm typecheck / pnpm lint / pnpm format-check
  -> 14 / 14, 14 / 14, clean
```

CI (pull request #91, run 36956282465) -> Database migrations: pass (1m11s) ->
Lint, Typecheck, Test, Build: pass (4m17s)

CI (merged main, head 558fe0b, run 36956634087) - the merged-receipt gate ->
Database migrations: success; 29 migrations applied to a fresh database -> Lint,
Typecheck, Test, Build: success -> pull request #91 merged as 558fe0b

```

The live-PostgreSQL suite needs `DATABASE_URL` exported from the workspace-root
`.env` **with its query string stripped**, because the `.env` value carries
`?schema=public` and the suite feeds it to `psql`, which aborts with
`invalid URI query parameter: "schema"` ([[TD-021]]).

## Tests Added

- `apps/api/src/billing/billing.integration.test.ts` — 13 new cases over the
  real `AppModule` and the in-memory boundary: the confirmed result and the
  replayed confirm that keeps the SAME number with the counter NOT advanced, two
  invoices receiving consecutive numbers, the `CANCELLED` confirm `409`, the
  draft and confirmed cancels, the cancel replay, the five invalid cancel
  bodies, the byte-equivalent `404`s, both authorization paths, and the audit
  metadata carrying field names but never the reason text.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — 9 new route-level cases,
  including the two forced overlaps: the same-invoice concurrent confirm (one
  number, one audit row, one counter advance) and the counter-row overlap
  proving two different invoices get two distinct consecutive numbers.
- `packages/database/src/schema-billing.test.ts` — 3 cases pinning the tightened
  guard's ownership clause per column, the strict additivity of the replacement,
  and the classification prose.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the two command routes
  pinned with their permissions, completing the four-route `billing` family.

## Known Limitations

- **`confirm` and `cancel` are replay-safe by state, not by key.** A retry after
  a timeout must read the invoice back to learn the outcome; there is no
  `Idempotency-Key` and no stored idempotency record ([[DEC-041]]). The
  trade-off is deliberate: the commands carry no payload, so the state machine
  is the guard.
- **`GET /invoices` and the other staff lists are unbounded** ([[TD-026]]).
- **The invoice line order is deterministic but arbitrary** ([[TD-025]]).
- **An item description over 200 characters blocks invoicing** ([[TD-024]]).
- **No fiscal effect.** Confirmation queues no submission and emits no event;
  [[EPIC-15]] owns the interface and the consumer ([[DEC-042]]).
- **Cancelling a confirmed invoice does not reverse anything.** No payment,
  cash, stock or fiscal record is touched, and [[TD-018]] still owns payment
  refund and sale reversal ([[DEC-043]]).
- **`CANCELLED` is terminal**: no reopen, no second cancellation into a
  different outcome, and the allocated number is never released or reused.
- **`confirm` and `cancel` re-run the `billing` entitlement and permission gates
  on every call**, so a mid-flight revocation is denied at the next attempt.

## Technical Debt

- [[TD-023]] is **resolved** by this Story: the header guard now rejects a
  permitted transition that also changes `tenant_id`, `id`, `sale_id`,
  `customer_id`, `currency`, `series` or `created_at`, and cannot move
  `confirmed_at` except on `DRAFT -> CONFIRMED`.
- [[TD-024]], [[TD-025]] and [[TD-026]] stay open; they belong to the BILL-001
  and BILL-002 record and are untouched here.
- [[TD-018]] stays open: this Story adds no sale reversal, stock compensation or
  payment refund, and cancellation is not a financial correction.
- [[TD-022]] tracks the deferred portal invoice and document surface, kept
  current by [[BILL-005]].

## Decisions / ADRs

- [[DEC-038]] — the immutable-from-creation aggregate both commands transition
  without ever writing a line or an amount.
- [[DEC-039]] — the locked allocation from `invoice_number_sequence` at
  confirmation, with the number retained on cancellation.
- [[DEC-040]] — the `billing.confirm` and `billing.cancel` keys, the role matrix
  and the `billing` entitlement gate enforced on both routes.
- [[DEC-041]] — confirmation effects: payload-free, state-guarded, no
  `Idempotency-Key` and no `InvoiceConfirmed` event.
- [[DEC-042]] — fiscal boundary ownership: no Fiscal import, no fiscal call and
  no fiscal cancellation.
- [[DEC-043]] — the cancellation boundary, its state gates, its retained number
  and its terminal `CANCELLED` state.
- [[DEC-044]] — epic scope boundaries: the deferrals this Story must not absorb.
- No ADR is required: the commands preserve the transaction model, the tenancy
  model and the approved stack.

## Files / Modules

Implemented. Created:

- `packages/database/prisma/migrations/20261001000002_invoice_header_guard_tightening/migration.sql`

Changed:

- `apps/api/src/billing/billing.repository.ts` — `lockById`, `allocateNumber`,
  `markConfirmed`, `markCancelled`
- `apps/api/src/billing/billing.service.ts` — `confirmInvoice`, `cancelInvoice`
- `apps/api/src/billing/billing.controller.ts` — the two command routes
- `apps/api/src/billing/billing.zod.ts` — `cancelInvoiceBody`
- `apps/api/src/billing/billing.integration.test.ts`
- `apps/api/src/rbac/route-contract.probe.test.ts`
- `apps/api/test/support/in-memory-database.ts`
- `apps/api/test/live-pg-isolation.e2e-spec.ts`
- `packages/database/src/schema-billing.test.ts`

## Completion Notes

The Story is `done`. Every acceptance criterion is checked, the migration is
merged, the four `billing` routes are pinned deny-by-default, both commands are
replay-safe by state, the concurrency is proven by forced overlaps rather than
timing, and the local gates and the **merged** CI run are green.

Evidence of closure:

- pull request #91 merged as `558fe0b`;
- run
  [`36956634087`](https://github.com/EstebanJS7/New_SaaS/actions/runs/36956634087)
  on the merged `main` at `558fe0b` concluded `success` on both required checks,
  and its `migrations` job applied all **29** migrations to a fresh database;
- the slice receipt before the merge was run `36956282465`;
- [[TD-023]] is `resolved` by this Story;
- the QA evidence entry is recorded in `docs/10-qa/CI-EVIDENCE.md`.

What this Story deliberately does not include, so the epic does not read as
complete: [[BILL-004]] owns the staff Billing workspace and [[BILL-005]] owns the
module documentation and the epic closure. [[TD-024]], [[TD-025]], [[TD-026]] and
[[TD-018]] stay open.

`done` here means implementation closure for this slice only. It is **not** a
production-readiness statement: the epic stays `planned`, [[EPIC-20]] Production
Hardening remains, and the open debt is untouched.
```
