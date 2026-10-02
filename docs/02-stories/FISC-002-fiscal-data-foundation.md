---
id: FISC-002
type: story
title: Fiscal data foundation
epic: EPIC-15
status: review
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
      isolation and rejected cross-tenant references. The probes are written and
      reviewed but **not executed**: this environment has no reachable
      PostgreSQL (see `## Verification`).
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
pnpm typecheck                        -> 14/14 tasks successful
pnpm lint                             -> 14/14 tasks successful
pnpm build                            -> 9/9 tasks successful
pnpm format-check                     -> all matched files use Prettier code style

NOT EXECUTED — blocked by the environment, not by the code:
live-PostgreSQL suite (`pnpm test:live-pg`) and `db:deploy` both require a
reachable PostgreSQL. This environment has none: Docker is not available in the
WSL distro, the installed PostgreSQL 16 cluster is DOWN, and starting it needs a
sudo password that is unavailable. The suite was therefore NOT run and the
migration was NOT applied to any database, so the applied-schema shape, the
trigger rejections and the 22 fiscal cases are written, reviewed and
typechecked but unproven at runtime. Closing this gate requires a live database;
it is recorded as the slice's open verification item rather than a silent gap.
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

- **The live-PostgreSQL gate is unexecuted.** No PostgreSQL was reachable in the
  implementation environment, so the migration was never applied and the 22
  fiscal cases never ran. This is the slice's single open verification item.
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

## Technical Debt

- None planned.

## Decisions / ADRs

- Depends on accepted [[DEC-046]], [[DEC-049]] and [[DEC-050]].

## Files / Modules

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20261002000001_fiscal_data_foundation/migration.sql`
- `packages/database/src/schema-fiscal.test.ts`
- `packages/database/src/schema-clinical.test.ts`
- `apps/api/test/live-pg-isolation.e2e-spec.ts`

## Completion Notes

_Status must remain non-done until all required gates pass._
