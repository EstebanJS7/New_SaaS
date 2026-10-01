---
id: BILL-001
type: story
title: Invoice data foundation
epic: EPIC-14
status: planned
priority: high
depends_on: []
prd_sections:
  - "9"
  - "10"
  - "21"
  - "22"
  - "41"
permissions:
  - billing.read
  - billing.create
  - billing.confirm
  - billing.cancel
branch:
created: 2026-10-01
updated: 2026-10-01
---

# BILL-001 — Invoice data foundation

## Objective

Create the tenant-scoped Billing data foundation PRD §21 requires, on top of the
EPIC-12 sale foundation: the `Invoice` aggregate with the `DRAFT`, `CONFIRMED`
and `CANCELLED` states, the immutable `InvoiceLine` snapshot that consumes the
sale's frozen `SaleLine` rows, the per-tenant `invoice_number_sequence`, the
schema-level state, numbering and immutability constraints, and the seeded
`billing.*` permission family. This Story ships no route and no UI.

## Context

- PRD §21 defines the three invoice states, immutable snapshot items and a
  transactional numbering sequence, and states that "Invoice is distinct from
  fiscal status"; PRD §22 keeps fiscal documents in the Fiscal domain.
- `SaleLine` (`packages/database/prisma/schema.prisma:1766`) is documented as
  "the immutable money record ... the frozen snapshot a future invoice
  consumes"; [[DEC-038]] makes this Story add the consuming side without
  recomputing any amount.
- No `Invoice`, `InvoiceLine` or `FiscalDocument` model and no invoice enum
  exist in `packages/database/prisma/schema.prisma` today, and no sequence,
  counter, `nextNumber` helper or allocation service exists anywhere in
  `packages/database` or `apps/api` ([[DEC-018]], [[DEC-027]], [[DEC-039]]).
- `fiscal.invoice.issue` has been seeded since EPIC-01 and is consumed by no
  route; [[DEC-040]] keeps it a Fiscal capability reserved for [[EPIC-15]].
- `PERMISSION_SEEDS` holds 52 entries pinned by
  `packages/database/src/reference-seed.test.ts`, and the `billing` and `fiscal`
  feature codes are already seeded against the inert `STARTER_PLAN_SEED`
  ([[DEC-040]]).
- [[DEC-038]], [[DEC-039]], [[DEC-040]], [[DEC-042]] and [[DEC-044]] are
  **proposed**, not accepted. Implementation must not start until the maintainer
  accepts or amends them.

## In Scope

- `Invoice`, `InvoiceLine` and `invoice_number_sequence` as tenant-scoped tables
  with `@@unique([tenantId, id])` ownership keys, RESTRICT tenant FKs and the
  composite `(tenant_id, sale_id)` / `(tenant_id, invoice_id)` FKs
  ([[DEC-038]]).
- `InvoiceStatus` with exactly `DRAFT`, `CONFIRMED` and `CANCELLED`, plus
  `UNIQUE (tenant_id, sale_id)` so one sale yields at most one invoice.
- Nullable `number` while `DRAFT` and required on `CONFIRMED` and `CANCELLED`, a
  non-null `series` defaulted to `'A'`, with
  `UNIQUE (tenant_id, series, number)` and a positive check ([[DEC-039]]).
- The database triggers that reject updating or deleting a non-`DRAFT` invoice,
  reject any update of an `InvoiceLine` snapshot amount, and reject changing an
  allocated number.
- The `billing.read`, `billing.create`, `billing.confirm` and `billing.cancel`
  seeds with their role-matrix rows, moving the pinned permission count 52 → 56
  ([[DEC-040]]).
- Data classification of every new field (PRD §41).
- The planned additive migration `20261001000001_billing_invoice_foundation`,
  the `schema-billing.test.ts` schema gate and the live-PostgreSQL
  applied-schema probes.
- This Story and the epic record.

## Out of Scope

- **Invoice creation, reads and creation audit** — [[BILL-002]].
- **Confirm and cancel commands, number allocation and row locking** —
  [[BILL-003]].
