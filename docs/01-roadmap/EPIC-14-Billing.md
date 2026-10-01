---
id: EPIC-14
type: epic
title: Billing
status: planned
priority: high
depends_on:
  - EPIC-12
prd_sections:
  - "9"
  - "10"
  - "18"
  - "19"
  - "21"
  - "22"
  - "27"
  - "28"
  - "29"
  - "36"
  - "39"
  - "40"
  - "41"
created: 2026-10-01
updated: 2026-10-01
---

# EPIC-14 — Billing

## Objective

Deliver PRD §21 Billing on top of the EPIC-12 sale foundation: a tenant-scoped
`Invoice` aggregate with the three PRD §21 states, immutable snapshot lines
copied from the sale's frozen `SaleLine` snapshot, transactional numbering
allocated at confirmation, explicit `confirm` and `cancel` commands with audit,
and a staff Billing workspace.

EPIC-14 depends on [[EPIC-12]] POS/Payments (done) because an invoice bills a
completed sale: the epic consumes the frozen line snapshot that EPIC-12's schema
comment reserves for it and never recomputes money. It also builds on
[[EPIC-02]] for permission seeds, the role matrix and the already-seeded
`billing` feature code (PRD §10).

The epic is deliberately **fiscal-free**. PRD §21 requires that "Invoice is
distinct from fiscal status", and PRD §22 gives the Fiscal boundary, the
`FiscalDocument` aggregate and the queued submission to the Fiscal domain, which
[[EPIC-15]] builds. One consequence must be stated plainly rather than hidden:
the PRD §36 journey step "fiscal submission queued" is **not** reached when this
epic closes.

## Current state before implementation (verified 2026-10-01)

This section is a pre-implementation snapshot. Nothing in it describes
implemented EPIC-14 behavior.

- `docs/01-roadmap/ROADMAP.md:25` lists EPIC-14 Billing as `planned`, depending
  on EPIC-12 (done), and lists EPIC-15 Fiscal Abstraction and EPIC-16 Fiscal
  Third-party Adapter as `planned`, each depending on the previous one.
  [[EPIC-13]] Cash is `done`.
- No `docs/01-roadmap/EPIC-14-Billing.md`, no `BILL-*` story, no
  `docs/05-modules/Billing.md` and no Billing decision record existed before
  this kickoff; this record and [[BILL-001]]–[[BILL-005]] are new.
- `packages/database/prisma/schema.prisma` has **no** `Invoice`, `InvoiceLine`,
  `InvoiceStatus` or `FiscalDocument` model and no invoice-related enum; the
  word "invoice" appears only in comments.
- `Sale` (`schema.prisma:1705`) carries a required `currency` (`VarChar(3)`,
  server-resolved from the typed `sales.defaultCurrency` setting per
  [[DEC-022]]), a nullable `customerId` ([[DEC-028]]), `SaleStatus`
  (`DRAFT / COMPLETED / CANCELLED`) and the `@@unique([tenantId, id])` ownership
  key. `SaleLine` (`schema.prisma:1766`) is documented as "the immutable money
  record ... the frozen snapshot a future invoice consumes" and carries
  `rateCode`, `unitPrice` (`Decimal(14,2)`), `quantity` (`Decimal(10,3)`),
  `lineTotal`, `taxableBase` and `taxAmount` (all `Decimal(14,2)`).
- **No numbering infrastructure exists.** No sequence, counter, `nextNumber`
  helper or allocation service exists anywhere in `packages/database` or
  `apps/api`; [[DEC-018]] and [[DEC-027]] both verified this, and [[DEC-027]]
  assigns the transactional sequence to the Invoice.
- `fiscal.invoice.issue` ("Issue fiscal invoices") has been seeded since EPIC-01
  and is granted to `OWNER`, `ADMIN` and `CASHIER`, but **no route consumes
  it**. It is treated here as a Fiscal capability and stays reserved for
  [[EPIC-15]] ([[DEC-040]]).
- `PERMISSION_SEEDS` holds **52** entries and the seed-count probe pins exactly
  that volume (`packages/database/src/reference-seed.test.ts:743`). The
  `billing` and `fiscal` feature codes are both in the twelve
  `FEATURE_CODE_SEEDS` (`reference-seed.ts:387-388`) and both map to the inert
  `STARTER_PLAN_SEED`; no domain consumes either.
- The typed `sales` settings namespace declares `requireCustomerForInvoice`
  (default `false`) and **no code consumes it**
  (`apps/api/src/settings/registry.ts`).
