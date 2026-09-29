# EPIC-12 POS/Payments — scope preparation and tracking

## Objective

Prepare EPIC-12 POS/Payments as the next roadmap epic after EPIC-11
Suppliers/Purchases: a scope-preparation pass that produces the epic record, the
accepted Decision records the PRD leaves open, and the story breakdown, before
any source code is written.

## Problem and why

`docs/01-roadmap/ROADMAP.md:23` lists EPIC-12 POS/Payments as `planned` with
`EPIC-09, EPIC-10` as dependencies, both `done`. Nothing else about EPIC-12
exists: no roadmap record, no story, no schema, no module. The PRD is thin on
purpose (§18 Sales and POS, §19 Payments, §20 Cash) and several product
questions it defers cannot be invented by an implementation slice without
silently expanding scope, which the engineering rules forbid.

## Current evidence (verified read-only on `main` at `d1e65d2`)

- `docs/01-roadmap/ROADMAP.md:23-25` — EPIC-12 `planned`, depends on EPIC-09 and
  EPIC-10; EPIC-13 Cash depends on EPIC-12.
- No `docs/01-roadmap/EPIC-12-POS-Payments.md`; `docs/02-stories/` holds no
  sales/POS story.
- `packages/database/prisma/schema.prisma` has no `Sale`, `Payment` or
  `CashSession` model and no `PaymentMethod` enum. `StockMovementType`
  (line 1341) is pinned to `ADJUSTMENT` and `PURCHASE`, and the enum comment
  states that `SALE` and the `*_REVERSAL` compensations "belong to EPIC-12 and
  later and are added additively then".
- `apps/api/src/` has no sales/POS module (`inventory`, `purchases`,
  `suppliers`, `catalog`, `settings`, ... exist).
- PRD §18 defines `DRAFT`/`COMPLETED`/`CANCELLED` and lists the atomic Complete
  Sale steps (validate totals, validate payments, validate stock, create stock
  movements, update balances, create cash movements for CASH payments, mark
  completed, audit) and requires idempotency; §19 lists six payment methods; §20
  defines the Cash entities and movement kinds; §40 names
  `Sale cancellation/reversal` and `Payment refund/reversal` as core correction
  cases.
- The `sales` tenant-settings namespace already exists and is seeded:
  `apps/api/src/settings/registry.ts:54-74` defines `defaultCurrency` (default
  `PYG`) and `requireCustomerForInvoice` (default `false`),
  `requiresFeature: "sales"` and
  `requiredPermissionKey: "sales.settings.manage"`; that key is seeded at
  `packages/database/src/reference-seed.ts:94` and the `sales` feature code at
  `packages/database/src/reference-seed.ts:298`.
- `docs/03-architecture/REVERSALS-CORRECTIONS.md` already fixes the command
  convention (`POST /sales/:id/cancel`, `POST /payments/:id/refund`, ...) and
  the `Idempotency-Key` rule for sensitive reversal commands.
- `docs/05-modules/Inventory.md` "Does Not Own" assigns sales/POS stock
  validation, cash movements and idempotent `CompleteSale` to EPIC-12; the
  serialization protocol binds every stock writer to
  `stockSerializationLockKey(tenantId, catalogItemId)` ([[TD-016]]), which
  EPIC-11 receiving already honours through `InventoryRepository.lockItemStock`
  (`apps/api/src/purchases/purchases.service.ts:432`).
- `docs/05-modules/Catalog-Taxes.md` stores a rate reference and never computes
  tax; the item has `referencePriceAmount`/`referencePriceCurrency`
  (`schema.prisma:1277-1278`, DEC-010) and no SKU, barcode, category or unit
  column (`schema.prisma:1286`).

## Scope of this pass

- Documentation only: the EPIC-12 roadmap record, the Decision records for the
  open product questions, the story documents, and reconciliation of the roadmap
  table and the epic's current-state snapshot.
- Maintainer decisions are captured by questionnaire and recorded as accepted
  Decisions; the pass never chooses product scope on its own.
- No PRD edit unless the maintainer explicitly approves a narrow clarification
  (the DEC-010 precedent).
- All artifacts in English, per the repository documentation convention.

## Out of scope

- Any source code, schema, migration, seed, route, test or UI change.
- Moving EPIC-12 or any story past `planned`.
- Changing PRD sections, module docs or existing accepted Decisions.
- Committing to `main`, pushing, or opening a PR without explicit instruction.

## Constraints

- Complete Sale must be transactional, idempotent and must never mutate stock or
  cash balances directly; corrections are compensating records (PRD §40).
- Every new stock writer MUST acquire the `(tenant, item)` advisory lock
  ([[TD-016]]); the `BLOCK` negative-stock policy is fixed.
- New private aggregates need tenant composite ownership keys, cross-tenant
  `404`, granular permissions and tenant-isolation tests.
- Money and quantities use `Decimal`/`NUMERIC`; confirmed records stay
  immutable.
- No new runtime, broker, ORM, state library or API protocol (complexity
  budget).

## Delivery strategy

Documentation slice, `ask-on-risk`. Expected well under the ~400 authored-line
heuristic per commit; a feature branch with work-unit commits is the working
assumption, and the maintainer owns push/PR.

## TDD resolution

- Mode: **off** (no project or session configuration enables it). This pass
  writes documentation only; no test runner applies.

## Route declaration per task

