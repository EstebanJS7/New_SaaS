---
id: EPIC-12
type: epic
title: POS/Payments
status: planned
priority: high
depends_on:
  - EPIC-09
  - EPIC-10
prd_sections:
  - "5"
  - "7"
  - "9"
  - "10"
  - "15"
  - "16"
  - "18"
  - "19"
  - "20"
  - "27"
  - "28"
  - "29"
  - "40"
  - "41"
created: 2026-09-27
updated: 2026-09-29
---

# EPIC-12 — POS/Payments

## Objective

Deliver PRD §18's sale lifecycle with PRD §19 payments, plus the minimum PRD §20
Cash foundation that `CompleteSale` needs: a `DRAFT` sale carrying priced lines
with a frozen tax snapshot, an explicit idempotent `CompleteSale` command that
validates totals, payments and stock, writes signed negative `SALE` stock
movements through the [[EPIC-10]] ledger under the ledger's serialization
protocol, writes the CASH movements for CASH payments through the minimal cash
ledger, marks the sale `COMPLETED` and audits — all inside one transaction.

The epic depends on [[EPIC-09]] Catalog/Taxes (done) because a sale line
references a tenant catalog item that already carries a required seeded tax
rate, and on [[EPIC-10]] Inventory (done) because completion is a stock writer:
it must go through the existing signed ledger and the `(tenant, item)`
serialization protocol instead of touching balances directly. It also builds on
[[EPIC-02]] for permission seeds, the role matrix and the already-seeded `sales`
and `cash` feature codes (PRD §10).

EPIC-12 is the first Core surface that is also an entitlement capability: the
already-seeded `sales` feature code gates the sale surface and the
already-seeded `cash` feature code gates the cash surface, each through
`EntitlementsService.has`, as recorded by [[DEC-026]] (the `cash` gate is the
2026-09-29 subsequent-scope clarification). It stops at the forward sale path.
Session close with the expected/counted difference, the six remaining cash
movement kinds, cash reversals, the full cash UI, invoices, billing, fiscal
documents and sale reversal or payment refund belong to later epics and are
explicitly out of scope here.

## Current state before implementation (verified 2026-09-27)

This section is a pre-implementation snapshot. Nothing in it describes
implemented EPIC-12 behavior.

- `docs/01-roadmap/ROADMAP.md:23-25` lists EPIC-12 POS/Payments as `planned`,
  depending on EPIC-09 and EPIC-10 (both `done`), and lists EPIC-13 Cash and
  EPIC-14 Billing as `planned`, each depending on EPIC-12.
- No `docs/01-roadmap/EPIC-12-POS-Payments.md` and no sales/POS story existed
  before this task; this record and [[POS-001]]–[[POS-005]] are new.
- `packages/database/prisma/schema.prisma` has no `Sale`, `SaleLine`, `Payment`,
  `CashRegister`, `CashSession` or `CashMovement` model and no `PaymentMethod`
  or `CashMovementType` enum.
- `StockMovementType` (`schema.prisma:1341`) holds exactly `ADJUSTMENT` and
  `PURCHASE`, and its comment (`schema.prisma:1336-1340`) reserves `SALE`, the
  `TRANSFER_*` values and the `*_REVERSAL` compensations for EPIC-12 and later,
  to be added additively then.
- `apps/api/src/` has no `sales/` or `pos/` module; the existing modules are
  `audit`, `auth`, `branding`, `catalog`, `clinical`, `common`, `config`,
  `context`, `customers`, `entitlements`, `health`, `inventory`, `patients`,
  `portal`, `purchases`, `rbac`, `scheduling`, `settings`, `suppliers` and
  `tenancy`.
- 22 migrations exist under `packages/database/prisma/migrations/`, the newest
  being `20260926000003_purchase_receiving`.
