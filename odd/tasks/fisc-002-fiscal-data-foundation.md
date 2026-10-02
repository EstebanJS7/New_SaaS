---
feature: fisc-002-fiscal-data-foundation
epic: EPIC-15
story: FISC-002
status: in-progress
created: 2026-10-02
updated: 2026-10-02
branch: feat/epic-15-fiscal-data-foundation
base_commit: 59a5002
---

# FISC-002 Fiscal data foundation — ODD task tracker

## Goal

Ship the additive `FiscalDocument` persistence foundation for EPIC-15: enums,
tenant-scoped aggregate, additive invoice linkage, structural immutability
guards, a hand-written migration, schema tests and live-PostgreSQL probes — with
no API, no worker, no provider and no seed change.

## Pinned technical contract (decided by the parent, binding on the writer)

Derived from accepted DEC-046, DEC-049, DEC-050 and the shipped EPIC-14 Billing
precedent. These are technical modeling decisions, not product scope; they must
be recorded in the FISC-002 story's Database section in the same commit.

### Enums

```prisma
enum FiscalProvider {
  THIRD_PARTY
  SIFEN_DIRECT
  FAKE
  @@map("fiscal_provider")
}

enum FiscalDocumentStatus {
  PENDING
  QUEUED
  SENDING
  SUBMITTED
  APPROVED
  REJECTED
  ERROR
  CANCEL_PENDING
  CANCELLED
  @@map("fiscal_document_status")
}
```

Rationale to record:

- `FiscalProvider` values are PRD §22 verbatim (`THIRD_PARTY`, `SIFEN_DIRECT`,
  `FAKE`), appended never reordered, same doc-comment convention as
  `InvoiceStatus`.
- `FiscalDocumentStatus` is the SIFEN.md internal lifecycle minus `SIGNING`.
  `SIGNING` is omitted deliberately because it models XAdES signing of a SIFEN
  XML payload, which PRD §23 forbids implementing from memory; EPIC-16 appends
  it additively when a real adapter requires it. `CANCEL_PENDING` and
  `CANCELLED` are included because cancellation is in EPIC-15 scope per DEC-051.
- Both enums carry the
  `Values are appended, never reordered or removed. Evolve additively only.`
  doc-comment sentence, because `schema-billing.test.ts` asserts that exact
  sentence convention for enum evolution.

### Model

`model FiscalDocument` → `@@map("fiscal_document")`, with:

- `id String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid`
- `tenantId String @map("tenant_id") @db.Uuid`
- `invoiceId String @map("invoice_id") @db.Uuid`
- `provider FiscalProvider`
- `status FiscalDocumentStatus @default(PENDING)`
- `externalId String? @map("external_id")`
- `cdc String?`
- `xmlStorageKey String? @map("xml_storage_key")`
- `kudeStorageKey String? @map("kude_storage_key")`
- `requestSnapshot Json? @map("request_snapshot")`
- `responseSnapshot Json? @map("response_snapshot")`
- `attemptCount Int @default(0) @map("attempt_count")`
- `lastAttemptAt DateTime? @map("last_attempt_at")`
- `lastErrorCode String? @map("last_error_code")`
- `lastErrorMessage String? @map("last_error_message")`
- `submittedAt DateTime? @map("submitted_at")`
- `resolvedAt DateTime? @map("resolved_at")`
- `cancelledAt DateTime? @map("cancelled_at")`
- `createdAt DateTime @default(now()) @map("created_at")`
- `updatedAt DateTime @updatedAt @map("updated_at")`
- relations:
  `tenant Tenant @relation(..., onDelete: Restrict, onUpdate: Restrict)` and
  composite
  `invoice Invoice @relation(fields: [tenantId, invoiceId], references: [tenantId, id], onDelete: Restrict, onUpdate: Restrict)`
- `@@unique([tenantId, id])`, `@@index([tenantId, status])`,
  `@@index([tenantId, invoiceId])`

Deliberate non-duplication (record as a decision line in the story): the fiscal
row stores **no** invoice series, number, currency, customer or money snapshot.
A confirmed invoice is immutable and its number is never reallocated (DEC-039),
so the provider request is built by reading through the composite FK. Copying
money into Fiscal would duplicate Billing's frozen snapshot without a consumer.

Also deliberate: no helper attempts table. `attempt_count` plus the last-error
pair and the audit trail cover DEC-049's "retries update the same
FiscalDocument" without a second table.

