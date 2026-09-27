---
id: EPIC-11
type: epic
title: Suppliers/Purchases
status: done
priority: high
depends_on:
  - EPIC-10
prd_sections:
  - "5"
  - "7"
  - "9"
  - "10"
  - "16"
  - "17"
  - "27"
  - "28"
  - "29"
  - "40"
  - "41"
created: 2026-09-26
updated: 2026-09-27
---

# EPIC-11 — Suppliers/Purchases

## Objective

Deliver PRD §17's purchase lifecycle and the supplier registry it references as
tenant-scoped Core domains: a purchase moves through `DRAFT`, `RECEIVED` and
`CANCELLED`, and receiving is an explicit command that atomically validates the
draft, creates stock movements, updates balances, marks the purchase `RECEIVED`
and writes audit.

The epic depends on [[EPIC-10]] Inventory (done) because receiving is a stock
writer: it must go through the existing signed ledger, the `(tenant, item)`
projection and the ledger's serialization protocol instead of touching balances
directly. It also builds on [[EPIC-09]] Catalog/Taxes (done), because a purchase
line references a tenant catalog item, and on [[EPIC-02]] RBAC/Entitlements
(done) for permission plumbing; the `purchases` feature code already exists in
the seeded feature catalog (PRD §10).

EPIC-11 stops at the inventory effect of receiving. Cash, billing, fiscal
emission, payment settlement, POS, purchase reversal and low-stock reporting
belong to other epics and are explicitly out of scope here.

## Current state before implementation (verified 2026-09-26)

- PRD §17 defines the three purchase states and the receiving steps; PRD §5
  lists `suppliers` and `purchases` as Core domains; PRD §27 lists "purchase
  receive" among the audited actions; PRD §40 lists "Purchase reversal" among
  the correction cases; PRD §41 requires classification for new sensitive
  fields.
- No supplier or purchase implementation exists.
  `packages/database/prisma/schema.prisma` has no supplier or purchase model,
  and a search for `supplier`/`purchase` across `packages/database` and
  `apps/api` returns only reserved comments and unrelated matches (the seeded
  `purchases` feature code, the `inventory.stock.*` permission family, and the
  schema comment that reserves movement types).
- The inventory movement enum is pinned to `ADJUSTMENT` only. The schema comment
  states that `PURCHASE`, `SALE`, `TRANSFER_*` and the `*_REVERSAL`
  compensations "arrive additively with the epics that own their commands", and
  `docs/05-modules/Inventory.md` assigns purchases/receiving to EPIC-11.
- The ledger's serialization protocol is binding on this epic: every future
  stock writer **MUST** acquire
  `stockSerializationLockKey(tenantId, catalogItemId)` before reading or writing
  `stock_balance` (`docs/05-modules/Inventory.md`, [[TD-016]]).
- No supplier or purchase permission key is seeded. The permission catalog
  currently holds the `catalog.*` family ([[EPIC-09]]) and the
  `inventory.stock.*` family ([[EPIC-10]]) beside the EPIC-01 baseline.
- No Decision or ADR record defined any supplier attribute set, purchase
  numbering, line cost/tax structure, supplier optionality or cancellation
  semantics when this epic was written; those gaps were closed by the eight
  EPIC-11 Decisions accepted on 2026-09-26 ([[DEC-011]]–[[DEC-018]], see
  "Decisions / ADRs"), while the implementation still does not exist.
- [[EPIC-10]] is `done` (PR #66, merge commit `ee558a7`, CI run 36249268114), so
  this epic's roadmap dependency is closed.

At this pre-implementation snapshot everything below was planned and unchecked:
no acceptance criterion in this record had been implemented. The later sections
record the implementation and the closure.

## Progress (2026-09-26)

The snapshot above records the pre-implementation state verified on 2026-09-26
and is retained as such; it is not the current state. Since then the first Story
has landed: the [[SUP-001]] supplier registry work units are merged with CI
green.

- Pull request #68 (`feat(EPIC-11): implement the supplier registry (SUP-001)`,
  base `main`) merged `feat/epic-11-suppliers-purchases` into `main` as merge
  commit `baa66ca` (`baa66ca4a2ac6fdac29115440c94038e6437dff7`), merged
  `2026-09-26T21:00:58Z`.