- `apps/api/src/` has no `billing/` or `fiscal/` module; `apps/web/` has no
  Billing route, and `apps/web/src/components/shell/nav-sidebar.tsx` has only
  the `POS` (`requiredFeature: "sales"`) and `Cash` (`requiredFeature: "cash"`)
  entries.
- `apps/api/src/rbac/route-contract.probe.test.ts:858` actively fails the build
  if any route appears under `/portal/invoices`, `/portal/documents` or
  `/portal/files`; the portal invoice surface stays deferred ([[DEC-044]]).
- `packages/shared/src/events/dispatcher.ts` exports `createEventDispatcher()`
  but **no code under `apps/`** references it, and no worker job processor,
  queue producer or outbox table exists in `apps/` ([[DEC-041]], [[DEC-042]]).
- [[TD-018]] remains open for sale reversal and payment refund; EPIC-14 does not
  close it and emits no compensating financial record.

## Scope

- Add the tenant-scoped `Invoice` aggregate with the PRD §21 states `DRAFT`,
  `CONFIRMED` and `CANCELLED`, composite ownership keys, RESTRICT tenant FKs and
  immutability enforced at the database ([[DEC-038]]).
- Add `InvoiceLine` rows as immutable snapshots copied verbatim from the
  originating sale's frozen `SaleLine` rows; Billing performs **no** money
  arithmetic and trusts no caller-computed amount ([[DEC-038]]).
- Create one invoice per completed sale, enforced by
  `UNIQUE (tenant_id, sale_id)`, inheriting the sale's `currency` and
  `customerId`, with `requireCustomerForInvoice` gating creation ([[DEC-038]]).
- Add a per-tenant transactional invoice numbering sequence
  (`invoice_number_sequence`) allocated at confirmation under a row lock, with
  `UNIQUE (tenant_id, series, number)` and nullable `number` while `DRAFT`
  ([[DEC-039]]).
- Implement explicit, audited commands `POST /invoices/:id/confirm` and
  `POST /invoices/:id/cancel`; no generic status patch, no delete and no edit of
  a confirmed or cancelled invoice ([[DEC-041]], [[DEC-043]]).
- Seed the `billing.*` permission family, wire the role matrix and gate the
  Billing surface on the already-seeded `billing` feature code through
  `EntitlementsService.has` ([[DEC-040]]).
- Build the staff Billing workspace: invoice list and detail, create-from-sale,
  confirm and cancel, full UX state coverage and a gated navigation entry
  ([[DEC-045]]).
- Cover tenant isolation, authorization, capability gates, state transitions,
  audit, concurrency, numbering and applied-schema invariants with unit,
  integration and durable live-PostgreSQL tests.

## Out of Scope

- **Fiscal documents, fiscal status, fiscal providers, queued submission,
  retries, CDC/KuDE and the `fiscal-ui` surface** — [[EPIC-15]] and [[EPIC-16]]
  per [[DEC-042]]. Billing imports no Fiscal provider, concrete or otherwise, in
  this epic.
- **Direct SIFEN implementation** — PRD §23 forbids implementing protocol
  details from memory.
- **Portal invoices and documents** — stays deferred; the route-contract probe's
  prohibition is not removed here ([[DEC-044]]). Tracked as [[TD-022]].
- **Accounts receivable, credit ledger and invoice payment allocation** — MVP
  non-goal (`docs/00-product/SCOPE.md:72`); PRD §19 keeps payments on the sale.
- **Printed invoice rendering, PDF export and official number formatting** —
  [[DEC-018]], [[DEC-039]] and [[DEC-044]].
- **Invoice reports and dashboards** — [[EPIC-18]].
- **Email or WhatsApp invoice delivery** — [[EPIC-17]].
- **Sale reversal, payment refund and stock compensation** — [[TD-018]].
- **Multi-branch or establishment-scoped numbering series, and any branch
  hierarchy** — [[DEC-039]] fixes one per-tenant sequence.
- **Invoicing work that has no completed sale**, unless the maintainer accepts
  [[DEC-038]] Option B instead of the recommended Option A.
- **Editing or deleting a confirmed or cancelled invoice, and reusing a released
  invoice number.**
- **A PRD edit.** No decision here requires one.

## Acceptance Criteria

Nothing below is implemented; every box is unchecked. Each criterion names the
planned evidence that will close it.

