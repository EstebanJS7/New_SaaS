# EPIC-14 Billing — scope preparation and tracking

## Objective

Prepare EPIC-14 Billing as a docs-only kickoff before implementation: the epic
record, planned BILL stories and proposed Decision records for the unresolved
product/architecture choices.

## Constraints

- Do not change PRD scope.
- Do not write implementation code in this pass.
- Keep module docs for implemented behavior only; `docs/05-modules/Billing.md`
  is created by BILL-005 after implementation.
- Keep generated repository artifacts in English with YAML frontmatter.
- Keep EPIC-14 and the BILL stories in `planned` until implementation starts.
- Record an EPIC-14 decision as `accepted` only by an explicit maintainer act,
  never by inference from a kickoff approval.

## Tasks

- [x] Verify the repository facts EPIC-14 will cite (permission seeds, feature
      codes, the typed `sales` setting, the frozen `SaleLine` snapshot,
      `IdempotencyRecord`, the unwired event dispatcher, absent invoice code).
- [x] Create proposed Decision records DEC-038 through DEC-045.
- [x] Create `docs/01-roadmap/EPIC-14-Billing.md` aligned to PRD §18-22 and the
      epic boundaries already recorded by EPIC-08, EPIC-12 and EPIC-13.
- [x] Create planned BILL-001 through BILL-005 story records (delegated to
      `gentle-ai-worker`, then reconciled by the parent).
- [x] Apply the three maintainer-approved polish items: the atomic numbering
      allocation in DEC-039, the EPIC-15 cancellation hand-off in DEC-043 and
      the named [[TD-022]] deferral in DEC-044.
- [x] Create [[TD-022]] for the still-deferred portal invoice and document
      surface, with its owner and its re-evaluation point, and reconcile every
      reference to it across the epic and the BILL stories.
- [x] Run the docs-only formatting and whitespace checks and record results.
- [x] Maintainer review (2026-10-01): DEC-038 through DEC-045 accepted as
      proposed with the three polish items applied.
- [x] Convert DEC-038 through DEC-045 to `status: accepted` with the acceptance
      text in each `## Decision` section, and reconcile every downstream claim
      in the epic and the BILL stories.

## BILL-001 — invoice data foundation (work units)

Branch: `feat/epic-14-billing-invoice-foundation` (renamed from
`docs/epic-14-billing-kickoff`; the docs commits are part of it, matching the
EPIC-13 precedent of one branch per epic carrying scope and implementation).

### Pinned slice contract (parent-owned, so no writer invents identifiers)

- Migration folder: `20261001000001_billing_invoice_foundation`.
- Enum `InvoiceStatus` -> table-scoped type `invoice_status`, created with
  `CREATE TYPE` and the full literal set `DRAFT`, `CONFIRMED`, `CANCELLED` in
  one migration (never `ALTER TYPE ... ADD VALUE`, which cannot be used as an
  enum literal in the same transaction).
- `Invoice` -> `invoice`; `InvoiceLine` -> `invoice_line`;
  `InvoiceNumberSequence` -> `invoice_number_sequence`.
- **No stored header totals.** The invoice total is the sum of its immutable
  lines, so a stored total can never disagree with them. This is a projection of
  the snapshot, not the pricing arithmetic [[DEC-038]] forbids.
- `invoice` money and status columns are INTERNAL, the customer-linked
  references are CONFIDENTIAL (PRD §41).

### Two accepted-decision clarifications found while pinning the contract

Both are refinements that keep the decisions' stated intent and must be recorded
as subsequent scope notes on the accepted records, not applied silently:

1. **`number` is present exactly when `confirmed_at` is** ([[DEC-039]]).
   [[DEC-039]] said "required on `CONFIRMED` and `CANCELLED`" but also "a
   cancelled or abandoned draft never consumes a number". The two conflict for a
   `DRAFT` that is cancelled, and only the second is correct: the accepted
   guarantee is "no number is consumed before confirmation". The CHECK becomes
   `(number IS NULL) = (confirmed_at IS NULL)`.
2. **The one-invoice-per-sale uniqueness is partial** ([[DEC-038]]).
   `UNIQUE (tenant_id, sale_id)` combined with the story's own "trigger
   rejecting UPDATE and DELETE of a non-`DRAFT` invoice" and the absence of any
   delete route would block a sale from ever being invoiced again once a draft
   invoice is cancelled. The index becomes
   `UNIQUE (tenant_id, sale_id) WHERE status <> 'CANCELLED'`, so cancelled
   invoices stay permanent records while the sale is freed. This follows the
   shipped `cash_session_one_open_per_register_key` partial-index precedent.