- Already available and reused, not invented: the typed `sales` tenant-settings
  namespace (`apps/api/src/settings/registry.ts:54-74`) with `defaultCurrency`
  (default `PYG`), `requireCustomerForInvoice` (default `false`),
  `requiresFeature: "sales"` and
  `requiredPermissionKey: "sales.settings.manage"`; the seeded `sales` and
  `cash` feature codes (`packages/database/src/reference-seed.ts:298-299`); the
  already-seeded `sales.settings.manage` (`reference-seed.ts:94`) and
  `cash.session.close` (`reference-seed.ts:87`) keys, neither consumed by any
  route; the `PERMISSION_SEEDS` count of exactly 43 pinned by the seed-count
  probe (`packages/database/src/reference-seed.test.ts:607`);
  `EntitlementsService.has`
  (`apps/api/src/entitlements/entitlements.service.ts:50`); the EPIC-10 ledger
  seam `InventoryRepository.lockItemStock` / `createMovement` / `findBalance` /
  `upsertBalance` with `stockSerializationLockKey`
  (`apps/api/src/inventory/inventory.repository.ts:183`); the catalog read API
  with its per-item required tax rate; and the tenant-scoped module, audit and
  RBAC precedents from EPIC-09, EPIC-10 and EPIC-11.
- Binding obligations already in force: `docs/05-modules/Inventory.md` and
  [[TD-016]] require every stock writer to acquire
  `stockSerializationLockKey(tenantId, catalogItemId)` before reading or writing
  `stock_balance`, under the fixed `BLOCK` negative-stock policy;
  `docs/03-architecture/REVERSALS-CORRECTIONS.md` fixes the explicit-command
  endpoint convention (`POST /sales/:id/cancel`, `POST /payments/:id/refund`)
  and the `Idempotency-Key` rule for sensitive commands;
  `docs/03-architecture/TENANT-SETTINGS.md` and
  `docs/03-architecture/DATA-CLASSIFICATION-RETENTION.md` govern typed settings
  and field classification.
