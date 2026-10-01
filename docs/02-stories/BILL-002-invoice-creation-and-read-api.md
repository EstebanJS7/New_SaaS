---
id: BILL-002
type: story
title: Invoice creation and read API
epic: EPIC-14
status: done
priority: high
depends_on:
  - BILL-001
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
  - "41"
permissions:
  - billing.read
  - billing.create
branch: feat/epic-14-billing-invoice-api
created: 2026-10-01
updated: 2026-10-01
---

# BILL-002 — Invoice creation and read API

## Objective

Deliver the Billing read and creation surface: `POST /invoices` turns exactly
one `COMPLETED` in-tenant sale into one `DRAFT` invoice whose `InvoiceLine` rows
copy the sale's frozen `SaleLine` snapshot verbatim, `GET /invoices` and
`GET /invoices/:id` expose the tenant-scoped reads, and creation is audited. The
API computes no money and accepts no caller-computed amount.

## Context

- PRD §18 states "Sale is separate from Invoice" and PRD §19 states "Invoice and
  Payment are separate concepts", so an invoice is created from a completed sale
  and never carries payment data.
- [[DEC-038]] makes the invoice always originate in one completed sale, inherit
  the sale's `currency` and `customerId`, and copy `sale_line` verbatim, with
  `requireCustomerForInvoice` gating creation.
- The typed `sales` settings namespace already declares
  `requireCustomerForInvoice` (default `false`) and no code consumes it
  (`apps/api/src/settings/registry.ts`), so this Story is the first consumer.
- [[DEC-028]] makes `customerId` nullable on the sale, so an invoice for a
  walk-in sale is only possible while the gate setting is off.
- [[DEC-040]] assigns `billing.read` and `billing.create` to this Story and
  makes the `billing` entitlement mandatory on every Billing route.
- The Billing module does not exist yet: `apps/api/src/` has no `billing/`
  directory, and `apps/api/src/rbac/route-contract.probe.test.ts` pins the route
  inventory and each route's required permission, so a new route and its key
  must land in the same slice.
- [[DEC-038]], [[DEC-040]], [[DEC-042]] and [[DEC-044]] were accepted on
  2026-10-01 by the maintainer and are binding on this Story.

## In Scope

- The new `apps/api/src/billing/` module: contract, service, repository,
  controller, DTO and integration tests.
- `POST /invoices` behind `billing.create` and the `billing` entitlement: create
  one `DRAFT` invoice from exactly one `COMPLETED` in-tenant sale.
- The verbatim `InvoiceLine` copy from the sale's frozen `SaleLine` rows, with
  the invoice inheriting the sale's `currency` and `customerId` ([[DEC-038]]).
- The `requireCustomerForInvoice` gate read through the typed settings service.
- `GET /invoices` with its planned filter and `GET /invoices/:id`, both behind
  `billing.read` and tenant-scoped.
- Stable domain error codes for a sale that is not `COMPLETED`, a sale that
  already has an invoice, and an unknown sale.
- Co-committed audit for accepted creation, with actor, tenant and invoice
  reference, and no audit row for a rejection.
- The route pins in `apps/api/src/rbac/route-contract.probe.test.ts` and the
  live-PostgreSQL isolation and application-path coverage.
- This Story and the epic record.

## Out of Scope

- **The aggregate, the constraints, the triggers and the permission seeds** —
  [[BILL-001]].
- **Confirm, cancel, number allocation and audit of those commands** —
  [[BILL-003]].
- **The staff Billing workspace** — [[BILL-004]].
- **Epic closure and module documentation** — [[BILL-005]].
- **Draft invoice editing and any `billing.update` route** — [[DEC-038]] makes
  the invoice immutable from creation, so a wrong draft is cancelled and
  rebuilt.
- **Fiscal documents, fiscal status, fiscal providers and queued submission** —
  [[EPIC-15]], [[EPIC-16]] and [[DEC-042]].