### Work units

- [x] W1 — schema + migration + schema gate: `InvoiceStatus`, the three models,
      the back-relations, the section banner, the additive migration with its
      constraints, partial unique index and immutability triggers, and
      `packages/database/src/schema-billing.test.ts`.
- [x] W2 — `billing.*` seeds: the four `PERMISSION_SEEDS` entries, the
      `ROLE_PERMISSION_MATRIX` rows for all six roles, and the two pinned counts
      in `reference-seed.test.ts` (52 -> 56 and the VETERINARIAN exact array).
- [x] W3 — live-PostgreSQL applied-schema block for EPIC-14 in
      `apps/api/test/live-pg-isolation.e2e-spec.ts`.
- [x] W4 — docs reconciliation: the two subsequent scope notes on DEC-038 and
      DEC-039, the BILL-001 implementation record, the epic progress entry and
      the story guarantee-table fix (`series` is non-null). The migration and
      permission counters are deliberately **not** touched here: the historical
      records (`ROADMAP.md`, `EPIC-13-Cash.md`, `docs/10-qa/CI-EVIDENCE.md`,
      `CASH-002`) are closure receipts of earlier epics, and the new `28`/`56`
      figures belong to BILL-005's closure evidence.

### Gates for this slice

- `pnpm --filter @newsaas/database test` (schema gate plus the seed suite).
- `pnpm --filter @newsaas/database db:generate`.
- `pnpm --filter @newsaas/database db:deploy` against the local Docker Postgres
  and `pnpm --filter @newsaas/database db:live-verify`.
- `pnpm --filter @newsaas/api test:live-pg` ([[TD-021]]: the suite needs
  `DATABASE_URL` exported from the workspace-root `.env`, which Prisma does not
  auto-load, AND it needs the value to be **schema-less** — the `.env` value
  carries `?schema=public`, which the suite feeds to `psql` and which aborts
  with `invalid URI query parameter: "schema"`. Strip the query string for this
  command.)
- `pnpm typecheck`, `pnpm lint`, `pnpm format-check`, `git diff --check`.

### BILL-001 W2 — `billing.*` permission family

- Files: `packages/database/src/reference-seed.ts` (646 lines) and
  `packages/database/src/reference-seed.test.ts` (849 lines).
- Keys added at the end of `PERMISSION_SEEDS` with a per-entry comment block and
  a new `- EPIC-14 BILL-001 ...` bullet on the catalogue doc comment:
  `billing.read`, `billing.create`, `billing.confirm`, `billing.cancel`. No
  `billing.update` (the invoice is immutable from creation, [[DEC-038]]), no
  feature-code change (`billing` and `fiscal` already exist) and no change to
  `fiscal.invoice.issue`.
- Role matrix as finally verified: `OWNER` 56 keys, `ADMIN` 56, `VETERINARIAN`
  18, `RECEPTIONIST` 19, `CASHIER` 19, `INVENTORY_MANAGER` 19. All six hold
  `billing.read`; only `OWNER`, `ADMIN` and `CASHIER` hold `billing.create`,
  `billing.confirm` and `billing.cancel`.
- Pinned expectations reconciled: `permissions: 52 -> 56` and the exact
  `ROLE_PERMISSION_MATRIX.VETERINARIAN` array (`+ "billing.read"`). No other
  assertion needed changing; nothing was weakened.
- Gates: `reference-seed.test.ts` 27 tests passed; the whole database package
  `18 files / 399 tests passed`; `pnpm typecheck` 14/14; `pnpm format-check`
  clean. The parent re-ran the focused suite, the full package suite and
  prettier over the two files and reproduced all three.
- Seed idempotency reproduced exactly as CI does it, on the throwaway database
  `newsaas_verify_seed_w2_33045` (created and dropped inside the running
  container, never the development database): both `db:seed` runs produced
  identical counts —
  `roles: 6, permissions: 56, featureCodes: 12, plans: 1, rolePermissions: 187, planCapabilities: 12, species: 6, breeds: 9, taxRates: 3`.

### BILL-001 W3 — live-PostgreSQL invoice probes

- File: `apps/api/test/live-pg-isolation.e2e-spec.ts`, **insertions only**
  (`1183 0` per `git diff --numstat`): no existing block, fixture or assertion
  was modified. The new peer block
  `describe("EPIC-14 billing application-path isolation")` starts at line 12554
  and adds 14 tests.