- Product questions the PRD leaves open were closed by the ten accepted Decision
  records [[DEC-020]]–[[DEC-029]] accepted on 2026-09-27 (see "Decisions /
  ADRs"), while the implementation still does not exist.

## Progress

This section records verified implementation evidence as slices land. The epic's
`status` stays `planned` until its Exit Criteria are met.

- **[[POS-001]] Sale draft and line pricing — `done`.** Five commits on
  `feat/epic-12-sale-draft`: `b80f7e4` records the slice and its three resolved
  contracts in `odd/tasks/epic-12-pos-payments.md`, `93f7f57` adds the W1 data
  foundation, `fd73edc` adds the W2 API surface, `6ac1825` records the W1/W2
  evidence and the W3 blocker, and `d4a1e58` adds the W3 live-PostgreSQL
  coverage.
- **W1 evidence.** The additive `20260927000001_sales` migration plus the
  `Sale`/`SaleLine` models pass `pnpm --filter @newsaas/database test` (16 files
  / 293 tests), and the seed-count probe moves the permission catalog 43 → 47
  with the four `sales.*` keys.
- **W2 evidence.** `pnpm --filter @newsaas/api test` with `DATABASE_URL_TEST`
  exported passes 74 files / 998 tests, the live suite included.
- **W3 evidence.** `pnpm --filter @newsaas/api test:live-pg` passes 80 tests
  with 0 skipped, 9 of them the new EPIC-12 sale-draft isolation cases; the live
  database after `db:deploy` plus `db:seed` reports 23 applied migrations, a
  `permission` count of 47 and the planned enum, columns, foreign keys and
  delete triggers.
- **[[POS-002]] Cash register and session foundation — `done`.** Five commits on
  `feat/epic-12-cash-foundation`: `edc91b5` tracks the slice and its four
  resolutions, `7ad99f6` records those resolutions as dated decision notes,
  `9892fc1` adds the C1 data foundation, `fda5b92` adds the C2 API surface, and
  `ade5a1a` adds the C3 live-PostgreSQL coverage.
- **C1 evidence.** The additive `20260927000002_cash_foundation` migration, the
  three models and the `SALE`-only enum pass
  `pnpm --filter @newsaas/database test` (17 files / 324 tests, 30 of them the
  new `schema-cash.test.ts`), and the seed-count probe moves the permission
  catalog 47 → 50 with the three `cash.*` keys.
- **C2 evidence.** `pnpm --filter @newsaas/api test` with a schema-less
  `DATABASE_URL_TEST` passes 75 files / 1026 tests, 17 of them the new
  `cash.integration.test.ts`, and the route-contract probe pins the four cash
  routes.
- **C3 evidence.** `pnpm --filter @newsaas/api test:live-pg` passes 90 tests
  with 0 skipped, 10 of them the EPIC-12 cash-foundation cases; the live
  database after `db:deploy` plus `db:seed` reports 24 applied migrations, a
  `permission` count of 50, the partial unique index
  `cash_session_one_open_per_register_key`, seven `RESTRICT` foreign keys and
  three triggers.
- **Merged, in order.** PR #76 (epic scope documentation) merged into `main` as
  the merge commit `14f23bc` on 2026-09-29 with CI run `36498156543` green on
  head `72fb85f`; PR #77 (POS-001 sale draft) merged as `6ef1896` on 2026-09-29
  with CI run `36513245839` green on the evaluated head `f21aaad`; and PR #78
  (POS-002 cash foundation) merged as `0d583e6` on 2026-09-29 with CI run
  `36521067733` green on the evaluated head `3d141c2`.
- **[[POS-001]] and [[POS-002]] are `done`.** Each Story closed on its merged,
  CI-backed receipt: every acceptance criterion is checked, the local gates
  passed and the branch's CI run is green on both required checks. `done` means
  implementation closure only, never production readiness. [[POS-002]]'s
  applied-schema invariants were additionally re-proven by the parent's own
  rolled-back SQL probes against the live database, with zero residue.
- **[[POS-003]] Complete sale with payments — implemented, `in-progress`.**
  Three commits on `feat/epic-12-sale-completion`: `91e712d` adds the D1 data
  layer, `441f72b` adds the D2 completion command, and `2bb0f6c` adds the D3
  live-PostgreSQL coverage. The story is `in-progress` and flips to `done` in a
  closure commit after its pull request merges and its CI receipt exists.
- **D1 evidence.** The additive `20260927000003_sale_completion` migration — the
  `SALE` value on `stock_movement_type`, the `payment_method` enum, the
  `payment` table and the tenant-scoped `idempotency_record` — passes
  `pnpm --filter @newsaas/database test` (17 files / 346 tests), the effective
  enum literal set is derived as `{ADJUSTMENT, PURCHASE, SALE}` from the
  creating migration plus both additive ones, and the seed-count probe moves the
  catalog 50 → 51 with `sales.complete`.
- **D2 evidence.** `pnpm --filter @newsaas/api test` with a schema-less
  `DATABASE_URL_TEST` passes 75 files / 1049 tests, 36 of them the sales suite
  including the completion cases; the route-contract probe pins
  `POST /sales/:id/complete` to `sales.complete`; and the two additive `SALE`
  widenings in the inventory ledger's type unions are the only edits to that
  module.
- **D3 evidence.** `pnpm --filter @newsaas/api test:live-pg` passes 99 tests
  with 0 skipped, 9 of them the completion cases: the atomic completion with the
  projection equal to the ledger's signed sum, the CASH payment path, both
  CASH-session rejections, the idempotent replay, the concurrent
  double-completion, the applied schema claims and the cross-tenant `404`. The
  live database reports 25 applied migrations, a `permission` count of 51, the
  additive enum, the two new tables with their constraints and the two
  conditional `payment` triggers.
- **[[TD-016]] records this call site without closing it.** The completion
  command is the third compliant stock writer; the debt stays open because the
  serialization protocol is still a convention rather than a database-enforced
  guarantee.
- **[[POS-004]] and [[POS-005]] remain `planned`.** No staff surface and no epic
  closure work has started.
- Root `pnpm test` fails in a local environment without `DATABASE_URL_TEST` for
  the pre-existing [[TD-021]] reason; CI is unaffected.

## Scope

- A tenant-scoped `Sale` aggregate with a `sale_status` enum pinned to `DRAFT`,
  `COMPLETED` and `CANCELLED` (PRD §18), and `SaleLine` child rows that carry a
  priced unit, an explicit quantity and a frozen tax snapshot ([[DEC-021]],
  [[DEC-022]]).
- The `DRAFT` lifecycle: create, edit and cancel a draft with no stock, cash or
  payment effect, and exactly the two `DRAFT` transitions `DRAFT -> COMPLETED`
  and `DRAFT -> CANCELLED` ([[DEC-023]]).
- The minimum PRD §20 Cash foundation that `CompleteSale` needs: tenant-scoped
  `CashRegister`, `CashSession` and `CashMovement`, a `CashMovementType` enum
  extended additively with `SALE` only, one `OPEN` session per register enforced
  by a partial unique index, a minimal register-create command and a minimal
  session-open command ([[DEC-020]]).
- An explicit idempotent `CompleteSale` command that atomically validates the
  draft, the totals, the payments and the stock, writes signed negative `SALE`
  stock movements through the EPIC-10 ledger under the `(tenant, item)`
  serialization protocol, writes the cash movement for each CASH payment,
  freezes the line snapshot, marks the sale `COMPLETED` and writes audit — or
  persists nothing ([[DEC-021]], [[DEC-024]], [[DEC-029]]).
- PRD §19 payments: several payments per sale across the six methods, summing to
  the sale total exactly, written only by the completion command ([[DEC-029]]).
- The staff POS surface: the browser transport, the item search, the line editor
  and the completion flow with its distinct outcomes, using semantic design
  tokens only.
- Granular permission keys and a seeded role matrix — `sales.read`,
  `sales.create`, `sales.update`, `sales.cancel`, `sales.complete`, `cash.read`,
  `cash.register.create` and `cash.session.open` — with the `sales` capability
  gate on the sale routes and the `cash` capability gate on the cash routes,
  moving the seeded count 43 → 47 (POS-001) → 50 (POS-002) → 51 (POS-003)
  ([[DEC-026]]).
- The additive enum values this epic adds: `SALE` on `stock_movement_type` and
  `SALE` on `cash_movement_type`.
- Tests: tenant isolation for every new private aggregate, authorization,
  validation and atomicity coverage, plus durable live-PostgreSQL evidence for
  the completion transaction, the CASH payment path and the concurrent
  double-complete.
- Module documentation for the new domains, the changelog entry and the roadmap
  status update at closure ([[POS-005]]).

## Out of Scope

- **Session close and the expected/counted difference, the six remaining cash
  movement kinds (`REFUND`, `INCOME`, `EXPENSE`, `WITHDRAWAL`, `DEPOSIT`,
  `ADJUSTMENT`), cash reversals and the full cash UI** — EPIC-13 Cash. The
  boundary is narrowed by [[DEC-020]]: EPIC-13 keeps close, the difference, the
  other movement kinds and the UI.
- **Invoices, billing, invoice numbering and invoice confirmation or
  cancellation** — EPIC-14. A sale emits no invoice and is separate from one
  (PRD §18).
- **Fiscal documents, fiscal provider calls or fiscal cancellation** — EPIC-15
  and EPIC-16. This epic makes no external call.
- **Sale reversal and payment refund.** PRD §40 names "Sale
  cancellation/reversal" and "Payment refund/reversal" as core correction cases,
  but EPIC-12 ships no reversal or refund command ([[DEC-023]], [[TD-018]]). A
  `COMPLETED` sale is immutable; `POST /sales/:id/cancel` on a completed sale
  and `POST /payments/:id/refund` stay reserved conventions.
- **Barcode/SKU item codes.** PRD §18 asks for a scanner-optimized POS, but the
  catalog has no SKU or barcode column (`schema.prisma:1286`) and [[DEC-025]]
  defers the column ([[TD-019]]). The POS resolves items by name.
- **Discounts of any kind** — no percentage, amount or reason field
  ([[DEC-028]]). The line-level price override from [[DEC-022]] is the only
  price adjustment.
- **Appointment or patient links on a sale** — the sale has no `appointmentId`
  and no `patientId` and never touches Scheduling or clinical records
  ([[DEC-028]]).
- **A human-readable sale number, ticket printing or any numbering sequence** —
  [[DEC-027]]; numbering belongs to the Invoice (PRD §21).
- **Reports, dashboards and low-stock thresholds** — EPIC-18.
- **Imports** — EPIC-19.
- **Stock transfers and any Branch, Warehouse or location dimension.** Stock and
  cash stay tenant-wide.
- **POS offline mode, a local queue or background sync.** The POS requires the
  API.
- **Automatic destructive retention of idempotency rows or any confirmed
  financial record** — PRD §41 forbids it before an approved policy exists
  ([[DEC-024]], [[TD-020]]).
- **Hard delete of any sale, sale line, payment, cash register, cash session or
  ledger row.**

## Deferred / future dependencies

- **Sale reversal and payment refund** — [[DEC-023]] defers them out of EPIC-12.
  A `COMPLETED` sale is immutable and a mis-keyed counter sale cannot be
  corrected in product until the owning slice lands the compensating movements,
  the reason, the idempotency and the audit. Recorded as [[TD-018]].
- **Barcode/SKU item identification** — [[DEC-025]] defers the catalog column,
  so a scanner can only type into the name search field. Recorded as [[TD-019]];
  an additive optional per-tenant-unique `barcode` column would close it.
- **Idempotency-row retention** — [[DEC-024]] persists idempotency records with
  no cleanup, and PRD §41 forbids automatic destructive retention until an
  approved policy exists. Recorded as [[TD-020]].
- **The EPIC-13 Cash boundary** is narrowed by [[DEC-020]]: EPIC-13 keeps
  session close with the expected/counted difference, the six remaining movement
  kinds, cash reversals and refunds, and the full cash UI, and must extend the
  cash model additively rather than introduce a second one.
- **Purchase reversal** (PRD §40, referenced by [[DEC-015]]) remains a separate
  future dependency of [[EPIC-11]] and is untouched here.

## Acceptance Criteria

Nothing below is implemented; every box is unchecked. Each criterion names the
evidence that will close it.

### POS-001 — Sale draft and line pricing

- [ ] A `DRAFT` sale with priced lines is tenant-scoped with a tenant composite
      ownership key and a `RESTRICT` tenant foreign key, and a cross-tenant or
      unknown sale UUID is one byte-equivalent `404`. Evidence to produce: the
      cross-tenant block of the [[POS-001]] live-PostgreSQL case and the shared
      `404` assertion in its integration suite.
- [ ] The sale status enum is exactly `DRAFT`, `COMPLETED`, `CANCELLED`; there
      is no `PATCH` and no `DELETE` route on the sale surface, and `CANCELLED`
      is reachable only through an explicit `DRAFT`-guarded cancel command.
      Evidence to produce: the enum gate and the route-inventory probe in
      [[POS-001]].
- [ ] Each line carries the immutable snapshot `rateCode`, `unitPrice`,
      `quantity`, `lineTotal`, `taxableBase` and `taxAmount`, tax-included with
      half-up per-line rounding, money at `Decimal(14, 2)` and quantities at
      `Decimal(10, 3)`. Evidence to produce: the arithmetic unit cases pinning
      `EXEMPT`, `IVA_5` and `IVA_10` in [[POS-001]].
- [ ] The unit price is overridable per line and the sale currency is resolved
      server-side from `sales.defaultCurrency`, never from the request body; an
      item whose reference currency differs from the sale currency is a stable
      error and no conversion occurs. Evidence to produce: the pricing and
      currency cases of [[POS-001]].
- [ ] `customerId` is optional and resolved in-tenant, and the aggregate carries
      no discount, no `appointmentId` and no `patientId`. Evidence to produce:
      the absence assertions and the optional-customer case of [[POS-001]].

### POS-002 — Cash register and session foundation

- [ ] `CashRegister`, `CashSession` and `CashMovement` are tenant-scoped with
      tenant composite ownership keys, and a cross-tenant or unknown id is one
      byte-equivalent `404`. Evidence to produce: the isolation block of
      [[POS-002]].
- [ ] "Only one OPEN session per register" is enforced in the database by a
      partial unique index, not by application convention, and a concurrent
      second open is rejected by the database. Evidence to produce: the
      concurrent open case of [[POS-002]].
- [ ] `CashMovementType` gains `SALE` additively only, and the six remaining PRD
      §20 kinds stay reserved for EPIC-13; the already-seeded
      `cash.session.close` key is consumed by no EPIC-12 route. Evidence to
      produce: the additive enum gate and the route inventory of [[POS-002]].
- [ ] The minimal register-create and session-open commands and the cash read
      routes enforce authentication, server-side tenant context, permission
      (`cash.register.create` / `cash.session.open` / `cash.read`) and the
      `cash` capability, and no `PATCH` or `DELETE` route exists on cash
      records. Evidence to produce: the authorization and route-contract pins of
      [[POS-002]].

### POS-003 — Complete sale with payments

- [ ] Completion is one explicit command, never a generic status write, and it
      is atomic: the stock movements, the balance updates, the cash movements,
      the frozen line snapshot, the status change, the payment rows and exactly
      one audit row are co-committed, and any rejection persists nothing.
      Evidence to produce: the durable live-PostgreSQL completion block of
      [[POS-003]].
- [ ] Every completion stock write goes through the [[EPIC-10]] ledger seam and
      acquires `stockSerializationLockKey(tenantId, catalogItemId)` before
      reading or writing `stock_balance` under the fixed `BLOCK` policy, and the
      projection equals the ledger's signed sum afterwards. Evidence to produce:
      the projection-equals-signed-sum assertion and the [[TD-016]] compliance
      note of [[POS-003]].
- [ ] Payments across the six PRD §19 methods sum to the sale total exactly,
      each at `Decimal(14, 2)`, with no change, tendered amount, overpayment or
      customer credit modelled, and a payment set that does not sum exactly is
      rejected. Evidence to produce: the payment-sum cases of [[POS-003]].
- [ ] A CASH payment requires an `OPEN` session resolved server-side inside the
      same transaction and never from the request body, and writes one `SALE`
      cash movement whose amount equals the CASH payment amount. Evidence to
      produce: the CASH path of the [[POS-003]] live-PostgreSQL block.
- [ ] Idempotency uses both mechanisms of [[DEC-024]]: a tenant-scoped
      idempotency record unique per `(tenant, operation, key)` with a request
      fingerprint and a result reference, and a conditional
      `WHERE status =     'DRAFT'` transition guarded by a
      `SELECT ... FOR UPDATE` header row lock with a post-lock status re-read,
      so a same-key replay returns the prior result, a different-fingerprint
      request is a stable conflict, and a replay without a key is a stable `409`
      that persists nothing. Evidence to produce: the replay and concurrent
      double-complete cases of [[POS-003]].
- [ ] A `COMPLETED` sale and its lines and payments are immutable: no `PATCH`,
      no `DELETE`, no second completion, and a database-level delete rejection.
      Evidence to produce: the delete-rejection and second-completion cases of
      [[POS-003]].

### POS-004 — Staff POS surface

- [ ] The POS surface implements loading, empty, error, success,
      permission-denied and entitlement-denied states, and every component
      composes shared UI with semantic design tokens only — no brand literal and
      no injected styling. Evidence to produce: the state-coverage component
      tests of [[POS-004]].
- [ ] Item resolution uses the shipped tenant-scoped catalog read API by name,
      and the input is keyboard-first and tablet/touch-friendly; a scanner
      behaves exactly like typing and the deferred barcode is not presented as
      supported ([[DEC-025]]). Evidence to produce: the item-resolution cases of
      [[POS-004]].
- [ ] The browsers transport layer forwards only the staff session cookie, uses
      an allowlisted query and body rebuild, and never treats a client-supplied
      tenant identifier as authority. Evidence to produce: the proxy tests of
      [[POS-004]].
- [ ] Frontend permission and entitlement checks are UX only, and the backend
      checks remain mandatory; the surface adds no route, no schema change and
      no new permission key. Evidence to produce: the UX-only branch assertions
      and the route-inventory diff of [[POS-004]].

### POS-005 — Epic closure and evidence

- [ ] Module documentation for the new domains is merged, including the sales
      documentation at the path `docs/05-modules/Sales.md` and the cash
      documentation covering the minimal foundation. Evidence to produce: the
      merged documents and their `docs/05-modules/README.md` index entries.
- [ ] Durable live-PostgreSQL evidence exists for the completion transaction,
      the CASH payment path and the concurrent double-complete, and is recorded
      in `docs/10-qa/CI-EVIDENCE.md`. Evidence to produce: the recorded
      live-PostgreSQL runs of [[POS-003]].
- [ ] [[TD-018]], [[TD-019]] and [[TD-020]] exist as `open` records with their
      triggers, and [[TD-016]]'s compliance call site is recorded without
      closing it. Evidence to produce: the four debt records.
- [ ] The changelog entry and the roadmap status update for EPIC-12 land in a
      closure branch after the feature branch merges, not on the feature branch
      whose receipt they cite. Evidence to produce: the closure branch and its
      separate merge.

## Stories

- [[POS-001]] Sale draft and line pricing — the sale and line aggregates, the
  tax snapshot, the pricing and currency rules, the optional customer and the
  `DRAFT -> CANCELLED` command.
- [[POS-002]] Cash register and session foundation — the three tenant-scoped
  cash aggregates, the `SALE`-only cash movement enum, the partial unique index
  and the minimal register-create and session-open commands.
- [[POS-003]] Complete sale with payments — the idempotent atomic completion
  command, the ledger writes, the cash movements and the payment rows.
- [[POS-004]] Staff POS surface — the browser transport, the item search and the
  line and completion flows.
- [[POS-005]] Epic closure and evidence — the module documentation, the
  exit-criteria evidence, the debt records, the changelog entry and the roadmap
  status update.

## Dependencies

- [[EPIC-09]] Catalog/Taxes (**done**) — the tenant catalog items, their
  required seeded tax rate and the optional reference price a sale line
  consumes.
- [[EPIC-10]] Inventory (**done**) — the signed ledger, the `(tenant, item)`
  projection, `stock_movement_type` and the serialization protocol
  `CompleteSale` must reuse.
- [[EPIC-02]] RBAC/Entitlements (**done**) — permission seeds, the role matrix,
  the `sales` and `cash` feature codes and `EntitlementsService.has`.
- [[EPIC-11]] Suppliers/Purchases (**done**) — the shipped receiving command
  whose header lock order, conditional transition and `409` replay this epic's
  completion command follows.
- [[TD-016]] — the pre-existing serialization debt this epic inherits and must
  not reintroduce; `CompleteSale` is a named trigger of that record.
- [[TD-018]], [[TD-019]] and [[TD-020]] — the deferrals this epic creates.

## Exit Criteria

- [ ] Every Story — [[POS-001]], [[POS-002]], [[POS-003]], [[POS-004]],
      [[POS-005]] — is `done` with every required acceptance criterion checked
      and its implementation summary, migrations, endpoints and tests recorded.
- [ ] CRUD and command coverage is complete for the epic's surface: the sale
      draft reads and writes, the cancel and complete commands, the register
      create and cash session open commands and the cash reads, with no `PATCH`
      and no `DELETE` anywhere on the sale, payment or cash records.
- [ ] The checks required by the epic — lint, typecheck, unit tests, integration
      tests, build and `format-check` — are green in CI for every merged work
      unit.
- [ ] Durable live-PostgreSQL evidence exists for the `CompleteSale`
      transaction, the CASH payment path and the concurrent double-complete, and
      is recorded in `docs/10-qa/CI-EVIDENCE.md`.
- [ ] Module documentation for the new domains is merged: the sales module
      document and the cash documentation for the minimal foundation, with their
      `docs/05-modules/README.md` index entries.
- [ ] The generated scope notes for [[TD-018]], [[TD-019]] and [[TD-020]] exist
      as `open` records, and the [[TD-016]] obligation on this epic is recorded.

## Decisions / ADRs

The ten EPIC-12 Decisions were accepted on 2026-09-27 by the maintainer, each as
its recommended Option A, and they are binding on the dependent slices:

- [[DEC-020]] — `CompleteSale` cash boundary and the minimal Cash foundation:
  EPIC-12 owns the least Cash that makes PRD §18 satisfiable, with `SALE` the
  only new cash movement kind and one `OPEN` session per register enforced by a
  partial unique index.
- [[DEC-021]] — sale tax arithmetic, amount precision and the per-line snapshot:
  tax-included prices, per-line `taxableBase`/`taxAmount`, half-up rounding at
  the currency minor unit, money at `Decimal(14, 2)` and quantities at
  `Decimal(10, 3)`.
- [[DEC-022]] — line pricing, price override and sale currency: the catalog
  reference price is a suggestion, the operator may override the line price, and
  the sale currency is the tenant's `sales.defaultCurrency` with no conversion.
- [[DEC-023]] — sale status transitions and the deferred reversal boundary:
  exactly `DRAFT -> COMPLETED` and `DRAFT -> CANCELLED`, an immutable
  `COMPLETED` sale, and sale reversal and payment refund deferred.
- [[DEC-024]] — `CompleteSale` idempotency: a persisted tenant-scoped
  idempotency record plus the header row lock and conditional `DRAFT`-only
  transition, with no destructive retention before an approved policy.
- [[DEC-025]] — POS item identification and the deferred barcode: no new catalog
  code column, item resolution by name through the existing read API, and the
  PRD §18 scanner optimization tracked as unmet.
- [[DEC-026]] — sales permission keys, role matrix and the entitlement gate:
  eight new keys moving the seeded count 43 → 51 (POS-001 43 → 47, POS-002 47 →
  50, POS-003 50 → 51), read-wide writes to the owning roles, and the first
  entitlement-gated Core surface — the `sales` capability on the sale routes and
  the `cash` capability on the cash routes. The record's accepted seven keys are
  extended by [[POS-002]]'s `cash.register.create` alongside `cash.read` and
  `cash.session.open` (2026-09-29, subsequent-scope note), because without
  register creation no tenant could reach an `OPEN` session and the CASH path
  was broken.
- [[DEC-027]] — sale identifier: no human-readable number; the sale is
  identified by its UUID only.
- [[DEC-028]] — sale scope boundaries: optional customer, no discount, no
  appointment or patient link.
- [[DEC-029]] — payment composition and tender rules: several payments summing
  to the total exactly, no change, overpayment or customer credit, and immutable
  payments.

No ADR is required: EPIC-12 preserves the modular monolith, the transaction
model, the tenancy model, the ledger and the approved stack, so it introduces no
architecture change that the PRD §43 complexity budget would gate.

## Technical Debt

- [[TD-016]] is inherited by this epic as its next stock writer: every
  completion write must acquire
  `stockSerializationLockKey(tenantId, catalogItemId)` before reading or writing
  `stock_balance`. The debt stays `open` because the protocol remains a
  convention rather than a database-enforced guarantee. [[POS-003]] owns the
  compliance and must record the call site in [[TD-016]] without closing it.
- [[TD-018]] — sale reversal and payment refund deferred ([[DEC-023]]),
  `severity: medium`. Created by this epic.
- [[TD-019]] — POS item code identification deferred ([[DEC-025]]),
  `severity: low`. Created by this epic.
- [[TD-020]] — idempotency key retention ([[DEC-024]]), `severity: low`. Created
  by this epic.
- [[TD-021]] — the live-PostgreSQL test environment contract: Turbo 2's strict
  env mode plus `turbo.json`'s `globalEnv` omission of `DATABASE_URL_TEST` makes
  root `pnpm test` fail without it, `severity: low`. Pre-existing and not
  introduced by this epic; discovered while verifying [[POS-001]].
- No other debt is planned. If a slice ships a shortcut it must create a debt
  record rather than hide it.
