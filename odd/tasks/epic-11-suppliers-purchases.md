# EPIC-11 Suppliers/Purchases — planning and tracking

## Objective

Prepare EPIC-11 Suppliers/Purchases as the next roadmap epic after EPIC-10
Inventory, aligning the documentation surface before implementation: epic
record, initial stories, dependencies, acceptance criteria, and open
product/implementation decisions.

## Problem and why

The roadmap lists EPIC-11 as planned and dependent on EPIC-10, but no
`docs/01-roadmap/EPIC-11-...md` epic file or supplier/purchase story files exist
yet. PRD §17 defines only the purchase lifecycle minimum, so the project needs a
scoped implementation plan that preserves ledger-based inventory, auditability,
tenant isolation, and the approved MVP architecture.

## Current evidence

- `docs/01-roadmap/ROADMAP.md` lists EPIC-11 Suppliers/Purchases as planned
  after EPIC-10.
- `docs/00-product/PRD.md` §17 defines purchase states `DRAFT`, `RECEIVED`,
  `CANCELLED`; receiving validates `DRAFT`, creates stock movements, updates
  balances, marks `RECEIVED`, and writes audit atomically.
- `docs/05-modules/Inventory.md` explicitly leaves purchases/receiving to
  EPIC-11 and reserves inventory movement types for future owning commands.
- There is no EPIC-11 roadmap file and no supplier/purchase stories in
  `docs/02-stories/` yet.

## Scope

- Create the EPIC-11 roadmap document.
- Create initial story documents that split supplier foundation, purchase
  draft/write flow, receiving/inventory integration, and staff surface as
  reviewable units.
- Keep all artifacts in English per repository-facing documentation convention.
- Record open decisions as explicit questions or Decision needs rather than
  silently expanding PRD scope.

## Out of scope

- Source-code implementation.
- Schema migrations or API routes.
- PRD edits.
- Changing EPIC-09/EPIC-10 closure status.
- Committing, pushing, or opening a PR without explicit user instruction.

## Constraints

- Preserve tenant-scoped private resources and cross-tenant `404` behavior.
- Receiving must use explicit commands, database transactions, and inventory
  ledger movements; no direct balance mutation outside ledger semantics.
- Confirmed stock/cash/fiscal records remain immutable; corrections use explicit
  compensating operations.
- Supplier/purchase scope must not introduce cash, billing, fiscal provider
  calls, POS, or a new deployable/runtime.

## Delivery strategy

`ask-on-risk` (default). Forecast for this documentation slice: well under the
~400 authored-changed-line heuristic (five new Markdown files, no source code),
so a single PR slice is the working assumption; the user decides delivery.

## TDD resolution

- Mode: **off** (no project/session configuration enables it). This slice writes
  documentation only; no test runner applies.
- Source: no TDD configuration present for this repository's ODD flow.
- Runner: n/a for this slice; implementation slices will resolve the runner from
  the project commands.

## Route declaration per task

| Task | Route              | Trigger evidence                                                                                                                                   |
| ---- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1   | delegated          | Multi-file write rule (5 new docs) → `gentle-ai-worker`                                                                                            |
| D2   | delegated → inline | The worker created 3 of 5 files, then the launch was cancelled; the parent completed the 2 missing stories inline to avoid discarding partial work |
| D3   | inline             | Read-only verification over 5 known files (1–3-file read-only exception does not apply, but no writes occur)                                       |

## Tasks

- [x] D1: Draft EPIC-11 roadmap document with objective, scope, dependencies,
      acceptance criteria, exit criteria, decisions, and technical debt
      placeholders.
- [x] D2: Draft initial EPIC-11 story documents with narrow acceptance criteria
      and explicit out-of-scope boundaries.
- [x] D3: Read back the created docs and verify they do not silently expand PRD
      scope; report any unresolved product decisions before implementation.

## Acceptance criteria and checks

- EPIC-11 has a roadmap file linked to PRD §17 and dependent on EPIC-10.
- Initial stories are actionable, tenant-safe, and split into coherent
  implementation units.
- Story acceptance criteria mention authorization, tenant isolation, audit,
  inventory ledger integration, and applicable tests where relevant.
- Open uncertainties are documented as decisions/questions, not implemented
  assumptions.
- Documentation formatting is consistent with existing templates and status
  vocabulary.

## Files created