- **The staff Billing workspace** — [[BILL-004]].
- **Epic closure and module documentation** — [[BILL-005]].
- **Fiscal documents, fiscal status, fiscal providers, queued submission and the
  `fiscal-ui` surface** — [[EPIC-15]], [[EPIC-16]] and [[DEC-042]]. No fiscal
  column, port, queue or provider reference lands here.
- **Direct SIFEN implementation** — PRD §23 forbids implementing protocol
  details from memory.
- **Portal invoices and documents** — still deferred, with the route-contract
  probe prohibition intact ([[DEC-044]]).
- **Accounts receivable, credit ledger and invoice payment allocation** — PRD
  §19 and `docs/00-product/SCOPE.md:72`; [[DEC-044]].
- **Printed invoice rendering, PDF export and official number formatting** —
  [[DEC-018]], [[DEC-039]] and [[DEC-044]].
- **Invoice reports and dashboards** — [[EPIC-18]].
- **Email or WhatsApp invoice delivery** — [[EPIC-17]].
- **Sale reversal, stock compensation and payment refund** — [[TD-018]].
- **Multi-branch or establishment-scoped numbering series** — [[DEC-039]] fixes
  one per-tenant sequence.
- **Draft invoice editing** — [[DEC-038]] makes the invoice immutable from
  creation, so there is no `billing.update` key and no edit route.
- **Standalone or manual invoicing with no completed sale** — excluded while
  [[DEC-038]] Option A stands; Option B would be a product scope change.
- **A PRD edit.** No decision here requires one.

## Acceptance Criteria

- [ ] `Invoice`, `InvoiceLine` and `invoice_number_sequence` exist as
      tenant-scoped tables with `@@unique([tenantId, id])` ownership keys,
      RESTRICT tenant FKs and composite `(tenant_id, sale_id)` /
      `(tenant_id, invoice_id)` FKs. Evidence: the additive migration,
      `schema-billing.test.ts` and the live-PostgreSQL `information_schema`
      probe.
- [ ] `InvoiceStatus` contains exactly `DRAFT`, `CONFIRMED` and `CANCELLED`, and
      `UNIQUE (tenant_id, sale_id)` makes one sale produce at most one invoice.
      Evidence: the schema test and the live rejection probe for a second
      invoice on the same sale.
- [ ] `number` is `NULL` while `DRAFT` and required once `CONFIRMED` or
      `CANCELLED`, with `UNIQUE (tenant_id, series, number)` and a positive
      check. Evidence: the conditional CHECK plus live insert probes for each
      branch.
- [ ] Database triggers reject updating or deleting a non-`DRAFT` invoice,
      reject any update of an `InvoiceLine` snapshot amount, and reject changing
      an allocated number. Evidence: `schema-billing.test.ts` and the
      live-PostgreSQL trigger probes.
- [ ] The `billing.*` permission family is seeded and wired into the role
      matrix, and the seed-count probe is reconciled in the same work unit.
      Evidence: the seed diff, the updated probe count and the role-matrix
      assertion.
- [ ] `fiscal.invoice.issue` is still seeded and still consumed by no route.
      Evidence: the route-contract probe and a repository search.
- [ ] New invoice fields are classified: customer-linked invoice references are
      CONFIDENTIAL, money and status fields are INTERNAL (PRD §41). Evidence:
      the classification notes in the models and the story record.
- [ ] Tenant isolation is enforced when applicable. Evidence: the
      `schema-billing.test.ts` ownership-key and RESTRICT-FK assertions, the
      live applied-schema `information_schema` probe and the conforming absence
      of any unscoped invoice table.
- [ ] Backend authorization is enforced when applicable. Evidence: this Story
      adds no route, so it seeds the family and its role-matrix rows and proves
      the matrix grants `billing.read` to all six roles and the three write keys
      to `OWNER`, `ADMIN` and `CASHIER`; route enforcement is owned by
      [[BILL-002]] and [[BILL-003]].
- [ ] Required loading/error/empty/success UX exists. Evidence: not applicable
      in this story, owned by [[BILL-004]].
