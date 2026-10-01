---
id: BILL-001
type: story
title: Invoice data foundation
epic: EPIC-14
status: review
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
branch: feat/epic-14-billing-invoice-foundation
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
- [[DEC-038]], [[DEC-039]], [[DEC-040]], [[DEC-042]] and [[DEC-044]] were
  accepted on 2026-10-01 by the maintainer and are binding on this Story.

## In Scope

- `Invoice`, `InvoiceLine` and `invoice_number_sequence` as tenant-scoped tables
  with `@@unique([tenantId, id])` ownership keys, RESTRICT tenant FKs and the
  composite `(tenant_id, sale_id)` / `(tenant_id, invoice_id)` FKs
  ([[DEC-038]]).
- `InvoiceStatus` with exactly `DRAFT`, `CONFIRMED` and `CANCELLED`, plus
  `UNIQUE (tenant_id, sale_id)` so one sale yields at most one invoice.
- Nullable `number` while `DRAFT` and required once `confirmed_at` is set, a
  non-null `series` defaulted to `'A'`, with
  `UNIQUE (tenant_id, series, number)` and a positive check ([[DEC-039]],
  clarified by that record's `## Subsequent scope note`).
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

- [x] `Invoice`, `InvoiceLine` and `invoice_number_sequence` exist as
      tenant-scoped tables with `@@unique([tenantId, id])` ownership keys,
      RESTRICT tenant FKs and composite `(tenant_id, sale_id)` /
      `(tenant_id, invoice_id)` FKs. Evidence: the additive migration,
      `schema-billing.test.ts` and the live-PostgreSQL `information_schema`
      probe.
- [x] `InvoiceStatus` contains exactly `DRAFT`, `CONFIRMED` and `CANCELLED`, and
      `UNIQUE (tenant_id, sale_id)` makes one sale produce at most one invoice.
      Evidence: the schema test and the live rejection probe for a second
      invoice on the same sale.
- [x] `number` is `NULL` while `DRAFT` and required once `CONFIRMED` or
      `CANCELLED`, with `UNIQUE (tenant_id, series, number)` and a positive
      check. Evidence: the biconditional `invoice_number_iff_confirmed` CHECK
      (`(number IS NULL) = (confirmed_at IS NULL)`), the
      `invoice_number_positive` CHECK and live insert probes for each branch.
      The accepted [[DEC-039]] clause is clarified by that record's
      `## Subsequent scope note`.
- [x] Database triggers reject updating or deleting a non-`DRAFT` invoice,
      reject any update of an `InvoiceLine` snapshot amount, and reject changing
      an allocated number. Evidence: `schema-billing.test.ts` and the
      live-PostgreSQL trigger probes.
- [x] The `billing.*` permission family is seeded and wired into the role
      matrix, and the seed-count probe is reconciled in the same work unit.
      Evidence: the seed diff, the updated probe count and the role-matrix
      assertion.
- [x] `fiscal.invoice.issue` is still seeded and still consumed by no route.
      Evidence: the route-contract probe pins the route inventory by exact set
      equality, so any route consuming that key would have to appear in the
      pinned inventory; no fiscal or billing route was added in this slice.
- [x] New invoice fields are classified: customer-linked invoice references are
      CONFIDENTIAL, money and status fields are INTERNAL (PRD §41). Evidence:
      the classification notes in the models and the story record.
- [x] Tenant isolation is enforced when applicable. Evidence: the
      `schema-billing.test.ts` ownership-key and RESTRICT-FK assertions, the
      live applied-schema `information_schema` probe and the conforming absence
      of any unscoped invoice table.
- [x] Backend authorization is enforced when applicable. Evidence: this Story
      adds no route, so it seeds the family and its role-matrix rows and proves
      the matrix grants `billing.read` to all six roles and the three write keys
      to `OWNER`, `ADMIN` and `CASHIER`; route enforcement is owned by
      [[BILL-002]] and [[BILL-003]].
- [ ] Required loading/error/empty/success UX exists. Evidence: not applicable
      in this story, owned by [[BILL-004]].
- [ ] Required audit exists. Evidence: not applicable in this story, which adds
      no write command; creation audit is owned by [[BILL-002]] and command
      audit by [[BILL-003]].
- [x] Tests required by the Story pass. Evidence: the schema suite, the seed
      probe, the migration application and the live applied-schema probes are
      green in the merged work unit.

## Domain Invariants

- **Invoice lines are immutable snapshots.** An `InvoiceLine` copies the sale's
  frozen `SaleLine` values verbatim; Billing performs no money arithmetic and
  trusts no caller-computed amount ([[DEC-038]]).
- **One invoice per completed sale.** The partial
  `UNIQUE (tenant_id, sale_id) WHERE status <> 'CANCELLED'` makes a sale produce
  at most one live invoice, and an invoice always originates in exactly one
  completed sale; a cancelled invoice releases its sale.
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
Applied: 20261001000001_billing_invoice_foundation
```

One additive migration creating `invoice`, `invoice_line` and
`invoice_number_sequence` with their enum, constraints and triggers. It rewrites
no existing migration and alters no existing table.

### Models/Tables

- `Invoice` (table `invoice`) — the tenant-scoped aggregate header: status,
  nullable `number`, `series` NOT NULL defaulted to `'A'`, `sale_id`, inherited
  `currency` and `customer_id`, timestamps.
- `InvoiceLine` (table `invoice_line`) — the immutable snapshot child copied
  from `sale_line`, with no independent money authority.
- `InvoiceNumberSequence` (table `invoice_number_sequence`) — one row per
  `(tenant_id, series)` holding `next_value`.
- Permission seed catalog — the four `billing.*` keys and their role-matrix
  rows.

| Guarantee                   | Implemented shape                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| Tenant scope                | RESTRICT tenant FKs and `@@unique([tenantId, id])` ownership keys                                        |
| One invoice per sale        | PARTIAL `UNIQUE (tenant_id, sale_id) WHERE status <> 'CANCELLED'`; a cancelled invoice releases its sale |
| Number only when issued     | `series` NOT NULL defaulted to `'A'`; `number` present exactly when `confirmed_at` is                    |
| Number uniqueness           | `UNIQUE (tenant_id, series, number)`                                                                     |
| Positive number             | CHECK `number > 0`                                                                                       |
| Immutable issued invoice    | Trigger rejecting UPDATE and DELETE of a non-`DRAFT` invoice                                             |
| Immutable snapshot amounts  | Trigger rejecting any UPDATE of an `InvoiceLine` amount                                                  |
| Number is never reallocated | Trigger rejecting an UPDATE of an allocated `number`                                                     |
| Sequence ownership          | `UNIQUE (tenant_id, series)` with a non-negative `next_value`                                            |
| Money precision             | NUMERIC amounts, never a float, gated by the conventions test                                            |

## UI

- None. This Story ships no UI; [[BILL-004]] owns the staff Billing surface.
- If UI is changed, confirm reusable components use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

Implemented across three work units on
`feat/epic-14-billing-invoice-foundation`, after [[DEC-038]] through [[DEC-045]]
were accepted. No route and no UI exist: this slice ships schema, migration,
seed and tests only.

- `b1d5278` — `feat(EPIC-14): add the invoice data foundation (BILL-001 W1)`
  adds the Billing section banner, `enum InvoiceStatus` (`invoice_status`:
  `DRAFT`, `CONFIRMED`, `CANCELLED`), `model Invoice`/`invoice`,
  `model InvoiceLine`/`invoice_line`, `model InvoiceNumberSequence`/
  `invoice_number_sequence`, the `Tenant`, `Sale`, `Customer`, `TaxRate` and
  `CatalogItem` back-relations, and the additive migration
  `20261001000001_billing_invoice_foundation` (one `CREATE TYPE`, three
  `CREATE TABLE`, eight indexes, eight RESTRICT FKs, five triggers).
- `64371f3` — `feat(EPIC-14): seed the billing permission family (BILL-001 W2)`
  adds the four `billing.*` keys and their role-matrix rows, catalog 52 -> 56.
- `dc9309c` —
  `test(EPIC-14): prove the invoice constraints at the live database (BILL-001 W3)`
  adds the EPIC-14 peer block to the live-PostgreSQL suite.

Two clarifications of accepted decisions were required and are recorded as
`## Subsequent scope note` sections rather than applied silently:

1. The number rule is the biconditional
   `(number IS NULL) = (confirmed_at IS NULL)` ([[DEC-039]]), so an invoice
   cancelled straight from `DRAFT` keeps a NULL number.
2. The one-invoice-per-sale uniqueness is the partial index
   `UNIQUE (tenant_id, sale_id) WHERE status <> 'CANCELLED'` ([[DEC-038]]),
   which frees a cancelled invoice's sale.

No header totals are stored on `invoice`: the total is a projection of the
immutable lines. `invoice_line` carries no `updatedAt`.

## Verification

```text
pnpm --filter @newsaas/database test
  -> 18 files / 399 tests passed
     (was 17 / 361 before W1; schema-billing.test.ts adds 38)

pnpm --filter @newsaas/database exec vitest run src/reference-seed.test.ts
  -> 27 tests passed

pnpm --filter @newsaas/api test:live-pg
  -> 134 passed (134)
     The same run reports `14 passed | 120 skipped` under -t EPIC-14,
     so the pre-slice baseline is 120 and this slice adds exactly 14.

pnpm --filter @newsaas/database db:generate
  -> passed

pnpm --filter @newsaas/database db:deploy
  -> 28 migrations found; applied exactly
     20261001000001_billing_invoice_foundation

pnpm --filter @newsaas/database db:live-verify
  -> LIVE MIGRATION VERIFICATION PASSED

pnpm typecheck
  -> 14 / 14

pnpm lint
  -> 14 / 14 tasks successful

pnpm format-check
  -> clean

Seed idempotency (throwaway database newsaas_verify_seed_w2_33045,
both db:seed runs)
  -> identical counts: roles: 6, permissions: 56, featureCodes: 12,
     plans: 1, rolePermissions: 187, planCapabilities: 12, species: 6,
     breeds: 9, taxRates: 3
```

`pnpm lint` was omitted from the W3 gate list, and running it afterwards caught
one `@typescript-eslint/no-unsafe-assignment` in the new probe: the
confirmed-row assertion compared against an object literal containing
`expect.any(Date)`, which is the only such usage in the suite. The assertion was
rewritten to the existing repository pattern
(`expect(stored[0]?.confirmed_at).toBeInstanceOf(Date)`), which is stricter and
lint-clean, and the suite was re-run. The gate is green as of the fix commit;
the miss is recorded rather than hidden because it proves lint must stay in the
per-work-unit list.

Two environment conditions are operational facts, not defects:

- `db:deploy` and `db:live-verify` fail with
  `P1012 Environment variable not found: DATABASE_URL` unless `DATABASE_URL` is
  exported from the workspace-root `.env`, which Prisma does not auto-load.
- The live-PostgreSQL suite requires a **schema-less** `DATABASE_URL`: the
  `.env` value carries `?schema=public` and the suite feeds it to `psql`, which
  aborts with `invalid URI query parameter: "schema"`. Stripping the query
  string makes it pass.

Both belong to [[TD-021]].

`db:live-verify` is not idempotent and cannot pass against the development
database, so it was run on a throwaway database `newsaas_verify_epic14_bill001`,
created and dropped inside the running container. The development database and
its rows were not touched, matching the fresh-database condition CI uses.

## Tests Added

- `packages/database/src/schema-billing.test.ts` (new, 729 lines) — **38
  tests**: the migration DDL, the enum literal set, the ownership keys, the
  RESTRICT FKs, the biconditional number CHECK, the uniqueness constraints, the
  partial sale index and the five immutability triggers.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — **14 tests** in a new peer
  block `describe("EPIC-14 billing application-path isolation")` starting at
  line 12554, insertions only (`1183 0` per `git diff --numstat`).
- `packages/database/src/schema-clinical.test.ts` — the schema-wide
  `@@unique([tenantId, id])` ownership pin `19 -> 22` plus its model list, the
  established per-epic update.
- `packages/database/src/reference-seed.test.ts` — the 27 tests of the suite
  were reconciled: `permissions: 52 -> 56` and the exact `VETERINARIAN` array
  gains `billing.read`. No other assertion was weakened.

## Known Limitations

- The Story is implemented and locally verified, but no CI receipt exists yet,
  so it stays `review` rather than `done`.
- [[DEC-038]], [[DEC-039]], [[DEC-040]], [[DEC-042]] and [[DEC-044]] were
  accepted on 2026-10-01 by the maintainer; changing one later needs a new
  decision rather than a reinterpretation during implementation. [[DEC-038]] and
  [[DEC-039]] each carry a `## Subsequent scope note` recording the two
  clarifications this slice had to make.
- `invoice_number_never_reallocated` is **defence in depth, not the load-bearing
  guard**: for a non-`DRAFT` row the alphabetically earlier
  `invoice_no_update_when_not_draft` trigger raises first, and on a `DRAFT` row
  `number` must be NULL by `invoice_number_iff_confirmed`, so the reallocation
  trigger cannot be reached through normal DML. Its live probe isolates it by
  disabling the shadowing trigger inside the same rolled-back transaction after
  asserting `tgenabled = 'D'`. The number guarantee rests primarily on the
  header immutability trigger plus the biconditional CHECK.
- `db:live-verify` is not idempotent, so the recorded run used the throwaway
  database `newsaas_verify_epic14_bill001` rather than the development database.
- The live-PostgreSQL suite requires a schema-less `DATABASE_URL`, and
  `db:deploy` / `db:live-verify` require `DATABASE_URL` exported from the
  workspace root because Prisma does not auto-load the root `.env`. Both belong
  to [[TD-021]].
- `pnpm lint` was not run in this slice; only `typecheck` and `format-check`
  were.
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
- No new technical debt was created by this slice. The shadowed
  `invoice_number_never_reallocated` trigger is defence in depth rather than
  debt: the number guarantee is already carried by
  `invoice_no_update_when_not_draft` plus `invoice_number_iff_confirmed`, and
  the extra trigger keeps a future schema change from silently opening a
  reallocation path.
- If a later slice ships a shortcut it must create a debt record rather than
  hide it.

## Decisions / ADRs

- [[DEC-038]] — invoice sourcing and aggregate shape: one invoice per completed
  sale, verbatim snapshot lines, inherited currency and customer, and
  `UNIQUE (tenant_id, sale_id)`, implemented as the partial
  `... WHERE status <> 'CANCELLED'` (see that record's
  `## Subsequent scope note`).
- [[DEC-039]] — the per-tenant `invoice_number_sequence`, `number` present
  exactly when `confirmed_at` is, `series` NOT NULL defaulted to `'A'`, and
  `UNIQUE (tenant_id, series, number)` (see that record's
  `## Subsequent scope note`).
- [[DEC-040]] — the `billing.*` family and role matrix seeded here, with route
  pinning and the entitlement gate owned by [[BILL-002]] and [[BILL-003]].
- [[DEC-042]] — fiscal boundary ownership: this Story ships a fiscal-free
  aggregate.
- [[DEC-044]] — epic scope boundaries: the deferrals this Story must not absorb.
- No ADR is required: the aggregate preserves the modular monolith, the tenancy
  model, the ledger model and the approved stack.

## Files / Modules

Implemented paths.

- `packages/database/prisma/schema.prisma` — the Billing section and the five
  back-relations (+273 lines).
- `packages/database/prisma/migrations/20261001000001_billing_invoice_foundation/migration.sql`
  (new, 362 lines).
- `packages/database/src/schema-billing.test.ts` (new, 729 lines, 38 tests).
- `packages/database/src/schema-clinical.test.ts` — the ownership pin
  `19 -> 22`.
- `packages/database/src/reference-seed.ts` (646 lines) and
  `packages/database/src/reference-seed.test.ts` (849 lines) — the `billing.*`
  family and its role-matrix rows.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the EPIC-14 peer block (14
  tests, insertions only).
- `docs/07-decisions/DEC-038-invoice-sourcing-and-aggregate-shape.md` and
  `docs/07-decisions/DEC-039-invoice-numbering-and-allocation.md` — the two
  `## Subsequent scope note` sections.
- `docs/01-roadmap/EPIC-14-Billing.md` — the epic progress entry.
- `docs/02-stories/BILL-001-invoice-data-foundation.md` — this record.

## Completion Notes

The Story is `review`, not `done`: implementation and local verification are
complete and committed on `feat/epic-14-billing-invoice-foundation`, but a CI
receipt does not exist yet.

What remains before `done`:

- a CI run of the merged work units that reproduces the recorded gates;
- `pnpm lint` over the merged work units, which this slice did not run;
- [[BILL-002]] and [[BILL-003]], which own the creation/read routes, the
  `requireCustomerForInvoice` gate, the confirm and cancel commands, number
  allocation and route-level authorization and audit;
- [[BILL-005]], which reconciles the epic's closure counters, including the new
  `28 migrations`, `56 permissions` and `134` live-PostgreSQL cases, and creates
  `docs/05-modules/Billing.md` from CI receipts.

The Story may not be marked `done` while any required gate is unverified.
