---
id: FISC-002
type: story
title: Fiscal data foundation
epic: EPIC-15
status: done
priority: high
depends_on:
  - FISC-001
prd_sections:
  - "22"
  - "40"
  - "41"
permissions:
  - fiscal.invoice.issue
branch: feat/epic-15-fiscal-data-foundation
created: 2026-10-02
updated: 2026-10-02
---

# FISC-002 — Fiscal data foundation

## Objective

Add the tenant-scoped FiscalDocument persistence foundation and additive invoice
linkage required by the Fiscal abstraction.

## Context

PRD §22 requires `FiscalDocument` to store provider, external id, state, CDC,
XML/KuDE storage refs, sanitized snapshots, attempts/errors and timestamps.
[[DEC-042]] requires additive invoice linkage and forbids fiscal state on the
Billing aggregate.

## In Scope

- Fiscal provider/state enums and `FiscalDocument` schema.
- Tenant ownership keys and source invoice ownership constraints.
- Storage-reference fields for XML/KuDE, CDC/external identifiers and sanitized
  snapshot/error fields.
- No seed, permission, feature-code, API, worker, provider, route or settings
  changes in this slice.
- Schema and live-PostgreSQL evidence.

## Out of Scope

- Provider execution, BullMQ worker and API submission flow.
- Concrete third-party/SIFEN provider fields beyond safe references.
- Portal documents and printed/PDF rendering.

## Acceptance Criteria

- [x] `FiscalDocument` exists as a tenant-scoped table with
      `@@unique([tenantId, id])` ownership and tenant-safe invoice linkage.
- [x] Fiscal states and provider enum values match the accepted decision and are
      represented without duplicating state onto `Invoice`.
- [x] Database constraints prevent duplicate live issuance for the same source
      invoice according to the accepted multiplicity/idempotency rule.
- [x] Request/response snapshots and provider errors are stored only in
      sanitized fields; secret material is not persisted. The schema fixes the
      storage shape (sanitized snapshot columns, no secret column, no credential
      field); the enforcement that actually strips provider payloads before
      persistence is FISC-003's `FakeFiscalProvider` sanitization contract.
- [x] Schema tests and live-PostgreSQL probes cover constraints, tenant
      isolation and rejected cross-tenant references. Evidence: 4 textual gates
      plus **23 executed live-PostgreSQL cases**; the whole suite is 176/176 and
      the migration applies as `20261002000001_fiscal_data_foundation` (30
      migrations total).
- [x] Seed-count and route-contract probes are reconciled if new fiscal keys or
      settings are added. Nothing was added, so nothing moved: the pinned probes
      stay at `permissions: 56` and `featureCodes: 12` ([[DEC-040]] already
      allocated `fiscal.invoice.issue` and the `fiscal` feature code in
      EPIC-01).

## Domain Invariants

- A private fiscal record is tenant-scoped and never cross-tenant addressable.
- A FiscalDocument references its source invoice through tenant ownership, not a
  bare UUID trust path.
- Fiscal state is immutable except through explicit Fiscal operations;
  structural guards prohibit deletion, any update of a `CANCELLED` row, identity
  changes, provider-reference rewrites and attempt-count decreases.
- At most one non-cancelled FiscalDocument exists per invoice; cancellation
  releases the partial unique key.
- `cancelled_at` is present exactly when the status is `CANCELLED`, so the
  cancellation timestamp and the state cannot disagree.
- No status transition allow-list is implemented here; it belongs to FISC-004.

## API

### Added

```text
None yet, unless accepted decisions require read endpoints in this slice.
```

### Changed

```text
None.
```

## Database

### Migration

```text
`packages/database/prisma/migrations/20261002000001_fiscal_data_foundation/migration.sql` (additive; no explicit transaction, row writes, drops or enum alterations).
```

### Models/Tables

- `fiscal_document` / `FiscalDocument`; no attempts helper table.
- `fiscal_provider`: `THIRD_PARTY`, `SIFEN_DIRECT`, `FAKE`.
- `fiscal_document_status`: `PENDING`, `QUEUED`, `SENDING`, `SUBMITTED`,
  `APPROVED`, `REJECTED`, `ERROR`, `CANCEL_PENDING`, `CANCELLED`; `SIGNING` is
  deliberately omitted until a real adapter requires it.
- Partial unique index `fiscal_document_tenant_id_invoice_id_key` on
  `(tenant_id, invoice_id) WHERE status <> 'CANCELLED'`; ownership key
  `(tenant_id, id)`; status and invoice lookup indexes.
