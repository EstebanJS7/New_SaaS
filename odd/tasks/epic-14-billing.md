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
`feat/epic-14-billing-invoice-foundation`; the docs commits are part of it,
matching the EPIC-13 precedent of one branch per epic carrying scope and
implementation).

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
  earlier `invoice_no_update_unless_permitted_transition` trigger raises first,
  and on a `DRAFT` row `number` must be NULL by `invoice_number_iff_confirmed`,
  so the reallocation trigger cannot be reached through normal DML. Its probe
  therefore disables the shadowing trigger inside a rolled-back transaction to
  isolate it, and asserts `tgenabled = 'D'` first so the isolation is proven
  rather than assumed. The number guarantee rests primarily on the header
  immutability trigger plus the biconditional CHECK.
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

### BILL-001 — RDD native review outcome (closed, approved)

- Lineage `review-b65dbcee62dc6d5b`, target `sha256:423807f0…` for the initial
  candidate and `sha256:6e486a1a…` after the correction; committed range
  `da7919b..e5d8848`, 12 paths, 3200 changed lines, high tier, four lenses
  (`review-risk`, `review-resilience`, `review-readability`,
  `review-reliability`), correction budget 200.
- The review raised one BLOCKER twice, independently:
  `R3-CONFIRMED-CANCELLATION` (reliability) and `R4-001` (resilience). The
  header `BEFORE UPDATE` guard rejected every update whose OLD status was not
  `DRAFT`, so a `CONFIRMED` invoice could never become `CANCELLED`, against
  [[DEC-043]] and against this migration's own comments. **Every local gate was
  green**, because the schema test and the live probe encoded the same wrong
  assumption as the trigger.
- Correction: `e5d8848`, 195 diff lines (145 added, 50 deleted), submitted as an
  exact correction plan and accepted as candidate tree `02ed9c43…`. The guard is
  now `invoice_no_update_unless_permitted_transition` with an exhaustive
  allow-list, plus a two-sided live regression probe.
- Outcome: the targeted validator ran on the corrected candidate, the review
  closed `approved` on its last admitted event, and the acknowledgement burned
  the authority with `burn_evidence: gentle-ai.review-acknowledged/v1`.
  `delivery: ordinary-repository-policy` — the review never authorizes delivery.
- Four non-blocking readability advisories (`R2-001`..`R2-004`, one WARNING and
  three SUGGESTIONs) were recorded as informational only. All four were stale
  claims left by the correction and the lint fix (a criterion still stating the
  imprecise number rule, a bullet still claiming lint was not run, and two block
  comment phrases describing the old trigger) and are fixed in this commit.
- Operative lesson recorded for the epic: the review caught a semantic
  cancellation-path blocker that lint, typecheck and both database suites could
  not see, because the tests mirrored the defect. Keep the review in the loop
  for every slice that writes a state machine, and never treat green gates as
  evidence that a transition is reachable.

### BILL-001 — publication and CI receipt

- The scope half of the chain is branch `docs/epic-14-billing-scope`, cut at
  `da7919b`, published as pull request **#86** (`type:docs`); run `36873574529`
  is green on both required checks (`Database migrations` 1m14s,
  `Lint, Typecheck, Test, Build` 4m21s).
- The implementation half is `feat/epic-14-billing-invoice-foundation`,
  published as pull request **#87** (`type:feature`) at head `17ebae5`; run
  `36873584746` is green on both required checks: `Database migrations` 1m8s and
  `Lint, Typecheck, Test, Build` 4m18s.
- The CI `Database migrations` job reproduced the whole persistence gate on a
  fresh database, including the number that locally required a throwaway
  database: `28 migrations found` with all of them applied, the reference seed
  run twice with the count-equality probe, and the live-PostgreSQL suite at
  **`Tests 135 passed (135)`**. The other job reported database 18 files, API 75
  files (1 skipped) and web 81 files.
- Both pull requests target `main`, because CI's required checks only run for
  pull requests targeting the default branch. #87's diff therefore also shows
  #86's records until #86 merges, so the merge order is #86 then #87.
- BILL-001 stays `review`: its own criterion is a CI run of the **merged** work
  units, so it moves to `done` when #87 merges, together with the QA evidence
  entry.

### BILL-001 — merged and closed

- Pull request **#86** merged as `15dc434` and pull request **#87** merged as
  `fc60d11`, in that order.
- The merged-receipt gate is run `36885623341` on `main` at `fc60d11`: both
  required checks `success` (`Database migrations` 15:38:07Z to 15:39:14Z,
  `Lint, Typecheck, Test, Build` 15:38:07Z to 15:42:32Z), with all 28 migrations
  applied to a fresh database.
- [[BILL-001]] moved to `done` with its acceptance criteria checked, and its
  three pre-implementation wordings were corrected while ticking them: the
  one-invoice rule is the partial index, the number rule is the biconditional,
  and the trigger rule is the transition allow-list.
- `docs/10-qa/CI-EVIDENCE.md` gained the EPIC-14 section with both runs, the
  local evidence and the review outcome.
- The epic stays `planned`: [[BILL-002]] through [[BILL-005]] remain, and
  [[TD-023]] stays open for BILL-003.

## BILL-002 — invoice creation and read API (work units)

Branch: `feat/epic-14-billing-invoice-api`, cut from `main` at `10ab908` after
BILL-001 closed.

