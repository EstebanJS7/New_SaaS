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

Maintainer decision: authorize the first implementation slice, [[POS-001 Sale
  draft and line pricing]], now that DEC-020 through DEC-029 are binding.
Push and pull request remain the maintainer's decision; nothing has been pushed.
