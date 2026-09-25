# EPIC-09 Catalog and Taxes — scope preparation

## Objective

Define a reviewable, bounded EPIC-09 scope before implementation: a tenant-safe
catalog, globally seeded Paraguay tax rates, and staff-agenda service
integration. Record the user's decisions and protect downstream
POS/Inventory/Fiscal boundaries.

## Problem and rationale

The roadmap schedules EPIC-09 before Inventory and POS, but no catalog/tax
schema, API, seed or UI exists. PRD §15 defines four item kinds and three tax
rates without settling rate ownership or catalog price; PRD §14 requires an
agenda service filter. User selected global seeded rates, optional item
reference price with per-item ISO currency (default PYG), and a separate
staff-agenda service slice, while deferring portal service selection. No tax
arithmetic or fiscal implementation is approved.

## Scope and constraints

- Planning and repository documentation only in this pass; no app/schema
  implementation or SDD phase artifacts.
- Record the user-approved optional catalog price addition through DEC-010, with
  explicit tradeoffs and future POS tax-treatment open question. The user
  formally accepted DEC-010 and authorized only its narrow PRD §15 clarification
  on 2026-09-25; no other PRD section is in scope.
- Create a planned EPIC-09 record with evidence-aware acceptance criteria,
  work-unit boundaries, dependencies and out-of-scope sections. Keep ROADMAP
  status planned until implementation starts.
- Preserve existing EPIC-08 uncommitted work; do not stage, commit or push.
- TDD disabled (`openspec/config.yaml` strict_tdd: false); exact runner
  `pnpm test` when application implementation begins. Documentation checks:
  Prettier and diff whitespace.

## Tasks

- [x] P1: Draft the optional-reference-price Decision proposal, recording
      amount+ISO currency and global tax-rate decisions without pretending tax
      inclusion has been decided.
- [x] P2: Draft EPIC-09 planned scope/acceptance and staged work units:
      data/seed, API/security, staff UI, nullable service link + agenda filter,
      hardening/documentation. Explicitly defer portal selection, stock ledger,
      POS/tax calculations and fiscal provider.
- [x] P3: Cross-check planned scope against PRD §§14–15, accepted DEC-007,
      existing code seams, and project documentation rules; run documentation
      checks and report open decisions/verification status.
- [x] P4: Record maintainer acceptance of DEC-010, clarify PRD §15 narrowly, and
      align EPIC-09's conditional price criteria with the accepted decision.
- [x] P5: Independently verify the approved scope reconciliation and formatting;
      leave application implementation for a separately scoped pass.
- [x] P6: Record the later maintainer choice that each catalog item requires a
      seeded tax rate at creation, without changing DEC-010's accepted history.
- [x] P7: Record the maintainer decision to defer any stock-tracking flag to
      EPIC-10 and to settle the WU1 representation choices (non-null global rate
      foreign key, one fixed price scale).

## Acceptance and verification

- Accepted DEC-010 and planned Epic have YAML metadata; only the approved PRD
  §15 clarification is made, and no implementation completion is claimed.
- No unintended changes to code or prior uncommitted housekeeping.
- Exact formatting/whitespace checks reported; no runtime tests claimed for
  documentation-only pass.

## Progress

- Exploration: confirmed no Catalog/Taxes implementation and mapped reusable
  platform patterns. Prior user choices in Engram: `epic-09/tax-rate-scope`,
  `epic-09/service-integration-scope`, `epic-09/optional-reference-price`,
  `epic-09/reference-price-currency`.
- P1: `docs/07-decisions/DEC-010-optional-catalog-reference-price.md` drafted as
  `proposed`, with PRD §15 extension pending formal acceptance. Focused Prettier
  and `git diff --check` passed; no code touched.
- P2: `docs/01-roadmap/EPIC-09-Catalog-Taxes.md` created as planned, with
  user-selected WU4 required (nullable service link for compatibility), catalog
  configuration classified INTERNAL, global seeded-rate selection, and DEC-010
  price conditional on acceptance. Focused Prettier and `git diff --check`
  passed after review correction.
- P3: Independent scope check found WU4 required, caller duration preserved,
  global seeded-rate selection and conditional DEC-010 correctly bounded. It
  also found a stale DEC-010 claim about the Epic file and this ODD file's
  formatting; both were corrected. Final `pnpm format-check`,
  `git diff --check`, and `git diff --cached --check` passed. No application
  source changed; lint, typecheck, tests, build and live-PG were skipped for
  this documentation-only pass.
- Open at P5: item rate representation and requiredness; POS tax treatment
  deliberately deferred. Requiredness was subsequently resolved in P6;
  representation remains a design choice. Existing EPIC-08 and EPIC-09 docs are
  uncommitted.
- User approved DEC-010 and the narrow PRD §15 clarification on 2026-09-25; no
  POS/fiscal arithmetic or currency conversion was approved.
- P4: DEC-010 status and prose now say accepted with maintainer approval dated
  2026-09-25; PRD §15 has only the approved reference-price clarification and
  its `updated` metadata was refreshed; EPIC-09 price criteria are no longer
  conditional. Targeted Prettier and `git diff --check` passed before the
  metadata-only correction.
- P5: Independent read-only check confirmed DEC-010 accepted, unconditional
  reference price in planned EPIC-09, required agenda service slice and no
  POS/fiscal arithmetic. `pnpm format-check`, `git diff --check` and
  `git diff --cached --check` all passed. Parent also inspected
  `git diff -- docs/00-product/PRD.md`: only `updated` metadata and §15 changed.
  Lint, typecheck, tests, build and live-PG were skipped because this pass
  changed documentation only. Existing EPIC-08 and new EPIC-09 changes remain
  uncommitted; the `.atl` index-only deletions remain staged.
- User selected a mandatory seeded rate (EXEMPT, IVA_5 or IVA_10) at item
  creation; no tax arithmetic or tenant-created rates were approved.
- P6: EPIC-09 now requires a seeded rate at creation and forbids clearing it;
  omission on an update retains the existing rate. DEC-010 carries a dated
  subsequent-scope note without retroactively expanding its accepted content.
  Final `pnpm format-check`, `git diff --check` and `git diff --cached --check`
  passed after the correction.
- P7: Maintainer deferred the stock-tracking flag to EPIC-10 and authorized
  local documentation commits without push. EPIC-09 records that deferral in Out
  of Scope, moves the tax-rate representation into "Decided" as a non-null
  foreign key to the global rate row, fixes the price scale at `Decimal(14, 2)`
  as a design choice, and no longer lists an epic-level open decision.
- Next: WU1 implementation is tracked separately in
  `odd/tasks/epic-09-wu1-catalog-foundation.md`. No source code was written in
  this scope-preparation feature.