- CI run
  [`36270774108`](https://github.com/EstebanJS7/New_SaaS/actions/runs/36270774108)
  on the evaluated head commit `4b8adf8`
  (`4b8adf8438b7457034c6f18c5c9a8d250501c6f2`) concluded `completed` / `success`
  in 3m57s, with `Database migrations` (`108484172152`) and
  `Lint, Typecheck, Test, Build` (`108484172375`) both `SUCCESS`.
- The slice's live-PostgreSQL evidence is recorded as the EPIC-11 CI baseline in
  `docs/10-qa/CI-EVIDENCE.md`.

The purchase slices have since merged as well, both with CI green:

- Pull request #70
  (`feat(EPIC-11): implement the purchase draft lifecycle (PUR-001)`, base
  `main`) merged `feat/epic-11-purchase-draft` into `main` as merge commit
  `f214003` (`f2140036fa7f18be9293c21a62bb9e2f7828f759`), merged
  `2026-09-26T22:53:35Z`.
- CI run `36277429018` on the evaluated head commit `4442466`
  (`44424665da95a08d379435add856e6767bbbb9c6`) concluded `success`, with
  `Database migrations` and `Lint, Typecheck, Test, Build` both `SUCCESS`.
- Pull request #71 (`feat(EPIC-11): implement purchase receiving (PUR-002)`,
  base `main`) merged `feat/epic-11-purchase-receiving` into `main` as merge
  commit `8862050` (`8862050c74f4dafa3518d4029c8becb778895979`), merged
  `2026-09-27T04:16:17Z`.
- CI run `36293559990` on the evaluated head commit `edfa66c`
  (`edfa66cbcfbf514f97ed2a0fa657c04b0091ab1e`) concluded `success`, with
  `Database migrations` and `Lint, Typecheck, Test, Build` both `SUCCESS`.
- The same two required jobs ran for both merges. These runs are the
  machine-generated receipts for the merged slices and supersede the
  corresponding local runs as the canonical baseline, while the local runs
  remain useful as pre-push evidence; the merged evidence is recorded in
  `docs/10-qa/CI-EVIDENCE.md`.

The epic is **closed** as of this slice: the [[PUR-003]] staff purchases surface
is implemented, merged and covered by CI, all four Stories are `done`, and every
exit criterion is checked. See "Exit Criteria" for the criterion-to-evidence map
and the closure note.

## Scope

- A tenant-scoped supplier aggregate with a tenant composite ownership key, an
  active/inactive lifecycle and a read/write API behind granular permissions.
  The attribute set is fixed by an accepted Decision ([[DEC-011]]) — see
  [[SUP-001 Supplier foundation]] and "Decisions resolved (2026-09-26)".
- A tenant-scoped `Purchase` aggregate with a `purchase_status` enum pinned to
  `DRAFT`, `RECEIVED` and `CANCELLED` (PRD §17), draft lines that reference
  in-tenant catalog items, and tenant-safe reads.
- A draft lifecycle: create, edit and cancel a `DRAFT` purchase with no stock,
  cash, billing or fiscal effect. A draft is inert until receiving.
- An explicit receiving command that atomically validates `DRAFT`, writes signed
  positive `PURCHASE` stock movements through the EPIC-10 ledger, updates
  balances under the shared `(tenant, item)` serialization protocol, marks the
  purchase `RECEIVED` and writes audit (PRD §17, §27).
- An additive extension of the `stock_movement_type` enum with `PURCHASE`.
- Granular permission keys and a seeded role matrix for the two new domains.
- Tenant isolation, authorization, validation and ledger-integration tests, plus
  live-PostgreSQL evidence for the receiving transaction.
- A staff browser surface (authenticated proxy, client module, pages) with the
  required loading, empty, error, success and permission-denied states.

## Out of Scope

- **Cash movements, cash sessions and cash close** — [[EPIC-13]] Cash.
- **Invoices, billing and invoice confirmation/cancellation** — [[EPIC-14]].
- **Fiscal documents, fiscal provider calls or fiscal cancellation** —
  [[EPIC-15]] and [[EPIC-16]]. EPIC-11 makes no external call.
- **Payments, settlement, paid/unpaid state or accounts payable** — [[EPIC-12]]
  POS/Payments and [[EPIC-13]]. EPIC-11 adds no payment concept and no owed
  amount.
- **POS, keyboard/barcode/touch selling flows and sale completion** —
  [[EPIC-12]].
- **Purchase reversal** and compensating movements for a `RECEIVED` purchase.
  PRD §40 names purchase reversal as a correction case, but EPIC-11 ships no
  reversal command (see "Deferred / future dependencies").