- **Portal invoices and documents** — deferred, with the route-contract probe
  prohibition intact ([[DEC-044]]).
- **Accounts receivable, credit ledger and invoice payment allocation** —
  [[DEC-044]] and `docs/00-product/SCOPE.md:72`; payments stay on the sale (PRD
  §19).
- **Printed invoice rendering, PDF export and official number formatting** —
  [[DEC-018]], [[DEC-039]] and [[DEC-044]].
- **Invoice reports and dashboards** — [[EPIC-18]].
- **Email or WhatsApp invoice delivery** — [[EPIC-17]].
- **Sale reversal, stock compensation and payment refund** — [[TD-018]].
- **Standalone or manual invoicing with no completed sale** — excluded while
  [[DEC-038]] Option A stands.
- **A schema, migration or seed change.** [[BILL-001]] ships the tables and the
  seeds; this Story consumes them.
- **A PRD edit.** No decision here requires one.

## Acceptance Criteria

- [x] `POST /invoices` creates a `DRAFT` invoice from exactly one `COMPLETED`
      in-tenant sale behind `billing.create` and the `billing` capability, and
      copies the sale's `SaleLine` snapshot verbatim. Evidence: the integration
      case asserting the copied amounts and the route permission pin.
- [x] `requireCustomerForInvoice` gates creation when the sale has no customer,
      and the gate reads the typed setting rather than raw JSON. Evidence: the
      integration case toggling the setting and the rejection case.
- [x] A sale that is not `COMPLETED`, a sale with an existing invoice, and a
      nonexistent sale each fail with their own stable domain code and persist
      nothing. Evidence: the three rejection cases plus the no-residue
      assertion.
- [x] `GET /invoices` and `GET /invoices/:id` are tenant-scoped behind
      `billing.read`; foreign identifiers are byte-equivalent `404`s. Evidence:
      the tenant-isolation integration and live-PostgreSQL cases.
- [x] The API never accepts tenant authority from body, query or route.
      Evidence: the tenant-isolation cases and the request-schema review.
- [x] Creation is audited with actor, tenant and invoice reference, and rejected
      attempts write no audit row. Evidence: the audit assertions of both
      suites.
- [x] Tenant isolation is enforced when applicable. Evidence: the
      byte-equivalent foreign/unknown invoice and sale `404` cases over real
      HTTP, and the tenant-predicated repository reads.
- [x] Backend authorization is enforced when applicable. Evidence: the
      deny-by-default route pins for `GET /invoices`, `GET /invoices/:id` and
      `POST /invoices`, plus the permission and `billing` capability sweeps.
- [x] Required loading/error/empty/success UX exists. Evidence: not applicable
      in this story, owned by [[BILL-004]].
- [x] Required audit exists. Evidence: exactly one `invoice.created` row
      co-committed with each accepted creation, carrying field NAMES only.
- [x] Tests required by the Story pass. Evidence: the integration suite, the
      route-contract probe, the live-PostgreSQL block and the repository gates
      are green in the merged work unit.

## Domain Invariants

- **Invoice lines are immutable snapshots.** An `InvoiceLine` copies the sale's
  frozen `SaleLine` values verbatim; Billing performs no money arithmetic and
  trusts no caller-computed amount ([[DEC-038]]).
- **One live invoice per completed sale.** The PARTIAL
  `UNIQUE (tenant_id, sale_id) WHERE status <> 'CANCELLED'` rejects a second
  live invoice for the same sale while a cancelled one releases its sale, and an
  invoice always originates in exactly one completed sale ([[DEC-038]]).
- **Payments stay on the sale.** No payment, cash or receivable record is read
  or written by this Story (PRD §19, [[DEC-044]]).
- **A number is allocated only at confirmation.** Creation writes no number, so
  `number` stays `NULL` while `DRAFT`; `series` is NOT NULL and defaults to
  `'A'` ([[DEC-039]]).