### Pinned slice contract (parent-owned)

- Routes: `POST /invoices` (`billing.create`), `GET /invoices` and
  `GET /invoices/:id` (`billing.read`), all behind the `billing` entitlement.
- **`invoice_line.description` comes from `catalog_item.name`.** The column is a
  NOT NULL snapshot and `SaleLine` carries no description, so creation reads the
  catalog name for each copied line, tenant-predicated, in one query.
- **Length trap and its resolution.** `CatalogItem.name` is an unbounded
  `String` and `invoice_line.description` is `VarChar(200)`, so a verbatim copy
  can violate the column. Creation must NOT truncate silently: a line whose
  description exceeds 200 characters is rejected with a stable domain error. The
  narrower column is a defect of the BILL-001 data foundation and is recorded as
  [[TD-024]] for a later corrective migration.
- **No header totals are stored**; the DTO's `total` and `taxAmount` are
  projections summed locally from the invoice's own immutable lines with
  `Prisma.Decimal`, documented as a projection of frozen values. Billing must
  NOT import `apps/api/src/sales/sales.pricing.ts`.
- **No activation checks.** Creation requires the sale to be `COMPLETED` and,
  when `requireCustomerForInvoice` is on, the sale to carry a customer. A
  customer or catalog item deactivated _after_ the sale must never make a
  completed sale un-invoiceable.
- **No pagination.** `GET /invoices` filters by `status` and orders by
  `createdAt desc, id asc`, matching the shipped sales and cash lists; the
  unbounded list is recorded as a limitation rather than silently capped.
- `requireCustomerForInvoice` is read through
  `TenantSettingsService.get("sales")` and narrowed with a
  `typeof === "boolean"` defence, mirroring `SalesService.resolveCurrency`.
- A second invoice for a live sale is the partial unique index's `P2002`,
  translated to `409` by matching the index shape, following the `CashService`
  precedent. A cancelled invoice releases its sale.
- Audit action `invoice.created`, target type `invoice`, changed-field NAMES
  only.

### Work units

- [x] W1 — in-memory test boundary: the three invoice tables (delegates,
      registration, snapshot) so a Billing integration suite can run.
- [x] W2 — the billing module creation path: `POST /invoices`, the verbatim
      snapshot copy, the settings gate, the audit row and the stable errors,
      with the route pin and the integration suite.
- [x] W3 — the reads: `GET /invoices` and `GET /invoices/:id`, their pins, the
      integration cases and the live-PostgreSQL BILL-002 block.
- [x] W4 — docs reconciliation: the story record, the epic progress entry, the
      two stale invariant claims and [[TD-024]].

### BILL-002 W1 — in-memory test boundary

- `apps/api/test/support/in-memory-database.ts` gained the `invoice`,
  `invoice_line` and `invoice_number_sequence` delegates, their registration and
  snapshot entries, and the two constraint shapes the integration suite needs
  (`invoice_tenant_id_sale_id_key` for a second live invoice on one sale, and
  the allocation key), so a Billing integration suite can boot the real
  `AppModule` without a database.
- Insertions only: `442 0` in `git diff --numstat`, file at 4405 lines. No
  production code changed, and the existing suites prove the change is inert:
  the focused sales and cash integration suites passed 75 tests, and
  `pnpm --filter @newsaas/api test` stayed green.
- Gates: `pnpm lint`, `pnpm typecheck` and `pnpm format-check` green.

### BILL-002 W1 — RDD native review (closed, approved)

- Lineage `review-01c7a12dc4e54144`, candidate range `10ab908..68d1c1c`, 2
  paths, 506 changed lines, tier **medium**, one lens (`review-reliability`),
  correction budget 200. The provider derived one lens because the change is
  test infrastructure, not production behaviour.
- Outcome: **approved on the first pass**, no correction required; the
  acknowledgement burned the authority with
  `burn_evidence: gentle-ai.review-acknowledged/v1`.
- Two non-blocking advisories, both inside the fake invoice delegates: `R3-1`
  (WARNING, `in-memory-database.ts:3410`, the `invoice.findFirst` delegate) and
  `R3-2` (SUGGESTION, `:3443-3451`, the partial-unique enforcement in
  `invoice.create`). They are scheduled into W2 rather than patched blind: the
  fake's only real consumer is the Billing repository that W2 writes, so the
  `include`/`orderBy` fidelity and the constraint shapes can only be _verified_
  once that caller exists and the integration suite exercises them. Patching a
  test double from an advisory without its claim text would risk teaching the
  fake the wrong rule, which is exactly the mirrored-bug failure mode BILL-001
  already suffered.
- Operative lesson: a medium-tier candidate gets one lens, so this was fast and
  proportionate; keep test-infrastructure changes as their own candidate instead
  of burying them inside a feature commit, or the reliability lens never sees
  them.

### BILL-002 W2 — invoice creation path