- **Low-stock thresholds and alerts** — [[EPIC-18]] Dashboards/Reports.
- **Stock transfers and any location, Branch or Warehouse dimension.** Stock
  stays tenant-wide per the [[EPIC-10]] decision.
- **Partial receiving, a partially received state or back-order state.** PRD §17
  defines no partial state.
- **A tenant-configurable negative-stock policy.** The policy is a fixed
  `BLOCK`.
- **Supplier portal or supplier self-service.**
- **Supplier/purchase imports** — [[EPIC-19]] Imports.
- **Hard delete of any purchase, purchase line or stock movement.**

## Deferred / future dependencies

- **Purchase reversal.** PRD §40 requires confirmed inventory corrections to be
  explicit, idempotent, reasoned and audited, and names "Purchase reversal" as a
  core case. A `RECEIVED` purchase is therefore immutable, and a correction
  needs a compensating movement through the reserved `reversesMovementId`. That
  command is a future dependency, not EPIC-11 scope; the Decision required by
  [[PUR-002 Purchase receiving]] must state that intent explicitly.
- **Accounts payable / supplier settlement.** Belongs to a later epic; EPIC-11
  records no owed amount and no payment term enforcement.

## Acceptance Criteria

- [x] Suppliers and purchases are tenant-scoped private aggregates: every
      private table carries the tenant composite ownership key and a `RESTRICT`
      tenant FK, and a cross-tenant UUID is one byte-equivalent `404`. Evidence:
      the `supplier` and `purchase`/`purchase_line` DDL and their live-PG
      isolation blocks in [[Suppliers]] and [[Purchases]].
- [x] Every protected operation validates authentication, server-side tenant
      context, permission/policy and resource tenant ownership before data
      access; frontend permission checks are UX only. Evidence: the per-route
      `@RequirePermissions` plus the service re-assertion documented in
      [[Suppliers]] and [[Purchases]], and the UX-only permission branches of
      the [[PUR-003]] surface.
- [x] All external input is validated against a strict allowlisted contract that
      rejects unknown keys; `tenantId` is never read from body, query or route;
      no Prisma model crosses the HTTP boundary. Evidence: the `.strict()` Zod
      contracts, allowlisted DTO projections and unknown-key rejection sweeps
      documented in [[Suppliers]] and [[Purchases]], plus the proxies' rebuilt
      query allowlist in [[PUR-003]].
- [x] The purchase status enum is exactly `DRAFT`, `RECEIVED`, `CANCELLED` (PRD
      §17), and receiving/cancelling are explicit transition commands, not
      generic `PATCH status` writes. Evidence: the `purchase_status` enum, the
      `POST /purchases/:id/cancel` and `POST /purchases/:id/receive` commands
      and the absence of any `PATCH`/`DELETE` route in [[Purchases]].
- [x] Receiving validates `DRAFT`, creates the stock movements, updates
      balances, marks the purchase `RECEIVED` and writes audit **atomically**: a
      rejection persists nothing. Evidence: the single-transaction receive
      command in [[Purchases]] and the live-PostgreSQL receiving block.
- [x] Every receiving write goes through the EPIC-10 ledger seam and acquires
      `stockSerializationLockKey(tenantId, catalogItemId)` before reading or
      writing `stock_balance` ([[TD-016]]); the projection equals the ledger's
      signed sum after the command. Evidence: the `lockItemStock` /
      `createMovement` / `upsertBalance` seam and the live receiving case
      asserting the projection equals the signed sum in [[Purchases]].
- [x] `stock_movement_type` gains `PURCHASE` additively; existing `ADJUSTMENT`
      behavior is unchanged. Evidence: the additive
      `20260926000003_purchase_receiving` migration and the enum gate in
      [[Purchases]].
- [x] Purchase receive is audited with stable ids and field names only (PRD
      §27). Evidence: exactly one `purchase.received` audit row per accepted
      receive, carrying `{ schemaVersion, changedFields }` with no stored value,
      in [[Purchases]].
- [x] No cash, billing, fiscal, payment, POS or low-stock behavior is introduced
      by any EPIC-11 slice. Evidence: the module scope and inertness guarantees
      in [[Purchases]] and [[Suppliers]] and the "Out of Scope" list above.
- [x] The staff surface implements loading, empty, error, success and
      permission-denied states using semantic design tokens only. Evidence: the
      [[PUR-003]] state-coverage implementation summary and its component tests;
      every component composes `@newsaas/ui` and semantic Tailwind tokens with
      no brand literal or injected styling.