- **`CANCELLED` is terminal and drafts are never edited.** There is no edit,
  patch or delete route for an invoice at any status ([[DEC-038]], [[DEC-043]]).
- **The invoice is fiscal-free.** Billing imports no Fiscal provider and stores
  no fiscal state ([[DEC-042]]).
- **Tenant identity is server-owned.** No body, query or route value is treated
  as tenant authority, and a cross-tenant or unknown identifier is a
  byte-equivalent `404`.
- **Money and quantities use `Decimal`/NUMERIC**, never a float.

## API

### Added

| Route               | Permission       | Contract                                                                                                                                                                                                                                                                                                                |
| ------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /invoices`    | `billing.create` | Create one `DRAFT` invoice (`201`) from exactly one `COMPLETED` in-tenant sale. The body accepts the sale reference and nothing else; the snapshot lines, the currency, the customer and the totals are derived server-side from the sale's frozen rows. The response is an allowlisted invoice DTO with no `tenantId`. |
| `GET /invoices`     | `billing.read`   | List the tenant's invoices with the planned status filter, newest first, under an allowlisted DTO.                                                                                                                                                                                                                      |
| `GET /invoices/:id` | `billing.read`   | Read one in-tenant invoice with its snapshot lines.                                                                                                                                                                                                                                                                     |

Rejections are stable: `400` for an unknown body key or a malformed sale
reference; `403` for a missing permission or a tenant without the `billing`
capability; the shared byte-equivalent `404` for a foreign or unknown invoice or
sale; and `409` for a sale that is not `COMPLETED`, a sale that already has an
invoice, or a sale without a customer while `requireCustomerForInvoice` is on.
No `PATCH`, no `DELETE` and no generic status route exists on the surface.

### Changed

```text
None yet
```

## Database

### Migration

```text
None yet
```

This Story consumes the tables, constraints and triggers [[BILL-001]] ships, and
adds no migration of its own.

### Models/Tables

- None added. Creation writes one `Invoice` row and its `InvoiceLine` children;
  the reads are tenant-predicated queries over those tables.

## UI

- None. [[BILL-004]] owns the staff Billing surface.
- If UI is changed, confirm reusable components use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

Implemented and committed on `feat/epic-14-billing-invoice-api` across three
work units, each reviewed and approved by the RDD native review before the next
one started:

- **W1 `68d1c1c`** — the in-memory test boundary gained the `invoice`,
  `invoice_line` and `invoice_number_sequence` delegates, their registration and
  snapshot entries, and the two constraint shapes the suite asserts, so a
  Billing integration suite can boot the real `AppModule` without a database.
- **W2 `d508520`** — the `billing` module and `POST /invoices`: the entitlement
  and permission gates, one `$transaction`, the verbatim snapshot copy, the
  `catalog_item.name` description read in one query, the length guard, the
  `requireCustomerForInvoice` gate, the `P2002` → `409` translation, one
  co-committed `invoice.created` audit row and the line projections.
- **W3 `41e412b`** — `GET /invoices` with its `status` filter and
  `GET /invoices/:id`, their route pins and the live-PostgreSQL block that
  proves the application paths over real HTTP.

No migration: [[BILL-001]] shipped the tables, the triggers and the seeded
`billing.*` keys, and this Story consumes them.

## Verification

```text
pnpm --filter @newsaas/api exec vitest run src/billing/billing.integration.test.ts
  -> 19 tests passed

pnpm --filter @newsaas/api test
  -> 76 files passed | 1 skipped (77)
     1007 tests passed | 142 skipped (1135)

pnpm --filter @newsaas/api test:live-pg   (schema-less DATABASE_URL)
  -> 142 passed (142), was 135 before this Story

pnpm typecheck
  -> 14 / 14

pnpm lint
  -> 14 / 14

pnpm format-check
  -> clean