- Coverage: the applied `invoice_status` enum order; the column shapes and
  nullability of the three tables (`14:2` money, `10:3` quantity, nullable
  `number`); the fifteen CHECK definitions read from `pg_constraint`; the
  partial `invoice_tenant_id_sale_id_key` predicate, the allocation key and the
  three ownership keys from `pg_index`; the eight RESTRICT FKs and the absence
  of CASCADE; the five triggers with their conditional predicates read from
  `pg_proc.prosrc`; and behaviour inside rolled-back transactions — a numbered
  draft and an unnumbered confirmation rejected, a cancelled insert without a
  reason rejected, a second live invoice for one sale rejected while a cancelled
  one and its replacement are admitted, the `DRAFT -> CONFIRMED` transition
  admitted, later updates and number reallocation rejected, every `invoice_line`
  update and delete rejected, a non-positive counter rejected and the atomic
  allocation admitted, and a no-residue count check.
- Gates: `pnpm --filter @newsaas/api test:live-pg` **134 passed (134)**; the
  same run shows `14 passed | 120 skipped` under `-t EPIC-14`, so the
  pre-EPIC-14 baseline is 120 and this slice adds exactly 14. `pnpm typecheck`
  14/14; `pnpm format-check` clean. The parent reproduced the full suite and the
  focused suite independently.
- Environment contract: the suite requires a **schema-less** `DATABASE_URL`. The
  workspace-root `.env` value carries `?schema=public`, and the suite builds a
  `psql` admin URL from it, so the run aborts in `beforeAll` with
  `psql: error: invalid URI query parameter: "schema"`. Exporting `DATABASE_URL`
  with the query string stripped (and the same for `DATABASE_URL_TEST`) makes it
  pass. This matches the EPIC-13 note and belongs to [[TD-021]].
- Finding worth recording: `invoice_number_never_reallocated` is **defence in
  depth, not the load-bearing guard**. For a non-`DRAFT` row the alphabetically
  earlier `invoice_no_update_when_not_draft` trigger raises first, and on a
  `DRAFT` row `number` must be NULL by `invoice_number_iff_confirmed`, so the
  reallocation trigger cannot be reached through normal DML. Its probe therefore
  disables the shadowing trigger inside a rolled-back transaction to isolate it,
  and asserts `tgenabled = 'D'` first so the isolation is proven rather than
  assumed. The number guarantee rests primarily on the header immutability
  trigger plus the biconditional CHECK.
- Documentation counter to reconcile at closure: the last recorded live-PG
  baseline in the docs is `119`, while the suite reports `120` before this slice
  and `134` after it. The delta is exactly the 14 new tests; the stale baseline
  is a docs counter, not a defect.

- **Gate omission caught at W4.** `pnpm lint` was missing from the W3 gate list
  the parent handed to the writer. Running it during W4 found exactly one error
  in the new probe — `@typescript-eslint/no-unsafe-assignment` from an object
  literal holding `expect.any(Date)` (the only such usage in the suite) — fixed
  by switching to the repository's existing
  `expect(stored[0]?.confirmed_at).toBeInstanceOf(Date)` pattern in a follow-up
  commit. `pnpm lint` is green at 14/14 tasks, and the W4 gate list now carries
  it explicitly. Lesson recorded: lint belongs in every work unit that touches a
  linted path, not only in the slice's final sweep.

## Evidence

### BILL-001 W1 — invoice data foundation (schema, migration, schema gate)

- Files: `packages/database/prisma/schema.prisma` (+273 lines: the Billing
  section banner, `enum InvoiceStatus`, `model Invoice`, `model InvoiceLine`,
  `model InvoiceNumberSequence`, and the `Tenant`, `Sale`, `Customer`, `TaxRate`
  and `CatalogItem` back-relations);
  `packages/database/prisma/migrations/20261001000001_billing_invoice_foundation/migration.sql`
  (new, 362 lines: one `CREATE TYPE`, three `CREATE TABLE`, eight indexes, eight
  RESTRICT FKs, five triggers); `packages/database/src/schema-billing.test.ts`
  (new, 729 lines, 38 tests).
- Committed trigger/constraint names: CHECKs `invoice_number_iff_confirmed`,
  `invoice_number_positive`, `invoice_series_not_blank`,
  `invoice_draft_not_confirmed`, `invoice_confirmed_requires_timestamp`,
  `invoice_cancelled_at_matches_status`, `invoice_cancel_reason_present`,
  `invoice_line_quantity_positive`, `invoice_line_unit_price_non_negative`,
  `invoice_line_line_total_non_negative`,
  `invoice_line_taxable_base_non_negative`,
  `invoice_line_tax_amount_non_negative`, `invoice_line_position_non_negative`,
  `invoice_line_description_not_blank`,
  `invoice_number_sequence_next_value_positive`; triggers
  `invoice_no_delete_when_not_draft`, `invoice_no_update_when_not_draft`,
  `invoice_number_never_reallocated`, `invoice_line_no_update`,
  `invoice_line_no_delete`; partial index `invoice_tenant_id_sale_id_key`
  (`... WHERE "status" <> 'CANCELLED'`).