- [x] Tenant isolation tests exist for every new private aggregate;
      authorization and validation tests cover every new route; the receiving
      transaction has live-PostgreSQL evidence. Evidence: the test inventories
      in [[Suppliers]] and [[Purchases]] and the EPIC-11 live-PostgreSQL blocks
      inside the 71-case suite.
- [x] Every open product decision is resolved by an accepted Decision record
      before the dependent schema or contract is written: the eight records
      [[DEC-011]]–[[DEC-018]] were accepted on 2026-09-26 and are binding on the
      dependent slices, and the schema and contracts have since been written
      against them.
- [x] Documentation is current, and the lint/typecheck/test/build checks
      required by the epic are green. Evidence: this record, [[Suppliers]],
      [[Purchases]], the `docs/05-modules/README.md` index, the changelog, the
      CI-evidence sections and the roadmap note; `pnpm lint` 14/14,
      `pnpm typecheck` 14/14, `pnpm build` 9/9, `pnpm test` 15/15 and
      `pnpm format-check` clean, then green in the merged CI runs.

## Stories

All four Stories are `done`.

- [[SUP-001 Supplier foundation]] — the tenant-scoped supplier registry.
- [[PUR-001 Purchase draft]] — the `DRAFT` lifecycle with no stock effect.
- [[PUR-002 Purchase receiving]] — the explicit receiving command and the ledger
  integration.
- [[PUR-003 Staff purchases surface]] — the browser transport and pages.

## Progress

- 2026-09-26: [[SUP-001 Supplier foundation]] implemented, independently
  verified, merged, and backed by live-PostgreSQL evidence; the supplier half of
  the epic is done.
- 2026-09-26: [[PUR-001 Purchase draft]] implemented on branch
  `feat/epic-11-purchase-draft` (commits `517ad69`, `59031c3`, `43ac6dd`) with
  its schema gate, HTTP integration suite, route-contract pins and a 7-case
  live-PostgreSQL block; the draft half of the epic is done.
- 2026-09-26: [[PUR-002 Purchase receiving]] implemented on branch
  `feat/epic-11-purchase-receiving` (commit `a0d6442` plus the live-PostgreSQL
  coverage). The slice adds the `purchases.receive` key (completing the
  [[DEC-016]] total at 43), the additive `PURCHASE` movement type and the
  explicit `POST /purchases/:id/receive` command with its header-first lock
  order, all-or-nothing line gate, one-transaction ledger writes and one
  `purchase.received` audit row. The HTTP integration suite holds 25 purchase
  tests, the route probe pins the sixth route, and the live-PostgreSQL suite
  grows to 71/71 with a 6-case receiving block whose concurrent double-receive
  race admits exactly one `201` under a proven header-row-lock overlap.
- 2026-09-26: [[PUR-001]] merged into `main` as merge commit `f214003` through
  pull request #70, required CI checks green on head `4442466` (run
  `36277429018`).
- 2026-09-27: [[PUR-002]] merged into `main` as merge commit `8862050` through
  pull request #71, required CI checks green on head `edfa66c` (run
  `36293559990`).
- 2026-09-27: [[PUR-003]] implemented on branch `feat/epic-11-staff-purchases` —
  the two proxies, the client modules, the supplier and purchase pages with
  their state coverage, and the receive flow with its seven distinct outcomes —
  then merged into `main` as merge commit `e12ac1f` through pull request #73,
  required CI checks green on head `ae08e88` (run `36305211468`).

This note is retained as the slice-by-slice progress record. With the staff
surface now implemented and merged, every epic acceptance and exit criterion in
this record is checked against the evidence in "Exit Criteria", and the epic
`status` is `done`.

## Dependencies

- [[EPIC-10]] Inventory (**done**) — the signed ledger, the `(tenant, item)`
  projection and the serialization protocol receiving must reuse.
- [[EPIC-09]] Catalog/Taxes (**done**) — the tenant catalog items a purchase
  line references.
- [[EPIC-02]] RBAC/Entitlements (**done**) — permission seeds, role matrix and
  the `purchases` feature code.
- [[TD-016]] — the pre-existing serialization debt this epic inherits and must
  not reintroduce; the receiving slice is a named trigger of that record.
- [[TD-013]] — the staff-proxy rejection contract this epic's staff surface
  follows; the surface fired that record's trigger and leaves it open.

EPIC-11 is not a dependency of [[EPIC-12]] POS/Payments: the roadmap lists
EPIC-12 as depending on EPIC-09 and EPIC-10 only.