- Created `apps/api/src/billing/`: `billing.permissions.ts` (the frozen four-key
  family; only `read`/`create` are consumed in this slice), `billing.zod.ts`
  (`.strict()` body so an unknown key is the stable `400`), `billing.dto.ts` (no
  `tenantId`, fixed-scale decimal strings), `billing.repository.ts` (`create`,
  tenant-predicated `findById` with ordered lines, the single-query
  `readCatalogItemNames`, one `INVOICE_NOT_FOUND_MESSAGE`), `billing.service.ts`
  (the entitlement and permission gates, one `$transaction`, the verbatim copy,
  the `P2002` → `409` translation, one co-committed audit row, the projections),
  `billing.controller.ts` (only `POST /invoices`), `billing.module.ts` and
  `billing.integration.test.ts` (12 cases). Changed `apps/api/src/app.module.ts`
  (registration before `PortalModule`), the route-contract probe (the
  `POST /invoices` inventory entry and its permission pin) and the in-memory
  fake.
- Size: 1828 new lines plus 89/15 tracked, about 1932 diff lines, all insertions
  except the two W1 advisory fixes.
- Pinned rejection paths: `403 FEATURE_NOT_ENTITLED`, `403 FORBIDDEN` (route
  guard and the service's defence-in-depth), `404` reusing the shared
  `SALE_NOT_FOUND_MESSAGE` for a foreign or unknown sale, `409` for a sale that
  is not `COMPLETED`, for a sale that already has a live invoice (the partial
  index's `P2002`, matched by index or column shape), for a description over 200
  characters and for the missing-customer setting gate, and `400` for every
  invalid body.
- Audit: `invoice.created`, target type `invoice`, changed-field NAMES only
  (`saleId`, `customerId`, `currency`, `lines`), co-committed inside the
  transaction so a rejection leaves no audit row.
- Projections: `total` and `taxTotal` are summed locally from the invoice's own
  frozen lines with `Prisma.Decimal`; `apps/api/src/sales/sales.pricing.ts` is
  not imported.
- Gates: the focused suite 12 tests; the whole API suite 76 files (1 skipped) /
  **1000 tests passed** / 135 skipped; `pnpm typecheck` 14/14; `pnpm lint`
  14/14; `pnpm format-check` clean. The parent re-ran the focused and full
  suites and prettier, and read the transaction, the copy, the matcher and the
  projections.
- Disclosed deviation, accepted: the invoice lines are walked in ascending
  `catalogItemId` order before `position` is assigned, because
  `SaleRepository.findById` declares no `orderBy` and an unordered read would
  make the frozen document layout non-reproducible. The sale model records no
  explicit line order, so this is a deterministic choice rather than a faithful
  one; it is recorded as a story limitation in W4.
- The two W1 advisories are closed against their real consumer: the fake now
  refuses an unscoped invoice header read loudly instead of answering across
  tenants, and its partial-unique check considers the incoming row's own status
  so a `CANCELLED` insert can never collide, which matches PostgreSQL.

### BILL-002 W2 — RDD native review (closed, approved)

- Lineage `review-4fe1a95e416b6b45`, candidate range `fbf8111..d508520`, 12
  paths, 1980 changed lines, tier medium, one lens (`review-reliability`),
  correction budget 200. **Approved on the first pass**, no correction; the
  acknowledgement burned the authority with
  `burn_evidence: gentle-ai.review-acknowledged/v1`.
- `R3-ORDERING-TIEBREAK` (WARNING, `billing.service.ts:217-219`) confirmed the
  deliberate deviation the writer disclosed: the invoice lines are ordered by
  ascending `catalogItemId`, which is deterministic but arbitrary. The root
  cause is outside Billing — `sale_line` records no order and `createdAt` is
  identical for one transaction — so it is recorded as [[TD-025]] with the fix,
  the backfill decision and the ownership. `invoice_line.position` already
  exists and is unique per invoice, so only the source order is missing.
- `R3-SETTINGS-INVALID-UNCOVERED` (SUGGESTION, `billing.service.ts:459-461`):
  the `typeof !== "boolean"` narrowing is unreachable because
  `TenantSettingsService.get` validates the stored namespace against its schema
  before returning, and the same unreachable defence exists in
  `SalesService.resolveCurrency`. Kept for consistency with that precedent and
  recorded as a deliberate coverage gap rather than deleted, so the module does
  not silently diverge from the shipped shape.
- Both advisories are informational and non-blocking, and both are carried into
  W4's story record and limitation list.

### BILL-002 W3 — invoice reads and live-PostgreSQL coverage

- `GET /invoices` (optional `status` filter, `createdAt desc, id asc`, no
  pagination) and `GET /invoices/:id`, both behind `billing.read` plus the
  `billing` entitlement in the same gate order the create path uses, and both
  reusing the single `INVOICE_NOT_FOUND_MESSAGE` so the masks are
  byte-equivalent by construction. The route-contract probe now pins the full
  read surface, so the three-route family is complete.
- Size: `1378` added / `24` removed across 7 files, of which 848 insertions are
  the live-PostgreSQL block.
- Gates: the billing suite **19 tests**; the API suite **76 files (1 skipped) /
  1007 tests passed** / 142 skipped; the live-PostgreSQL suite **142 passed**
  (was 135, so this slice adds 7 route-level cases); `pnpm typecheck` and
  `pnpm lint` 14/14; `pnpm format-check` clean. The parent reproduced the
  focused suite and the live-PostgreSQL suite.
- The live block proves the application paths over real HTTP against the
  disposable database: creation from a completed sale and the matching read with
  the copied values and the summed total, the list and the `status` filter in
  both directions, byte-equivalent `404`s between a foreign and an unknown
  invoice id and between a foreign and an unknown sale, the stable `409` for a
  second invoice on one sale, `403 FEATURE_NOT_ENTITLED` in an unentitled
  tenant, and a no-residue count check after every rejection.

### BILL-002 W3 — RDD native review (closed, approved)

- Lineage `review-d918081c81315de7`, candidate range `f2ce931..41e412b`, 8
  paths, 1427 changed lines, tier **high**, **four lenses** (`risk`,
  `resilience`, `readability`, `reliability`) — the tier came from
  `process_boundary` on the live-PostgreSQL spec, not from the production code.
  Four reviewers prepared and submitted; **approved**, no correction; the
  authority is burned with `burn_evidence: gentle-ai.review-acknowledged/v1`.
- `R4-UNBOUNDED-LIST` (WARNING, `billing.controller.ts:36-41`): the resilience
  lens flagged the unpaginated list, which was a pinned decision, not an
  oversight. The pattern is repo-wide — `GET /sales`, `GET /cash/sessions` and
  `GET /cash/movements` are equally unbounded — so it is recorded as [[TD-026]]
  with one shared pagination contract to apply to every staff list in a single
  slice, rather than silently capping one surface and truncating results.
- Three `readability` and `reliability` suggestions (`billing.zod.ts:57`,
  `billing.integration.test.ts:677`, `:933-935`, `:1104`) are informational test
  and schema polish, carried into W4's record.
- The risk lens returned the smallest review payload of the four (897 bytes)
  with nothing to report, which is a useful signal that the tenant isolation and
  the authorization sweeps held.

### BILL-002 W4 — documentation reconciliation

- [[BILL-002]] moved to `review` with its eleven acceptance criteria checked,
  the two stale domain invariants corrected while checking them (the one-invoice
  rule is the PARTIAL index, and `series` is NOT NULL defaulted to `'A'` rather
  than `NULL` while `DRAFT`), and the implementation, verification, tests,
  limitations, debt, files and completion sections rewritten against what
  actually shipped.
- The epic gained the BILL-002 progress entry; the epic's own acceptance block
  for BILL-002 stays unchecked because [[BILL-005]] reconciles the epic's
  criteria at closure against CI receipts.
- Three debt records now carry the slice's advisories: [[TD-024]] (the
  `VarChar(200)` description versus the unbounded catalog name), [[TD-025]]
  (sale lines record no order) and [[TD-026]] (every list endpoint is unbounded,
  with one shared pagination contract as the fix).
- [[TD-021]] gained a second concrete consequence: the live-PostgreSQL suite
  needs a schema-less `DATABASE_URL`, not just an exported one.

### BILL-002 — merged and closed

- Pull request **#89** merged as `c52b175`.
- The merged-receipt gate is run `36911300059` on `main` at `c52b175`: both
  required checks `success`, with all 28 migrations applied to a fresh database.
- [[BILL-002]] moved to `done` with its acceptance criteria checked (eleven in
  the story, six in the epic block) and the two pre-implementation wordings
  corrected while ticking them: the one-invoice rule is the partial index, and
  `series` is NOT NULL defaulted to `'A'`.
- `docs/10-qa/CI-EVIDENCE.md` gained the BILL-002 row and section.
- The epic stays `planned`: [[BILL-003]] through [[BILL-005]] remain, and
  [[TD-023]] through [[TD-026]] stay open.

## BILL-003 — invoice confirmation and cancellation (work units)

Branch: `feat/epic-14-billing-invoice-commands`, cut from `main` at `4c90c83`
after BILL-002 closed.

### Pinned slice contract (parent-owned)

- `POST /invoices/:id/confirm` behind `billing.confirm`: lock the invoice row
  `FOR UPDATE`, gate on `DRAFT`, allocate the number from the tenant sequence,
  write `CONFIRMED` plus `confirmed_at`, and co-commit exactly one audit row.
  The allocation and the transition commit together or not at all.
- **The allocation is ONE atomic statement that also creates the counter row**,
  because a tenant may have no `invoice_number_sequence` row yet:
  `INSERT INTO "invoice_number_sequence" ("tenant_id", "series", "next_value") VALUES ($1::uuid, 'A', 2) ON CONFLICT ("tenant_id", "series") DO UPDATE SET "next_value" = "invoice_number_sequence"."next_value" + 1, "updated_at" = now() RETURNING "next_value" - 1`.
  A fresh row returns 1 and an existing row returns its current value, with no
  read-then-write window.
- `POST /invoices/:id/cancel` behind `billing.cancel`: a required non-blank
  reason bounded to 500 characters, the `DRAFT` or `CONFIRMED` gate, the write
  to `CANCELLED` with `cancelled_at` and `cancel_reason`, the allocated number
  retained, and exactly one co-committed audit row.
- **Replay-safe by state, no key**: a retried confirm on a `CONFIRMED` invoice
  and a repeated cancel on a `CANCELLED` invoice return `200` with the same
  representation and write no second audit row ([[DEC-041]]).
- Audit actions `invoice.confirmed` and `invoice.cancelled`, target type
  `invoice`, changed-field NAMES only.
- [[TD-023]] is **this slice's**: a migration that `CREATE OR REPLACE`s the
  header guard so a permitted transition cannot change `tenant_id`, `id`,
  `sale_id`, `customer_id`, `currency`, `series` or `created_at`, and cannot
  move `confirmed_at` except on `DRAFT -> CONFIRMED`. Today the guard inspects
  the status transition only, so a cancellation could silently re-point the
  document.
- No event is emitted and nothing outside Billing is written ([[DEC-041]],
  [[DEC-042]], [[DEC-043]]).

### Work units

- [x] W1 — the TD-023 migration: the tightened header guard, its schema-gate
      update and the live-PostgreSQL probes for the rejected column changes and
      the admitted transition.
- [x] W2 — the confirm command: the locked read, the atomic allocation, the
      state write, the audit, the replay, the route pin and the integration
      cases.
- [x] W3 — the cancel command: the reason contract, the two-state gate, the
      terminal write, the audit, the replay, the route pin, the integration
      cases and the live-PostgreSQL command block including the
      concurrent-confirm overlap.
- [x] W4 — docs reconciliation: the story record, the epic progress entry,
      [[TD-023]] resolution and the new counters.

### BILL-003 W1 — TD-023 closed by tightening the header guard

- The additive migration `20261001000002_invoice_header_guard_tightening`
  `CREATE OR REPLACE`s the guard body without recreating the trigger and without
  touching any table: the three-transition allow-list is kept byte-identical,
  and a new ownership clause rejects a permitted transition that also changes
  `tenant_id`, `id`, `sale_id`, `customer_id`, `currency`, `series` or
  `created_at`, and forbids moving `confirmed_at` except on
  `DRAFT -> CONFIRMED`. `updated_at`, `cancelled_at`, `cancel_reason` and
  `number` keep their existing owners, so the tighten does not narrow the state
  machine.
- The schema gate gained three cases pinning the ownership clause per column,
  the strict additivity of the replacement (no table, trigger, type, index, row
  or DDL beyond the one function) and the classification prose.
- The live-PostgreSQL block gained two rolled-back cases: five identity-column
  rewrites during `DRAFT -> CONFIRMED` are rejected with their exact messages,
  and a `CONFIRMED -> CANCELLED` that moves `confirmed_at` or `currency` is
  rejected while the clean cancel succeeds keeping the allocated number and the
  original confirmation timestamp byte-equal.
- **Discrimination evidence, which is the point of this closure**: the writer
  re-armed the pre-TD-023 body on a throwaway database and ran the probe's exact
  tampering statement. It was **admitted** (`UPDATE 1`, row `CONFIRMED | USD`),
  proving the gap was real and that the new probe is not mirrored to a wrong
  assumption; after applying the migration unchanged, the same statement was
  rejected and no row changed. This is the BILL-001 mirrored-bug lesson applied
  before the fact rather than after a review.
- Gates: the database suite 18 files / **403 tests** (was 400); `db:deploy`
  reported **29 migrations** and applied the new one; `db:live-verify` printed
  `LIVE MIGRATION VERIFICATION PASSED` on throwaway databases; the
  live-PostgreSQL suite **144 passed** (was 142, and the 142 pre-existing cases
  are unchanged); `pnpm typecheck` and `pnpm lint` 14/14; `pnpm format-check`
  clean.
- Local state note: the development database now has migration 29 applied, a
  local-only change with no repository effect.
- [[TD-023]]'s own verification checklist is satisfied by the two live cases and
  the schema gate, so it can be marked `resolved` in W4.

### BILL-003 W1 — RDD native review (closed, approved)

- Lineage `review-b795346140ce8fe1`, candidate range `4c90c83..c384f61`, 4
  paths, 635 changed lines, tier **high**, **four lenses** (again driven by
  `process_boundary` on the live-PostgreSQL spec); **approved** with no
  correction, and the authority is burned.
- The first capture hit a genuine transport defect, not a content one: the
  readability reviewer's payload arrived as truncated JSON
  (`5 arrays opened, 4 closed`), so the provider **refused the submission at
  admission without consuming the slot** and preserved the rejected payload
  under `.git/gentle-ai/rejected-results/`. Two reviewers had already been
  admitted and two had not. Following the provider's instruction, fresh STATUS
  was queried and only the two reoffered slots were run, which closed the
  review. **Never resubmit refused bytes** is the rule that kept this clean.
- `R2-doc-duplicate-evidence-heading` (WARNING) and `R3-001` (SUGGESTION) both
  pointed at a duplicated `## Evidence` heading that this session's own
  documentation injection introduced in this file. Fixed in the same commit that
  records the outcome: an agent-generated docs defect caught by the review.
- `R2-live-pg-confirmed-at-null-handling` (SUGGESTION) asked for an explicit row
  count before dereferencing the queried confirmation row; an
  `expect(confirmed).toHaveLength(1)` was added, and the live-PostgreSQL suite
  was re-run at **144 passed**.

### BILL-003 W2 — confirm command

- `POST /invoices/:id/confirm` behind `billing.confirm`, no body and no
  `Idempotency-Key`, reusing the existing param schema and response DTO.
- Transaction order: row-lock the header `FOR UPDATE`, then the **post-lock
  authoritative read** (so a foreign or unknown id is the shared byte-equivalent
  `404` and writes nothing), then branch on the locked status — `CONFIRMED`
  returns the row unchanged with **no allocation and no second audit row** (the
  replay of [[DEC-041]]), `CANCELLED` is the stable `409`, and `DRAFT` allocates
  and transitions.
- The allocation is the pinned single statement:
  `INSERT INTO "invoice_number_sequence" ("tenant_id", "series", "next_value") VALUES ($1::uuid, $2, 2) ON CONFLICT ("tenant_id", "series") DO UPDATE SET "next_value" = "invoice_number_sequence"."next_value" + 1, "updated_at" = now() RETURNING "next_value" - 1`,
  read positionally so the arbitrary column alias cannot matter, refusing a
  non-positive result with a stable error rather than writing it. A fresh tenant
  row returns `1`; an existing row its next value.
- The conditional transition is
  `updateMany({ where: { id, tenantId, status: "DRAFT" } })`, and a `0`-row
  result is the lost-race backstop that raises the same stable `409` instead of
  a silent success. The lock is the raw tenant-predicated
  `SELECT ... FOR UPDATE` with explicit `::uuid` casts, following the sale/cash
  precedent and its documented `42883: operator does not exist: uuid = text`
  rationale.
- One co-committed `invoice.confirmed` audit row on a real transition, with
  changed-field NAMES only (`status`, `number`, `confirmedAt`).
- Size: `586` added / `23` removed across 6 files. Gates: the focused suite **25
  tests** (was 19); the API suite **76 files (1 skipped) / 1013 tests passed** /
  144 skipped; `pnpm typecheck` and `pnpm lint` 14/14; `pnpm format-check`
  clean. The parent re-ran the focused and full suites and prettier, and read
  the allocation, the lock, the conditional write and the transaction order.
- The tests cover the confirmed result, the **replay keeping the same number
  with the counter NOT advanced** (the number-skip guard a naive replay would
  break), the `CANCELLED` `409`, the byte-equivalent `404`, both authorization
  paths, and two invoices in one tenant receiving consecutive numbers.
- The durable live-PostgreSQL proof, including the concurrent-confirm overlap,
  lands in W3.

### BILL-003 W2 — RDD native review (closed, approved)

- Lineage `review-2b1723416d0631b5`, candidate range `266340f..fcfb50b`, 7
  paths, 647 changed lines, tier medium, one lens (`review-reliability`),
  correction budget 200. **Approved**, no correction; the authority is burned
  with `burn_evidence: gentle-ai.review-acknowledged/v1`.
- `R3-CONCURRENCY-COVERAGE` (WARNING, `billing.integration.test.ts:1195`) is the
  useful kind of finding: it confirms that the in-memory suite cannot prove the
  row-lock serialization, which is exactly the split this plan pins. The block's
  own doc comment already says so, and the finding converts that statement into
  an **obligation for W3**: the live-PostgreSQL block must prove the
  concurrent-confirm overlap (one admitted confirmation, exactly one number
  allocated, the loser seeing the same representation or the stable `409`, never
  a second number) or this WARNING stands uncovered. W3 does not close without
  it.
- One process note: the first facade STATUS was called with a base ref I typed
  instead of the one the provider composed, and the provider refused it with
  `git_command_failed` / `Needed a single revision` and a `not_started` mutation
  outcome. The composed value was recovered from the issued START command and
  the call succeeded. Never type a provider-composed selector: copy it.

### BILL-003 W3 — cancel command and the durable command coverage

- `POST /invoices/:id/cancel` behind `billing.cancel`: a `.strict()` body whose
  `reason` must be non-blank after trimming and at most 500 characters, with the
  database's `invoice_cancel_reason_present` CHECK as the backstop rather than
  the first line. Same shape as confirm: lock the header, read it post-lock so a
  foreign or unknown id is the shared byte-equivalent `404`, replay an already
  `CANCELLED` invoice unchanged with no write and no second audit row, otherwise
  the conditional `WHERE status IN ('DRAFT','CONFIRMED')` write whose zero-row
  result is the lost-race `409`.
- The reason TEXT never enters the audit trail: the metadata carries the field
  names `status`, `cancelledAt`, `cancelReason` and nothing else. The allocated
  number and the original `confirmed_at` survive a confirmed cancellation, which
  is the transition the W1 guard explicitly admits.
- **`R3-CONCURRENCY-COVERAGE` is closed, and better than the obligation asked.**
  The live block forces a GENUINE overlap on the SAME invoice by having a
  dedicated transaction hold the exact header row lock the command takes first,
  reading the row's `ctid` so it cannot move, and using `waitForRowLockWaiters`
  against that exact `(relation, page, tuple)` so BOTH confirmations are
  provably parked before either can read the status or allocate: the
  interleaving is decided by the database boundary, not by timing. It then
  asserts exactly ONE number across both responses, one header holding it, the
  counter advanced **exactly once** and exactly one audit row.
- It also adds a SECOND forced overlap, on the tenant's
  `invoice_number_sequence` row, proving two DIFFERENT invoices confirmed
  concurrently receive two DISTINCT consecutive numbers. That is the atomicity
  of the allocation statement itself, which the header lock cannot cover.
- Size: `1355` added / `45` removed across 8 files, of which 734 insertions are
  the live-PostgreSQL block. Gates: the focused suite **32 tests** (was 25); the
  API suite **77 files / 1173 tests passed** with `DATABASE_URL_TEST` exported,
  because the live-PostgreSQL spec then runs inside it (1020 + 153); the
  separate live-PostgreSQL run **153 passed** (was 144, so this slice adds 9);
  `pnpm typecheck` and `pnpm lint` 14/14; `pnpm format-check` clean. The parent
  re-ran all four and read the cancel transaction and the two overlap probes.
- The eight-route family is now complete in the route-contract probe: the frozen
  inventory and the per-route permission map hold all four `billing` routes.

### BILL-003 W3 — RDD native review (closed, approved)

- Lineage `review-7752615080dcd223`, candidate range `9579931..16fe4ec`, 9
  paths, 1439 changed lines, tier **high**, **four lenses**; **approved** with
  no correction, authority burned.
- The relay refused the risk lens' payload at admission TWICE with a truncated
  JSON envelope (`3 arrays opened, 2 closed`, preserving the payload under
  `.git/gentle-ai/rejected-results/`). Nothing was consumed
  (`submitted_reviewers: 0`) and the preserved bytes contained a complete
  verdict — the defect is in the envelope, not the review. Following the
  provider: fresh STATUS, re-run only the reoffered slots, **never resubmit
  refused bytes**. The third attempt submitted all four.
- `R3-1` (WARNING, `billing.zod.ts:65`) flagged the `.trim().min(1)` ordering on
  the cancel reason: if Zod validated the untrimmed value, a whitespace-only
  reason would pass the API and then fail the database CHECK as a 500-class
  error instead of the stable `400`. **Verified empirically rather than
  assumed**: a probe against the installed Zod 3.24 shows `"   "`, `""` and
  `"\t\n "` are all REJECTED and `"ok"` is accepted trimmed, so the check runs
  on the trimmed value and the advisory is informational. The ordering is subtle
  enough that it is recorded, so a later reader does not "fix" it into a bug by
  moving `.min(1)` before `.trim()`.
- Three readability suggestions (`live-pg-isolation.e2e-spec.ts:14911-14915`,
  `in-memory-database.ts:612-614`, `billing.integration.test.ts:728-734`) are
  informational comment and naming polish.

### BILL-003 W4 — documentation reconciliation

- [[BILL-003]] moved to `review` with its twelve acceptance criteria checked; it
  carried no stale invariant wording, so nothing needed correcting while
  checking them.
- The implementation, verification, tests, limitations, debt, files and
  completion sections were rewritten against what shipped, including the three
  approved reviews and the fact that W3 discharged W2's concurrency obligation
  with two forced overlaps instead of a timing assumption.
- [[TD-023]] is now **resolved**, with a `## Resolution` section naming the
  commit, the migration, the ownership clause, the discrimination evidence and
  the independent review confirmation.
- The epic gained the BILL-003 progress entry; the epic's own acceptance block
  for BILL-003 stays unchecked because [[BILL-005]] reconciles the epic's
  criteria at closure against CI receipts.
- Counters that move at closure, for BILL-005: **29 migrations** (was 28),
  live-PostgreSQL **153 cases** (was 142 at the start of the epic), database
  suite 18 files / 403 tests, and the `permission` count unchanged at **56**.

### BILL-003 — merged and closed

- Pull request **#91** merged as `558fe0b`.
- The merged-receipt gate is run `36956634087` on `main` at `558fe0b`: both
  required checks `success`, with all **29** migrations applied to a fresh
  database.
- [[BILL-003]] moved to `done` with its twelve acceptance criteria checked and
  the epic's own block ticked, and [[TD-023]] is `resolved`.
- `docs/10-qa/CI-EVIDENCE.md` gained the BILL-003 row and section.
- The epic stays `planned`: [[BILL-004]] and [[BILL-005]] remain, and
  [[TD-018]], [[TD-024]], [[TD-025]], [[TD-026]] stay open.

## BILL-004 — staff billing surface (work units)

Branch: `feat/epic-14-billing-staff-surface`, cut from `main` at `6717176` after
BILL-003 closed.

### Pinned slice contract (parent-owned)

- Mirror the EPIC-13 Cash surface exactly, because it is the shipped precedent:
  a Billing-owned route directory `apps/web/src/app/(app)/app/billing/` with the
  client module, the panels, the display/validation helpers and their tests, and
  an authenticated Next.js proxy at `apps/web/src/app/api/billing/[[...path]]/`.
- The proxy allowlists **only** the four Billing routes (`POST /invoices`,
  `GET /invoices`, `GET /invoices/:id`, `POST /invoices/:id/confirm`,
  `POST /invoices/:id/cancel`) and forwards **staff cookie context only**. It
  forwards no client-supplied tenant identifier, and it must reject a
  non-allowlisted path before reaching the API.
- The surface displays server-computed values as returned: **no money arithmetic
  in the client**, and the totals come from the API's projection. No fiscal
  state is displayed, because none exists.
- States to cover, each with a test: loading, empty, error, success,
  permission-denied and entitlement-denied, plus the distinct command outcomes
  (a confirm replay, a conflict, a cancel replay).
- The navigation entry is
  `{ href: "/app/billing", label: "Billing", requiredFeature: "billing" }` with
  the dormant-gate limitation recorded, and semantic design tokens only.
- **No portal route, no printable document and no export.** The route-contract
  probe's deferred portal roots must keep failing on `/portal/invoices`.
- Backend authorization remains the authority: the permission-denied and
  entitlement-denied branches are UX affordances only, and a backend `404` must
  render as an error state rather than as data.

### Work units

- [x] W1 — the proxy and the client transport: the `/api/billing` route with its
      allowlist and its tests, plus `billing-api.ts` and its tests.
- [x] W2 — the surface: the list panel with the status filter, the detail panel,
      the create-from-sale flow, the confirm and cancel actions, the page, the
      navigation entry and the full state coverage.
- [ ] W3 — docs reconciliation: the story record, the epic progress entry and
      the counters.

### BILL-004 W1 — staff proxy and client transport

- Four new files, `2049` insertions and no deletions: the proxy
  `apps/web/src/app/api/billing/[[...path]]/route.ts` (429 lines) with its suite
  (807), and the client `apps/web/src/app/(app)/app/billing/billing-api.ts`
  (398) with its suite (415). Roughly two thirds are tests.
- The proxy allowlists exactly the five shipped operations with their methods,
  forwards **staff cookie context only** (no `x-tenant-id`, no `authorization`,
  no synthesized permission header), rejects an out-of-allowlist path, method
  mismatch, out-of-contract query or malformed path before contacting the API,
  and exports no `PATCH`, `PUT` or `DELETE` — so no invoice can be patched or
  deleted through it.
- Two decisions the worker flagged, both accepted: the payload-free `confirm`
  body is **never read or forwarded** rather than refused, because the API
  declares no `@Body()` there and inventing a rejection message would add a
  [[TD-013]] divergence — note the cash precedent does not cover this case,
  since `POST /cash/sessions/:id/close` does carry a counted-amount body; and a
  single segment after `/invoices/` is an opaque id, so an export-shaped path is
  forwarded and refused by the API's own validation, which is the shipped cash
  behaviour and is pinned by a test.
- The client mirrors `cash-api.ts`: five typed helpers, the DTO-exact
  `Invoice`/`InvoiceLine` types with money and quantity as exact strings and
  **no arithmetic**, and failure predicates that keep `403`, `404` and `409`
  distinguishable so the surface can branch.
- Gates: the focused suites 43 tests; the web suite **83 files / 983 tests**
  passed (was 81 / 940); `pnpm typecheck` and `pnpm lint` 14/14;
  `pnpm format-check` clean. The parent re-ran the focused and full web suites
  and prettier, and read the allowlist, the cookie boundary and the client
  types.

### BILL-004 W2 — the staff Billing workspace

- 16 new files (2269 lines) plus the navigation entry (44/18 on two tracked
  files), about 2287 insertions: `page.tsx`, `billing-surface.tsx`, the
  `invoice-list`, `invoice-detail` and `create-invoice` panels, `billing-display`,
  `billing-validation` and `billing-outcome`, each with its colocated test.
- **No money arithmetic in the client, verified rather than asserted**: a grep for
  `parseFloat|parseInt|Number(|Math.|toFixed|.reduce(` over every non-test Billing
  UI module returns exactly one hit, and it is a comment stating that there is
  none. Amounts render through textual digit grouping only and the totals are the
  API's projected strings.
- State coverage with a named test for each branch: list loading, empty, error and
  success; detail loading, no-selection, error and the backend `404` rendered as an
  error rather than as data; the entitlement-denied workspace; the permission
  refusal; the create validation, conflict and success; and the confirm and cancel
  success and conflict outcomes.
- The navigation entry `{ href: "/app/billing", label: "Billing", requiredFeature:
  "billing" }` sits after Cash, and it **strengthened** the nav suite rather than
  narrowing it: the entry count moves 11 → 12, the new link's href and label are
  asserted, the placeholder slice index moves with it, and two new cases prove the
  `billing` gate is independent of `sales` and `cash` in both directions.
- Gates: the focused suites **102 tests** (11 files); the web suite **90 files /
  1050 tests** (was 83 / 983); `pnpm typecheck` and `pnpm lint` 14/14;
  `pnpm format-check` clean. The parent re-ran both suites and prettier, read the
  arithmetic grep and the full navigation diff.
- **One limitation the Story must record honestly**: the API returns the same
  `200` body for a fresh transition and for a replay and exposes no replay
  discriminant in the DTO ([[DEC-041]] chose that deliberately), so the surface can
  render a replay safely but **cannot display a distinct "already confirmed"
  outcome**. The acceptance criterion that asks for the replay as a distinct
  outcome is therefore only satisfiable in the weaker replay-safe-rendering sense,
  and W3 must say so rather than tick it as written.


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
  `invoice_no_delete_when_not_draft`,
  `invoice_no_update_unless_permitted_transition`,
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
- Working branch: `docs/epic-14-billing-kickoff`, renamed to
  `feat/epic-14-billing-invoice-foundation` when the implementation started (the
  EPIC-13 precedent of one branch per epic carrying scope and implementation).
- Kickoff commit: `673cfb7` —
  `docs(EPIC-14): add billing scope, planned stories and proposed decisions` (16
  new files). The scope records were later split onto their own branch
  `docs/epic-14-billing-scope`, cut at `da7919b`, and published as pull request
  #86.
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
- Acceptance commit (2026-10-01, now `da7919b`, and the tip of the
  `docs/epic-14-billing-scope` branch):
  `docs(EPIC-14): accept the billing decisions` moved `DEC-038` through
  `DEC-045` to `status: accepted`, each `## Decision` section now carries the
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