### BILL-001 — Invoice data foundation

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

### BILL-002 — Invoice creation and read API

- [ ] `POST /invoices` creates a `DRAFT` invoice from exactly one `COMPLETED`
      in-tenant sale behind `billing.create` and the `billing` capability, and
      copies the sale's `SaleLine` snapshot verbatim. Evidence: the integration
      case asserting the copied amounts and the route permission pin.
- [ ] `requireCustomerForInvoice` gates creation when the sale has no customer,
      and the gate reads the typed setting rather than raw JSON. Evidence: the
      integration case toggling the setting and the rejection case.
- [ ] A sale that is not `COMPLETED`, a sale with an existing invoice, and a
      nonexistent sale each fail with their own stable domain code and persist
      nothing. Evidence: the three rejection cases plus the no-residue
      assertion.
- [ ] `GET /invoices` and `GET /invoices/:id` are tenant-scoped behind
      `billing.read`; foreign identifiers are byte-equivalent `404`s. Evidence:
      the tenant-isolation integration and live-PostgreSQL cases.
- [ ] The API never accepts tenant authority from body, query or route.
      Evidence: the tenant-isolation cases and the request-schema review.
- [ ] Creation is audited with actor, tenant and invoice reference, and rejected
      attempts write no audit row. Evidence: the audit assertions of both
      suites.

### BILL-003 — Invoice confirmation and cancellation commands

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

### BILL-004 — Staff billing surface

- [ ] Staff can list invoices with a status filter, open one invoice's detail
      with its snapshot lines and totals, create an invoice from a completed
      sale, confirm it and cancel it with a reason. Evidence: the Billing pages
      and their tests.
- [ ] The UI covers loading, empty, error, success, permission-denied and
      entitlement-denied states, and backend authorization remains the
      authority. Evidence: the state-branch coverage listed in the Story.
- [ ] The client module lives in a Billing-owned route directory behind a
      `/api/billing` proxy that allowlists only the Billing routes and forwards
      staff cookie context only. Evidence: the proxy tests and the allowlist.
- [ ] The navigation entry is gated behind the `billing` capability as far as
      the existing shell supports, with the dormant-gate limitation recorded.
      Evidence: the `requiredFeature` declaration, its visibility tests and the
      recorded limitation.
- [ ] The surface displays server-computed values as returned, performs no money
      arithmetic and shows no fiscal state. Evidence: the detail-panel tests and
      the absence of arithmetic in the client module.
- [ ] Reusable UI uses semantic design tokens only, with no Veterinary-specific
      brand literal. Evidence: the shared control classes and the `@newsaas/ui`
      primitives.
- [ ] No portal route, printable document or export is added. Evidence: the
      route-contract probe still failing on the deferred portal roots.

### BILL-005 — Epic closure and evidence

- [ ] Module documentation for Billing is created after implementation and
      describes the aggregate, commands, numbering, authorization and UI
      behavior. Evidence to produce: `docs/05-modules/Billing.md` plus its index
      entry, merged with the implementation closure.
- [ ] `docs/10-qa/CI-EVIDENCE.md`, the changelog and the roadmap status are
      updated only after the implementation stories merge with CI receipts.
      Evidence to produce: the closure branch receipt.
- [ ] Every story records migrations, endpoints, tests, limitations and any new
      technical debt before moving to `done`. Evidence to produce: story files.
- [ ] The still-deferred portal invoice surface and the absence of fiscal
      integration are recorded as explicit debt/limitation, not as silent gaps.
      Evidence to produce: the current [[TD-022]] record and the epic limitation
      list.
- [ ] The epic exits with lint, typecheck, unit, integration, live-PostgreSQL,
      build and docs checks green, or with explicit non-green/pending evidence
      recorded. Evidence to produce: CI and local command receipts.

## Stories

- [[BILL-001]] Invoice data foundation — the aggregate, the numbering sequence,
  the constraints, the immutability triggers and the `billing.*` seeds.
- [[BILL-002]] Invoice creation and read API — create-from-sale, the
  `requireCustomerForInvoice` gate, tenant-scoped reads and audit.
- [[BILL-003]] Invoice confirmation and cancellation commands — number
  allocation, state gates, row locking, audit and terminal states.
- [[BILL-004]] Staff billing surface — the Billing workspace, the proxy, the
  client module, the states and the navigation entry.
- [[BILL-005]] Epic closure and evidence — module docs, QA evidence, changelog,
  roadmap update and final status reconciliation.