## Exit Criteria

- [x] The implementation work units are committed, pushed and merged with the
      required CI checks green. Evidence: the four merges — SUP-001 via PR #68
      (merge commit `baa66ca`), PUR-001 via PR #70 (`f214003`, CI run
      `36277429018` on head `4442466`), PUR-002 via PR #71 (`8862050`, CI run
      `36293559990` on head `edfa66c`) and PUR-003 via PR #73 (`e12ac1f`, CI run
      `36305211468` on head `ae08e88`) — each with `Database migrations` and
      `Lint, Typecheck, Test, Build` green. The receipts are recorded in
      `docs/10-qa/CI-EVIDENCE.md`.
- [x] The durable live-PostgreSQL evidence for receiving (atomicity,
      immutability, cross-tenant isolation and the `(tenant, item)`
      serialization race) passes and is recorded in `docs/10-qa/CI-EVIDENCE.md`.
      Evidence: the live-PostgreSQL suite stands at 71 cases, includes the
      EPIC-11 supplier, purchase-draft and purchase-receiving blocks, and runs
      in CI's `Database migrations` job on every pull request, so it is
      machine-verified rather than local-only; the EPIC-11 CI baselines in
      `docs/10-qa/CI-EVIDENCE.md` record the runs.
- [x] Each Story's required acceptance criteria are checked and its
      implementation summary, migrations, endpoints and tests are recorded.
      Evidence: the `done` records [[SUP-001 Supplier foundation]],
      [[PUR-001 Purchase draft]], [[PUR-002 Purchase receiving]] and
      [[PUR-003 Staff purchases surface]]. PUR-003 records that it adds no
      migration, endpoint or permission key because it consumes the shipped
      contracts.
- [x] Documentation is current: this epic, the module documentation for the new
      domains, the module index, the changelog and the roadmap note. Evidence:
      this record, [[Suppliers]], [[Purchases]], the `docs/05-modules/README.md`
      index entries, `docs/09-releases/CHANGELOG.md` and
      `docs/01-roadmap/ROADMAP.md`.
- [x] Decisions and debt are recorded; no deferred requirement is hidden as
      scope. Evidence: the eight accepted Decisions below, [[TD-013]] (open, its
      trigger now fired) and [[TD-016]] (open, the receiving writer compliant),
      plus the explicitly deferred items in the closure note below.

`status: done` means epic implementation closure only: the four work units are
merged as merge commits `baa66ca`, `f214003`, `8862050` and `e12ac1f` through
pull requests #68, #70, #71 and #73, the required CI checks are green, and the
live-PostgreSQL evidence is recorded. It is **never** a production-readiness
statement.

Open debt and deferred work remain and are not resolved by this closure:

- [[TD-013]] stays **open** and its trigger has fired: this epic added the next
  two staff proxies, which follow the documented rejection contract but
  duplicate the shape classification instead of sharing a helper because the
  shared library was outside the implementing slices' edit surfaces.
- [[TD-016]] stays **open** although the receiving writer complies with its
  protocol; the protocol is still a convention rather than a database-enforced
  guarantee.
- Deferred and outside this epic: purchase reversal (PRD §40, referenced by
  [[DEC-015]] but not implemented), inventory valuation and tax arithmetic
  ([[DEC-013]]), entitlement gating of the purchases surface ([[DEC-016]]), a
  human-readable purchase number ([[DEC-018]]), any traceability from a ledger
  movement back to its purchase, and live-API coverage for the staff proxies,
  which are tested against mocked API envelopes rather than a running API.

## Decisions / ADRs

The eight EPIC-11 Decisions were accepted on 2026-09-26 by the maintainer, each
as its recommended Option A:

- [[DEC-011]] — supplier identity, uniqueness and classification: which supplier
  attributes are required and optional, what is unique per tenant, what
  lifecycle applies, and what data classification each field carries.
- [[DEC-012]] — purchase aggregate shape and the draft-versus-receive validation
  gate: what a purchase aggregate must contain to be saved as a draft and to be
  received, and at which of those two moments catalog-item state is checked.
- [[DEC-013]] — purchase line cost and tax structure: whether a purchase line
  carries a unit cost, a tax rate, a computed total or nothing at all, given
  that no consumer of a purchase amount exists.
- [[DEC-014]] — purchase receiving semantics — single-shot transition,
  all-or-nothing line gates and deterministic lock order: what a receive does on
  a replay, which lines it may accept, what it persists when any line is
  rejected, and in what order it takes the ledger's advisory locks.