- Gates: `db:generate` passed; `pnpm --filter @newsaas/database test` **18 files
  / 399 tests passed** (was 17/361, so `schema-billing.test.ts` adds 38);
  `pnpm typecheck` 14/14 tasks; `pnpm format-check` clean; `db:deploy` reported
  `28 migrations found` and applied exactly
  `20261001000001_billing_invoice_foundation`; `db:live-verify` printed
  `LIVE MIGRATION VERIFICATION PASSED`.
- `db:live-verify` is not idempotent and cannot pass against the development
  database (`live-a` / `live-b` exist since 2026-09-30, `P2002` on `slug`). It
  was therefore run on a throwaway database `newsaas_verify_epic14_bill001`,
  created and dropped inside the running container; the development database and
  its rows were not touched. This is the same fresh-database condition CI uses.
- Cross-epic counter bumped with an explicit authorization:
  `packages/database/src/schema-clinical.test.ts` pins schema-wide
  `@@unique([tenantId, id])` occurrences, `19 -> 22`, plus its model-list
  comment. This is the established per-epic update, not a weakened assertion.
- Two operational notes for later slices: `db:deploy` and `db:live-verify` fail
  with `P1012 Environment variable not found: DATABASE_URL` unless
  `DATABASE_URL` is exported from the workspace-root `.env`, which Prisma does
  not auto-load ([[TD-021]] territory); and the delegated writer echoed a local
  dev-database credential fragment once in its log. That credential is the local
  Docker dev value from the gitignored `.env`, not a repository secret, so no
  rotation is required — recorded here rather than left unnoticed.
- Documentation counters that must move at closure: `27 migrations` -> 28 and
  `52 permissions` -> 56 (`docs/01-roadmap/ROADMAP.md`,
  `docs/01-roadmap/EPIC-13-Cash.md`, `docs/10-qa/CI-EVIDENCE.md`,
  `docs/02-stories/CASH-002-cash-movement-commands.md`).

- Created: 2026-10-01.
- Branch at start: `main` tracking `origin/main`.
- Working branch: `docs/epic-14-billing-kickoff`.
- Kickoff commit: `df2feaa` —
  `docs(EPIC-14): add billing scope, planned stories and proposed decisions` (16
  new files; not pushed, no PR opened).
- Read-only exploration: `gentle-ai-explore` confirmed that no EPIC-14 artifact,
  no `Invoice`/`InvoiceLine`/`InvoiceStatus` model, no `billing/` or `fiscal/`
  API module and no numbering infrastructure existed before this pass, and that
  `fiscal.invoice.issue` is seeded but consumed by no route.
- Artifacts created (16 files, all new):
  - `docs/01-roadmap/EPIC-14-Billing.md`
  - `docs/02-stories/BILL-001-invoice-data-foundation.md`
  - `docs/02-stories/BILL-002-invoice-creation-and-read-api.md`
  - `docs/02-stories/BILL-003-invoice-confirmation-and-cancellation-commands.md`
  - `docs/02-stories/BILL-004-staff-billing-surface.md`
  - `docs/02-stories/BILL-005-epic-closure-and-evidence.md`
  - `docs/07-decisions/DEC-038` … `DEC-045` (eight proposed decisions)
  - `docs/08-tech-debt/TD-022-portal-invoice-document-surfaces-deferred.md`
  - this task file
- Story authoring was delegated to `gentle-ai-worker` with an explicit allowed
  edit surface of the five BILL story paths only; the parent authored the epic
  and the decisions. The parent then reconciled the story cross-references (BILL
  numbering in `related_stories`, the `series`/`number` nullability rule in
  DEC-039 and BILL-001, and the [[TD-022]] references after the debt record was
  created).
- Maintainer review outcome (2026-10-01): the eight decisions were accepted as
  proposed, with the three polish items below applied. The kickoff landed as
  `673cfb7` while the decisions were still `proposed`.