- Named CHECKs `fiscal_document_attempt_count_non_negative` and
  `fiscal_document_cancelled_at_iff_cancelled`; RESTRICT tenant and composite
  invoice FKs.
- No external-id/status coupling is enforced. An earlier draft coupled
  `external_id` to a fixed state set, which would have rejected the legitimate
  `SUBMITTED` -> `APPROVED` -> `CANCELLED` path and over-constrained FISC-004's
  flow; provider-reference consistency belongs to FISC-004.
- Five structural triggers: no delete, cancelled immutable, identity immutable,
  provider references write-once and attempts monotonic. Only `CANCELLED` is
  treated as fully terminal: whether an `APPROVED` or `REJECTED` row may still
  move is a property of the transition graph, which FISC-004 owns. Enforcing
  broader terminal immutability before that graph exists would have made
  `APPROVED` -> `CANCELLED` impossible — the same defect class TD-023 recorded
  for the invoice header guard.
- No invoice series, number, currency, customer or money snapshot is duplicated:
  confirmed invoices are immutable, so consumers read through the composite
  tenant-ownership FK. Retries update the same document.

## UI

- None.

## Implementation Summary

Implemented the additive `FiscalDocument` persistence foundation: the two fiscal
enums, the tenant-scoped aggregate with its composite invoice ownership, two
named CHECKs, a mirrored partial unique index and five structural triggers, plus
the hand-written additive migration. The schema and its live-PostgreSQL probes
are covered by textual gates and by 22 written live-PostgreSQL cases.

Two guards pinned in the first contract draft were corrected during
implementation and both were the same defect class TD-023 recorded — a guard
written before the flow that would use it existed:

1. The dropped `fiscal_document_external_id_iff_resolved` CHECK would have
   rejected the legitimate `SUBMITTED` -> `APPROVED` -> `CANCELLED` path,
   because a cancelled document keeps its provider reference.
2. The renamed `fiscal_document_cancelled_immutable` trigger replaced a broader
   `terminal_immutable` guard that rejected every update to an `APPROVED` or
   `REJECTED` row, which made `CANCELLED` unreachable from those states.

The applied migration is the corrected one, and the live-PostgreSQL block
carries an explicit positive control proving the documented path is admitted.

No seed, permission, feature code, route, settings, API or worker change was
made, so the conditional seed AC is satisfied; the pinned probes remain
`permissions: 56` and `featureCodes: 12`.

## Verification

```text
TDD: disabled by `openspec/config.yaml` (`strict_tdd: false`,
`rules.apply.tdd: false`); RED/GREEN lifecycle not active.

pnpm --filter @newsaas/database test  -> 19 files / 407 tests passed
                                         (18 files / 403 tests before this slice;
                                          +4 cases in schema-fiscal.test.ts)
pnpm --filter @newsaas/database db:generate
                                     -> Prisma Client v6.19.3 generated
pnpm --filter @newsaas/database db:deploy
                                     -> 30 migrations applied to the local
                                        PostgreSQL 16 database, including
                                        `20261002000001_fiscal_data_foundation`
pnpm --filter @newsaas/api test:live-pg
                                     -> 176 passed (176), was 153 before this
                                        slice (+23 fiscal cases). The fiscal
                                        block alone: 23 passed (23).
pnpm typecheck / lint / build / format-check
                                     -> 14/14, 14/14, 9/9, clean

TDD: disabled by `openspec/config.yaml` (`strict_tdd: false`,
`rules.apply.tdd: false`); RED/GREEN lifecycle not active.
```

### What executing the gate changed

The live-PostgreSQL block was first run only after a local PostgreSQL became
reachable, and that run found **15 failures in the 22 written cases** — every
one a defect that reading and three review rounds had not caught. Five distinct
causes, all fixed:

1. `databaseMessage` compared against the server's whole render, which includes
   a newline and a `DETAIL: Failing row contains (...)` line, so every
   exact-message assertion failed. It now keeps the primary message only, which
   also stops row values from reaching an assertion.
2. `insertRawFiscalInvoice` defaulted to `series 'A', number 1`; `invoice`
   enforces `UNIQUE (tenant_id, series, number)` and the suite shares one
   tenant, so every case that created its own invoice collided with the fixture.
   Numbers now come from a block-local monotonic counter.