| Task | Route     | Trigger evidence                                                                  |
| ---- | --------- | --------------------------------------------------------------------------------- |
| T1   | inline    | Tracking artifact and route declaration written by the parent before any write    |
| T2   | delegated | 4-file rule: evidence spans schema, settings, seeds, architecture and module docs |
| T3   | inline    | Human decision gate: batched questionnaires to the maintainer                     |
| T4   | delegated | Multi-file write rule: epic record plus several Decision records and stories      |
| T5   | delegated | Verification rule: independent read-only verification over the new documents      |

## Tasks

- [x] T1: Create this tracking document, its Engram mirror and the visible todo
      list before the first documentation write.
- [x] T2: Complete the evidence map for the Decisions slice: schema and seed
      facts, settings namespace, architecture conventions, module boundaries and
      the debt that binds EPIC-12.
- [x] T3: Confirm every open product decision with the maintainer in batched
      questionnaires, then record the choices as accepted Decision records.
- [x] T4: Write the EPIC-12 roadmap record and the story breakdown, reconcile
      the roadmap table and the epic snapshot, and keep every claim traceable to
      code or an accepted Decision.
- [x] T5: Independently verify the documents against the evidence and run the
      documentation gates; report open items honestly.

## Acceptance criteria and checks

- The epic record carries conformant frontmatter and links to the exact PRD
  sections its scope touches.
- Every scope statement is supported by the PRD, an accepted Decision or
  verified code; unresolved product questions are recorded as Decisions rather
  than implemented assumptions.
- Stories are reviewable units with explicit out-of-scope boundaries and
  acceptance criteria covering tenant isolation, authorization, audit,
  idempotency and tests where relevant.
- The roadmap table reflects the epic's real status; nothing claims
  implementation.
- `pnpm format-check` and `git diff --check` pass on the changed documents.

## Open product decisions (must be resolved before implementation)

Recorded from the evidence above; each needs a Decision record before the
dependent schema or contract is written.

1. Cash boundary — PRD §18 requires Complete Sale to write cash movements for
   CASH payments, but Cash is EPIC-13 and depends on EPIC-12.
2. Tax arithmetic ownership inside EPIC-12: tax-included versus tax-excluded
   lines, rounding and PYG precision (Catalog never computes).
3. Currency handling: `sales.defaultCurrency` versus DEC-010's per-item
   currency.
4. Barcode/SKU for the PRD §18 scanner versus Catalog's documented absence of
   SKU, barcode, category and unit.
5. `SALE` movement type, `tracksStock` gate and the mandatory `(tenant, item)`
   advisory lock ([[TD-016]]).
6. `CompleteSale` idempotency mechanism and persistence.
7. Sale numbering (EPIC-11 precedent: [[DEC-018]]).
8. Entitlement gating for the seeded `sales` feature code, and the `sales.*`
   permission matrix.
9. Whether sale cancellation/reversal and payment refund (PRD §40,
   `REVERSALS-CORRECTIONS.md`) are EPIC-12 scope.
10. Manual price override, discount, customer link and appointment link on a
    sale.
11. Story split and work-unit boundaries.

## Files planned

- `docs/01-roadmap/EPIC-12-POS-Payments.md`
- `docs/07-decisions/DEC-020...` (one per accepted decision)
- `docs/02-stories/POS-001...` (story set, names pending T4)
- `odd/tasks/epic-12-pos-payments.md` (this document)

## Progress

- 2026-09-27: Read-only readiness check of EPIC-12 confirmed the absence of
  epic, stories, schema and module; user selected "Preparar el alcance de
  EPIC-12 (solo docs)". Tracking document written before any documentation
  write.
- 2026-09-27: T2 evidence map closed. Discovered that EPIC-12 inherits more than
  the PRD states: the `sales` tenant-settings namespace already exists with
  `defaultCurrency`/`requireCustomerForInvoice` and `requiresFeature: "sales"`,
  the `sales.settings.manage` and `cash.session.close` keys are already seeded,
  and `docs/03-architecture/REVERSALS-CORRECTIONS.md` already fixes the sale
  cancel and payment refund command convention plus the `Idempotency-Key` rule.
- 2026-09-27: T3 closed in three batched questionnaires and one follow-up; the
  maintainer accepted the recommended option in every case. Ten Decision records
  DEC-020 through DEC-029 are `accepted`.
- 2026-09-27: T4 closed. The epic record, five POS stories and three tech-debt
  records exist; the roadmap table was left untouched because EPIC-12's status,
  name and dependencies did not change.
- 2026-09-27: T5 closed with two independent read-only verification passes. Pass
  1 found five documentary defects (two wrong `ROADMAP.md` line citations, a
  wrong `purchases.service.ts` range, a reversed cash direction in DEC-020, a
  vague deferral wording instead of the debt link, and a POS-003 contradiction
  between the blanket `409` and the same-key replay), plus a wrong claim in the
  verification request itself. Pass 2 confirmed the corrections and found five
  more real gaps, which were then fixed: the epic was missing the template's
  `## Stories` and `## Dependencies` headings, DEC-024 and DEC-025 still used
  the vague deferral wording in their late sections, and POS-003 carried two
  more blanket `409` statements that contradicted the same-key replay.

## Verification evidence

- `pnpm format-check` -> "All matched files use Prettier code style!" (green on
  the whole repository, not only the new files).
- Formatter idempotence (the [[TD-017]] trap): two consecutive
  `prettier --write` passes over the new documents produced byte-identical
  output, and no wikilink is wrapped inside a list item.
