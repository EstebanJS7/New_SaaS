# Apply Progress: EPIC-06 Comprehensive Clinical Records

Change: `2026-09-11-epic-06-clinical` Artifact store: `openspec` (+ Engram
`sdd/2026-09-11-epic-06-clinical/apply-progress`) Mode: **Standard**
(`openspec/config.yaml` `strict_tdd: false`; no strict-TDD module loaded)
Delivery strategy: **force-chained** / chain strategy **feature-branch-chain**
Tracker branch: `feat/epic-06-clinical` (from `origin/main` @ `b7529a2`)
Work-unit branches: `feat/epic-06-clinical-wu1` (WU1, merged into the tracker
via PR #5), `feat/epic-06-clinical-wu2a-encounter-core` (re-sliced from
`feat/epic-06-clinical-wu2`, from tracker @ `d4e606f`). Batches: **WU1 — Data
Foundation** (complete, corrected, merged), **WU2A — Encounter Core** (complete,
merged into the tracker via PR #6), and **WU2B — Specialized Records**
(**implemented, fresh-reviewed and committed on
`feat/epic-06-clinical-wu2b-specialized-records`**, based on the latest tracker
`@ 11d144c`; maintainer-approved `size:exception`). Service-layer only: no
controllers, no Zod, no routes, no web, no live-PG evidence. No push, PR, or
merge performed.

## Completed Tasks

- [x] 1.1 RED: `packages/database/src/schema-clinical.test.ts` pins six models,
      enum, RESTRICT FKs, indexes, Decimal weight, and the CLOSED-update/DELETE
      trigger.
- [x] 1.2 GREEN: `schema.prisma` clinical section + additive migration
      `20260912000001_clinical/migration.sql` with guarded immutability
      triggers.
- [x] 1.3 RED then GREEN: `reference-seed`
      (`vet.clinical.read/update/close/amend` + role matrix) and `demo-seed`
      (`seedDemoClinical`, synthetic no-PII fixture).
- [x] 2A.1 RED: `apps/api/src/clinical/clinical.service.test.ts` pins
      version/stale 409, CLOSED 409, exactly-one transactional audit, amendment
      reason/permission/idempotency/concurrency recovery, audit rollback,
      veterinary entitlement, cross-tenant 404, allowlisted projection and
      client-safe `internalNotes` exclusion (spec Lifecycle, Autosave,
      Amendments, Audit, Isolation). **26 tests**, all green (exact-target
      `P2002` recovery and an unrelated-target rethrow are pinned).
- [x] 2A.2 GREEN: `apps/api/src/clinical/clinical.service.base.ts`,
      `clinical.service.ts` (server tenant context, conditional
      `updateMany(status=DRAFT, version=N)`, `SELECT ... FOR UPDATE` amendment
      lock + in-tx idempotency replay + P2002 recovery, `AuditWriter`
      co-committed transaction), `clinical.dto.ts` (encounter allowlist),
      `clinical.module.ts` (provides/exports **only** `ClinicalService`), and
      `ClinicalModule` registered in `apps/api/src/app.module.ts`.
- [x] 2B.1 RED: `apps/api/src/clinical/clinical.records.service.test.ts` covers
      the five subdomain record kinds (treatment, vaccination, deworming, study,
      weight), tenant-scoped create/list/update, exactly-one co-committed audit,
      invalid-weight rejection with nothing persisted, and cross-tenant 404 with
      nothing persisted. **7 tests**, all green.
- [x] 2B.2 GREEN: `apps/api/src/clinical/clinical.records.service.ts`
      (`ClinicalRecordsService` extends `ClinicalServiceBase`) +
      `clinical.records.dto.ts` (allowlisted responses); `clinical.module.ts`
      now provides/exports `ClinicalRecordsService` on top of the unchanged
      `ClinicalService` encounter core.

## Files Changed — WU1 (Data Foundation)

| File                                                                        | Action   | What Was Done                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/database/prisma/schema.prisma`                                    | Modified | `ClinicalEncounterStatus` enum + 6 tenant-scoped, Patient-anchored clinical models (encounter, treatment, vaccination, deworming, study, weight) with RESTRICT relations and back-relations on `Tenant`/`Patient`/`UserProfile`. Correction: `Patient`/`ClinicalEncounter` gain `@@unique([tenantId, id])`, and every clinical patient/amendment relation is a composite FKs on `(tenantId, patientId)`/`(tenantId, amendsEncounterId)` → same-tenant key. |
| `packages/database/prisma/migrations/20260912000001_clinical/migration.sql` | Created  | Additive DDL: 6 tables, enum, 14 RESTRICT FKs (6 tenant + 6 COMPOSITE `(tenant_id, patient_id) → patient(tenant_id, id)` + 1 COMPOSITE same-tenant amendment self-FK + 1 close actor), 2 tenant-ownership unique keys, 8 indexes/unique, `quantity > 0` CHECK, CLOSED-immutability + no-delete triggers.                                                                                                                                                   |
| `packages/database/src/schema-clinical.test.ts`                             | Created  | 15 schema/migration inventory assertions for WU1, including composite tenant-ownership FK/index coverage and key-before-FK ordering.                                                                                                                                                                                                                                                                                                                       |
| `packages/database/src/reference-seed.ts`                                   | Modified | Added `vet.clinical.read/update/close/amend` permissions; granted the full clinical set to OWNER/ADMIN/VETERINARIAN.                                                                                                                                                                                                                                                                                                                                       |
| `packages/database/src/reference-seed.test.ts`                              | Modified | New clinical catalog/matrix test; updated pinned `VETERINARIAN` array and permission volume (19 → 23).                                                                                                                                                                                                                                                                                                                                                     |
| `packages/database/src/demo-seed.ts`                                        | Modified | Exported `DEMO_PATIENT_DOG_ID`; added `seedDemoClinical` + structural client contracts; synthetic encounter + weight fixture.                                                                                                                                                                                                                                                                                                                              |
| `packages/database/src/demo-seed.test.ts`                                   | Modified | 5 tests: anchoring/state, no-PII synthetic content, single transaction, rerun convergence, missing-patient failure.                                                                                                                                                                                                                                                                                                                                        |
| `packages/database/prisma/demo-seed.ts`                                     | Modified | Wired `seedDemoClinical` into the guarded entrypoint and extended the run log.                                                                                                                                                                                                                                                                                                                                                                             |

## Files Changed — WU2A Encounter Core (corrected boundary)

WU2A impl = **827** changed lines (`permissions` 16 + `dto` 59 + `base` 113 +
`service` 610 + `module` 27 + `app.module` 2); + 706 test = **1,533** including
tests (updated by Correction Pass 2; the maintainer-approved WU2A
`size:exception` remains in force).

| File                                             | Action   | What Was Done                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/clinical/clinical.permissions.ts`  | Created  | Canonical `vet.clinical.read/create/update/close/amend` contract (mirrors `patients.permissions.ts`); keys already seeded by WU1. Shared with WU2B; owned by WU2A.                                                                                                                                                                                                                     |
| `apps/api/src/clinical/clinical.dto.ts`          | Created  | Encounter allowlist, `CLINICAL_DTO_SCHEMA_VERSION`, exported `toIso`, and `toClientSafeEncounter()` which strips staff-only `internalNotes` without mutating the input.                                                                                                                                                                                                                |
| `apps/api/src/clinical/clinical.service.base.ts` | Created  | `ClinicalServiceBase<TPrisma>`: tenant context, `veterinary` entitlement, granular permission, `assertPatient`, co-committed `appendAudit`. Shared with WU2B; owned by WU2A.                                                                                                                                                                                                           |
| `apps/api/src/clinical/clinical.service.ts`      | Created  | `ClinicalService`: encounter create/list/get, version-guarded DRAFT autosave, version-guarded close, linked audited amendment, `findEncounterOrThrow`. Amendment is concurrency-safe: `SELECT ... FOR UPDATE` on the original inside the tx, in-tx idempotency replay, and P2002 unique-conflict recovery (review finding 2). Exactly one co-committed `AuditWriter` row per mutation. |
| `apps/api/src/clinical/clinical.service.test.ts` | Created  | **26** focused encounter-core tests on a copy-on-write fake-Prisma transaction harness, including audit-failure rollback (review finding 3), concurrent idempotency recovery, and the exact-target `P2002` gate (unrelated target rethrown).                                                                                                                                           |
| `apps/api/src/clinical/clinical.module.ts`       | Created  | `ClinicalModule` imports Context/RBAC/Audit/Entitlements (leaf consumer) and provides/exports **only** `ClinicalService`. WU2B's `ClinicalRecordsService` is intentionally NOT wired here (review finding 1). No controllers in WU2A.                                                                                                                                                  |
| `apps/api/src/app.module.ts`                     | Modified | Registered `ClinicalModule` after `PatientsModule`; no guard-chain order change (Clinical exposes no `APP_GUARD`).                                                                                                                                                                                                                                                                     |

## Re-slice Pass — WU2 → WU2A Encounter Core + WU2B Specialized Records (2026-09-12)

Maintainer decision: do **not** apply the 2,104-line `size:exception`; split the
uncommitted WU2 for maintainability and CI diagnosis. Delivery context is
unchanged (force-chained / feature-branch-chain). This is a file-boundary
refactor plus SDD bookkeeping only — **approved product scope is unchanged**.

### Boundary

- **WU2A Encounter Core**: `ClinicalEncounter` lifecycle only —
  `ClinicalService` create/list/get, versioned DRAFT autosave, close, linked
  audited amendments, the shared tenant/entitlement/permission/audit base,
  client-safe DTO mapping, module registration, and tests.
- **WU2B Specialized Records**: treatments, vaccinations, deworming, studies,
  and weights create/list/update (`ClinicalRecordsService`) and their focused
  tests.

### File layout after re-slice

WU2A (implementation + tests):

| File                                             | Lines | Role                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/clinical/clinical.permissions.ts`  | 16    | Canonical `vet.clinical.*` keys (shared by both slices; owned by WU2A).                                                                                                                                                              |
| `apps/api/src/clinical/clinical.dto.ts`          | 59    | Encounter allowlist, `CLINICAL_DTO_SCHEMA_VERSION`, `toClientSafeEncounter`, exported `toIso`.                                                                                                                                       |
| `apps/api/src/clinical/clinical.service.base.ts` | 113   | `ClinicalServiceBase<TPrisma>`: tenant context, `veterinary` entitlement, granular permission, `assertPatient`, co-committed `appendAudit`.                                                                                          |
| `apps/api/src/clinical/clinical.service.ts`      | 610   | `ClinicalService`: encounter types, create/list/get, version-guarded DRAFT autosave, close, linked audited amendments, `findEncounterOrThrow`; concurrency-safe amendment (FOR UPDATE + in-tx replay + exact-target P2002 recovery). |
| `apps/api/src/clinical/clinical.service.test.ts` | 706   | 26 encounter-core tests on a copy-on-write fake-Prisma harness (incl. audit rollback + concurrent idempotency recovery + unrelated-P2002 rethrow).                                                                                   |
| `apps/api/src/clinical/clinical.module.ts`       | 27    | Provides/exports **only** `ClinicalService` (WU2A). WU2B re-adds `ClinicalRecordsService` in its own slice.                                                                                                                          |
| `apps/api/src/app.module.ts`                     | +2    | `ClinicalModule` registration (unchanged from the original WU2).                                                                                                                                                                     |

WU2B:

| File                                                     | Lines | Role                                                                                                                                                                         |
| -------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/clinical/clinical.records.dto.ts`          | 61    | Allowlisted treatment/vaccination/deworming/study/weight response contracts.                                                                                                 |
| `apps/api/src/clinical/clinical.records.service.ts`      | 783   | `ClinicalRecordsService extends ClinicalServiceBase`: five subdomain row/input/delegate types, create/list/update, generic `createRecord`/`updateRecord`, weight validation. |
| `apps/api/src/clinical/clinical.records.service.test.ts` | 299   | 4 specialized-record tests on a records-only fake-Prisma harness.                                                                                                            |

Refactor mechanics:

- Extracted the shared boundary into `clinical.service.base.ts`
  (`ClinicalServiceBase<TPrisma extends ClinicalBasePrisma>`); both services
  declare explicit constructors so Nest DI metadata is emitted per concrete
  class. WU2A never imports a WU2B file; WU2B depends on WU2A
  (`clinical.service.base.ts`, `clinical.dto.ts`, `clinical.permissions.ts`).
- `clinical.dto.ts` now holds only the encounter allowlist; subdomain response
  types moved to `clinical.records.dto.ts`.
- The single 658-line fake-Prisma test file was split into an encounter-only
  test and a records-only test; each carries only the harness it needs.
- Behavior is equivalent: no logic, invariant, comment, or test was removed. No
  `.atl/` or `.codegraph/` change is part of the slice.

### Measured size (changed lines)

| Slice | Implementation                                                                                | Tests | Total incl. tests |
| ----- | --------------------------------------------------------------------------------------------- | ----- | ----------------- |
| WU2A  | 827 (`permissions` 16 + `dto` 59 + `base` 113 + `service` 610 + `module` 27 + `app.module` 2) | 706   | 1,533             |
| WU2B  | 864 (`records.dto` 61 + `records.service` 783 + `module` 20)                                  | 371   | 1,235             |

After Correction Pass 2 the WU2A implementation is **827** changed lines (+59
from the exact-target `P2002` matcher and its comments), over the ≤800 budget;
the maintainer-approved WU2A `size:exception` covers it. A strict ≤800 total
including the focused test file was and remains **not feasible** without
deleting tests or minifying comments, which the workload guard forbids; the
honest measure is reported rather than hidden. Both slices are roughly half of
the original 2,104-line WU2, and each CI failure localizes to one boundary.

### Verification after re-slice

| Command                                                                                                              | Result                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts src/clinical/clinical.service.test.ts`         | exit 0 — 1 file, **24 passed** (corrected pass)                                                                               |
| `pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts src/clinical/clinical.records.service.test.ts` | exit 0 — 1 file, **4 passed**                                                                                                 |
| `pnpm --filter @newsaas/api test`                                                                                    | exit 0 — 51 files passed / 1 skipped (live-PG), **460 passed / 16 skipped** (pre-slice baseline 453 + 7 new correction tests) |
| `pnpm --filter @newsaas/api typecheck`                                                                               | exit 0 — no errors                                                                                                            |
| `pnpm --filter @newsaas/api lint`                                                                                    | exit 0 — no errors                                                                                                            |
| `pnpm --filter @newsaas/api build`                                                                                   | exit 0 — `tsc` build clean                                                                                                    |
| `pnpm exec prettier --check "apps/api/src/clinical/**/*.ts" "apps/api/src/app.module.ts"`                            | exit 0 — all files match Prettier style                                                                                       |

### Branch rename

Renamed the local branch `feat/epic-06-clinical-wu2` →
`feat/epic-06-clinical-wu2a-encounter-core`. Safe: the branch had no commit
beyond tracker `d4e606f`, no upstream configured, and nothing was pushed. The
WU2B files remain in the same working tree pending their own chained slice.

### WU2B status — planned and uncommitted (out of the WU2A boundary)

The specialized-records source and tests exist in the working tree and pass, but
they are **not part of the WU2A commit**. WU2A's `clinical.module.ts` wires only
`ClinicalService`; the WU2B slice must re-add the `ClinicalRecordsService`
provider/export itself. No subdomain feature code or test is outstanding — only
its own chained commit/PR remains.

## Verification Evidence — WU2 (pre-slice historical, superseded)

> Superseded by the Re-slice Pass and Correction Pass evidence above; retained
> only as an audit trail of the original 21-test WU2 service-only run.

| Command                                                                                                      | Result                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts src/clinical/clinical.service.test.ts` | exit 0 — 1 file, **21 passed**                                                                                           |
| `pnpm --filter @newsaas/api test`                                                                            | exit 0 — 50 files passed / 1 skipped (live-PG), **453 passed / 16 skipped** (incl. route-contract probe and main wiring) |
| `pnpm --filter @newsaas/api typecheck`                                                                       | exit 0 — no errors                                                                                                       |
| `pnpm --filter @newsaas/api lint`                                                                            | exit 0 — no errors                                                                                                       |
| `pnpm --filter @newsaas/api build`                                                                           | exit 0 — `tsc` build clean                                                                                               |
| `pnpm exec prettier --check apps/api/src/clinical/**/*.ts apps/api/src/app.module.ts`                        | exit 0 — all files match Prettier style                                                                                  |

Focused test naming note: task 2.1 literally says `**/*.spec.ts`, but the API
Vitest `include` is `src/**/*.test.ts` + `test/**/*.e2e-spec.ts`; a `src/**`
`.spec.ts` would never run. The suite is therefore `clinical.service.test.ts`
(repo convention), so the tests actually execute under the project runner.

## Verification Evidence — WU1 (focused, unchanged)

| Command                                                                       | Result                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @newsaas/database exec prisma validate`                        | exit 0 — "The schema is valid" (re-run after correction)                                                                                                                               |
| `pnpm --filter @newsaas/database test`                                        | exit 0 — 10 files, **124 passed** (incl. `schema-clinical.test.ts` **15/15**, `demo-seed.test.ts` 22/22, `reference-seed.test.ts` 16/16)                                               |
| `pnpm --filter @newsaas/database typecheck`                                   | exit 0 — no errors                                                                                                                                                                     |
| `pnpm --filter @newsaas/database lint`                                        | exit 0 — no errors                                                                                                                                                                     |
| `prisma migrate diff --from-empty --to-schema-datamodel` structural alignment | **9/9** composite tenant-ownership statements (2 unique keys + 6 composite patient FKs + 1 composite amendment FK) match Prisma's derived DDL verbatim (normalized whitespace), exit 0 |

## Correction Pass — WU2A boundary + amendment concurrency (2026-09-12)

Fresh review of the WU2A slice raised four findings; all are corrected here. No
WU3 work, no commit/push/PR/merge, no `.atl/`/`.codegraph/` change.

1. **WU2B leakage removed from the WU2A boundary.** `clinical.module.ts` no
   longer imports, provides, or exports `ClinicalRecordsService`; it wires only
   `ClinicalService`. The three WU2B files remain untracked in the working tree
   for the later slice. Proof: with the WU2B files moved aside, WU2A `typecheck`
   exits 0 and the focused suite is 24/24 — the slice stages and builds
   independently.
2. **Concurrency-safe amendment idempotency.** `amendEncounter` now runs the
   design flow inside the transaction (`SELECT ... FOR UPDATE` on the original
   encounter, then read + CLOSED check + idempotency replay), and catches a
   Prisma `P2002` unique violation (structurally detected, no generated-client
   coupling) to recover to the winner's committed row; it rethrows when no row
   matches. Concurrent duplicate requests no longer surface a raw unique error.
   Focused tests cover the lock query, the race recovery, and the rethrow.
3. **Real audit-rollback proof.** The fake transaction harness is now
   copy-on-write, so a rollback restores prior rows instead of leaking in-place
   mutations. Four tests fail the co-committed audit append and assert that the
   create / autosave (content + version) / close / amendment is fully rolled
   back. The previous "a tx handle was passed" assertion was removed.
4. **Artifact truth.** `tasks.md` and this document now mark WU2A complete and
   WU2B planned/uncommitted, with the WU2-wide superseded claims replaced.

### Verification after correction (Correction Pass 1, historical)

| Command                                                                                                              | Result                                                            |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts src/clinical/clinical.service.test.ts`         | exit 0 — 1 file, **24 passed**                                    |
| WU2A-only probe (WU2B files moved aside): `typecheck` + focused test                                                 | exit 0; **24 passed** — slice builds independently                |
| `pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts src/clinical/clinical.records.service.test.ts` | exit 0 — 1 file, **4 passed**                                     |
| `pnpm --filter @newsaas/api test`                                                                                    | exit 0 — 51 files passed / 1 skipped, **460 passed / 16 skipped** |
| `pnpm --filter @newsaas/api typecheck`                                                                               | exit 0                                                            |
| `pnpm --filter @newsaas/api lint`                                                                                    | exit 0                                                            |
| `pnpm --filter @newsaas/api build`                                                                                   | exit 0                                                            |
| `pnpm exec prettier --check "apps/api/src/clinical/**/*.ts" "apps/api/src/app.module.ts"`                            | exit 0                                                            |

## Correction Pass 2 — exact P2002 target for amendment recovery (2026-09-12)

Fresh review found that `amendEncounter`'s concurrency recovery accepted _any_
Prisma `P2002` by code alone. That could mask an unrelated unique violation on
the same table (e.g. the `(tenantId, id)` tenant-ownership key) whenever a row
happened to exist for the supplied idempotency key. The recovery is now scoped
to the exact idempotency constraint.

1. **Exact-target match.** `isAmendmentIdempotencyConflict` (replacing
   `isUniqueConstraintConflict`) requires `code === "P2002"` **and** a
   `meta.target` that identifies
   `clinical_encounter_tenant_id_idempotency_key_key` (the
   `@@unique([tenantId, idempotencyKey])` index).
   `matchesAmendmentIdempotencyTarget` accepts the shapes Prisma actually emits:
   the index/constraint name as a string or single-element array, and the
   column/field pair (`tenant_id`/`idempotency_key` or
   `tenantId`/`idempotencyKey`, order-agnostic) — normalized for case and
   separators. Every other target returns `false`, so the error propagates
   untouched.
2. **Negative regression test.** New test
   `rethrows an unrelated P2002 even when an idempotency-key row exists` stubs a
   `P2002` on `["tenant_id", "id"]` while a committed row for the supplied key
   is present, and asserts the original error is rethrown (no silent recovery).
   A matching positive test covers the index-name metadata shape.

**RED proof (one-variable experiment):** with the matcher temporarily reverted
to the pre-fix code-only check, the new negative test fails and the service
wrongly returns `enc-winner`; restoring the target-aware matcher turns it green.
The service file was backed up and restored byte-for-byte after the experiment.

### Verification after Correction Pass 2

| Command                                                                                                      | Result                                                            |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts src/clinical/clinical.service.test.ts` | exit 0 — 1 file, **26 passed** (was 24; +2)                       |
| Negative test vs. pre-fix matcher (temporary revert, then restored)                                          | **RED: 1 failed** — wrongly recovered `enc-winner`                |
| `pnpm --filter @newsaas/api test`                                                                            | exit 0 — 51 files passed / 1 skipped, **462 passed / 16 skipped** |
| `pnpm --filter @newsaas/api typecheck`                                                                       | exit 0                                                            |
| `pnpm --filter @newsaas/api lint`                                                                            | exit 0                                                            |
| `pnpm --filter @newsaas/api build`                                                                           | exit 0                                                            |
| `pnpm exec prettier --check "apps/api/src/clinical/**/*.ts" "apps/api/src/app.module.ts"`                    | exit 0 — all files match Prettier style                           |

Scope: only `apps/api/src/clinical/clinical.service.ts` and
`apps/api/src/clinical/clinical.service.test.ts` changed. No WU2B file, module
boundary, product scope, `.atl/`, or `.codegraph/` change; no
commit/push/PR/merge.

## Final Fresh Re-review (2026-09-12)

A fresh re-review of the corrected WU2A slice **APPROVED** it after all
corrections (boundary isolation, concurrency-safe amendment, faithful
audit-rollback harness, artifact truth, and the exact-target `P2002` matcher).
The maintainer-approved **`size:exception`** (827 impl / 1,533 incl. tests)
remains in force. WU2A is finalized as a single chained commit on
`feat/epic-06-clinical-wu2a-encounter-core`
(`feat(EPIC-06): add encounter service core`). No push, PR, merge, or WU2B/WU3
work is performed by this finalization; the WU2B files remain uncommitted in the
working tree for their own chained slice.

## Deviations from Design

WU1 (unchanged from prior pass):

- Added defense-in-depth `BEFORE DELETE` triggers for the five subdomain tables
  (design names only the encounter immutability trigger). Rationale: the spec
  states subdomain records "MUST NOT be hard-deleted"; DB enforcement matches
  that invariant and mirrors the EPIC-05 DB-enforced-pattern precedent. No
  schema/contract change.
- Added a `CHECK ("quantity" > 0)` constraint for `ClinicalWeight` from the
  design's `Decimal(10,3) > 0` note; API validation remains the primary 400 path
  in WU3.

WU2A / WU2B:

- **Service scope split**: the five subdomain create/list/update service methods
  are **WU2B**, not WU2A. Rationale: task 3.2 scopes WU3 to "controllers, Zod
  inputs, DTOs, permission declarations, and route-contract probe" — it does NOT
  add services, so the subdomain persistence must exist for WU3 controllers to
  stay thin. WU2A ships only the encounter core; WU2B is its follow-on slice.
- Service-level granular permission checks (`requirePermission`) mirror
  `TenantSettingsService`/`BrandingService` "defense in depth" precedent; WU3
  routes will declare the same keys with `@RequirePermissions`. Entitlement
  (`FEATURE_NOT_ENTITLED`) is enforced for every clinical operation.
- Amendment content is copied from the original with optional per-field
  override; the amendment row is CLOSED, links `amendsEncounterId`, and starts
  at `version = 1`. Idempotent replay is an in-transaction lookup after a
  `SELECT ... FOR UPDATE` row lock, with exact-target `P2002` unique-conflict
  recovery as the cross-original fallback (review finding 2). True READ
  COMMITTED interleaving/serialization evidence still requires live PG (WU5/H1).
- `createWeight`/`updateWeight` reject non-positive/non-numeric quantity with
  `VALIDATION_FAILED` as service defense in depth (Zod 400 remains WU3's primary
  path, DB CHECK remains the backstop).

## Correction Pass — WU1 data-foundation repair (unchanged)

Fresh review found the WU1 foundation allowed a clinical row whose `tenant_id`
was tenant A but whose `patient_id` referenced a Patient owned by tenant B, and
allowed an amendment (`amends_encounter_id`) to link across tenants. Both were
separate single-column FKs (`patient_id → patient(id)`), which do not prove
tenant ownership.

Fix (smallest correct DB-level enforcement, Prisma-native composite keys):

- `Patient` gains `@@unique([tenantId, id])` (migration: unique index
  `patient_tenant_id_id_key`); `ClinicalEncounter` gains
  `@@unique([tenantId, id])` (`clinical_encounter_tenant_id_id_key`) as the
  amendment self-FK target.
- Each of the six clinical models now anchors through a composite FK
  `(tenant_id, patient_id) → patient(tenant_id, id)` (RESTRICT). Tenant A can no
  longer reference tenant B's Patient: the pair simply does not exist.
- The amendment self-FK is now composite
  `(tenant_id, amends_encounter_id) → clinical_encounter(tenant_id, id)`
  (RESTRICT); PostgreSQL MATCH SIMPLE skips it while `amends_encounter_id` is
  NULL, so ordinary encounters are unaffected.
- The direct `tenant_id → tenant(id)` FK is retained on every table, so the
  original tenant-ownership guarantee is preserved, not replaced.
- The composite unique keys are declared before the FKs (PostgreSQL requires the
  referenced key at constraint time); a focused test pins that ordering.

Preserved WU1 guarantees: 6 tables, enum, weight CHECK, CLOSED-immutability and
all no-delete triggers, idempotency unique, seed/permission behavior are
untouched.

## Issues Found

- None blocking. WU2A typecheck/lint/build/tests are green after the correction
  pass; one Prettier pass and one ESLint `prefer-nullish-coalescing` rewrite
  (`pickContent`) were applied earlier.
- No live database (no Docker daemon, no reachable Postgres): migration
  execution, a live negative cross-tenant INSERT, and the concurrent-autosave
  409 proof remain WU5/H1-owned. WU2A's autosave guard is proven at the service
  layer via the conditional-`updateMany` `count = 0 ⇒ 409` path, and the
  amendment lock/recovery is proven at the harness level.
- `internalNotes` is CONFIDENTIAL/staff-only; WU2A provides the client-safe
  mapper and proves exclusion, while WU3 must ensure the HTTP client-safe
  projection never leaks it.

## Remaining Tasks (not started — out of WU2A scope)

- [x] 2B WU2B commit: implementation is complete, verified, fresh-reviewed and
      committed as its own chained commit on its branch; the maintainer approved
      the 1,235-line `size:exception`. Push/PR/merge remain out of scope.
- [ ] 3.1 / 3.2 Controllers, Zod/DTO allowlist, routes, route-contract probe
      (WU3).
- [ ] 4.1 / 4.2 Web proxy + clinical workspace, RTL tests (WU4).
- [ ] 5.1 / 5.2 Live-PG isolation/concurrency evidence, root gates,
      documentation (WU5).

## Workload / PR Boundary — WU2A Encounter Core

- Mode: **chained PR slice** (feature-branch-chain), WU2A only;
  maintainer-approved **`size:exception`** for the WU2A slice (827 impl / 1,533
  incl. tests after Correction Pass 2, over the ≤800 total-including-tests
  budget).
- Boundary: starts at tracker `feat/epic-06-clinical` @ `d4e606f` (includes
  WU1); ends with the encounter core and its focused tests. The WU2B
  specialized-records files are explicitly OUT (uncommitted). No
  controllers/routes/Zod (WU3), no web (WU4), no live-PG/docs (WU5).
- Staged-boundary guidance (WU2A only):
  `apps/api/src/clinical/clinical.permissions.ts`,
  `apps/api/src/clinical/clinical.dto.ts`,
  `apps/api/src/clinical/clinical.service.base.ts`,
  `apps/api/src/clinical/clinical.service.ts`,
  `apps/api/src/clinical/clinical.service.test.ts`,
  `apps/api/src/clinical/clinical.module.ts`, and `apps/api/src/app.module.ts`.
  Do **NOT** stage `clinical.records.dto.ts`, `clinical.records.service.ts`, or
  `clinical.records.service.test.ts`. Exclude pre-existing `.atl/` dirtiness and
  the `.codegraph/` tool index.

## Risks

- WU2A is 827 impl / 1,533 incl. tests after Correction Pass 2, over the ≤800
  budget; covered by the maintainer-approved `size:exception` (comments/tests
  were not minified).
- The WU2B files are uncommitted in the working tree; a careless `git add -A`
  would leak WU2B into the WU2A commit. Use the explicit path list above.
- Autosave staleness is proven by `updateMany` `count = 0`, and amendment
  concurrency is now covered by the `FOR UPDATE` lock + in-tx replay +
  exact-target `P2002` recovery; true READ COMMITTED interleaving/serialization
  still requires live PG (WU5/H1).
- `internalNotes` leakage prevention depends on WU3 using
  `toClientSafeEncounter` for any client-safe projection.

## Branch / Worktree State

- Current branch: `feat/epic-06-clinical-wu2a-encounter-core` (renamed from
  `feat/epic-06-clinical-wu2`; still based on `feat/epic-06-clinical` @
  `d4e606f`). See "Branch rename" in the Re-slice Pass.
- Finalized: WU2A committed as exactly one chained commit
  `feat(EPIC-06): add encounter service core` after the fresh re-review approved
  the corrected slice. No push, no PR, no merge performed. WU2B remains
  uncommitted in the working tree for its own chained slice.
- Pre-existing unrelated dirtiness: `.atl/.skill-registry.cache.json`,
  `.atl/skill-registry.md`.
- Tool artifact (not WU2A/WU2B): `.codegraph/` (CodeGraph index), untracked.

---

# Phase 2B — Specialized Records (WU2B) — continuation 2026-09-12

Base/continuation note: WU2A was merged into the tracker
(`feat/epic-06-clinical` @ `11d144cc120737e16d5e30890c9cdfc26e371105`, PR #6).
WU2B was branched from that latest tracker as
`feat/epic-06-clinical-wu2b-specialized-records`. The three pre-existing
untracked WU2B files were preserved/reused; pre-existing `.atl/` modifications
and the untracked `.codegraph/` index were preserved and never staged. Nothing
was committed, pushed, or merged.

## Files Changed — WU2B Specialized Records

| File                                                     | Action   | What Was Done                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/clinical/clinical.records.service.ts`      | Created  | `ClinicalRecordsService extends ClinicalServiceBase<ClinicalRecordsPrisma>`: treatment/vaccination/deworming/study/weight `list`/`create`/`update`, tenant + entitlement + granular permission gates, `assertPatient`, one co-committed audit row per mutation, allowlisted mapping, positive-decimal weight guard, no hard delete. (783 lines) |
| `apps/api/src/clinical/clinical.records.dto.ts`          | Created  | Allowlisted CONFIDENTIAL response contracts for the five record kinds; Prisma models are never returned. (61 lines)                                                                                                                                                                                                                             |
| `apps/api/src/clinical/clinical.records.service.test.ts` | Created  | 7 fake-Prisma tests: treatment update+audit, vaccination create/list+audit, deworming create/list+audit, study create/list/update+audit, exact-decimal weight create/update, invalid-weight rejection persisting nothing, cross-tenant 404 persisting nothing. (371 lines)                                                                      |
| `apps/api/src/clinical/clinical.module.ts`               | Modified | Added `ClinicalRecordsService` to `providers` and `exports` and updated the module doc; the WU2A `ClinicalService` encounter core is otherwise unchanged. (+10/-10)                                                                                                                                                                             |

## Evidence (WU2B verification)

- Focused:
  `pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts src/clinical/clinical.records.service.test.ts`
  → **7 passed**.
- Full API suite: `pnpm --filter @newsaas/api test` → **51 files passed / 1
  skipped; 465 passed / 16 skipped** (baseline was 462 passed; +3 from the added
  coverage).
- `pnpm --filter @newsaas/api typecheck` → exit 0.
- `pnpm --filter @newsaas/api lint` → exit 0.
- `pnpm --filter @newsaas/api build` → exit 0.
- `npx prettier --check` on the four changed files → all clean.
- DI wiring: `PrismaModule` is `@Global` (provides/exports `PrismaService`) and
  `RequestContextService`, `PermissionResolver`, `AuditWriter`,
  `EntitlementsService` are all exported by the modules `ClinicalModule` imports
  — the same resolution path WU2A already uses.

## Nonblocking Review Limitations (accepted)

Noted during fresh review and explicitly accepted as nonblocking; no code change
was made for them:

- No live database (no Docker/Postgres available): cross-tenant 404 and
  concurrent behavior are proven at the service/fake-Prisma layer; live-PG
  isolation/concurrency evidence remains WU5/H1-owned.
- `updateRecord` with no changed fields is a no-op read that returns the
  existing row and appends no audit row (intentional); it is not separately
  pinned by a test.
- `internalNotes` CONFIDENTIAL leakage prevention depends on WU3 using the
  client-safe projection; WU2B provides only the allowlisted record DTOs.

## Workload / PR Boundary — WU2B

- Mode: **chained PR slice** (feature-branch-chain), WU2B only, with a
  maintainer-approved **`size:exception`** for the 1,235-line honest measure
  (comments and tests were not minified).
- Boundary: base = tracker `feat/epic-06-clinical` @ `11d144c` (contains WU2A);
  ends with the specialized-records service, DTO, tests and module wiring. No
  controllers/Zod/routes (WU3), no web (WU4), no live-PG/docs (WU5).
- Measured size: **1,225 additions / 10 deletions = 1,235 changed lines** (783
  service + 61 DTO + 371 test + 10 module additions; module also deletes 10
  lines). This exceeds the ≤800-line slice budget; the maintainer approved the
  `size:exception` after fresh review, so WU2B is committed as its own chained
  commit.
- Slice staging guidance (WU2B, for a future committer): stage only
  `apps/api/src/clinical/clinical.records.service.ts`,
  `clinical.records.dto.ts`, `clinical.records.service.test.ts`,
  `clinical.module.ts`, and the SDD doc updates; exclude pre-existing `.atl/`
  dirtiness and `.codegraph/`.

## Risks

- **Size exception (approved)**: WU2B is 1,235 changed lines; the maintainer
  approved the `size:exception` after fresh review, so no further split is
  required for this slice.
- Fresh-context review was performed and identified no blockers before commit.
- No live database (no Docker/Postgres): cross-tenant isolation and concurrency
  are proven at the service/fake-Prisma layer; live-PG proof remains WU5/H1.
- `updateRecord` with no changed fields is a no-op read that returns the
  existing row and appends no audit (intentional); not separately pinned.

## Branch / Worktree State

- Current branch: `feat/epic-06-clinical-wu2b-specialized-records`, created with
  `--no-track` from `origin/feat/epic-06-clinical` @ `11d144c`. Committed as
  exactly one chained commit `feat(EPIC-06): add specialized clinical records`;
  no push, no PR, no merge.
- Preserved and unstaged: `.atl/.skill-registry.cache.json`,
  `.atl/skill-registry.md` (pre-existing dirtiness) and `.codegraph/` (tool
  index). Only the WU2B boundary files plus the SDD docs are committed.

# Phase 3 — API Contracts (WU3) — continuation 2026-09-12

## Files Changed — WU3 API Contracts

| File                                                      | Action   | What Was Done                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/clinical/clinical.zod.ts`                   | Created  | Strict Zod input contracts for all params/bodies (encounter create/autosave/close/amend + five record kinds), positive-decimal weight guard matching `Decimal(10,3)`, and the shared `parseClinicalInput` 400 `VALIDATION_FAILED` helper.                                                                                                                                             |
| `apps/api/src/clinical/clinical.encounters.controller.ts` | Created  | `ClinicalEncountersController` (`patients/:patientId/clinical/encounters`): list/create/get/autosave/close/amendments, each declaring its `vet.clinical.*` permission.                                                                                                                                                                                                                |
| `apps/api/src/clinical/clinical.records.controller.ts`    | Created  | `ClinicalRecordsController` (`patients/:patientId/clinical`): list/create/update for treatments, vaccinations, deworming, studies, weights; read/create/update permission mapping; no delete route.                                                                                                                                                                                   |
| `apps/api/src/clinical/clinical.module.ts`                | Modified | Registers both controllers; adds no new provider and does not change the services.                                                                                                                                                                                                                                                                                                    |
| `apps/api/src/rbac/route-contract.probe.test.ts`          | Modified | Pins the 21 new clinical routes in `EXPECTED_ROUTE_INVENTORY`.                                                                                                                                                                                                                                                                                                                        |
| `apps/api/src/clinical/clinical.http.integration.test.ts` | Created  | HTTP boundary over the real guard chain: anonymous 401, per-route 403 FORBIDDEN, entitlement-negative 403 FEATURE_NOT_ENTITLED, invalid-weight 400 + no persistence, byte-equivalent cross-tenant 404 (read + create), allowlisted encounter DTO + `toClientSafeEncounter` internalNotes exclusion + IDs-only audit, five record create paths, and 409 lifecycle conflicts. 10 tests. |
| `apps/api/test/support/clinical-http-fixture.ts`          | Created  | WU3 test fixture: reuses the EPIC-05 three-tenant boundary, grants `vet.clinical.*` to A/B/C and attaches minimal in-memory clinical delegates (`create/findFirst/findMany/updateMany`, no delete) so WU3 routes can be exercised end-to-end without live PostgreSQL.                                                                                                                 |

No change to `clinical.service.ts`, `clinical.service.base.ts`,
`clinical.records.service.ts`, `clinical.dto.ts`, `clinical.records.dto.ts` or
`clinical.permissions.ts` — WU3 sits on top of WU1/WU2 unchanged.

## Evidence (WU3 verification)

- Focused:
  `vitest run src/clinical/clinical.http.integration.test.ts src/rbac/route-contract.probe.test.ts src/clinical/clinical.service.test.ts src/clinical/clinical.records.service.test.ts`
  → 4 files / 50 tests passed.
- Full API suite: `pnpm --filter @newsaas/api test` → 52 files passed / 1
  skipped (live-PG); 476 passed / 16 skipped.
- `pnpm --filter @newsaas/api typecheck` → exit 0.
- `pnpm --filter @newsaas/api lint` → exit 0.
- `pnpm --filter @newsaas/api build` → exit 0.
- `prettier --check` clean on all 7 changed code/support files.

## Measured size (WU3, post review corrections)

- API contract/source support: **570 changed lines** (147 zod + 103 encounters
  controller + 230 records controller + 82 route-probe + 8 module, of which 2
  are deletions).
- Test code: **760 changed lines** (618 HTTP integration + 142 fixture).
- Total changed incl. tests: **1,330 changes (1,328 additions / 2 deletions)**.

The total exceeds the ≤800 slice budget. **The maintainer approved the WU3
`size:exception`** (decision recorded 2026-09-12) for the honest, non-minified
measure. The initial cut measured 1,059 changed lines; the mandated review
corrections added the 271-line delta (all cross-tenant isolation and
permission-mapping evidence plus the SDD artifacts). No comment or test was
minified.

## Deviations from Design

None. Controllers, routes, Zod inputs, DTO surface, permission mapping and probe
inventory follow design §4 and the route list exactly. POST commands (`close`,
`amendments`) keep Nest's default `201` response, matching the existing EPIC-05
command convention (`POST /patients/:id/deactivate` → 201).

## Known Limitations (WU3)

- The in-memory clinical delegates model create/find/list/update only; clinical
  transaction rollback and concurrency semantics are not modelled and remain
  WU5/H1 live-PG evidence.
- Cross-tenant 404 is proven over HTTP for the foreign Patient anchor
  (`assertPatient`) and for foreign clinical **aggregate UUIDs** (encounter GET
  and the five record update routes, anchored to the probing tenant's own
  Patient), including a no-write / no-audit assertion; the live-PG
  byte-equivalent probe is WU5-owned.

## Branch / Worktree State — WU3

- Branch: `feat/epic-06-clinical-wu3-api-contracts`, created from
  `origin/feat/epic-06-clinical` @ `75cb822` (contains WU1 + WU2A + WU2B).
- Fresh review APPROVED; WU3 committed as exactly one chained commit
  `feat(EPIC-06): add clinical API contracts`
  (`8030c526b324db3baf021a7b839ffeb4caa14a45`). No push, no PR, no merge.
- Preserved and unstaged: `.atl/.skill-registry.cache.json`,
  `.atl/skill-registry.md` (pre-existing dirtiness) and `.codegraph/` (tool
  index).

## WU3 Review Correction Pass (2026-09-12)

A fresh review rejected the first WU3 cut: the cross-tenant evidence only used a
foreign Patient anchor (never a foreign clinical aggregate UUID), the permission
test only proved a generic denial, and the tracking artifacts wrongly said no
`size:exception` was approved. All three are corrected here. No WU1/WU2 product
behavior, module boundary, or product scope changed; no `.atl/` or `.codegraph/`
change; no commit/push/PR/merge.

1. **Foreign clinical aggregate UUID isolation + no-write proof.**
   `clinical.http.integration.test.ts` seeds tenant B with one aggregate of
   every clinical kind and, as tenant A, references B's aggregate UUIDs through
   A's OWN Patient anchor, so a foreign Patient anchor is ruled out:
   - `GET /patients/:patientId/clinical/encounters/:id` with B's encounter UUID;
   - `PUT /patients/:patientId/clinical/{treatments|vaccinations|deworming|studies|weights}/:id`
     with B's record UUID and a Zod-valid update body.

   Each probe asserts a byte-equivalent 404 `NOT_FOUND` versus a random
   nonexistent id under the same Patient (same pinned `X-Request-Id`) and that
   no identifier leaks. The test additionally asserts every foreign row is
   unchanged (deep snapshot equality) and that no audit row was appended.

2. **Permission-to-route mapping evidence.** `route-contract.probe.test.ts` adds
   `CLINICAL_PERMISSION_BY_ROUTE`, pinning the exact `vet.clinical.*` key for
   all 21 clinical routes against the real enumerated `@RequirePermissions`
   metadata (a wrong key fails by name). `clinical.http.integration.test.ts`
   adds a runtime single-key matrix: for each of the five keys, a role holding
   exactly that key is probed against every route — its matching routes must
   pass the guard and every other route must be denied with 403 `FORBIDDEN`. The
   amend route's positive case is covered by the metadata fence because its
   service reaches the `SELECT ... FOR UPDATE` lock the in-memory boundary does
   not model.

3. **Truthful size exception.** `tasks.md` and this document now record the
   maintainer-approved WU3 `size:exception` and the post-correction measure
   (1,330 changed lines incl. tests; 570 contract/source + 760 tests).

### RED proof (one-variable experiments, both reverted)

- Metadata fence: temporarily redecorated `PUT .../encounters/:id` with
  `vet.clinical.read`; the probe failed naming
  `WRONG CLINICAL PERMISSION: PUT /patients/:patientId/clinical/encounters/:id expected [vet.clinical.update] got [vet.clinical.read]`.
  Controller restored.
- Aggregate isolation: temporarily made the fixture's `matchesWhere` ignore
  `tenantId`/`patientId`; the aggregate test failed (foreign encounter GET
  returned 200, not 404). Fixture restored byte-for-byte.

### Verification after WU3 corrections

| Command                                                                                                       | Result                                                                          |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| focused `vitest run clinical.http.integration route-contract.probe clinical.service clinical.records.service` | exit 0 — 4 files, **50 passed** (was 47; +3)                                    |
| metadata RED experiment (wrong key, then reverted)                                                            | **RED: 1 failed** — named the wrong-permission route                            |
| isolation RED experiment (unscoped match, then reverted)                                                      | **RED: 1 failed** — foreign GET returned 200                                    |
| `pnpm --filter @newsaas/api test`                                                                             | exit 0 — 52 files passed / 1 skipped; **476 passed / 16 skipped** (was 473; +3) |
| `pnpm --filter @newsaas/api typecheck`                                                                        | exit 0                                                                          |
| `pnpm --filter @newsaas/api lint`                                                                             | exit 0                                                                          |
| `pnpm --filter @newsaas/api build`                                                                            | exit 0                                                                          |
| `prettier --check` on the changed clinical/probe/support files                                                | exit 0 — clean                                                                  |

Scope: only `apps/api/src/clinical/clinical.http.integration.test.ts` and
`apps/api/src/rbac/route-contract.probe.test.ts` changed in code, plus the two
SDD artifacts; `clinical-http-fixture.ts` was probed temporarily and restored
exactly. No production/controller change, no WU1/WU2 change, no
`.atl/`/`.codegraph/`.

### Branch / Worktree State — WU3 (after corrections)

- Branch: `feat/epic-06-clinical-wu3-api-contracts`, created from
  `origin/feat/epic-06-clinical` @ `75cb822` (contains WU1 + WU2A + WU2B).
- Post-correction fresh review APPROVED; WU3 committed as exactly one chained
  commit `feat(EPIC-06): add clinical API contracts`
  (`8030c526b324db3baf021a7b839ffeb4caa14a45`). No push, no PR, no merge.
- Preserved and unstaged: `.atl/.skill-registry.cache.json`,
  `.atl/skill-registry.md` (pre-existing dirtiness) and `.codegraph/` (tool
  index).

# Phase 4A — Staff Proxy and API Client (WU4A) — continuation 2026-09-12

Base/continuation note: WU3 was committed and merged into the tracker
(`feat/epic-06-clinical` @ `eb7b838` via PR #8 plus the delivery/prettier
commits). WU4A is branched from that latest tracker. Prior WU1/WU2A/WU2B/WU3
content above is retained unchanged. Pre-existing `.atl/` modifications and the
untracked `.codegraph/` index were preserved and never touched. Nothing was
committed, pushed, opened as a PR, or merged.

## WU4 → WU4A/WU4B Re-slice (2026-09-12)

Maintainer decision: do **not** apply the 1,526-line WU4 `size:exception`; split
the uncommitted WU4 for maintainability and CI diagnosis. Delivery context is
unchanged (force-chained / feature-branch-chain). This is a file-boundary
refactor plus SDD bookkeeping only — **approved product scope is unchanged**.

- **WU4A Clinical Proxy & Client**: the authenticated `/api/clinical` proxy, the
  `clinical-api.ts` staff client, and their node tests.
- **WU4B Staff Workspace UI**: `clinical-workspace.tsx`, its RTL tests, and the
  `patient-detail.tsx` mount. It stays **uncommitted/untracked** for its own
  chained child slice.

Branch rename: `feat/epic-06-clinical-wu4-staff-workspace` →
`feat/epic-06-clinical-wu4a-proxy-client` (safe: the branch had no upstream
configured and nothing was pushed). The WU4B files remain in the same working
tree pending their own chained slice.

## Completed Tasks — WU4A

- [x] 4A.1 RED: node tests for the authenticated `/api/clinical` proxy
      (cookie/`x-request-id` allowlist, Patient-anchored path rewrite,
      raw-stream mutating body with `duplex: "half"`, streamed response, 409
      passthrough) and the `clinical-api.ts` client contract (proxy paths, body
      shapes, stable error code/status, conflict classification, client-safe
      `internalNotes` stripping).
- [x] 4A.2 GREEN: authenticated `/api/clinical` proxy and `clinical-api.ts`
      client, independently build/testable with the WU4B workspace absent.

## Files Changed — WU4 Staff Workspace (re-sliced)

Slice mapping: **WU4A** = `route.ts` + `route.test.ts` + `clinical-api.ts` +
`clinical-api.test.ts` (the active, complete slice). **WU4B** =
`clinical-workspace.tsx` + `clinical-workspace.test.tsx` + the
`patient-detail.tsx` mount (implemented but **uncommitted/untracked residual**;
the WU4A commit must not stage these rows).

| File                                                                              | Action   | What Was Done                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/app/api/clinical/[[...path]]/route.ts`                              | Created  | Authenticated clinical proxy. Patient-anchored rewrite: `/api/clinical/:patientId/<rest>` → upstream `/patients/:patientId/clinical/<rest>` for GET/POST/PUT. Forwards only the server-read session cookie and `x-request-id`; pipes mutating bodies as the caller's raw stream (`duplex: "half"`); preserves upstream status, error envelope, `content-type` and `x-request-id`, and streams the response body. |
| `apps/web/src/app/(app)/app/patients/[id]/clinical-api.ts`                        | Created  | Staff clinical API client (mirrors the allowlisted WU2A/WU3 DTOs). `listEncounters`, `createEncounter`, `updateDraft`, `closeEncounter`, `amendEncounter`, the `ApiRequestError` stable-code carrier, `isClinicalPermissionDenied`/`isClinicalConflict`, `userFacingClinicalError`, and `toClientSafeEncounter` (strips staff-only `internalNotes`, never mutates input).                                          |
| `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.tsx`                 | Created  | Staff clinical workspace: loading/empty/error/permission-denied/success states, encounter list with DRAFT/CLOSED badges, draft editor with version-guarded save (409 CONFLICT shows a reload prompt and keeps local edits), close command, and the closed-encounter amendment form. Staff-only `internal notes` are separated from the client summary. Semantic tokens only; no Portal code.                        |
| `apps/web/src/app/(app)/app/patients/[id]/patient-detail.tsx`                     | Modified | Mounted `<ClinicalWorkspace patientId={patientId} />` in the existing staff Patient detail surface (+2 lines).                                                                                                                                                                                                                                                                                                   |
| `apps/web/src/app/api/clinical/[[...path]]/route.test.ts`                         | Created  | 15 proxy tests (7 initial + 8 security/path corrections): cookie/`x-request-id` forwarding and upstream path rewrite, header allowlist, nested command rewrite, raw-stream PUT body (`duplex`), streamed upstream response, absent `x-request-id`, 409 conflict passthrough, and rejection (no upstream call) of the empty anchor, malformed anchor, traversal anchor, traversal segment, encoded separator, unknown shape, sub-route-less anchor and non-contract method. |
| `apps/web/src/app/(app)/app/patients/[id]/clinical-api.test.ts`                   | Created  | 19 client tests (8 initial + 11 identifier/error-normalization corrections): patient-anchored proxy paths for list/get/create/autosave/close/amend, body shapes, stable error code/status on 403, conflict classification, `toClientSafeEncounter` internal-notes stripping, malformed/empty-id rejection without a request, and normalization of null/invalid/non-envelope/array error JSON, a rejected fetch (`NETWORK_ERROR`) and an unreadable 200 body (`MALFORMED_RESPONSE`). |
| `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.test.tsx`            | Created  | 11 RTL tests: loading, empty, success list, generic error, 403 denied copy, create + editor open, autosave success (version + body), autosave conflict (reload action + local edits kept), close swaps to amendment form, amendment submit body, and staff internal-notes vs client-summary separation.                                                                                                             |

## WU4A Independence Proof (WU4B files moved aside)

The WU4B workspace files (`clinical-workspace.tsx`,
`clinical-workspace.test.tsx`) were temporarily removed and `patient-detail.tsx`
restored to the tracker revision, leaving only the WU4A files. In that WU4A-only
tree:

- Focused WU4A run: 2 files / **15 passed**.
- Full web suite: **25 files / 132 passed** (baseline 23 files / 117 passed; +2
  files / +15 tests).
- `typecheck`, `lint` and `build` (incl. `verify-build-output.mjs`) all exit 0.

WU4B was then restored byte-for-byte (checksums re-verified against the backup)
and the tree re-verified below. This proves WU4A stages and builds independently
— the WU4B files are pure dependents (WU4B imports WU4A, never the reverse), so
no code change was needed to make WU4A build/testable on its own.

## Evidence (WU4A verification, full WU4 tree)

- Focused WU4A:
  `pnpm --filter @newsaas/web exec vitest run --config vitest.config.ts
  "src/app/api/clinical/[[...path]]/route.test.ts"
  "src/app/(app)/app/patients/[id]/clinical-api.test.ts"`
  → 2 files / **15 passed**.
- Full web suite: `pnpm --filter @newsaas/web test` → **26 files / 143 passed**
  (baseline 23 files / 117 passed; +3 files / +26 tests; WU4A 2 files + WU4B 1
  file).
- `pnpm --filter @newsaas/web typecheck` → exit 0.
- `pnpm --filter @newsaas/web lint` → exit 0.
- `pnpm --filter @newsaas/web build` → exit 0; `verify-build-output.mjs`
  passed.
- `prettier --check` clean on all 7 changed web files (`--write` applied to 4).

## WU4A Security/Error Correction Pass (2026-09-12, maintainer-authorized)

Fresh WU4A review corrections applied to the WU4A slice only. WU4A/WU4B split
preserved; no WU4B workspace/patient-detail file was changed; nothing committed,
pushed, opened as a PR, or merged; `.atl/` and `.codegraph/` untouched.

Corrections:

1. **Proxy path hardening** (`route.ts`): an allowlisted table of the clinical
   route shapes (encounters list/item/close/amendments + the five record list/item
   shapes, each with its contract methods) now gates every request. Empty or
   malformed Patient anchors are rejected `400 VALIDATION_FAILED` (so
   `/api/clinical` no longer maps to an unanchored upstream `/clinical`),
   traversal segments, percent-encoded bytes, unknown shapes and non-contract
   methods are rejected (`400`/`404`) **before** `cookies()` or `fetch`, and every
   emitted upstream segment is re-encoded. The reject decision is made before the
   request body is touched.
2. **Client identifier validation** (`clinical-api.ts`): `encodeIdentifier`
   rejects any non-UUID/empty patient or encounter id with
   `ApiRequestError("INVALID_IDENTIFIER", …, 0)` before path construction; valid
   ids are `encodeURIComponent`-encoded. Public functions are `async`, so malformed
   ids surface as rejections rather than synchronous throws.
3. **Error normalization** (`clinical-api.ts`): `parseError` reads the body as
   `unknown` and only extracts a code/message from an object envelope with an
   object `error`, so invalid, `null` and non-envelope JSON become
   `UNKNOWN` instead of a `TypeError`. A rejected `fetch` becomes
   `NETWORK_ERROR` (status 0) and an unreadable success body becomes
   `MALFORMED_RESPONSE`, both `ApiRequestError`.
4. **Focused tests**: proxy tests for empty anchor, malformed anchor, traversal
   anchor, traversal segment after a valid anchor, encoded separator, unknown
   shape, sub-route-less anchor and non-contract method (all asserting the
   upstream is never called) plus UUID fixtures; client tests for malformed/empty
   patient and encounter ids (asserting no fetch), null JSON, invalid JSON,
   non-envelope object JSON, array JSON, rejected fetch, and an unreadable 200
   body.

### Evidence (WU4A correction pass)

- Focused WU4A: route test **15 passed**, client test **19 passed** → 2 files /
  **34 passed** (was 15).
- WU4A-only tree (WU4B files moved aside, `patient-detail.tsx` reverted to the
  tracker revision): full web suite **25 files / 151 passed** (was 25 files /
  132 passed); `typecheck`, `lint` and `build` incl. `verify-build-output.mjs`
  all exit 0. WU4B restored byte-for-byte (sha256 re-verified before/after; diff
  empty).
- Full WU4 tree: the WU4B RTL suite now fails with `Invalid patient id.` because
  its fixtures use `patient-1` / `enc-1`; this is the expected dependent update
  for the **WU4B chained slice** (out of the WU4A boundary) and no WU4B file was
  edited here.
- `prettier --check` clean on the four WU4A files.

## Measured size (WU4, re-sliced)

| Part                                            | Slice | Pre-correction | Post-correction |
| ----------------------------------------------- | ----- | -------------- | --------------- |
| `route.ts` proxy                                | WU4A  | 99             | 198             |
| `clinical-api.ts` client                        | WU4A  | 215            | 276             |
| `route.test.ts`                                 | WU4A  | 257            | 346             |
| `clinical-api.test.ts`                          | WU4A  | 172            | 321             |
| **WU4A subtotal (impl + tests)**                | WU4A  | **743** (314 + 429) | **1,141** (474 + 667) |
| `clinical-workspace.tsx`                        | WU4B  | 491            | 491             |
| `patient-detail.tsx` mount (+2)                 | WU4B  | 2              | 2               |
| `clinical-workspace.test.tsx`                   | WU4B  | 290            | 290             |
| **WU4B subtotal (493 impl + 290 tests)**        | WU4B  | **783**        | **783**         |
| **Original WU4 total incl. tests (superseded)** | WU4   | 1,526          | —               |

Pre-correction, both re-sliced parts were under the ≤800 changed-lines budget
and no `size:exception` was required. The maintainer-authorized security/error
correction pass added a **+398-line** evidence delta to WU4A (hardened proxy,
identifier validation, error normalization and the mandated focused tests),
lifting WU4A to **1,141 changed lines**, i.e. over the ≤800 slice budget. The
maintainer approved the **WU4A `size:exception`** after the 2026-09-12 fresh
re-review for the honest, non-minified measure; WU4B stays at 783, under budget. No comment, test, or state was
minified to fit the budget.

## WU4B status — implemented, uncommitted residual (out of the WU4A boundary)

The WU4B staff workspace source and tests exist in the working tree, but they are
**not part of the WU4A commit**. After the WU4A correction tightened the client to
UUID identifiers, the WU4B RTL suite (`clinical-workspace.test.tsx`, 11 tests)
**fails with `Invalid patient id.`** because its fixtures still use `patient-1` /
`enc-1`. That fixture migration is a **WU4B-slice task** (the WU4B chained child),
not a WU4A edit; no WU4B file was changed in this pass. WU4B owns:

- `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.tsx` (491)
- `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.test.tsx` (290)
- the `patient-detail.tsx` mount (+2, tracked but left uncommitted)

They must stay untracked/unstaged (`git add` must not use `-A`) and are held for
the next chained child slice. No WU4B feature code or test is outstanding — only
its own chained commit/PR and fresh review remain.

## Deviations from Design (WU4)

- **Proxy path rewrite**: the design names the proxy file but not its path
  convention. The proxy is Patient-anchored (`/api/clinical/:patientId/...` →
  `/patients/:patientId/clinical/...`) so client paths avoid the duplicated
  `clinical` segment a pure path mirror would produce. Documented and pinned by
  a proxy test.
- **RHF + Zod not used**: the web workspace has no `react-hook-form` or `zod`
  dependency installed, and every existing web form (`patient-form.tsx`,
  customer detail) uses explicit controlled state + TanStack Query. The service
  surface is Zod-validated on the API. Adding RHF/Zod would introduce new
  dependencies against the project dependency rule; the established controlled
  pattern is used instead.
- **No client permission source**: there is no client-side permission/session
  hook in the web app. Permission-aware UX is therefore error-code driven
  (403 `FORBIDDEN` / `FEATURE_NOT_ENTITLED` render dedicated copy); the backend
  remains authoritative. No navigation/portal change.
- **Autosave is an explicit version-guarded save** ("Save draft") rather than a
  debounced background write; the spec requires the version guard, not a timing
  model, and this keeps the write deterministic and reviewable.
- **WU4 UI scope is encounter lifecycle only** (list/create/autosave/close/
  amend). The five specialized record kinds remain API-only because the spec
  Staff-workspace requirement and tasks 4A.1/4A.2 and 4B.1/4B.2 enumerate only
  encounter flows;
  `clinical-api.ts` intentionally does not add unused record functions.

## Known Limitations (WU4)

- `internalNotes` is rendered only inside the staff workspace and is stripped by
  `toClientSafeEncounter`; there is no Portal clinical surface in WU4. A future
  Portal view must use the client-safe mapper.
- All clinical data flows through the API; cross-tenant and concurrency
  semantics are enforced server-side and proven by WU3/WU5 evidence, not the web
  layer.

## Workload / PR Boundary — WU4A

- Mode: **chained PR slice** (feature-branch-chain), WU4A only. The
  maintainer-authorized correction pass lifts WU4A to **1,141** changed lines,
  over the ≤800 budget, so the maintainer approved the **WU4A `size:exception`**
  after the 2026-09-12 fresh re-review (no test or comment minified). WU4B stays
  at 783.
- Boundary: base = tracker `feat/epic-06-clinical` @ `eb7b838` (contains WU1 +
  WU2A + WU2B + WU3); ends with the authenticated proxy, the `clinical-api.ts`
  client, and their node tests. The WU4B workspace files and the
  `patient-detail.tsx` mount are explicitly OUT (uncommitted residual). No
  Portal, Scheduling, files, reports or live-PG/docs (WU5) work.
- Staging guidance (for a future committer): stage only
  `apps/web/src/app/api/clinical/**`,
  `apps/web/src/app/(app)/app/patients/[id]/clinical-api.ts`,
  `clinical-api.test.ts`, and the SDD doc updates; exclude pre-existing `.atl/`
  dirtiness, the `.codegraph/` tool index, and every WU4B file
  (`clinical-workspace.tsx`, `clinical-workspace.test.tsx`,
  `patient-detail.tsx`). Do **NOT** run `git add -A` / `git add .`.
- WU4B (next chained child) will stage `clinical-workspace.tsx`,
  `clinical-workspace.test.tsx`, `patient-detail.tsx` and the SDD doc updates on
  its own branch based on WU4A (`783` changed lines, also under budget).

## Risks (WU4A / WU4B)

- **Size**: the correction pass lifts WU4A to 1,141 changed lines, over the ≤800
  slice budget; the maintainer approved the `size:exception` after the
  2026-09-12 fresh re-review. WU4B is 783, under budget.
- The WU4B files are uncommitted in the working tree; a careless `git add -A`
  would leak WU4B into the WU4A commit. Use the explicit path list above.
- Fresh-context re-review APPROVED the corrected WU4A slice on 2026-09-12 (with
  the 1,141-line `size:exception`), so WU4A is committed as exactly one chained
  commit `feat(EPIC-06): add clinical proxy and client`.
- The proxy rewrite is pinned by a test; a future change to the API route
  prefix would require updating both the proxy and its test.

## Branch / Worktree State — WU4A

- Current branch: `feat/epic-06-clinical-wu4a-proxy-client` (renamed from
  `feat/epic-06-clinical-wu4-staff-workspace`; base
  `origin/feat/epic-06-clinical` @ `eb7b838`; no upstream configured).
  Finalized: the 2026-09-12 fresh re-review APPROVED the corrected slice and its
  1,141-line `size:exception`; WU4A is committed as exactly one chained commit
  `feat(EPIC-06): add clinical proxy and client`. No push, no PR, no merge
  performed.
- WU4B residual (unstaged/untracked, held for its own chained child):
  `clinical-workspace.tsx`, `clinical-workspace.test.tsx`, and the
  `patient-detail.tsx` mount.
- Preserved and unstaged: `.atl/.skill-registry.cache.json`,
  `.atl/skill-registry.md` (pre-existing dirtiness) and `.codegraph/` (tool
  index).