- [ ] Required audit exists. Evidence: not applicable in this story, which adds
      no write command; creation audit is owned by [[BILL-002]] and command
      audit by [[BILL-003]].
- [ ] Tests required by the Story pass. Evidence: the schema suite, the seed
      probe, the migration application and the live applied-schema probes are
      green in the merged work unit.

## Domain Invariants

- **Invoice lines are immutable snapshots.** An `InvoiceLine` copies the sale's
  frozen `SaleLine` values verbatim; Billing performs no money arithmetic and
  trusts no caller-computed amount ([[DEC-038]]).
- **One invoice per completed sale.** `UNIQUE (tenant_id, sale_id)` makes a sale
  produce at most one invoice, and an invoice always originates in exactly one
  completed sale.
- **A number is allocated only at confirmation.** A `DRAFT` invoice carries no
  number, and an allocated number is never released, reallocated or reused
  ([[DEC-039]]).
- **`CANCELLED` is terminal.** There is no reopen, no delete and no edit of a
  non-`DRAFT` invoice ([[DEC-043]]).
- **The invoice is fiscal-free.** Billing imports no Fiscal provider, concrete
  or otherwise, and stores no fiscal state ([[DEC-042]]).
- **Every row belongs to exactly one tenant.** Each invoice table carries a
  RESTRICT tenant FK and a composite ownership key, and tenant identity is
  server-owned.
- **Money and quantities use `Decimal`/NUMERIC**, never a float (PRD §21).
- **No confirmed record is deleted.** Correction is an explicit state
  transition, or a future compensating record, never an edit ([[DEC-043]],
  [[TD-018]]).

## API

### Added

```text
None yet
```

This Story adds no route. It seeds the permission family that [[BILL-002]] and
[[BILL-003]] pin per route, and leaves `fiscal.invoice.issue` consumed by no
route ([[DEC-040]]).

### Changed

```text
None yet
```

## Database

### Migration

```text
Planned: 20261001000001_billing_invoice_foundation
```

One additive migration creating `invoice`, `invoice_line` and
`invoice_number_sequence` with their enum, constraints and triggers. It rewrites
no existing migration and alters no existing table.

### Models/Tables

- `Invoice` (table `invoice`) — the tenant-scoped aggregate header: status,
  nullable `number` and `series`, `sale_id`, inherited `currency` and
  `customer_id`, timestamps.
- `InvoiceLine` (table `invoice_line`) — the immutable snapshot child copied
  from `sale_line`, with no independent money authority.
- `InvoiceNumberSequence` (table `invoice_number_sequence`) — one row per
  `(tenant_id, series)` holding `next_value`.
- Permission seed catalog — the four `billing.*` keys and their role-matrix
  rows.

| Guarantee                   | Planned shape                                                      |
| --------------------------- | ------------------------------------------------------------------ |
| Tenant scope                | RESTRICT tenant FKs and `@@unique([tenantId, id])` ownership keys  |
| One invoice per sale        | `UNIQUE (tenant_id, sale_id)`                                      |
| Number only when issued     | `number` NULL and `series` NULL while `DRAFT`, required afterwards |
| Number uniqueness           | `UNIQUE (tenant_id, series, number)`                               |
| Positive number             | CHECK `number > 0`                                                 |
| Immutable issued invoice    | Trigger rejecting UPDATE and DELETE of a non-`DRAFT` invoice       |
| Immutable snapshot amounts  | Trigger rejecting any UPDATE of an `InvoiceLine` amount            |
| Number is never reallocated | Trigger rejecting an UPDATE of an allocated `number`               |
| Sequence ownership          | `UNIQUE (tenant_id, series)` with a non-negative `next_value`      |
| Money precision             | NUMERIC amounts, never a float, gated by the conventions test      |

## UI

- None. This Story ships no UI; [[BILL-004]] owns the staff Billing surface.
- If UI is changed, confirm reusable components use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- `packages/database/src/schema-billing.test.ts` (planned) — the migration DDL,
  the enum literal set, the ownership keys, the RESTRICT FKs, the conditional
  number CHECK, the uniqueness constraints and the three immutability triggers.