- Acceptance commit (2026-10-01, the second commit on
  `docs/epic-14-billing-kickoff`,
  `docs(EPIC-14): accept the billing decisions`): `DEC-038` through `DEC-045`
  moved to `status: accepted`, each `## Decision` section now carries the
  accepted option and its terms (following the EPIC-13/DEC-026 precedent), and
  every downstream claim was reconciled: the epic's `## Decisions / ADRs`
  section and its dependency list, the `proposed, not accepted` bullets in
  BILL-001 through BILL-004, and BILL-005's three references. The acceptance is
  a separate, auditable commit rather than an amend of the kickoff.
- Polish items applied:
  1. DEC-039 now prescribes **one atomic statement** for the number allocation
     (`UPDATE invoice_number_sequence SET next_value = next_value + 1 … RETURNING next_value - 1`)
     instead of a `SELECT ... FOR UPDATE` followed by a write, and says the
     statement's row lock is held until the `confirm` transaction commits.
  2. DEC-043 gained a `## Hand-off to EPIC-15` section: once a `FiscalDocument`
     exists, cancelling a `CONFIRMED` invoice must request fiscal cancellation
     through the Fiscal application interface or [[EPIC-15]] must record why it
     does not, because otherwise a `CANCELLED` invoice can coexist with an
     approved fiscal document.
  3. DEC-044 now names [[TD-022]] instead of "a debt record to be created", and
     the re-evaluation point is justified: the document a customer wants to open
     is the authorised fiscal document (the KuDE), which does not exist before
     [[EPIC-15]]/[[EPIC-16]].
- Checks run (2026-10-01):
  - `npx prettier --check` over the 16 files: passed.
  - Formatter idempotency (the [[TD-017]] hazard): a second `prettier --write`
    produced byte-identical files (`md5sum` diff empty).
  - Wikilink line-wrap guard: no unterminated wikilink at a line end.
  - `pnpm format-check` (repo-wide):
    `All matched files use Prettier code style!`
  - `git diff --check` over the new files: clean.
  - Not run on purpose: `lint`, `typecheck`, `test`, `build`, `test:live-pg`.
    This pass changed documentation only and touched no source, schema, seed or
    test file, so those suites are unaffected. They become required again at
    BILL-001.
- Open limitations of this pass:
  - `openspec/config.yaml` still carries a stale context line naming EPIC-09 as
    the next planned epic. It was deliberately not edited: it is an OpenSpec
    artifact and any refresh is the maintainer's call.
  - `FILE-MANIFEST.md` already does not list EPIC-09 through EPIC-13 docs and
    was left alone rather than diverging further.

### BILL-001 W4 — documentation reconciliation

- Reconciled the implemented slice into the repository records with **no**
  source, schema, migration, seed or test change:
  - `docs/07-decisions/DEC-038-invoice-sourcing-and-aggregate-shape.md` and
    `docs/07-decisions/DEC-039-invoice-numbering-and-allocation.md` each gained
    a `## Subsequent scope note`; the accepted `## Decision` text was left
    untouched. This follows the EPIC-12/[[DEC-026]] precedent: the note extends
    the accepted decision rather than rewriting it, so the partial sale index
    ([[DEC-038]]) and the biconditional number rule ([[DEC-039]]) are recorded
    as clarifications of an accepted decision, not as silent deviations.
  - `docs/02-stories/BILL-001-invoice-data-foundation.md`: `status: review`, the
    working branch, the corrected guarantee table (partial sale index; `series`
    NOT NULL defaulted to `'A'`), the ticked criteria with the real evidence,
    the implementation summary with the three commits and the two
    clarifications, the verification commands with their real results, the two
    environment conditions, the test inventory, the known limitations (including
    the shadowed-trigger finding) and the real file paths.
  - `docs/01-roadmap/EPIC-14-Billing.md`: one `## Progress` bullet for BILL-001.
    The epic's BILL-001 acceptance block stays unticked; BILL-005 reconciles it
    at closure with CI receipts. The `## Current state before implementation`
    snapshot was not touched.
- **No historical documentation counter was changed.**
  `docs/01-roadmap/ROADMAP.md`, `docs/01-roadmap/EPIC-13-Cash.md`,
  `docs/10-qa/CI-EVIDENCE.md` and
  `docs/02-stories/CASH-002-cash-movement-commands.md` still state
  `27 migrations`, `52 permissions` and a `119` live-PG baseline. Those are
  closure receipts of the state at those epics' closures, not live counters. The
  new `28 migrations`, `56 permissions` and `134` live-PG cases are left for
  BILL-005 to write into the EPIC-14 closure evidence. `docs/05-modules/**`
  stays untouched because BILL-005 owns the module doc.
- Gates: `npx prettier --write` and `npx prettier --check` over the five files,
  plus `pnpm format-check`. No test suite was run: no code changed.