- `docs/01-roadmap/EPIC-11-Suppliers-Purchases.md`
- `docs/02-stories/SUP-001-supplier-foundation.md`
- `docs/02-stories/PUR-001-purchase-draft.md`
- `docs/02-stories/PUR-002-purchase-receiving.md`
- `docs/02-stories/PUR-003-staff-purchases-surface.md`
- `odd/tasks/epic-11-suppliers-purchases.md` (this document)

## Progress

- 2026-09-26: User selected “Preparar EPIC-11”; tracking document created before
  documentation writes.
- 2026-09-26: D1/D2 drafted via `gentle-ai-worker` (epic, SUP-001, PUR-001) and
  completed inline after the launch was cancelled (PUR-002, PUR-003).
- 2026-09-26: D3 read-back verification completed against PRD, TD-016 and the
  schema/seed evidence.

## Verification evidence

- All five documents carry conformant frontmatter (`type`, stable `id`,
  `status: planned`, `created`/`updated: 2026-09-26`, `epic: EPIC-11` for
  stories, `depends_on`).
- Every repository claim in the epic's "Current state before implementation"
  section was verified against code and docs:
  - `packages/database/prisma/schema.prisma:1332` pins `StockMovementType` to
    `ADJUSTMENT` with the reserved-types comment at line 1329.
  - No `Supplier`/`Purchase` model, no `app/api/src/suppliers|purchases` module,
    and no supplier/purchase permission seed exist.
  - `packages/database/src/reference-seed.ts:233` seeds the `purchases` feature
    code (PRD §10).
  - `stockSerializationLockKey` exists at
    `apps/api/src/inventory/inventory.repository.ts:181` and TD-016 names
    EPIC-11 as a future stock writer.
  - PRD section numbers cited (§5, §7, §9, §10, §16, §17, §27, §28, §29, §40,
    §41) exist and match the claims made about them.
  - The roadmap lists EPIC-12 as depending on EPIC-09/EPIC-10 only, so the
    epic's "EPIC-11 is not a dependency of EPIC-12" statement holds.
- Internal `[[...]]` link check over the five new documents: no unresolved link.
- No source file, migration, PRD section, module doc, roadmap status or existing
  story was modified (`git status` shows only the six added files above).

## Open product decisions (must be resolved before implementation)

The epic and stories record these as unresolved; none is implemented scope:

1. Supplier attribute set, uniqueness and data classification.
2. Purchase numbering (the engineering rules forbid `MAX(sequence) + 1`).
3. Purchase line cost and tax structure.
4. Supplier and line optionality; empty-draft rules.
5. Cancellation reachability (draft-only vs. received) and its relation to the
   deferred purchase reversal.
6. Receiving replay/idempotency semantics.
7. Non-tracking and inactive catalog-item line gates.
8. `suppliers.*` / `purchases.*` permission keys and role matrix; whether the
   `purchases` entitlement gates the surface.
9. Audit scope for supplier and draft administration.
10. Staff UI detail (screens, fields, receive affordance).
11. Multi-line receive lock acquisition order (deadlock avoidance across several
    `(tenant, item)` locks).

Each needs a Decision record under `docs/07-decisions/` before the dependent
schema or contract is written; an ADR is not expected, since EPIC-11 introduces
no architecture change.

## Next step

User decision: authorize the Decision records (one scoped slice) or authorize
the first implementation slice ([[SUP-001 Supplier foundation]]) once its
attribute Decision is accepted. No code should be written before then.

---

# EPIC-11 Decisions slice — tracking

## Objective

Close the eleven open EPIC-11 product/implementation questions with durable,
accepted Decision records under `docs/07-decisions/`, so implementation is not
blocked on unresolved scope.

## Authorization

Granted by the user on 2026-09-26: option 1, "Autorizar un slice acotado para
escribir los Decision records". Product choices remain the maintainer's: the
slice drafted proposals with options and a recommendation, then asked.

## Tasks

- [x] E1: Explore conventions (delegated to `gentle-ai-explore`): Decision
      format, permission keys/matrix/seeds and probes, entitlement precedent,
      audit writer, money/quantity column types, classification documentation,
      tenant-scoped module skeleton, and whether any numbering infrastructure
      exists.
- [x] E2: Draft seven Decision proposals with options and a recommendation
      (delegated to `gentle-ai-worker`, mode `task`): DEC-011 supplier identity,
      DEC-012 aggregate shape, DEC-013 line cost/tax, DEC-014 receiving
      semantics, DEC-015 cancellation boundary, DEC-016 permissions/entitlement,
      DEC-017 audit scope.