3. The identity probes passed an untyped parameter, so PostgreSQL rejected the
   statement with
   `column "tenant_id" is of type uuid but expression is of type text` before
   any trigger could run. Each probe now casts explicitly.
4. The `attempt_count >= 0` CHECK is unreachable on UPDATE: the monotonic
   trigger runs before the row's CHECK constraints and every decrease from a
   stored non-negative count is a decrease. The CHECK is now probed where it is
   actually reachable (INSERT) and the UPDATE path is probed against the
   trigger. The block gained a case: 22 → 23.
5. Two catalogue expectations were wrong about what PostgreSQL stores:
   `CHECK((attempt_count>=0))` carries no integer cast, and the cancellation
   predicate keeps no enum cast.

This is the concrete cost of the deferred gate that [[TD-027]] recorded, and the
reason that record existed rather than a silent gap.

```

## Tests Added

- `packages/database/src/schema-fiscal.test.ts` — **4 cases**: additive-only
  migration assertions, the two applied enum literals and their additive
  evolution doc comment, the ownership key and composite invoice FK ordering,
  the partial unique index predicate, both named CHECKs, the absence of the
  dropped `external_id_iff_resolved` constraint, the absence of the retired
  `terminal_immutable` name, and all five trigger bodies raising
  `restrict_violation`.
- `packages/database/src/schema-clinical.test.ts` — the frozen global ownership
  counter moved 22 → 23 with the comment list extended by `FiscalDocument`.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the
  `EPIC-15 fiscal data foundation` block, **22 cases** (lines 15605-16096): both
  enum orders, the exact `fiscal_document` column set and scalar types, both
  exact CHECK definitions plus the closed constraint-name set, the ownership and
  partial index definitions, the trigger catalogue with timing and events, the
  partial-index release after cancellation, both directions of the cancellation
  biconditional, the negative attempt count, DELETE refusal for every status,
  payload refusal on a `CANCELLED` row, per-column identity refusal, write-once
  `external_id`/`cdc`, monotonic attempt count, cross-tenant composite FK
  refusal, the admitted `PENDING` -> `SUBMITTED` -> `APPROVED` -> `CANCELLED`
  positive control, and a no-residue count invariant.

## Known Limitations

- No provider execution and no route until later fiscal stories; the
  `fiscal.invoice.issue` permission is still consumed by no route.
- No storage prefix or artifact write exists yet; `STORAGE_KEY_PREFIXES` still
  holds only `brandingAsset`, and the private XML/KuDE reference write lands
  with the first real artifact producer.
- Provider-payload sanitization is enforced only by the schema shape here; the
  code that performs it belongs to FISC-003.
- The `fiscal-ui` namespace belongs to FISC-005 and is still absent from
  `SettingsNamespace`.
- Status transition allow-list belongs to FISC-004, so an `APPROVED` or
  `REJECTED` fiscal document is still updatable at the database level until
  then.
- No attempt history table exists: `attempt_count`, the last-error pair and the
  audit trail carry retry history instead.

## Second review round

The follow-up work unit was reviewed as a new candidate and also closed
**approved and acknowledged** on lineage `review-49e414ffad03db30` (revision
`sha256:b539b70bfd0e1c5ed67be211fb14d342362684338a1e71ec696a87e69fae15b1`), four
lenses, zero corrections, four advisories. One of those advisories pointed at a
real setup defect that a run would have caught immediately and that is now
fixed:

- Four cases created their own fiscal document on `fiscalSaleAId`, whose live
  invoice slot the fixture invoice already holds at the
  `invoice_tenant_id_sale_id_key` partial index. Every one of them would have
  failed at its setup statement with a duplicate-key violation instead of
  reaching the trigger, CHECK or transition under test. Each now creates its own
  sale as well, which is why the block-wide check for
  `insertRawFiscalInvoice(tx, tenantAId, fiscalSaleAId)` is empty.

The three remaining advisories from this round are informational and recorded
rather than actioned: two are readability notes on the `enumDocComment` helper
and the cancelled-document case, and one is a reliability suggestion on the same
helper.

## Technical Debt

- No new slice-specific technical debt. [[TD-027]] recorded the unexecuted
  live-PostgreSQL gate as environment debt and is now `resolved`: the migration
  applied, the suite ran, and the 23 fiscal cases pass.

## Review record

The native review of this slice closed **approved and acknowledged** on lineage
`review-55a6586fdf5cc2c2` (revision
`sha256:84f8bb173babb35986e5480f8dd93d529f4ca1d133ebbe2b0fd5a307604a0785`), with
four lenses and no correction budget consumed. All nine findings were advisory
and none opened a correction. Four were actionable and were fixed in the
follow-up work unit rather than deferred:

- `R2-regex-escape` — the block's `databaseMessage` used `[\\s\\S]` instead of
  `[\s\S]`, a character class that matches a literal backslash or the letters
  `s`/`S`. It would have failed to extract Prisma's wrapped message, so every
  exact-message assertion in the block would have failed on first execution.
- `R3-001` — the partial-index case ran two rejected probes plus one admitted
  insert in a single transaction. PostgreSQL aborts a transaction on the first
  failed statement, so the second probe would have observed `25P02` instead of
  `23505`. It now uses one rolled-back transaction per rejection.
- `R2-delete-status-name` — the case claimed to probe deletion "for every
  status" while probing one. It now really covers `PENDING`, `SUBMITTED`,
  `APPROVED` and `CANCELLED`, each on its own sale and invoice because the
  invoice partial index admits one live invoice per sale.
- `R2-enum-doc-comment-scope` — the additive-evolution assertion matched the
  whole schema, so it would have passed even if the fiscal enums lacked the
  comment. It is now scoped to each fiscal enum's own doc comment.

The remaining advisories are recorded and not actioned:

- `R3-002` and `R4-live-pg-fixture-residue` — the block's `beforeAll` commits
  its fixture rows, so they persist in the test database. This deliberately
  matches the shipped EPIC-12/EPIC-14 blocks, whose fixtures are committed the
  same way; changing it here would make FISC-002 inconsistent with the file's
  established pattern for no behavioural gain.
- `R3-003` — an advisory on the block opening.
- `R4-unexecuted-db-gate-marked-complete` — the live-PostgreSQL AC is checked
  while its execution is unproven. That is exactly why [[TD-027]] exists and why
  this Story is `review`, not `done`.

## Decisions / ADRs

- Depends on accepted [[DEC-046]], [[DEC-049]] and [[DEC-050]].

## Files / Modules

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20261002000001_fiscal_data_foundation/migration.sql`
- `packages/database/src/schema-fiscal.test.ts`
- `packages/database/src/schema-clinical.test.ts`
- `apps/api/test/live-pg-isolation.e2e-spec.ts`