- `packages/database/src/reference-seed.test.ts` (planned update) — the pinned
  count 52 → 56 and the `billing.*` role-matrix rows.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` (planned) — the applied-schema
  probes: the three tables, the enum order, the second-invoice rejection, the
  number branches and the trigger rejections.
- `apps/api/src/rbac/route-contract.probe.test.ts` (planned update) — the proof
  that `fiscal.invoice.issue` is still consumed by no route.

## Known Limitations

- Nothing is implemented. The Story is `planned` and every criterion is
  unchecked.
- [[DEC-038]], [[DEC-039]], [[DEC-040]], [[DEC-042]] and [[DEC-044]] are
  proposed, not accepted; implementation must not start before the maintainer
  accepts or amends them.
- The epic is fiscal-free. No fiscal document, fiscal status or fiscal
  submission exists after this Story ([[DEC-042]]), so the PRD §36 journey step
  "fiscal submission queued" is not reached by EPIC-14.
- The portal invoice and document surface stays deferred and the route-contract
  probe keeps failing on `/portal/invoices` ([[DEC-044]]).
- While [[DEC-038]] Option A stands, a tenant cannot invoice work that has no
  completed sale, and there is no standalone or manual invoice path. That is a
  recorded product limitation, not a hidden gap.
- No printable rendering or export of an invoice exists, and the human-readable
  rendering of `series` + `number` is deliberately undecided ([[DEC-039]],
  [[DEC-044]]).
- The recorded numbering guarantee is "no number is consumed before confirmation
  and `(tenant_id, series, number)` is unique", not "the issued sequence is
  gap-free under every failure mode" ([[DEC-039]]).
- The exact column list, index names and trigger names are slice-level
  implementation choices inside approved scope; the decisions fix only the
  constraint shapes recorded above.

## Technical Debt

- [[TD-018]] stays open. This Story adds no sale reversal, stock compensation,
  payment refund or compensating financial record, and the immutability triggers
  must not be read as resolving it.
- [[TD-022]] tracks the still-deferred portal invoice and document surface; it
  was created during the EPIC-14 kickoff and is kept current by [[BILL-005]]
  ([[DEC-044]]).
- No other debt is planned. If a slice ships a shortcut it must create a debt
  record rather than hide it.

## Decisions / ADRs

- [[DEC-038]] — invoice sourcing and aggregate shape: one invoice per completed
  sale, verbatim snapshot lines, inherited currency and customer, and
  `UNIQUE (tenant_id, sale_id)`.
- [[DEC-039]] — the per-tenant `invoice_number_sequence`, nullable `number` and
  `series` while `DRAFT`, and `UNIQUE (tenant_id, series, number)`.
- [[DEC-040]] — the `billing.*` family and role matrix seeded here, with route
  pinning and the entitlement gate owned by [[BILL-002]] and [[BILL-003]].
- [[DEC-042]] — fiscal boundary ownership: this Story ships a fiscal-free
  aggregate.
- [[DEC-044]] — epic scope boundaries: the deferrals this Story must not absorb.
- No ADR is required: the aggregate preserves the modular monolith, the tenancy
  model, the ledger model and the approved stack.

## Files / Modules

Planned paths; nothing below exists yet.

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20261001000001_billing_invoice_foundation/`
- `packages/database/src/schema-billing.test.ts`
- `packages/database/src/schema-conventions.test.ts`
- `packages/database/src/reference-seed.ts`
- `packages/database/src/reference-seed.test.ts`
- `apps/api/src/rbac/route-contract.probe.test.ts`
- `apps/api/test/live-pg-isolation.e2e-spec.ts`
- `docs/01-roadmap/EPIC-14-Billing.md`

## Completion Notes

_Status must remain non-done until all required gates pass._

This Story stays `planned` while nothing exists. It may not be marked `done`
before the maintainer accepts or amends the decisions this Story depends on, the
migration is applied and verified, the seed count and probes are reconciled, and
the merged work units carry their CI receipts.