## Dependencies

- [[EPIC-12]] POS/Payments (**done**) — provides `Sale`, the frozen `SaleLine`
  snapshot, the `COMPLETED` state, the audit and idempotency precedents and the
  `CompleteSale` writer this epic reads.
- [[EPIC-02]] RBAC/Entitlements/Tenant Settings (**done**) — permission seeds,
  the role matrix, the `billing` feature code and the typed settings service.
- [[DEC-038]] through [[DEC-045]] — the EPIC-14 decisions, accepted on
  2026-10-01 by the maintainer and binding on the dependent stories.
- [[TD-018]] — remains open for sale reversal and payment refund; EPIC-14 must
  not silently absorb that scope.
- [[DEC-018]], [[DEC-027]] — a sale and a purchase carry no number; the invoice
  owns the transactional sequence.

## Exit Criteria

- [ ] Every Story — [[BILL-001]], [[BILL-002]], [[BILL-003]], [[BILL-004]] and
      [[BILL-005]] — is `done` with acceptance criteria checked and evidence
      recorded.
- [ ] The Billing API exposes explicit `confirm` and `cancel` commands, with no
      generic status patch, no delete and no edit of a confirmed record.
- [ ] Tenant isolation, authorization, capability gates, audit, numbering and
      immutable-snapshot invariants are covered at the API and live-PostgreSQL
      levels, including a real concurrency case for confirm.
- [ ] The staff Billing surface covers the operational flow with documented UX
      states and semantic design-token usage.
- [ ] Module documentation, QA evidence, changelog and roadmap are current.
- [ ] Required checks are green for the merged work units, or explicit
      non-green/pending evidence is recorded.

## Decisions / ADRs

The eight EPIC-14 Decisions were accepted on 2026-10-01 by the maintainer and
are binding on the dependent stories:

- [[DEC-038]] — invoice sourcing and aggregate shape: one invoice per completed
  sale, snapshot lines copied verbatim, currency and customer inherited, and
  `requireCustomerForInvoice` gating creation.
- [[DEC-039]] — invoice numbering: a per-tenant `invoice_number_sequence` row
  allocated at confirmation with one atomic `UPDATE ... RETURNING`, `number`
  nullable while `DRAFT`, `UNIQUE (tenant_id, series, number)`.
- [[DEC-040]] — the `billing.*` permission family, the read-wide/write-to-owning
  roles matrix, the `billing` entitlement gate and the fiscal ownership of
  `fiscal.invoice.issue`.
- [[DEC-041]] — confirmation effects: payload-free and state-guarded, no
  `Idempotency-Key`, no `InvoiceConfirmed` event until a consumer exists.
- [[DEC-042]] — fiscal boundary ownership: EPIC-14 ships a fiscal-free invoice;
  [[EPIC-15]] owns the interface, the fake provider, `FiscalDocument` and the
  queued submission.
- [[DEC-043]] — cancellation boundary: `POST /invoices/:id/cancel` from `DRAFT`
  or `CONFIRMED` with a reason and audit, retaining the number, with no payment
  or fiscal reversal and a recorded hand-off to [[EPIC-15]].
- [[DEC-044]] — epic scope boundaries: the deferred portal surface (tracked by
  [[TD-022]]), the receivable/credit-ledger exclusion, print/export, reports,
  notifications and branch-series numbering each have a named owner.
- [[DEC-045]] — staff surface scope: one operational Billing workspace with full
  state coverage and no printable document.

No ADR is required: EPIC-14 preserves the modular monolith, the existing
tenancy, ledger, authorization, numbering and approved stack.

## Technical Debt

- [[TD-018]] remains open. EPIC-14 does not implement sale reversal, stock
  compensation, payment refund or any compensating financial record.
- [[TD-022]] records the **portal invoice and document surface** that EPIC-14
  leaves deferred, so the [[EPIC-08]] blocker stays visible and owned rather
  than being closed by implication ([[DEC-044]]). The record names its owner and
  its re-evaluation point after [[EPIC-15]]/[[EPIC-16]].
- If [[DEC-038]] is accepted as recommended, the inability to invoice work with
  no completed sale is a recorded product limitation, not a hidden gap.
- [[TD-021]] may still affect local root test execution without the required
  live-PostgreSQL environment variables; implementation slices must record exact
  verification behavior.
- No new technical debt beyond the above is planned. If a slice ships a shortcut
  it must create a debt record rather than hide it.