CI (pull request #89, run 36905626822)
  -> Database migrations: pass (1m3s)
  -> Lint, Typecheck, Test, Build: pass (3m37s)
     - live-PostgreSQL suite: Tests 142 passed (142)

CI (merged main, head c52b175, run 36911300059) - the merged-receipt gate
  -> Database migrations: success; 28 migrations applied to a fresh database
  -> Lint, Typecheck, Test, Build: success
  -> pull request #89 merged as c52b175
```

Two environment conditions are operational facts, not defects: `pnpm lint` and
`pnpm format-check` need nothing special, but the live-PostgreSQL suite needs
`DATABASE_URL` exported from the workspace-root `.env` **with its query string
stripped**, because the `.env` value carries `?schema=public` and the suite
feeds it to `psql`, which aborts with `invalid URI query parameter: "schema"`.
Both belong to [[TD-021]].

## Tests Added

- `apps/api/src/billing/billing.integration.test.ts` — 19 cases over the real
  `AppModule` and the in-memory boundary: the authorization and capability
  sweeps, the verbatim copy with no number and series `A`, the over-long
  description guard at 200 and 201 characters, the byte-equivalent `404` for an
  unknown and a foreign sale, the `409`s for a draft, a cancelled sale and a
  second invoice, the released sale after cancellation, the setting gate both
  ways, every invalid body, the absence of any read/PATCH/DELETE route on the
  creation slice, the shared invoice `404` constant, and the position order of
  the lines read through the real repository.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the three routes pinned in
  the exact-set inventory with their permissions, so the whole `billing` family
  is enumerated and deny-by-default.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — a new peer block with 7
  route-level cases: creation then read with the copied values and the summed
  total, the list and its `status` filter both ways, the byte-equivalent `404`s
  between a foreign and an unknown invoice id and between a foreign and an
  unknown sale, the stable `409` for a second invoice,
  `403 FEATURE_NOT_ENTITLED` in an unentitled tenant, and a no-residue count
  check after every rejection.
- `apps/api/test/support/in-memory-database.ts` — the invoice delegates, plus
  the two fidelity fixes the W1 review asked for.

## Known Limitations

- **The invoice line order is deterministic but arbitrary.** The lines are
  walked in ascending `catalogItemId` order because `SaleLine` records no order
  and `createdAt` is identical for every line of one transaction. The same sale
  always produces the same document, which is what a legal document needs, but
  the order does not reflect the order the lines were sold. [[TD-025]] records
  the fix (a `sale_line.position` column) and the backfill decision. The RDD
  native review flagged this as `R3-ORDERING-TIEBREAK`.
- **`GET /invoices` is unbounded.** It returns every invoice of the tenant with
  its lines, like the shipped sales and cash lists. A shared pagination contract
  is recorded as [[TD-026]]; capping this one surface alone would truncate
  results with no way to page past the cut. The review flagged it as
  `R4-UNBOUNDED-LIST`.
- **The settings narrowing defence is uncovered.** `requireCustomerForInvoice`
  is narrowed with a `typeof !== "boolean"` check that
  `TenantSettingsService.get` makes unreachable, because the typed service
  validates the stored namespace before returning. The same dead defence exists
  in `SalesService.resolveCurrency`, so it is kept for consistency and recorded
  rather than removed; the review raised it as `R3-SETTINGS-INVALID-UNCOVERED`.
- **An item description over 200 characters blocks invoicing.** The guard
  refuses rather than truncating, because `invoice_line.description` is
  `VarChar(200)` while `catalog_item.name` is unbounded. [[TD-024]] records the
  corrective migration.
- **No activation checks.** A customer or catalog item deactivated after the
  sale does not block invoicing, which is deliberate: a completed sale must stay
  invoiceable.
- Draft editing is unavailable ([[DEC-038]]): a wrong draft is cancelled by
  [[BILL-003]] and rebuilt from a new sale.
- While [[DEC-038]] Option A stands, a tenant cannot invoice work that has no
  completed sale.
- No fiscal state, no portal invoice read, no printed rendering and no export
  exist in this Story ([[DEC-042]], [[DEC-044]]).
- Only the `status` filter exists; there is no search, date range or sorting
  parameter.

## Technical Debt

- [[TD-024]] — `invoice_line.description` is `VarChar(200)` while
  `catalog_item.name` is unbounded, so a long name is refused instead of
  truncated. Created by this Story and assigned to the corrective slice.
- [[TD-025]] — sale lines record no order, so the invoice snapshot order is
  arbitrary. Created by this Story and assigned to the corrective slice or
  [[BILL-003]].
- [[TD-026]] — every list endpoint in the repository returns unbounded results,
  including `GET /invoices`. Created by this Story with a shared pagination
  contract as the fix.
- [[TD-018]] stays open: this Story adds no sale reversal, stock compensation,
  payment refund or compensating financial record.
- [[TD-022]] tracks the deferred portal invoice and document surface and is kept
  current by [[BILL-005]].

## Decisions / ADRs

- [[DEC-038]] — invoice sourcing and aggregate shape: created from exactly one
  completed sale, verbatim snapshot copy, inherited currency and customer, and
  the `requireCustomerForInvoice` gate.
- [[DEC-040]] — the `billing.read` and `billing.create` keys, the role matrix
  and the `billing` entitlement gate this Story enforces on every route.
- [[DEC-042]] — fiscal boundary ownership: this Story adds no fiscal column,
  import or call.
- [[DEC-044]] — epic scope boundaries: the portal, receivable, print/export,
  report and notification exclusions this Story must not absorb.
- No ADR is required: the module preserves the tenancy, authorization and API
  conventions of the shipped domains.

## Files / Modules

Implemented. Created:

- `apps/api/src/billing/billing.permissions.ts`
- `apps/api/src/billing/billing.zod.ts`
- `apps/api/src/billing/billing.dto.ts`
- `apps/api/src/billing/billing.repository.ts`
- `apps/api/src/billing/billing.service.ts`
- `apps/api/src/billing/billing.controller.ts`
- `apps/api/src/billing/billing.module.ts`
- `apps/api/src/billing/billing.integration.test.ts`

Changed:

- `apps/api/src/app.module.ts` — `BillingModule` registered before
  `PortalModule`
- `apps/api/src/rbac/route-contract.probe.test.ts` — the three routes and their
  pins
- `apps/api/test/support/in-memory-database.ts` — the invoice delegates
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the BILL-002 route block

## Completion Notes

The Story is `done`. Every acceptance criterion is checked, the module is
merged, the three routes are pinned deny-by-default in the route-contract probe,
tenant isolation is covered both against the in-memory boundary and over real
HTTP, and the local gates and the **merged** CI run are green.

Evidence of closure:

- pull request #89 merged as `c52b175`;
- run
  [`36911300059`](https://github.com/EstebanJS7/New_SaaS/actions/runs/36911300059)
  on the merged `main` at `c52b175` concluded `success` on both required checks,
  and its `migrations` job applied all **28** migrations to a fresh database;
- the slice receipt before the merge was run `36905626822`, whose `migrations`
  job reported the live-PostgreSQL suite at **142 passed**, the same number the
  local run reported;
- the QA evidence entry is recorded in `docs/10-qa/CI-EVIDENCE.md`.

What this Story deliberately does not include, so the epic does not read as
complete: [[BILL-003]] owns `confirm` and `cancel`, the atomic number allocation
and their audit, and it also owes [[TD-023]], the header guard that inspects the
status transition only. [[BILL-004]] owns the staff surface and [[BILL-005]]
reconciles the epic's closure counters and creates `docs/05-modules/Billing.md`.
[[TD-024]], [[TD-025]] and [[TD-026]] stay open.

`done` here means implementation closure for this slice only. It is **not** a
production-readiness statement: the epic stays `planned`, [[EPIC-20]] Production
Hardening remains, and the open debt ([[TD-018]], [[TD-021]] through [[TD-026]])
is untouched.