- [[DEC-015]] — purchase cancellation and the correction boundary for a received
  purchase: whether `CANCELLED` is reachable from a received purchase, and how a
  received purchase is corrected.
- [[DEC-016]] — suppliers/purchases permission keys, role matrix and entitlement
  gating: which `suppliers.*` and `purchases.*` keys exist, which roles hold
  them, and whether the `purchases` entitlement gates the surface.
- [[DEC-017]] — suppliers/purchases audit scope: which supplier and purchase
  operations write an audit row, at what granularity, and what each row may
  carry.
- [[DEC-018]] — purchase numbering (EPIC-11): whether the purchase aggregate
  carries a human-readable business number, and if so who generates it, under
  what uniqueness scope and with what gap-free guarantee.

EPIC-11 needs no ADR: it preserves the modular monolith, the existing tenancy
model, the ledger and the approved stack, so it introduces no architecture
change that the complexity budget would gate.

## Decisions resolved (2026-09-26)

Each former open question was answered by an accepted Decision record:

1. **Supplier attribute set and uniqueness** — answered by [[DEC-011]]: a
   required `name` plus optional `legalName`, `taxId` (RUC), `email`, `phone`
   and `address`, with `taxId` unique per tenant when present.
2. **Purchase numbering** — answered by [[DEC-018]]: EPIC-11 introduces no
   human-readable number; the purchase is identified by its UUID plus supplier
   and date.
3. **Line cost and tax structure** — answered by [[DEC-013]]: one optional,
   informational unit cost and no tax rate, computed total or purchase amount.
4. **Supplier optionality** — answered by [[DEC-012]]: `supplierId` is required
   on a purchase and a saved draft has at least one line.
5. **Cancellation semantics** — answered by [[DEC-015]]: `CANCELLED` is
   reachable only from `DRAFT`, and a `RECEIVED` purchase is corrected only by a
   future reversal.
6. **Receiving idempotency** — answered by [[DEC-014]]: a replayed receive is
   `409 CONFLICT` and persists nothing, with no idempotent short-circuit.
7. **Non-tracking and inactive lines** — answered by [[DEC-014]]: every line
   must resolve in-tenant to an ACTIVE item with `tracksStock` true, or the
   whole command fails with a stable `409` and persists no partial effect.
8. **Permission keys and role matrix** — answered by [[DEC-016]]: the
   `suppliers.*` and `purchases.*` keys exist with a fixed role matrix, and no
   entitlement gate applies.
9. **Audit scope for supplier changes** — answered by [[DEC-017]]: supplier
   create, update and deactivate each write exactly one co-committed audit row
   per accepted mutation.
10. **Staff UI detail** — not a product decision: it is a presentation choice
    inside approved scope, decided during [[PUR-003 Staff purchases surface]]
    implementation using the sibling staff surfaces as precedent, with no
    Decision record required.
11. **Multi-line receive lock acquisition order** — answered by [[DEC-014]]: the
    per-`(tenant, item)` advisory locks are acquired in ascending
    `catalogItemId` order.

What genuinely remains open and deferred, without new scope: **purchase
reversal** (PRD §40) stays a future capability that [[DEC-015]] references but
EPIC-11 does not implement; **inventory valuation and tax arithmetic** stay
outside EPIC-11 per [[DEC-013]]; **entitlement gating of the surface** is
deferred and adoptable later with no migration per [[DEC-016]]; and a
**human-readable purchase number** is deferred to the epic owning a printed or
fiscal document per [[DEC-018]].

## Technical Debt

- No debt is created by this epic.
- It inherits [[TD-016]], whose trigger is "the next stock writer added by
  [[EPIC-11]] or [[EPIC-12]]"; the receiving slice
  ([[PUR-002 Purchase receiving]]) now satisfies the protocol — it acquires the
  shared advisory lock before touching `stock_balance` — and [[TD-016]] is
  updated with that call site while staying open, because the protocol remains a
  convention rather than a database-enforced guarantee.
- It also fires [[TD-013]]'s trigger: the staff surface added the next two staff
  proxies ([[PUR-003 Staff purchases surface]]). Both follow the documented
  rejection contract instead of reproducing a sibling divergence, but they
  duplicate the handler's shape classification rather than sharing a helper
  because the shared library was outside the implementing slices' edit surfaces.
  The record stays **open**; firing a trigger is not resolving it.