- [x] E3: Confirm each choice with the maintainer in two batched questionnaires.
      All seven were accepted as their recommended Option A on 2026-09-26.
- [x] E4: Mark the records accepted, align EPIC-11 and the four stories, and
      close the numbering gap the writer surfaced with DEC-018 (delegated to
      `gentle-ai-worker`, mode `task`).

## Route declaration per task

| Task | Route     | Trigger evidence                                                                                               |
| ---- | --------- | -------------------------------------------------------------------------------------------------------------- |
| E1   | delegated | 4-file rule: the mapping spanned the decisions corpus, seeds, RBAC, audit, entitlements and schema conventions |
| E2   | delegated | Multi-file write rule: 7 new documents                                                                         |
| E3   | inline    | Human decision gate; questionnaires to the maintainer                                                          |
| E4   | delegated | Multi-file write rule: 12 documents to edit plus 1 new record                                                  |

## Accepted decisions (2026-09-26)

| Record      | Scope                                                      | Accepted option                                                                                                                         |
| ----------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [[DEC-011]] | Supplier identity, uniqueness and classification           | A — minimal identity; `taxId` unique per tenant when present; CONFIDENTIAL contact/fiscal fields                                        |
| [[DEC-012]] | Purchase aggregate shape and the draft-versus-receive gate | A — required supplier, >=1 line, positive exact `Decimal(10,3)`, item state gated at receive                                            |
| [[DEC-013]] | Line cost and tax structure                                | A — one optional informational unit cost, no tax arithmetic, no valuation                                                               |
| [[DEC-014]] | Receiving semantics                                        | A — single-shot, replay is `409` and persists nothing, all-or-nothing line gates, one transaction, ascending `catalogItemId` lock order |
| [[DEC-015]] | Cancellation and correction boundary                       | A — `CANCELLED` only from `DRAFT`, `RECEIVED` immutable, future reversal                                                                |
| [[DEC-016]] | Permissions and entitlement gating                         | A — nine keys, six-role read / three-role write matrix, no entitlement gate, seed count 34 -> 43                                        |
| [[DEC-017]] | Audit scope                                                | A — one co-committed row per accepted mutation; no per-line rows; reads never audited                                                   |
| [[DEC-018]] | Purchase numbering                                         | A — no human-readable number in EPIC-11; deferred to the epic owning a printed or fiscal document                                       |

DEC-018 exists because the E4 writer refused to check a Decision-precondition
acceptance criterion that no record supported. It surfaced the gap instead of
guessing, which is the correct behavior; the maintainer then chose Option A
("sin numero en EPIC-11 + DEC-018").

## Verification evidence

- 8/8 records `status: accepted` and each `## Decision` opens with the mandated
  sentence `Accepted on 2026-09-26 by the maintainer. Option A is the decision:`
  (`grep -c`, one hit per file).
- Independent worker validation: read-back of all thirteen files, `## Decision`
  -> `## PRD Update` present in order, and a wording sweep for
  `pending Decision`, `No Decision is accepted yet`, `Blocked on the pending`,
  `under Open Questions`, `not approved scope`, `pending the attribute Decision`
  returning zero occurrences across the twelve EPIC-11 documents plus DEC-018.
- Parent spot check, re-run after the writer returned: the stale-wording sweep
  is empty; 8 decision statuses read `accepted`; exactly four `[x]` boxes exist
  across the epic and the four stories, one per document whose only checked
  criterion is the Decision precondition (epic, SUP-001, PUR-001, PUR-002), and
  no criterion requiring implemented behavior was checked.
- Numbers cited by DEC-016 were verified directly against the source: 34
  permission seeds, 12 feature codes, seed-count probe at
  `packages/database/src/reference-seed.test.ts:529`.
- `git status` shows only added EPIC-11 documents plus this tracking file;
  `docs/00-product/PRD.md` and `docs/01-roadmap/ROADMAP.md` are unchanged, as
  the governance rules require (a Decision proposal never edits approved PRD
  scope).
- No test suite applies: this slice writes documentation only, and nothing
  executable changed. TDD mode stayed off.

## What this slice did not do

- No source code, schema, migration, seed, route or test was written.
- No epic or story moved past `planned`; every criterion that requires
  implemented behavior remains unchecked.
- Nothing was committed; the review candidate is a work-unit commit, and no
  commit was authorized.

## Next step