- `git diff --check` clean; `git status --short` shows only the twenty new files
  and no modification to `docs/00-product/PRD.md`, `docs/01-roadmap/ROADMAP.md`,
  `docs/05-modules/**` or any existing record.
- Checked checkboxes across the twenty files: 0. Epic and stories are `planned`,
  the ten decisions are `accepted` and the three debt records are `open`; every
  story reads `_Not implemented._` and `Not run.`
- Independent pass 1: 7 PASS / 3 FAIL (disposition of each failure recorded
  above). Independent pass 2: roadmap citations, the receiving-pattern citation,
  the cash direction and the debt links confirmed, and the template question
  resolved - the missing `## Implementation Summary`/`## Verification` claim was
  a defect in the verification request, not in the epic record, because those
  sections belong to `docs/_templates/STORY.md`.
- No application test applies: this slice changes no executable code. Live
  PostgreSQL, lint, typecheck and build were deliberately skipped and are not
  claimed.

## Next step

The maintainer authorized the first implementation slice on 2026-09-27; its
record follows.

---

# POS-001 Sale draft and line pricing — implementation tracking

## Objective

Deliver the `DRAFT` half of the sale lifecycle: a tenant-scoped sale with one
currency, an optional in-tenant customer and one or more priced lines, each
carrying the tax and price snapshot [[DEC-021]] fixes; the operator's price
override with the catalog reference price as a suggestion ([[DEC-022]]); and the
`DRAFT -> CANCELLED` command ([[DEC-023]]). The slice writes no stock, cash,
payment, invoice or fiscal state.

## Authorization and branch

