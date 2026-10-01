---
id: BILL-003
type: story
title: Invoice confirmation and cancellation commands
epic: EPIC-14
status: planned
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
branch:
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
  [[DEC-044]] are **proposed**, not accepted. Implementation must not start
  until the maintainer accepts or amends them.

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

- [ ] `POST /invoices/:id/confirm` locks the invoice row, gates on `DRAFT`,
      allocates the number from `invoice_number_sequence` inside the same
      transaction, sets `CONFIRMED` and writes exactly one audit row. Evidence:
      the API integration case, the live-PostgreSQL case and the audit
      assertion.
- [ ] Two concurrent confirms of the same invoice admit exactly one confirmation
      and allocate exactly one number; the loser observes a stable conflict or a
      replay of the same representation, never a second number. Evidence: the
      live-PostgreSQL row-lock overlap case.
- [ ] A retried `confirm` on an already `CONFIRMED` invoice returns `200` with
      the same representation and writes no second audit row, and `confirm` on a
      `CANCELLED` invoice is rejected. Evidence: the replay and rejection cases
      ([[DEC-041]]).
- [ ] `POST /invoices/:id/cancel` accepts a reason, gates on `DRAFT` or
      `CONFIRMED`, sets `CANCELLED`, retains the allocated number and writes
      exactly one audit row; `CANCELLED` is terminal. Evidence: the
      draft-cancel, confirmed-cancel, repeat-cancel and terminal-state cases
      ([[DEC-043]]).
- [ ] Cancellation performs no payment, cash, stock or fiscal side effect, and
      the implementation contains no Fiscal import. Evidence: the no-residue
      assertions and a repository search for fiscal imports in Billing.
- [ ] Both commands enforce authentication, tenant context, `billing.confirm` /
      `billing.cancel`, the `billing` capability and byte-equivalent
      cross-tenant `404`s. Evidence: the authorization sweeps and the live
      cross-tenant cases.
- [ ] No route accepts a generic status patch, and no route deletes an invoice.
      Evidence: the route-contract inventory.
- [ ] Tenant isolation is enforced when applicable. Evidence: the
      byte-equivalent foreign/unknown invoice `404` cases and the
      tenant-predicated locked read inside the confirm transaction.
- [ ] Backend authorization is enforced when applicable. Evidence: the
      deny-by-default route pins for both commands with their permission keys,
      plus the permission and capability sweeps.
- [ ] Required loading/error/empty/success UX exists. Evidence: not applicable
      in this story, owned by [[BILL-004]].
- [ ] Required audit exists. Evidence: exactly one `invoice.confirmed` row per
      accepted confirmation and one `invoice.cancelled` row per accepted
      cancellation, each carrying the actor, the invoice reference and field
      NAMES only, with no audit row for a rejection or a replay.
- [ ] Tests required by the Story pass. Evidence: the integration suite, the
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

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- `apps/api/src/billing/billing.integration.test.ts` (planned) — the confirm
  success with its single number and audit row, the state gates, the replay
  cases, the cancel cases for both source states, the repeat cancel, the
  terminal-state rejections, the strict body contract, the permission and
  capability sweeps and the rejection no-residue assertions.
- `apps/api/src/rbac/route-contract.probe.test.ts` (planned update) — both
  commands pinned in the deny-by-default inventory with their permissions, plus
  the inventory proof that no status-patch or delete route exists.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` (planned) — the row-lock overlap
  admitting exactly one confirmation and one number, the number allocation
  inside the transaction, the byte-equivalent cross-tenant `404`, the trigger
  rejections for a non-`DRAFT` update and the audit assertions.
- `apps/api/test/support/in-memory-database.ts` (planned update) — the sequence
  and locked-read seam the in-memory boundary needs for the new commands.

## Known Limitations

- Nothing is implemented. The Story is `planned` and every criterion is
  unchecked.
- [[DEC-039]], [[DEC-040]], [[DEC-041]], [[DEC-042]], [[DEC-043]] and
  [[DEC-044]] are proposed, not accepted; implementation must not start before
  the maintainer accepts or amends them.
- A retried `confirm` is replay-safe through the state gate, not through a
  stored idempotency record ([[DEC-041]]). A client that retries after a timeout
  must read the invoice to learn the outcome.
- Confirmation holds a row lock on the tenant's `invoice_number_sequence` row
  for the duration of its transaction, so a blocked confirmation delays other
  confirmations for the same tenant and series. That serialization is intended
  and must be covered by the live concurrency case ([[DEC-039]]).
- Cancelling a `CONFIRMED` invoice does not reverse money already collected
  ([[TD-018]]) and does not cancel any fiscal document ([[EPIC-15]],
  [[DEC-042]]). Both non-effects are deliberate and must be documented rather
  than implied.
- A cancelled or confirmed invoice keeps its number and the number is never
  reused; `CANCELLED` is terminal with no reopen path ([[DEC-043]]).
- The epic does not fix the reason's length, format or whether it is trimmed;
  the slice must follow the shipped reason-validation precedent rather than
  invent a rule here.
- The epic does not state whether cancelling a `CONFIRMED` invoice writes any
  additional correction record beyond the audit row. [[DEC-043]] states only
  that cancellation performs no payment, cash, stock or fiscal side effect, so
  no compensating record is planned.
- The recorded guarantee is "no number is consumed before confirmation and
  `(tenant_id, series, number)` is unique", not "the issued sequence is gap-free
  under every failure mode" ([[DEC-039]]).

## Technical Debt

- [[TD-018]] stays open. This Story adds no sale reversal, stock compensation,
  payment refund or compensating financial record; cancellation is a state
  transition on the invoice, never a money reversal.
- [[TD-022]] tracks the still-deferred portal invoice and document surface; it
  was created during the EPIC-14 kickoff and is kept current by [[BILL-005]]
  ([[DEC-044]]).
- [[TD-021]] may still require the live-PostgreSQL environment contract for the
  concurrency case; the implementation slice must record its exact verification
  behavior rather than skipping the case silently.
- No other debt is planned. If a slice ships a shortcut it must create a debt
  record rather than hide it.

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

Planned paths; nothing below exists yet.

- `apps/api/src/billing/`
- `apps/api/src/rbac/route-contract.probe.test.ts`
- `apps/api/test/support/in-memory-database.ts`
- `apps/api/test/live-pg-isolation.e2e-spec.ts`
- `packages/database/prisma/schema.prisma` (only under [[DEC-041]] Option B)
- `packages/database/src/schema-sales.test.ts` (only under [[DEC-041]] Option B)
- `docs/01-roadmap/EPIC-14-Billing.md`

## Completion Notes

_Status must remain non-done until all required gates pass._

This Story stays `planned` while nothing exists. It may not be marked `done`
before the maintainer accepts or amends the decisions it depends on, the
concurrent-confirm concurrency case is proven against live PostgreSQL, and the
merged work units carry their CI receipts.