## Completion Notes

`done` on 2026-10-02. All six acceptance criteria are checked and every required
gate is green, including the live-PostgreSQL gate that this slice could not run
when it was first written.

Merged evidence: pull request #97 (`feat/epic-15-fiscal-data-foundation`),
stacked on the scope pull request #96. CI run **`37050111481`** is green on both
required checks. The `Database migrations` job applied **30 migrations** to a
fresh PostgreSQL 16 container, including
`20261002000001_fiscal_data_foundation`, reported
`All migrations have been successfully applied.`, re-seeded reference data to
identical counts (`permissions: 56`, `featureCodes: 12`, `rolePermissions: 187`),
passed `LIVE MIGRATION VERIFICATION PASSED`, and ran the live-PostgreSQL
application-path suite at **176 passed (176)** — the 23 fiscal cases included.
`Lint, Typecheck, Test, Build` is green as well.

Local evidence, all executed on a reachable PostgreSQL: `db:deploy` 30
migrations, `test:live-pg` 176/176, database suite 19 files / 407 tests,
`typecheck` 14/14, `lint` 14/14, `build` 9/9, `format-check` clean.

Four native review lineages closed approved and acknowledged with no correction:
`review-55a6586fdf5cc2c2`, `review-49e414ffad03db30`,
`review-a26929649a8d3a16` and `review-2c9359c3812696e8`. The advisories were
treated as candidate defects rather than style notes, which was correct: they
exposed a broken `[\\s\\S]` regex, two rejected probes sharing an aborted
transaction, a case named "for every status" that probed one, and four cases
creating a second invoice for the fixture sale. Even after that, the first
execution of the block still found 15 failures in 22 cases — the durable lesson
of this slice is that for a database artifact, review is not a substitute for
execution. [[TD-027]] recorded the deferred gate and is now `resolved`.

What this Story deliberately does **not** ship: no route, no worker, no
provider, no settings namespace and no seed change. The status transition
allow-list belongs to [[FISC-004]], which is why an `APPROVED` or `REJECTED`
fiscal document is still updatable at the database level until then.

```