Authorize the first implementation slice, [[SUP-001 Supplier foundation]], now
that DEC-011, DEC-016 and DEC-017 are binding. Delivery still needs an explicit
branch/commit decision.

---

# SUP-001 Supplier foundation — implementation tracking

## Objective

Implement the tenant-scoped supplier registry that EPIC-11 purchases reference:
persistence with tenant composite ownership, an additive migration, the four
`suppliers.*` permission keys with the DEC-016 matrix, and a tenant-safe
read/write API behind the real guard chain.

## Authorization and delivery decisions

- The user authorized the implementation slice and the branch/commit work on
  2026-09-26 ("autorizo y crea comitea").
- Branch: `feat/epic-11-suppliers-purchases`, created from `main` at `450b5f2`.
- Documentation committed first as two work units: `350e28e` (DEC-011..DEC-018),
  `7d0b4af` (epic, stories, this plan).
- Delivery strategy: `single-pr` on the feature branch, matching the shipped
  EPIC-09 (PR #64) and EPIC-10 (PR #66) convention of one feature branch merged
  once. Push and PR remain the user's decision.
- TDD: mode off (no project or session configuration enables it, and no runner
  is designated for ODD). Functional checks are the ordinary gate.

## Binding decisions for this slice

- [[DEC-011]]: fields `name` (required, 1..200), optional `legalName`, `taxId`,
  `email`, `phone`, `address`; `taxId` unique per tenant when present;
  active/inactive lifecycle with deactivation instead of delete; `taxId`,
  `legalName`, `email`, `phone`, `address` CONFIDENTIAL and `name` INTERNAL,
  with logs carrying ids only.
- [[DEC-016]]: keys `suppliers.read`, `suppliers.create`, `suppliers.update`,
  `suppliers.deactivate`; all six roles read,
  `OWNER`/`ADMIN`/`INVENTORY_MANAGER` write; no entitlement gate. This slice
  moves the seeded permission count 34 -> 38; the remaining five `purchases.*`
  keys that reach the DEC-016 total of 43 arrive with PUR-001/PUR-002.
- [[DEC-017]]: one co-committed audit row per accepted mutation (create, update,
  deactivate) with `metadata { schemaVersion, changedFields }`; reads are never
  audited.

## Tasks

- [x] W1: Data foundation — the `Supplier` model with the tenant composite
      ownership key, the additive migration (RESTRICT tenant FK, per-tenant
      `taxId` uniqueness that tolerates multiple NULLs, the name-length CHECK,
      the no-delete trigger), `schema-suppliers.test.ts` gates, the four
      permission keys with the DEC-016 matrix, and the seed-count probe
      reconciled.
- [x] W2: API surface — the `apps/api/src/suppliers/` module (permissions, DTOs,
      Zod contracts, tenant-safe repository, service, controller, module), the
      five routes, DEC-017 audit, the route-contract pins, the shared in-memory
      boundary extension, and the integration suite over the real guard chain.
- [x] W3: Remediation of the independent verification findings — the partial
      unique index DEC-011 mandates, and the stable `409` for a duplicate
      present `taxId`.

## Route declaration per task

| Task | Route     | Trigger evidence                                                           |
| ---- | --------- | -------------------------------------------------------------------------- |
| W1   | delegated | Multi-file write rule: schema, migration, schema test, seed and seed probe |
| W2   | delegated | Multi-file write rule: 7 new module files plus route pins and tests        |
| W3   | delegated | Verification findings remediation: migration, schema, service and tests    |

## Commits

| Commit    | Work unit                                                  |
| --------- | ---------------------------------------------------------- |
| `350e28e` | Accepted Decisions DEC-011..DEC-018                        |
| `7d0b4af` | Epic, four stories and this plan                           |
| `ed3b056` | W1 supplier data foundation (part superseded by `d39d90d`) |
| `d39d90d` | W1 correction: the partial unique index DEC-011 fixes      |
| `826e7ac` | W2 supplier API surface                                    |

## Acceptance criteria and checks

Inherited from [[SUP-001 Supplier foundation]]; the criteria that require
implemented behavior are the ones this slice must close. Cross-tenant and
unknown supplier ids must be one byte-equivalent `404`; unknown keys must be
rejected; `tenantId` must never be read from body, query or route; no Prisma
model may cross the HTTP boundary.

## Progress

- 2026-09-26: plan written before the first source write; W1 delegated.
- 2026-09-26: W1 committed as `ed3b056`; independent verification
  (`gentle-ai-verify`) then found a real nonconformance — the migration used a
  plain composite UNIQUE where DEC-011 fixes a partial unique index — plus the
  missing stable conflict for a duplicate present `taxId`.
- 2026-09-26: W3 remediation applied and committed as `d39d90d` (partial index,
  schema comment, schema gate) with the `409` mapping landing in the W2 commit;
  both findings are closed.
- 2026-09-26: W2 implemented and verified locally; committed as `826e7ac`
  together with this tracking update.
- 2026-09-26: second independent verification pass over the corrected range:
  PASS on all eight claims, no remaining accepted-decision deviation, with the
  live-database behaviour reported as unverified rather than passed.

## Verification evidence

- Parent spot check after remediation, run by the parent and not only reported:
  `pnpm --filter @newsaas/database test` -> 14 files / 245 tests passed;
  `pnpm --filter @newsaas/api test` -> 71 files passed, 1 skipped (72), 869
  tests passed, 52 skipped (the live-PostgreSQL suite).
- `pnpm --filter @newsaas/database typecheck`,
  `pnpm --filter @newsaas/api typecheck`, `pnpm --filter @newsaas/api lint` and
  `git diff --check` all clean.
- Writer-reported and parent-reviewed: the P2002 matcher accepts only
  `supplier_tenant_id_tax_id_key` (both the index-name and the column-name
  target shapes) and rethrows every unrelated `P2002`; the conflict message is
  value-free because the tax identifier is CONFIDENTIAL.
- Verification pass 2 (all eight claims PASS) added one limitation that is
  sharper than "the tests inspect counts": the duplicate-conflict HTTP tests
  **inject a synthetic `P2002`** shaped like the index violation rather than
  letting PostgreSQL raise it, because the in-memory double deliberately does
  not enforce partial indexes. They do assert the in-memory supplier state and
  audit counts and that the stored update fields are unchanged, so they are not
  status-only assertions; but the real path — PostgreSQL rejecting a duplicate
  present `taxId` through the partial index and Prisma surfacing it as `P2002`
  with `meta.target` — is **unproven**. The matcher's two accepted target shapes
  are a defensive guess at what Prisma emits for a raw-SQL partial index, and
  only a live database can confirm which shape actually arrives.
- Follow-up task recorded, not yet actionable: **live-PostgreSQL coverage for
  the supplier boundary** — duplicate present `taxId` rejected through the
  partial index and surfaced as the stable `409`, multiple absent `taxId` values
  coexisting, the same `taxId` allowed in another tenant, and `migrate status`
  showing no drift for an index Prisma cannot model. Blocked on a runnable
  database; folded into EPIC-11's durable live-PostgreSQL exit criterion rather
  than given its own debt record, because SUP-001's own acceptance criteria do
  not require it.
- Superseded line numbers for the record: the stale reports cite
  `migration.sql:57` and `schema.prisma:1455` for the plain composite UNIQUE.
  Those belong to `ed3b056`; the corrected revision has the partial index at
  `migration.sql:59` and no such schema attribute at all.
- Independent verification, pass 2 (all eight claims PASS): the partial index
  DDL matches DEC-011 exactly and no plain composite UNIQUE remains; the schema
  declares no `@@unique([tenantId, taxId])` and documents the raw index; the
  schema gate requires the predicate and states that it inspects DDL text; the
  conflict catch does not disturb the shared `404`, the permission re-assertion
  or the DEC-017 audit call; the conflict tests assert persistence and audit
  counts rather than only the status code; the W2 commit contains no file
  outside its allowed set; the five routes carry one seeded permission each with
  no `PATCH`/`DELETE`; and the four keys and their matrix are unchanged from W1
  with no `purchases.*` key added.
- `db:deploy`, `db:seed` and the live-PostgreSQL suite are UNRUNNABLE here: the
  Docker daemon is unavailable, so PostgreSQL on `localhost:5433` cannot start.
  As a consequence the migration application, the partial index's runtime
  enforcement (duplicate present identifier rejected, multiple absent
  identifiers coexisting, cross-tenant reuse allowed) and the real-PostgreSQL
  `409` path are asserted by construction or by injected errors, NOT executed.
  EPIC-11's exit criteria still require durable live-PostgreSQL evidence before
  the epic closes.
- Native risk assessment through `gentle_review` (`assess`) could not be
  produced for this candidate: the committed-range form returned
  `schema-incompatible` with zero changed paths, and the ambient form replied
  that there are no pending changes. Per the contract the candidate is therefore
  treated as high risk, which is why independent verification ran at each work
  unit; that pass is what found the index deviation.
- Verification pass 1 left one claim `UNVERIFIED` because it was authorized only
  `git show --stat`/`--stat` range forms and refused to run an extra git
  command: claim 5, the exact historical diff of
  `packages/database/src/schema-clinical.test.ts`. That verifier had already
  settled when it asked (the reply channel returned `query is unavailable`), so
  the parent closed the gap directly instead of leaving an open line in the
  record. Authorized and run by the parent:
  `git diff 450b5f2c8a99407e1891eb8951085f5d658d04cb..ed3b056 -- packages/database/src/schema-clinical.test.ts`.
  The diff is exactly two hunks in one `it` block — the explanatory comment now
  names `Supplier`, and the count literal moves 9 -> 10. The presence assertion
  `expect(SCHEMA).toMatch(/@@unique\(\[tenantId, id\]\)/)` and the count
  assertion both remain, the following `clinicalModels` block is untouched, and
  `grep -c '@@unique\(\[tenantId, id\]\)' packages/database/prisma/schema.prisma`
  returns 10, confirming `Supplier` is genuinely a tenth such model rather than
  a miscount. The file is byte-identical at `ed3b056` and at the branch head, so
  the historical diff is also the current diff. The equivalent
  `git diff ed3b056^ ed3b056 -- packages/database/src/schema-clinical.test.ts`
  form (`ed3b056^` = `7d0b4af`) was also run by the parent, and diffing the two
  command outputs shows them byte-identical, so the authorization scope does not
  change the evidence. Claim 5 is therefore VERIFIED: the pin reconciliation
  weakened nothing.
- Stale re-report checked and dismissed with evidence: the pass-1 finding (a
  plain composite UNIQUE on `(tenant_id, tax_id)` in the migration and in
  `Supplier`) was re-surfaced after remediation. It describes the pre-`d39d90d`
  revision and no longer holds. Verified against the branch head:
  `migration.sql:59` is
  `CREATE UNIQUE INDEX "supplier_tenant_id_tax_id_key" ON "supplier"("tenant_id", "tax_id") WHERE "tax_id" IS NOT NULL`;
  no plain `UNIQUE … tax_id` remains in the migration; `Supplier`'s only `@@`
  attributes are `@@unique([tenantId, id])`, `@@index([tenantId, name])` and
  `@@map("supplier")`, with `schema.prisma:1428` documenting the raw partial
  index; and the schema gate at `schema-suppliers.test.ts:127-149` requires the
  exact partial DDL while explicitly rejecting the plain approximation. The line
  numbers the stale report cites (`migration.sql:57`, `schema.prisma:1455`)
  belong to the superseded revision.
- Only that finding's last clause was ever in dispute-free agreement: the schema
  gate inspects DDL text, so runtime uniqueness is unproven here. It stays
  recorded as the live-database limitation above and is bounded by EPIC-11's
  exit criteria rather than by SUP-001.
- Operational caveat carried over from the accepted precedent rather than
  introduced here: because Prisma cannot express a partial index,
  `schema.prisma` does not declare it, so the index lives only in the migration
  SQL — the same condition the `customer_portal_access_active_*` and
  `patient_guardian_primary_active_key` indexes already live with. A
  live-database `migrate status`/drift check would settle it, and that check is
  unrunnable until a database can start.
- Reply-channel limitation observed twice, recorded so a future session does not
  mistake it for an unanswered question: the pass-1 verifier's follow-up queries
  (`q1`, then `q2` after it had already settled) were surfaced to the parent,
  but `subagent_reply` returned `query is unavailable` both times. The questions
  were therefore answered in this record instead of in the child session.
  Nothing was left pending as a result: `q1` asked for authorization to run an
  extra git command and `q2` asked the same in a different form, and both
  commands were run by the parent with their outputs recorded above. The child
  had already delivered its report, so no verdict was lost; future verifier
  authorizations should include the exact diff commands up front so the verifier
  never has to ask mid-task.

## Next step

Hand the epic back for its remaining stories: PUR-001 (draft lifecycle), PUR-002
(receiving, the slice that must acquire the ledger's advisory lock in ascending
`catalogItemId` order) and PUR-003 (staff surface), then close EPIC-11 with
durable live-PostgreSQL evidence once a database can run. Nothing has been
pushed; push and PR remain the user's decision.