### One active document per invoice

Partial unique index mirroring the shipped Billing precedent exactly:

```sql
CREATE UNIQUE INDEX "fiscal_document_tenant_id_invoice_id_key"
  ON "fiscal_document"("tenant_id", "invoice_id")
  WHERE "status" <> 'CANCELLED';
```

Rationale to record: at most one non-cancelled fiscal document per invoice,
forever. Re-issuing after a `REJECTED` or `ERROR` outcome requires explicitly
cancelling the previous document first, which is the `REVERSALS-CORRECTIONS`
policy ("correction creates an explicit reversal/compensation and a new correct
operation when needed") rather than a silent second document.

### Structural guards (FISC-002 scope)

- CHECK `fiscal_document_attempt_count_non_negative`: `attempt_count >= 0`.
- CHECK `fiscal_document_cancelled_at_iff_cancelled`:
  `(cancelled_at IS NULL) = (status <> 'CANCELLED')` — the cancellation
  biconditional, mirroring the invoice number rule. A `CANCELLED` document
  always carries `cancelled_at`; no other status may carry it.
- **Corrected during implementation.** The first pinned draft of this contract
  specified `fiscal_document_external_id_iff_resolved`:
  `(external_id IS NULL) OR (status IN ('SUBMITTED','APPROVED','REJECTED'))`.
  That predicate was defective and the parent corrected it before review: a
  document that is submitted, approved and then fiscally cancelled would carry a
  non-NULL `external_id` with `status = 'CANCELLED'`, so the CHECK would have
  rejected a legitimate transition and would have over-constrained FISC-004's
  flow — the same class of mistake TD-023 recorded for the invoice header guard.
  No external-id/status coupling is enforced in FISC-002; provider-reference
  consistency belongs to FISC-004. `schema-fiscal.test.ts` asserts the absence
  of the dropped constraint.
- Triggers, all raising `USING ERRCODE = 'restrict_violation'` with messages
  that name a column and never a stored value:
  - `fiscal_document_no_delete`: DELETE is always rejected. A fiscal record is
    never deleted; cancellation is a transition.
  - `fiscal_document_cancelled_immutable`: once `status` is `CANCELLED`, no
    UPDATE is permitted at all. **Narrowed during implementation.** The first
    pinned draft made every terminal status (`APPROVED`, `REJECTED`,
    `CANCELLED`) immutable, which would have rejected the legitimate
    `APPROVED -> CANCELLED` and `REJECTED -> CANCELLED` transitions and left
    `CANCELLED` unreachable from those states — the same defect class TD-023
    recorded when an EPIC-14 header guard made `CONFIRMED -> CANCELLED`
    impossible. Whether an `APPROVED` or `REJECTED` row may still move is a
    property of the transition graph, which FISC-004 owns.
  - `fiscal_document_identity_immutable`: on any permitted UPDATE, `tenant_id`,
    `id`, `invoice_id`, `provider` and `created_at` cannot change.
  - `fiscal_document_provider_refs_write_once`: `external_id` and `cdc` cannot
    be changed once they are non-NULL.
  - `fiscal_document_attempts_monotonic`: `attempt_count` cannot decrease.

**Explicitly out of FISC-002 scope:** the status _transition allow-list_.
FISC-002 ships no transition at all, so it ships no transition guard; shipping a
speculative allow-list before FISC-004 defines the queue flow is the TD-023
mistake EPIC-14 had to correct afterwards. FISC-004 owns the allow-list
migration, exactly as BILL-003 owned the invoice transition guard.

### Not in this slice

- No `STORAGE_KEY_PREFIXES` addition. Nothing writes a fiscal artifact in
  EPIC-15's fake path; the prefix and the private-reference write land with the
  first real artifact producer and must be recorded as a limitation.
- No settings namespace. `fiscal-ui` belongs to FISC-005 per DEC-052.
- No permission or feature-code seed change. `fiscal.invoice.issue` and the
  `fiscal` feature code already exist; the pinned probes stay at
  `permissions: 56`, `featureCodes: 12`.
- No route. `route-contract.probe.test.ts` changes in FISC-004, not here.

### Frozen counters to move

| Counter                                               | File                                                    | From | To  |
| ----------------------------------------------------- | ------------------------------------------------------- | ---- | --- |
| `@@unique([tenantId, id])` model count + comment list | `packages/database/src/schema-clinical.test.ts:185-192` | 22   | 23  |

`reference-seed.test.ts` probes must **not** move.

### Migration

Hand-written, no `BEGIN`/`COMMIT`, sorting after `20261001000002`:

```text
packages/database/prisma/migrations/20261002000001_fiscal_data_foundation/migration.sql
```

Must create the two types, the table, the inline named CHECKs, the ownership
unique index **before** the composite FK that targets it, the partial unique
index, the FK to `fiscal_document`/`invoice`/`tenant`, and the five trigger
functions plus triggers. Additive only: no `DROP`, no `INSERT`, no
`UPDATE ... SET`, no `ALTER TYPE`.

## TDD resolution

- Mode: **off**. Authoritative source: `openspec/config.yaml` sets
  `strict_tdd: false` and `rules.apply.tdd: false`; no session or project
  configuration enables it. This matches the resolution recorded for EPIC-12 and
  EPIC-13 slices.
- Consequence: no RED-first obligation and no Strict TDD runner. The gates are
  the focused database suite, the live-PostgreSQL suite, `db:generate`,
  `db:deploy`, `typecheck`, `lint` and `format-check`, with the exact commands
  recorded in the story's `## Verification` section.
- Runner if it were active: `pnpm test` (Vitest), per
  `openspec/config.yaml:testing.runner`.

## Tasks

- [x] T1 — Pin the contract into the FISC-002 story file (Database, Domain
      Invariants, In Scope, Known Limitations, Tests sections).
- [x] T2 — Add the enums, `FiscalDocument` model, `Tenant`/`Invoice`
      back-references and the additive migration.
- [x] T3 — Add `schema-fiscal.test.ts` with DDL/additivity/constraint/trigger
      gates and bump the frozen ownership-key counter 22 → 23.
- [x] T4 — Add the live-PostgreSQL `EPIC-15 fiscal data foundation` block with
      constraint, partial-index, trigger and cross-tenant probes. Written as 22
      cases; execution blocked because no PostgreSQL is reachable in this
      environment.
- [ ] T5 — Verify: database suite, live-PostgreSQL suite, `db:generate`,
      `db:deploy`, `typecheck`, `lint`, `format-check`; then native review. The
      database suite (19 files / 407 tests), `db:generate`, `typecheck` (14/14),
      `lint` (14/14), `build` (9/9) and `format-check` passed; the
      live-PostgreSQL suite and `db:deploy` remain blocked by the missing
      database and are the slice's only open verification item.

T1 is owned by the delegated writer, which pinned the contract into the story
file in the same commit as the schema it describes.

## Route declaration per task

| Task | Route     | Trigger evidence                                                                                                    |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| T1   | delegated | Writer pinned the story contract alongside the schema                                                               |
| T2   | delegated | 4-file rule: schema, migration, back-references, tests                                                              |
| T3   | delegated | Multi-file write: schema test plus the frozen counter in `schema-clinical.test.ts`                                  |
| T4   | delegated | Multi-file write: two sequential writer passes, split by size after the worker role failed on the large single task |
| T5   | inline    | Parent ran the gates and owns the verification record                                                               |

## Delegation incidents

- The `gentle-ai-worker` role failed four times: twice on a large single task
  (23 turns then an assistant error, and once at 1 turn) and once on a
  continuation. A small liveness probe succeeded, so the failure was
  size/context-related rather than a dead role. The slice was re-delegated as
  three small writer tasks and completed.
- The parent ran the live-PostgreSQL block's two halves sequentially because
  they edit the same file, and executed the remaining verification inline.
- The parent corrected two contract defects it had pinned itself; both are
  recorded above in the `## Pinned technical contract` section.

## Review record

- Native review of the first candidate closed **approved and acknowledged** on
  lineage `review-55a6586fdf5cc2c2` (4 lenses, 0 corrections, 9 advisory
  findings). Four advisories were actionable defects and were fixed in a
  follow-up work unit: the `[\\s\\S]` regex that would have broken every
  exact-message assertion, the two-rejections-in-one-aborted-transaction case,
  the "for every status" case that probed one status, and the schema-wide enum
  doc-comment assertion. See the Story's `## Review record` for the full triage.
- Consequence: the follow-up work unit is a NEW candidate and needs its own
  preflight, as the contract requires.

## Notes

- Base commit `59a5002` (the kickoff docs). Branch
  `feat/epic-15-fiscal-data-foundation`.
- No commit or push happens without the parent's workflow step; the parent owns
  commits and the review lifecycle.