- The maintainer authorized starting POS-001 on 2026-09-27 ("ok arrancalo").
- Branch `feat/epic-12-sale-draft`, stacked on `docs/epic-12-scope-prep` (PR
  #76, still open), because the epic record and the ten Decisions it is bound by
  live on that branch. It gets retargeted or rebased onto `main` once PR #76
  merges.
- Delivery: work-unit commits on the feature branch; push, PR and merge remain
  the maintainer's decisions.
- TDD: mode **off** (`openspec/config.yaml` sets `strict_tdd: false` and no
  session configuration enables it). The runner is `pnpm test`; the slice's real
  gates are the database schema suite, the API integration suite and the live
  PostgreSQL suite.

## Slice-level resolutions accepted by the maintainer (2026-09-27)

The exploration found three contracts the accepted Decisions left open. All
three were confirmed with the maintainer before any code was written.

1. **Currency minor units.** [[DEC-021]] requires half-up rounding "at the
   currency's minor unit" but no currency-to-exponent source exists, and
   `salesSettingsSchema.defaultCurrency` accepts any three-letter code.
   Decision: a single exponent map in the sales domain with **PYG -> 0 as the
   only supported entry**; a tenant whose `defaultCurrency` is not in the map
   fails with a stable `400 VALIDATION_FAILED` instead of rounding silently with
   the wrong exponent. Extending it later is one entry.
2. **When the snapshot is computed.** [[DEC-021]]'s Decision text gives the
   computation to CompleteSale, while POS-001 requires the draft line to persist
   the snapshot. Decision: the `DRAFT` line persists the inputs
   (`catalogItemId`, `rateCode`, `unitPrice`, `quantity`) plus the derived
   amounts (`taxableBase`, `taxAmount`, `lineTotal`), recomputed on **every**
   write of the draft, because the operator must see line and sale totals while
   building the cart; CompleteSale (POS-003) recomputes and freezes them, and a
   `COMPLETED` sale is never recomputed again. [[DEC-021]] is unchanged: the
   completed sale is still what the invoice consumes, and "immutable" applies to
   `COMPLETED`, not to an editable draft.
3. **Entitlement and permission order.** [[DEC-026]] requires both on every
   route and fixes neither the order nor read gating. Decision: the `sales`
   entitlement is asserted first (`403 FEATURE_NOT_ENTITLED`) and the granular
   permission second (`403 FORBIDDEN`), over the **whole** surface including
   reads, exactly as the clinical and patients modules do.

## Binding decisions for this slice

- [[DEC-021]] tax-included prices, per-line snapshot, half-up per line, money
  `Decimal(14,2)`, quantities `Decimal(10,3)`, sale total = sum of line totals.
- [[DEC-022]] reference price as suggestion, operator override, sale currency
  from `sales.defaultCurrency` server-side, cross-currency item rejected, no
  conversion.
- [[DEC-023]] only `DRAFT -> COMPLETED` (POS-003) and `DRAFT -> CANCELLED`; no
  `PATCH`, no `DELETE`; reversal deferred ([[TD-018]]).
- [[DEC-026]] `sales.read`, `sales.create`, `sales.update`, `sales.cancel` with
  the role matrix and the `sales` entitlement gate. This slice moves the seeded
  permission count **43 -> 47**; the epic reaches 50 with `cash.read`,
  `cash.session.open` (POS-002) and `sales.complete` (POS-003).
- [[DEC-027]] no number, no sequence.
- [[DEC-028]] optional customer, no discount, no appointment or patient link.
- [[TD-016]] binds stock writers only; this slice writes no stock and is not a
  call site.

## Tasks

- [ ] W1: Data foundation — the `SaleStatus` enum, the `Sale` and `SaleLine`
      models with tenant composite ownership keys, the additive migration
      `20260927000001_sales` (RESTRICT foreign keys, CHECK constraints, the
      conditional delete-rejection trigger),
      `packages/database/src/schema-sales.test.ts`, the four `sales.*`
      permission keys with the [[DEC-026]] matrix and the reconciled seed-count
      probe.
- [ ] W2: API surface — `apps/api/src/sales/` (permissions, DTOs, Zod contracts,
      repository, the pricing and minor-unit arithmetic, service, controller,
      module), the five routes, the `sales` entitlement gate, the co-committed
      audit rows, the `SalesModule` registration, the shared in-memory boundary
      extension, the route-contract probe and the integration suite.
- [ ] W3: Live-PostgreSQL coverage for the sale boundary (atomic create, the
      byte-equivalent cross-tenant `404`, the composite ownership keys, the
      `DRAFT`-only transition, the delete rejection) plus the story and epic
      reconciliation.

## Route declaration per task

| Task | Route     | Trigger evidence                                                         |
| ---- | --------- | ------------------------------------------------------------------------ |
| W1   | delegated | Multi-file write rule: schema, migration, schema gate, seeds and probes  |
| W2   | delegated | Multi-file write rule: a new module with several files, probes and tests |
| W3   | delegated | Live-suite and documentation surfaces                                    |

## Acceptance criteria

Inherited verbatim from [[POS-001]]; the eighteen criteria that require
implemented behavior are what this slice must close. Nothing is checked until
the evidence exists.

## Progress

- 2026-09-27: branch created and stacked on the docs branch; a read-only scout
  mapped the sibling conventions and surfaced ten gaps, three of which needed
  the maintainer; all three were resolved above before the first write.
- 2026-09-27: W1 committed as `93f7f57` (tracking as `b80f7e4`). The
  `SaleStatus` enum, the `Sale`/`SaleLine` models and the additive
  `20260927000001_sales` migration exist with composite ownership keys,
  `RESTRICT` foreign keys (tenant, customer, sale, catalog item and the
  `rate_code -> tax_rate(code)` reference), the quantity and money CHECK
  constraints and two conditional delete triggers that reject only a `COMPLETED`
  or `CANCELLED` sale. The schema gate is
  `packages/database/src/schema-sales.test.ts` (24 tests) and the four `sales.*`
  keys land with the [[DEC-026]] matrix, moving the seeded count **43 -> 47**;
  `schema-clinical.test.ts`'s global `@@unique([tenantId, id])` inventory was
  reconciled 12 -> 14 with the parent's authorization, exactly as SUP-001 did 9
  -> 10.
- 2026-09-27: W2 committed as `fd73edc`. The `apps/api/src/sales/` module ships
  the four permissions, the pure pricing arithmetic, allowlisted DTOs, strict
  Zod contracts, the tenant-safe repository with the row-lock-first `DRAFT`
  gates, the service with the entitlement-first gate and one co-committed audit
  row per mutation, the controller with exactly five routes and no `PATCH` or
  `DELETE`, the module registration before `PortalModule`, the in-memory sale
  tables and the route-contract pins.

## Verified evidence (parent-run, not only writer-reported)

- `pnpm --filter @newsaas/database test` -> 16 files / **293 tests passed**.
- `pnpm --filter @newsaas/api test` -> 73 passed, 1 skipped (74 files); **918
  passed, 71 skipped** (989 tests); the skipped set is the live-PostgreSQL
  suite, which auto-skips without `DATABASE_URL_TEST`.
- `pnpm --filter @newsaas/api lint`, `pnpm --filter @newsaas/api typecheck`,
  `pnpm --filter @newsaas/database typecheck` and
  `pnpm --filter @newsaas/api build` all clean; `pnpm format-check` green
  repository-wide.
- Parent inspection of the source: exactly five routes (`GET /sales`,
  `GET /sales/:id`, `POST /sales`, `PUT /sales/:id`, `POST /sales/:id/cancel`)
  with no `PATCH` and no `DELETE`; no stock, balance, cash, payment, invoice or
  fiscal write anywhere in the module; the pricing function rounds with
  `toDecimalPlaces(minorUnit, ROUND_HALF_UP)` and derives
  `taxAmount = lineTotal - taxableBase`, so the split is exact by construction;
  `SALES_MINOR_UNITS` holds `PYG -> 0` only and an unsupported currency is a
  stable `VALIDATION_FAILED`; and all five service methods call
  `assertSalesEnabled()` before the permission re-assertion.

## Slice-level implementation choices recorded for review

- **A `DRAFT` does not gate on an inactive catalog item.** The draft is inert
  and the item's state belongs to the completion slice (POS-003), mirroring how
  [[DEC-014]] split the purchase draft from receiving. No Decision settles the
  draft-side rule, so none was invented.
- **An update recomputes with the sale's stored currency**, not a fresh read of
  `sales.defaultCurrency`, so a later settings change cannot silently re-price
  an existing draft ([[DEC-022]]: the sale records its currency once).
- **A line whose item does not resolve to a seeded global rate is a `400`**
  before any write ([[DEC-021]]), and the `rate_code` foreign key makes an
  invalid code unrepresentable in real PostgreSQL anyway.
- **HTTP `@RequirePermissions` runs before the service**, so a tenant lacking
  both permission and entitlement is rejected `403 FORBIDDEN` at the route
  layer, exactly as clinical and patients behave; a tenant holding permissions
  without the capability gets `FEATURE_NOT_ENTITLED`.

## W3 status

W3 cannot run yet: Docker is not available in this WSL distro (`docker` is
absent, `pg_isready` on `localhost:5433` reports no response and the port is
refused), so the migration was never applied and the live-PostgreSQL block was
never run. The composite ownership keys, the composite `RESTRICT` foreign keys,
the per-item unique, the row lock and the conditional delete triggers are
currently proven by DDL text and `prisma validate` alone. POS-001 stays
`planned` with its live criterion unchecked until that evidence exists.

## Next step

W3 once PostgreSQL can start: apply the migration, add the EPIC-12 sale-draft
block to `apps/api/test/live-pg-isolation.e2e-spec.ts` (atomic create, the
byte-equivalent cross-tenant `404`, the composite ownership keys, the
`DRAFT`-only transition and the delete rejection), run the live suite, then
reconcile the story and the epic record and open the slice pull request.

**Closed 2026-09-29:** W3 ran (live suite 80/80 with nine sale cases), the docs
were reconciled (`f21aaad`) and the slice is PR #77 with CI run `36513245839`
green on both required checks. POS-001 flips to `done` in a closure commit after
the merge.

---

# POS-002 Cash register and session foundation — implementation tracking

## Objective

Deliver the minimum PRD §20 Cash model that makes PRD §18's `CompleteSale`
satisfiable: a tenant-scoped `CashRegister`, `CashSession` and `CashMovement`,
the one-`OPEN`-session-per-register rule enforced by a partial unique index, and
the session-open command. [[DEC-020]] fixes the boundary; EPIC-13 keeps close,
the difference, the six other movement kinds, cash reversals and the cash UI.

## Authorization and branch

- The maintainer authorized continuing with POS-002 on 2026-09-29 ("ok
  continuemos") and answered four blocking questions the story left open.
- Branch `feat/epic-12-cash-foundation`, stacked on `feat/epic-12-sale-draft`
  (PR #77, open) because the two slices share `app.module.ts`, the shared
  in-memory boundary, the route-contract probe and the seed files, so stacking
  avoids conflicts. PR order: #76, then #77, then this slice.
- TDD: mode **off** (`openspec/config.yaml` sets `strict_tdd: false`). The gates
  are the database schema suite, the API suite and the live-PostgreSQL suite.

## Slice-level resolutions accepted by the maintainer (2026-09-29)

1. **Register creation stays in the slice.** The story defined only two reads
   and the session open, so nothing could create a `CashRegister` and the chain
   "OPEN session -> CASH sale" was broken for every tenant. A minimal
   `POST /cash/registers` with a new `cash.register.create` key is added. This
   is the first EPIC-12 addition to the accepted [[DEC-026]] key set, which
   moves from **seven keys / 50** to **eight keys / 51**; the record gets a
   dated subsequent-scope note rather than a retroactive rewrite, following the
   [[DEC-010]] precedent. Slice arithmetic: POS-001 took 43 -> 47, this slice
   takes 47 -> 50 (`cash.read`, `cash.session.open`, `cash.register.create`) and
   POS-003 takes 50 -> 51 (`sales.complete`).
2. **The cash surface is gated on the `cash` capability**, not on `sales` as the
   story text said. `cash` is its own seeded capability in PRD §10, exactly as
   `sales` gates the sale surface; a dated note on [[DEC-026]] records it.
3. **The session records a required opening float.**
   `openingAmount Decimal(14,2) NOT NULL` on `POST /cash/sessions`, allowed to
   be `0.00`. PRD §20 defines close as the server-computed expected amount
   compared against the counted amount, and without a baseline that expectation
   cannot represent the cash already in the drawer.
4. **`opened_by` references the tenant membership.** `opened_by_membership_id`
   with a composite `RESTRICT` foreign key to `tenant_membership(tenant_id, id)`
   (that unique key already exists), so the database guarantees the opener
   belongs to the session's tenant. A global `user_profile` reference could not.

## Binding decisions for this slice

- [[DEC-020]] the three cash entities, `SALE` as the only movement kind, the
  partial unique index, the session-open command, no Branch dimension, and
  EPIC-13's reserved scope (close, difference, the other six kinds, reversals,
  UI).
- [[DEC-026]] as extended on 2026-09-29: three `cash.*` keys, all six roles
  read, `OWNER`/`ADMIN`/`CASHIER` write, the surface gated on the `cash`
  capability, and `cash.session.close` left reserved for EPIC-13.
- [[DEC-023]] cash reversals stay deferred with sale reversal and payment refund
  ([[TD-018]]).
- [[TD-016]] binds stock writers only; this slice writes no stock.

## Tasks

- [ ] C0: Align the documentation with the four accepted resolutions: the
      POS-002 story, the epic record and dated subsequent-scope notes on
      [[DEC-020]] and [[DEC-026]].
- [ ] C1: Data foundation - the `CashMovementType` (`SALE` only) and
      `CashSessionStatus` enums, the three models with tenant composite
      ownership keys, the additive migration `20260927000002_cash_foundation`
      (composite `RESTRICT` foreign keys, the partial unique index on
      `(tenant_id, register_id) WHERE status = 'OPEN'`, the non-zero amount
      CHECK and the delete-rejection triggers),
      `packages/database/src/schema-cash.test.ts`, the three `cash.*` keys with
      the matrix and the reconciled seed probe (43 -> 47 -> 50).
- [ ] C2: API surface - `apps/api/src/cash/` (permissions, DTOs, Zod contracts,
      repository, service, controller, module), the three routes
      (`GET /cash/registers`, `GET /cash/sessions`, `POST /cash/sessions`) plus
      `POST /cash/registers`, the `cash` entitlement gate, the co-committed
      audit rows, the module registration, the in-memory boundary extension, the
      route-contract probe and the integration suite.
- [ ] C3: Live-PostgreSQL coverage for the cash foundation (the session open
      with its audit row, the partial unique index proven by a real concurrent
      second open, the cross-tenant `404`, the immutability trigger) plus the
      story and epic reconciliation.

## Route declaration per task

| Task | Route     | Trigger evidence                                                         |
| ---- | --------- | ------------------------------------------------------------------------ |
| C0   | delegated | Multi-file write rule: story, epic record and two Decision notes         |
| C1   | delegated | Multi-file write rule: schema, migration, gate, seeds and probes         |
| C2   | delegated | Multi-file write rule: a new module with several files, probes and tests |
| C3   | delegated | Live-suite and documentation surfaces                                    |

## Progress

- 2026-09-29: branch created and stacked on the POS-001 slice; the four blocking
  questions were answered by the maintainer before the first write and are
  recorded above.
- 2026-09-29: C0 closed (`edc91b5`, `7ad99f6`), C1 closed (`9892fc1`), C2 closed
  (`fda5b92`), C3 closed (`ade5a1a`), docs reconciled (`93aff47`) and the stale
  seed comments corrected (`512d4e2`). Parent-verified evidence: database 17
  files / 324 tests; API 75 files / 1026 tests; live suite 90 tests, none
  skipped, with the ten cash cases; typecheck, lint and `format-check` clean;
  and the live database showing 24 migrations, 50 permissions, the exact partial
  index predicate, seven `RESTRICT` foreign keys and three triggers.

## Independent probe evidence (parent-run, 2026-09-29)

The eight-claim verification pass marked the applied-schema invariants
**UNVERIFIED as stated**, because its boundary allowed only read-only `psql` and
the claim required rolled-back DML probes. That is a method limit rather than
missing evidence, but suite evidence is not an independent probe, so the parent
ran **16 probes of its own SQL** against the live database, every one rolled
back and each surfacing the real PostgreSQL error:

| Guarantee probed                       | Observed                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Session open with `0.00`               | admitted                                                                                         |
| Second `OPEN` for the same register    | rejected by `cash_session_one_open_per_register_key`                                             |
| `CLOSED` sibling for the same register | admitted                                                                                         |
| Duplicate register name in one tenant  | rejected by `cash_register_tenant_id_name_key`                                                   |
| Same register name in another tenant   | admitted, so the unique is tenant-scoped                                                         |
| Session `DELETE`                       | rejected: `a cash session cannot be hard-deleted; sessions are confirmed records`                |
| Movement `UPDATE`                      | rejected: `a confirmed cash movement is immutable; correct it with a compensating movement`      |
| Movement `DELETE`                      | rejected: `a confirmed cash movement cannot be deleted; correct it with a compensating movement` |
| Movement amount `0`                    | rejected by `cash_movement_amount_non_zero`                                                      |
| Negative `opening_amount`              | rejected by `cash_session_opening_amount_non_negative`                                           |
| Reserved kind `REFUND`                 | rejected by the `cash_movement_type` enum                                                        |
| Cross-tenant `register_id`             | rejected by `cash_session_tenant_id_register_id_fkey`                                            |
| Cross-tenant `opened_by_membership_id` | rejected by `cash_session_tenant_id_opened_by_membership_id_fkey`                                |
| Cross-tenant movement `session_id`     | rejected by `cash_movement_tenant_id_session_id_fkey`                                            |
| `SALE` movement insert                 | admitted                                                                                         |
| Zero residue                           | every table back to its pre-probe count, fixture profile and membership included                 |

An early version of these probes reported three failures that were artefacts of
the fixture itself: the two tenant variables had resolved to the same row, so a
"cross-tenant" reference was really same-tenant and the register-name case hit
the tenant-scoped unique instead of proving scope. Re-running with the tenants
ordered by `id` produced the table above. The lesson is recorded rather than the
bad run: a tenancy probe must assert that the two tenants differ before it
interprets any rejection.

## Next step

Drain the pull-request stack: merge #76 (scope docs) then #77 (POS-001),
retarget #78 to `main` so its CI runs, and flip POS-001 and POS-002 to `done` in
closure commits that do not ride the branch whose receipt they cite. POS-003
("CompleteSale" with payments, the ledger and cash writes, and the idempotency
record) is the last implementation slice of the epic.

---

# EPIC-12 closure block (2026-09-29)

The scope-preparation slice and the first two implementation slices are merged
into `main`:

- PR #76 — epic scope documentation — merge commit `14f23bc`.
- PR #77 — POS-001 sale draft and line pricing — merge commit `6ef1896`; POS-001
  is `done`.
- PR #78 — POS-002 cash register and session foundation — merge commit
  `0d583e6`; POS-002 is `done`.
- CI runs `36513245839` (PR #77, evaluated head `f21aaad`) and `36521067733` (PR
  #78, evaluated head `3d141c2`), both green on both required checks.

The epic stays `planned`: [[POS-003]], [[POS-004]] and [[POS-005]] are still
`planned`. Next step is POS-003 — "CompleteSale" with multiple payments across
the PRD §19 methods, the `SALE` stock and cash movements written through their
respective ledgers, and the persisted idempotency record.

## Lesson: drain the pull-request stack before deleting a base branch

Merging a pull request with `--delete-branch` while another open pull request
still has that branch as its base leaves the second pull request **closed**
against a missing base, and GitHub does not allow reopening it; the stack has to
be recreated. It happened to the `#76 -> #77 -> #78` stack. Drain the stack in
merge order and delete a base branch only after the last dependent pull request
has merged.

---

# POS-003 Complete sale with payments — implementation tracking

## Objective

Deliver PRD §18's `CompleteSale`: one explicit, tenant-scoped, atomic and
idempotent command that validates the draft's totals, its payments and its
stock, writes one signed negative `SALE` stock movement per line through the
EPIC-10 ledger under the serialization protocol, writes one `SALE` cash movement
per CASH payment against the server-resolved `OPEN` session, freezes the line
snapshot, records the PRD §19 payments, marks the sale `COMPLETED` and audits -
or persists nothing. This is the epic's only stock writer and the call site
[[TD-016]] names next.

## Authorization and branch

- The maintainer authorized POS-003 on 2026-09-29 ("continuemos") and answered
  the three open questions before the first write.
- Branch `feat/epic-12-sale-completion`, created from `main` at `4f5e012` after
  #76, #77, #78 and the closure PR #79 merged, so this slice is no longer
  stacked and its pull request runs CI directly.
- TDD: mode **off** (`openspec/config.yaml` sets `strict_tdd: false`). The gates
  are the database suite, the API suite and the live-PostgreSQL suite.

## Slice-level resolutions accepted by the maintainer (2026-09-29)

Also recorded in the story:

1. **Reference state is validated at completion** - an inactive catalog item or
   an inactive customer is a stable `409` that persists nothing, mirroring
   [[DEC-014]]'s draft/receive split; the item's currency is not re-validated
   because the line was already priced ([[DEC-022]]).
2. **Completion recomputes and writes the snapshot** from the line's frozen
   inputs, because [[DEC-021]] makes completion the step that computes and
   freezes; a `COMPLETED` sale is never recomputed.
3. **A replay answers `200` and a fresh completion `201`**, both returning the
   completed sale ([[DEC-024]]).
4. Recorded with them: the idempotency record's result reference is the sale id
   (re-read in-tenant on replay), the operation token is `sale.complete`, and
   the idempotency lookup happens **after** the header row lock.
5. The story's stale seed arithmetic was corrected to the accepted [[DEC-026]]
   subsequent-scope note: this slice moves the seeded count **50 -> 51** inside
   the epic's **43 -> 51** total.

## Binding decisions for this slice

- [[DEC-020]] one server-resolved `OPEN` session, one `SALE` cash movement per
  CASH payment, a CASH payment without a session rejected.
- [[DEC-021]] tax-included per-line snapshot recomputed and frozen at
  completion.
- [[DEC-023]] the only transition is `DRAFT -> COMPLETED`; the result is
  immutable and reversal stays deferred ([[TD-018]]).
- [[DEC-024]] the persisted idempotency record plus the header row lock with the
  conditional `DRAFT`-only transition; [[TD-020]] records the retention limit.
- [[DEC-026]] `sales.complete` for `OWNER`/`ADMIN`/`CASHIER` and the `sales`
  entitlement gate.
- [[DEC-029]] several payments summing exactly to the total, no change, no
  credit.
- [[DEC-014]] the header-first lock order and the conditional status write.
- [[TD-016]] binds this slice: every stock write acquires
  `stockSerializationLockKey(tenantId, catalogItemId)` before reading or writing
  `stock_balance`.

## Tasks

- [ ] D1: Data layer - the additive `SALE` value on `stock_movement_type`, the
      `payment_method` enum, the `payment` table and the tenant-scoped
      idempotency record, the additive migration
      `20260927000003_sale_completion`, the schema gate updates
      (`schema-sales.test.ts`, `schema-inventory.test.ts` whose SALE-absence
      assertion is now stale, and `schema-clinical.test.ts` for the two new
      tenant-scoped models), the `sales.complete` key with its matrix and the
      seed probe 50 -> 51.
- [ ] D2: API surface - the completion command inside `apps/api/src/sales/`: the
      strict payment contract, the transaction (header lock, idempotency lookup
      and record, reference-state gates, ascending per-item advisory locks with
      the `BLOCK` check, ledger movements and balance projection, cash
      movements, the recomputed snapshot, the payment rows, the conditional
      status write and one audit row), the controller route, the DTO, the
      in-memory boundary tables, the route-contract pin and the integration
      suite.
- [ ] D3: Live-PostgreSQL coverage - the atomic completion with the projection
      equal to the ledger's signed sum, the CASH payment path, the idempotent
      replay, the applied additive enum, the cross-tenant `404` and two
      concurrent completions admitting exactly one `201`.
- [ ] D4: Reconciliation, verification and the pull request.

## Route declaration per task

| Task | Route     | Trigger evidence                                                        |
| ---- | --------- | ----------------------------------------------------------------------- |
| D1   | delegated | Multi-file write rule: schema, migration, three gates, seeds and probes |
| D2   | delegated | Multi-file write rule: an existing module plus tests and probes         |
| D3   | delegated | Live-suite surface                                                      |
| D4   | delegated | Documentation surfaces                                                  |

## Progress

- 2026-09-29: branch created from `main` after the stack drained; the three
  resolutions were answered before the first write and are recorded in the story
  and above. A fourth was added mid-slice when the design exposed that a CASH
  payment could not pick a session: exactly one `OPEN` session is now required.
- 2026-09-29: D0 (`78f70f0`, `a44accd`), D1 (`91e712d`), D2 (`441f72b`), D3
  (`2bb0f6c`) and D4 (`f3668f8`) all landed. Parent-verified evidence: database
  17 files / 346 tests; API 75 files / 1049 tests with the 36-case sales suite;
  live suite 99 tests, 0 skipped, with 9 completion cases; typecheck, lint and
  `format-check` clean; live database showing 25 migrations, 51 permissions, the
  additive enum, the six payment methods, the two conditional `payment` triggers
  and the `(tenant_id, operation, key)` unique.
- 2026-09-29: merged as pull request #80, merge commit `dc7c429`, CI run
  `36592652167` green on head `f3668f8` on both required checks. POS-003 is
  `done`; [[TD-016]] carries a dated status update recording the completion
  command as its third compliant stock writer, and the debt stays open.
- Fixed inside D2 rather than deferred: D1's additive `SALE` migration
  invalidated an EPIC-11 live-spec assertion that pinned `stock_movement_type`
  to exactly `[ADJUSTMENT, PURCHASE]`. The lesson is that an enum probe must be
  reconciled in the same slice that appends the value.

## Next step

POS-004 (the staff POS surface consuming the draft, completion and cash routes)
and then POS-005 (epic closure: module documentation, `CI-EVIDENCE.md`, the
changelog and the roadmap status).

---

# POS-004 Staff POS surface - implementation tracking

## Objective

Deliver the staff browser surface for the counter sale: item search over the
shipped catalog read API, a local cart with the reference price pre-filled and
overridable, an optional customer, a payment capture across the six PRD §19
methods, and a completion flow that reports each distinct outcome honestly. Web
only: no route, no schema, no seed and no permission key is added.

## Authorization and branch

- The maintainer authorized POS-004 on 2026-09-29 ("cierralo y continuemos") and
  answered the cart-persistence question before the first write.
- Branch `feat/epic-12-staff-pos-surface`, created from `main` at `6ca2c2e`
  after POS-003 closed, so it is not stacked and its pull request runs CI
  directly.
- TDD: mode **off**. The gates are the web suite, lint, typecheck and build.

## Slice-level resolutions accepted by the maintainer (2026-09-29)

1. **The cart is local and checkout creates + completes.** The cart lives in the
   browser while it is built; checkout sends `POST /sales` with the lines and
   then `POST /sales/:id/complete` with the payments. Nothing is persisted per
   keystroke, an abandoned cart leaves no orphan draft, and a failed completion
   leaves a real `DRAFT` that the detail page can reopen and report honestly.
2. **The planned module path was wrong and is corrected.** The story named
   `apps/web/src/features/sales/`, which does not exist in this repository; the
   shipped EPIC-11 convention colocates client modules with their route, so the
   slice uses `apps/web/src/app/(app)/app/sales/` and the story was corrected
   accordingly.

## Tasks

- [ ] E1: Transport and client - the sales and cash proxies under
      `apps/web/src/app/api/**` with the cookie-only forwarding and the
      allowlisted query/body rebuild, their proxy tests, and the colocated
      client API and query layer.
- [ ] E2: Pages and states - the counter surface, the draft detail and the line
      editor with the six state branches, the completion outcome mapping and the
      component tests.
- [ ] E3: Reconciliation, verification and the pull request.

## Progress

- 2026-09-29: E1 closed (`c296029`): eight new files, 74 tests, the two proxies
  and the colocated client modules; `pnpm --filter @newsaas/web test` at 64
  files / 712 tests with typecheck, lint and build clean.
- 2026-09-29: E2 closed (`9a0bcb3`): 22 files and 83 tests adding the counter
  surface, the draft detail and line editor, the payment capture with a
  float-free exact-sum guard, the six state branches, the completion outcome
  mapping and the navigation entry; the web suite reaches 73 files / 795 tests
  with typecheck and lint clean.
- Known limitation recorded rather than hidden: the navigation entitlement gate
  is dormant because the shell has no browser-side entitlement source and adding
  one would be a new proxy route; the sibling EPIC-11 surfaces do not gate
  navigation at all, so this is ahead of the convention, not a regression. The
  backend `FEATURE_NOT_ENTITLED` remains the authority.

## Closure

- 2026-09-29: E3 closed (`88922da`); POS-004 merged as pull request #82, merge
  commit `62002d8`, CI run `36625254435` green on head `88922da`. The story is
  `done`.
- 2026-09-29: POS-005 closed on the `docs/epic-12-closure` branch: the
  implemented-behavior documents [[Sales]] and [[Cash]] with their module index
  entries, the EPIC-12 `CI-EVIDENCE.md` section, the changelog entry and the
  roadmap status update. EPIC-12 is `done`, with [[TD-016]], [[TD-017]],
  [[TD-018]], [[TD-019]], [[TD-020]] and [[TD-021]] open and EPIC-20 above them.

## Next step

EPIC-13 Cash (session close, the expected/counted difference, the six remaining
movement kinds, cash reversals and the cash UI), which depends on the foundation
this epic shipped.
