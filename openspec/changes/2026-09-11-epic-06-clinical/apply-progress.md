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

| File                                                                   | Action   | What Was Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/app/api/clinical/[[...path]]/route.ts`                   | Created  | Authenticated clinical proxy. Patient-anchored rewrite: `/api/clinical/:patientId/<rest>` → upstream `/patients/:patientId/clinical/<rest>` for GET/POST/PUT. Forwards only the server-read session cookie and `x-request-id`; pipes mutating bodies as the caller's raw stream (`duplex: "half"`); preserves upstream status, error envelope, `content-type` and `x-request-id`, and streams the response body.                                                                    |
| `apps/web/src/app/(app)/app/patients/[id]/clinical-api.ts`             | Created  | Staff clinical API client (mirrors the allowlisted WU2A/WU3 DTOs). `listEncounters`, `createEncounter`, `updateDraft`, `closeEncounter`, `amendEncounter`, the `ApiRequestError` stable-code carrier, `isClinicalPermissionDenied`/`isClinicalConflict`, `userFacingClinicalError`, and `toClientSafeEncounter` (strips staff-only `internalNotes`, never mutates input).                                                                                                           |
| `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.tsx`      | Created  | Staff clinical workspace: loading/empty/error/permission-denied/success states, encounter list with DRAFT/CLOSED badges, draft editor with version-guarded save (409 CONFLICT shows a reload prompt and keeps local edits), close command, and the closed-encounter amendment form. Staff-only `internal notes` are separated from the client summary. Semantic tokens only; no Portal code.                                                                                        |
| `apps/web/src/app/(app)/app/patients/[id]/patient-detail.tsx`          | Modified | Mounted `<ClinicalWorkspace patientId={patientId} />` in the existing staff Patient detail surface (+2 lines).                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/web/src/app/api/clinical/[[...path]]/route.test.ts`              | Created  | 15 proxy tests (7 initial + 8 security/path corrections): cookie/`x-request-id` forwarding and upstream path rewrite, header allowlist, nested command rewrite, raw-stream PUT body (`duplex`), streamed upstream response, absent `x-request-id`, 409 conflict passthrough, and rejection (no upstream call) of the empty anchor, malformed anchor, traversal anchor, traversal segment, encoded separator, unknown shape, sub-route-less anchor and non-contract method.          |
| `apps/web/src/app/(app)/app/patients/[id]/clinical-api.test.ts`        | Created  | 19 client tests (8 initial + 11 identifier/error-normalization corrections): patient-anchored proxy paths for list/get/create/autosave/close/amend, body shapes, stable error code/status on 403, conflict classification, `toClientSafeEncounter` internal-notes stripping, malformed/empty-id rejection without a request, and normalization of null/invalid/non-envelope/array error JSON, a rejected fetch (`NETWORK_ERROR`) and an unreadable 200 body (`MALFORMED_RESPONSE`). |
| `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.test.tsx` | Created  | 11 RTL tests: loading, empty, success list, generic error, 403 denied copy, create + editor open, autosave success (version + body), autosave conflict (reload action + local edits kept), close swaps to amendment form, amendment submit body, and staff internal-notes vs client-summary separation.                                                                                                                                                                             |

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
  `pnpm --filter @newsaas/web exec vitest run --config vitest.config.ts "src/app/api/clinical/[[...path]]/route.test.ts" "src/app/(app)/app/patients/[id]/clinical-api.test.ts"`
  → 2 files / **15 passed**.
- Full web suite: `pnpm --filter @newsaas/web test` → **26 files / 143 passed**
  (baseline 23 files / 117 passed; +3 files / +26 tests; WU4A 2 files + WU4B 1
  file).
- `pnpm --filter @newsaas/web typecheck` → exit 0.
- `pnpm --filter @newsaas/web lint` → exit 0.
- `pnpm --filter @newsaas/web build` → exit 0; `verify-build-output.mjs` passed.
- `prettier --check` clean on all 7 changed web files (`--write` applied to 4).

## WU4A Security/Error Correction Pass (2026-09-12, maintainer-authorized)

Fresh WU4A review corrections applied to the WU4A slice only. WU4A/WU4B split
preserved; no WU4B workspace/patient-detail file was changed; nothing committed,
pushed, opened as a PR, or merged; `.atl/` and `.codegraph/` untouched.

Corrections:

1. **Proxy path hardening** (`route.ts`): an allowlisted table of the clinical
   route shapes (encounters list/item/close/amendments + the five record
   list/item shapes, each with its contract methods) now gates every request.
   Empty or malformed Patient anchors are rejected `400 VALIDATION_FAILED` (so
   `/api/clinical` no longer maps to an unanchored upstream `/clinical`),
   traversal segments, percent-encoded bytes, unknown shapes and non-contract
   methods are rejected (`400`/`404`) **before** `cookies()` or `fetch`, and
   every emitted upstream segment is re-encoded. The reject decision is made
   before the request body is touched.
2. **Client identifier validation** (`clinical-api.ts`): `encodeIdentifier`
   rejects any non-UUID/empty patient or encounter id with
   `ApiRequestError("INVALID_IDENTIFIER", …, 0)` before path construction; valid
   ids are `encodeURIComponent`-encoded. Public functions are `async`, so
   malformed ids surface as rejections rather than synchronous throws.
3. **Error normalization** (`clinical-api.ts`): `parseError` reads the body as
   `unknown` and only extracts a code/message from an object envelope with an
   object `error`, so invalid, `null` and non-envelope JSON become `UNKNOWN`
   instead of a `TypeError`. A rejected `fetch` becomes `NETWORK_ERROR`
   (status 0) and an unreadable success body becomes `MALFORMED_RESPONSE`, both
   `ApiRequestError`.
4. **Focused tests**: proxy tests for empty anchor, malformed anchor, traversal
   anchor, traversal segment after a valid anchor, encoded separator, unknown
   shape, sub-route-less anchor and non-contract method (all asserting the
   upstream is never called) plus UUID fixtures; client tests for
   malformed/empty patient and encounter ids (asserting no fetch), null JSON,
   invalid JSON, non-envelope object JSON, array JSON, rejected fetch, and an
   unreadable 200 body.

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

| Part                                            | Slice | Pre-correction      | Post-correction       |
| ----------------------------------------------- | ----- | ------------------- | --------------------- |
| `route.ts` proxy                                | WU4A  | 99                  | 198                   |
| `clinical-api.ts` client                        | WU4A  | 215                 | 276                   |
| `route.test.ts`                                 | WU4A  | 257                 | 346                   |
| `clinical-api.test.ts`                          | WU4A  | 172                 | 321                   |
| **WU4A subtotal (impl + tests)**                | WU4A  | **743** (314 + 429) | **1,141** (474 + 667) |
| `clinical-workspace.tsx`                        | WU4B  | 491                 | 668 (post-correction) |
| `patient-detail.tsx` mount (+2)                 | WU4B  | 2                   | 2                     |
| `clinical-workspace.test.tsx`                   | WU4B  | 290                 | 656 (post-correction) |
| **WU4B subtotal (impl + tests)**                | WU4B  | **783**             | **1,326 code**        |
| **Original WU4 total incl. tests (superseded)** | WU4   | 1,526               | —                     |

Pre-correction, both re-sliced parts were under the ≤800 changed-lines budget
and no `size:exception` was required. The maintainer-authorized security/error
correction pass added a **+398-line** evidence delta to WU4A (hardened proxy,
identifier validation, error normalization and the mandated focused tests),
lifting WU4A to **1,141 changed lines**, i.e. over the ≤800 slice budget. The
maintainer approved the **WU4A `size:exception`** after the 2026-09-12 fresh
re-review for the honest, non-minified measure. WU4B was 783 before the
corrections and measured **1,150 changed code lines** after the first
review-correction pass; including the SDD artifacts that exceeded the ≤800
budget, and the maintainer approved the **WU4B `size:exception`** (~1,520
changed lines including SDD docs at review). The subsequent
conflict-reload/evidence correction pass (2026-09-12) brings the honest WU4B
measure to **1,326 changed code lines**, covered by the approved exception. No
comment, test, or state was minified to fit the budget.

## WU4B status — implemented, uncommitted residual (out of the WU4A boundary)

The WU4B staff workspace source and tests exist in the working tree, but they
are **not part of the WU4A commit**. The UUID fixture migration required by the
WU4A client contract, the 2026-09-12 review-correction pass and the
conflict-reload/evidence correction pass are all complete on the WU4B branch;
the focused suite is green. WU4B owns:

- `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.tsx` (668)
- `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.test.tsx` (656)
- the `patient-detail.tsx` mount (+2, tracked but left uncommitted)

They must stay untracked/unstaged (`git add` must not use `-A`) and are held for
the next chained child slice. No WU4B feature code or test is outstanding — its
own chained commit/PR remains, covered by the maintainer-approved WU4B
`size:exception`.

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
  hook in the web app. Permission-aware UX is therefore error-code driven (403
  `FORBIDDEN` / `FEATURE_NOT_ENTITLED` render dedicated copy); the backend
  remains authoritative. No navigation/portal change.
- **Autosave model (updated 2026-09-12)**: the draft is a **debounced on-change
  versioned autosave** (initially shipped as an explicit "Save draft" button,
  then corrected per review). The version guard remains the concurrency
  contract; the debounce only coalesces keystrokes, and the timer is cleaned up
  on every change and on unmount.
- **WU4 UI scope is encounter lifecycle only** (list/create/autosave/close/
  amend). The five specialized record kinds remain API-only because the spec
  Staff-workspace requirement and tasks 4A.1/4A.2 and 4B.1/4B.2 enumerate only
  encounter flows; `clinical-api.ts` intentionally does not add unused record
  functions.

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
  after the 2026-09-12 fresh re-review (no test or comment minified). WU4B is
  also over budget (1,326 changed code lines after the correction passes) and
  its **`size:exception` is maintainer-approved**.
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
  its own branch based on WU4A (`1,326` changed code lines including the
  2026-09-12 corrections; maintainer-approved `size:exception`).

## Risks (WU4A / WU4B)

- **Size**: the correction pass lifts WU4A to 1,141 changed lines, over the ≤800
  slice budget; the maintainer approved the `size:exception` after the
  2026-09-12 fresh re-review. WU4B is 1,326 changed code lines after its
  correction passes; its `size:exception` is maintainer-approved.
- The WU4B files are uncommitted in the working tree; a careless `git add -A`
  would leak WU4B into the WU4A commit. Use the explicit path list above.
- Fresh-context re-review APPROVED the corrected WU4A slice on 2026-09-12 (with
  the 1,141-line `size:exception`), so WU4A is committed as exactly one chained
  commit `feat(EPIC-06): add clinical proxy and client`.
- The proxy rewrite is pinned by a test; a future change to the API route prefix
  would require updating both the proxy and its test.

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

---

# Phase 4B — Staff Workspace UI (WU4B) — continuation 2026-09-12

Base/continuation note: WU4A was merged into the tracker and the tracker format
fix landed at `7128cf7` (`style(EPIC-06): format WU4A delivery state`). WU4B is
implemented on `feat/epic-06-clinical-wu4b-workspace-ui`, whose HEAD is exactly
`7128cf7` (no commits beyond the tracker; upstream unset so an accidental
`git push` cannot target the tracker). The three pre-existing WU4B residual
files were preserved/reused; pre-existing `.atl/` modifications and the
untracked `.codegraph/` index were preserved and never staged. Nothing was
committed, pushed, opened as a PR, or merged. Prior WU1/WU2A/WU2B/WU3/WU4A
content above is retained unchanged.

## Completed Tasks — WU4B

- [x] 4B.1 RED: RTL tests for loading, empty, error, success, permission-denied,
      autosave conflict (with local edits preserved), close, amendment, and
      client-safe `internalNotes` separation. Implemented as
      `clinical-workspace.test.tsx` (11 tests). Because the WU4A correction
      tightened `clinical-api.ts` to reject non-UUID identifiers, the fixtures
      were migrated from `patient-1`/`enc-1` to canonical UUIDs.
- [x] 4B.2 GREEN: `clinical-workspace.tsx` (loading/empty/error/success/denied,
      version-guarded draft save with 409 reload prompt, close, amend,
      staff-only `internalNotes` separation) and the `patient-detail.tsx` mount,
      using semantic tokens only and the authenticated `/api/clinical` proxy
      only. No Portal, Scheduling, files, reports, or WU5 change. Commit
      intentionally deferred by maintainer instruction; gated on the mandatory
      fresh review.
- [x] 4B.3 Review-correction pass (2026-09-12, maintainer-authorized): replaced
      the manual-only draft save with a debounced on-change versioned autosave
      (dirty-gated, timer cleanup, in-flight no-clobber); rendered mutation 403
      `FORBIDDEN` / `FEATURE_NOT_ENTITLED` as permission-aware UX with the
      unavailable create/save/close/amend actions disabled; made "Reload latest"
      clear the stale mutation error together with the conflict state; moved
      success/autosave updates into a `role="status"` live region and exposed
      the selected encounter with `aria-current`. Focused WU4B became **20
      tests** (was 11). See the dedicated correction-pass section below for the
      size accounting, RED proof and residual risks.
- [x] 4B.4 Conflict-reload/evidence correction pass (2026-09-12,
      maintainer-authorized): (1) autosave is suspended across the entire
      conflict-reload lifecycle (a new `reloading` state) until the refetch
      resolves and the refreshed authoritative encounter version is adopted, so
      no stale-version write can fire before/during a delayed refetch; (2) the
      editor fields stay editable while a save is in flight so the in-flight
      no-clobber guard is actually reachable; (3) focused tests added for a
      delayed conflict reload, unmount timer cancellation, and an in-flight save
      that must not clobber a newer local edit (focused WU4B is now **23
      tests**); (4) WU4B size/accounting corrected to **1,326 changed code
      lines** (668 workspace + 656 RTL + 2 mount) measured after this pass, with
      the maintainer-approved WU4B `size:exception` in force. All gates green.

## Files Changed — WU4B

| File                                                                   | Action   | What Was Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.tsx`      | Created  | Staff clinical workspace (**668 lines post-correction**): `ClinicalWorkspace` shell with loading/empty/error/permission-denied/success branches; encounter list with DRAFT/CLOSED badges and `aria-current` selection; `EncounterEditor` with a **debounced versioned autosave** (dirty-gated, timer cleanup, in-flight no-clobber, fields editable mid-flight, autosave suspended across the whole conflict-reload lifecycle until the refreshed authoritative version is adopted, 409 CONFLICT shows a reload prompt and keeps local edits); permission-aware mutation deny states that disable unavailable actions; close command; `AmendmentForm` for CLOSED encounters; `role="status"` live region. Semantic tokens only; internal notes isolated in a `staff-internal-notes` region; no Portal import.       |
| `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.test.tsx` | Created  | **23 RTL tests (656 lines post-correction)** on the WU4A UUID contract: loading, empty, success list, generic error, 403 denied copy, create + editor open, create 403/`FEATURE_NOT_ENTITLED`, debounced autosave (version + body, no write before the debounce), rapid-edit coalescing, reverted-draft no-write, autosave 409 conflict (edits kept) + reload clears conflict and stale error, delayed conflict reload (autosave stays suspended until the refetched version is adopted), unmount timer cancellation, in-flight save no-clobber of a newer local edit, denied save (fields disabled, no retry), denied close, denied amendment, close swaps to the amendment form, amendment submit body, `aria-current` selection, `role="status"` success, and staff internal-notes vs client-summary separation. |
| `apps/web/src/app/(app)/app/patients/[id]/patient-detail.tsx`          | Modified | Mounted `<ClinicalWorkspace patientId={patientId} />` in the existing staff Patient detail surface (+2/-0).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## UUID fixture migration (WU4A-dependent)

The WU4A security/error correction tightened `clinical-api.ts`
(`encodeIdentifier` rejects any non-UUID patient/encounter id with
`ApiRequestError("INVALID_IDENTIFIER", …, 0)` before path construction). The
WU4B RTL fixtures previously used the placeholders `patient-1` / `enc-1` and
therefore failed with `Invalid patient id.` The fixtures now use canonical
UUIDs:

- `PATIENT_ID = 11111111-1111-4111-8111-111111111111`
- `ENCOUNTER_ID = 22222222-2222-4222-8222-222222222222`
- `AMENDMENT_ID = 33333333-3333-4333-8333-333333333333`
- `TENANT_ID = 44444444-4444-4444-8444-444444444444`

Encounter content, DTO shape and method/URL assertions are unchanged. The
migration is fixture-only and does not alter WU4A behavior.

## Verification Evidence — WU4B (pre-review-correction, historical)

> Superseded by the post-correction evidence in "WU4B Review Correction Pass"
> below (focused 20/20, full web 171/171). Retained as the pre-correction audit
> trail.

| Command                                                                                                                                                                                                                                                                                                | Result                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `pnpm test --filter @newsaas/web -- --run clinical-workspace` (focused WU4B)                                                                                                                                                                                                                           | exit 0 — 1 file, **11 passed**                                                                            |
| `pnpm --filter @newsaas/web exec vitest run --config vitest.config.ts "src/app/(app)/app/patients/[id]/clinical-workspace.test.tsx" "src/app/(app)/app/patients/[id]/clinical-api.test.ts" "src/app/api/clinical/[[...path]]/route.test.ts" "src/app/(app)/app/patients/[id]/patient-detail.test.tsx"` | exit 0 — 4 files / **54 passed** (WU4B 11 + WU4A 34 + patient-detail 9)                                   |
| `pnpm --filter @newsaas/web test` (full web)                                                                                                                                                                                                                                                           | exit 0 — **26 files / 162 passed** (WU4A-only baseline was 25 files / 151; +1 file / +11 tests from WU4B) |
| `pnpm --filter @newsaas/web typecheck`                                                                                                                                                                                                                                                                 | exit 0 — no errors                                                                                        |
| `pnpm --filter @newsaas/web lint`                                                                                                                                                                                                                                                                      | exit 0 — no errors                                                                                        |
| `pnpm --filter @newsaas/web build`                                                                                                                                                                                                                                                                     | exit 0 — build clean; `verify-build-output.mjs` passed                                                    |
| `pnpm exec prettier --check` on the three WU4B files                                                                                                                                                                                                                                                   | all files match Prettier style                                                                            |

Requirement coverage: loading, empty, generic error, success list, 403
permission-denied copy, autosave success (version + body), autosave 409 conflict
with edits preserved, close → amendment form, amendment submit, and staff
`internalNotes` isolated from the client summary. All are exercised by the 11
focused tests.

## Fresh review — in-session adversarial pass (2026-09-12)

> Superseded by the maintainer-authorized "WU4B Review Correction Pass" section
> below, which resolves finding (a) (live/status region) and the autosave,
> permission-UX, conflict-reload and accessibility findings. Finding (c)
> (`patient-detail.test.tsx` non-UUID fixture) remains a recorded test-only
> limitation.

Per the explicit no-delegation instruction, the mandatory fresh review was
performed in-session as an adversarial pass over the three WU4B files. Findings:

- **No blocking defects.** The workspace consumes only `./clinical-api` (the
  authenticated `/api/clinical` proxy) and `@newsaas/ui` components; it never
  calls the API origin directly. All color styling uses semantic tokens
  (`bg-card`, `border-input`, `text-primary-foreground`, `text-status-success`,
  `text-destructive`, …); no brand literal or tenant CSS. `internalNotes`
  renders only inside the staff `(app)` shell workspace and is not read by any
  Portal or other surface (grep confirms the only mount is `patient-detail.tsx`
  under `(app)`).
- **Non-blocking (a)**: the success notice uses a plain `<span>` without
  `role="status"`; the error/conflict notices do use `role="alert"`. Not
  required by the spec.
- **Non-blocking (b)**: `afterEach(vi.restoreAllMocks())` does not restore the
  directly assigned `global.fetch`; each test reassigns it, and Vitest isolates
  test files, so there is no cross-test leak.
- **Non-blocking (c, recorded as a coupling risk)**: the pre-existing
  `patient-detail.test.tsx` uses the non-UUID id `patient-1`, so the newly
  mounted workspace renders its error state during that test. The test still
  passes (it does not assert clinical content) and production route ids are
  UUIDs. Migrating that fixture would change a tracked file outside the planned
  WU4B boundary and would push the slice over the ≤800 budget, so it is left as
  a recorded non-blocking limitation.
- **Fresh-context review**: this in-session pass was superseded by the two
  maintainer-authorized correction passes (review-correction and
  conflict-reload/evidence), which applied the review findings. The corrected
  slice is covered by the maintainer-approved WU4B `size:exception`.

## Measured size — WU4B

Honest measures (all lines count; nothing minified). **Pre-correction** is the
slice after the UUID fixture migration; **post-correction (pass 1)** is after
the first maintainer-authorized review-correction pass; **post-corrections
(pass 2)** is after the conflict-reload/evidence correction pass.

| File                                             | Pre-correction | Post (pass 1) | Post (pass 2) | Notes                                                                                 |
| ------------------------------------------------ | -------------- | ------------- | ------------- | ------------------------------------------------------------------------------------- |
| `clinical-workspace.tsx`                         | 491            | 632           | 668           | Debounced autosave, permission-aware mutations, conflict-reload suspension, a11y.     |
| `clinical-workspace.test.tsx`                    | 302            | 516           | 656           | 23 RTL tests (11 originally, 20 after pass 1); +140 from the new regression coverage. |
| `patient-detail.tsx` mount                       | 2              | 2             | 2             | +2 additions / 0 deletions.                                                           |
| **WU4B code subtotal**                           | **795**        | **1,150**     | **1,326**     | 668 workspace + 656 RTL + 2 mount.                                                    |
| SDD artifacts (`tasks.md` + `apply-progress.md`) | —              | ≥370          | ≈498          | `apply-progress` ≈382+/23− and `tasks` ≈68+/25− vs HEAD.                              |

**Maintainer-approved `size:exception`.** The corrected WU4B slice is **1,326
changed code lines**; including the SDD documentation deltas it is **≈1,824
changed lines**, i.e. materially **over the ≤800 budget**. The maintainer
approved the WU4B `size:exception` for the honest, non-minified **~1,520-line**
measure at the 2026-09-12 review; the subsequent maintainer-authorized
conflict-reload/evidence corrections add the remaining delta (the
reload-lifecycle guard, three regression tests and their documentation). No
test, comment, or state was minified to fit the budget and no further split is
required.

## Deviations from Design (WU4B)

- None that change the design. The WU4-level deviations (no RHF/Zod, error-code
  driven permission UX, explicit version-guarded save, and encounter-lifecycle-
  only UI scope) are recorded in the WU4A section above and remain in force for
  WU4B.

## Known Limitations / Risks (WU4B)

- **Size exception**: after the 2026-09-12 conflict-reload/evidence correction
  pass WU4B is **1,326 changed code lines**; including SDD docs it is over the
  ≤800 budget, covered by the maintainer-approved WU4B `size:exception`.
- No live database in this environment: cross-tenant isolation and concurrent
  409 semantics remain WU5/H1-owned; WU4B renders the UX states driven by the
  stable error codes only.
- `patient-detail.test.tsx` retains a non-UUID fixture (see review finding c);
  it is a test-only coupling, not a production defect.
- The commit is deferred; a careless `git add -A` would stage `.atl/` dirtiness,
  the `.codegraph/` index, and/or SDD docs. A future committer must stage only
  `clinical-workspace.tsx`, `clinical-workspace.test.tsx`, `patient-detail.tsx`,
  and the SDD doc updates, and must not use `-A`/`.`.

## Workload / PR Boundary — WU4B

- Mode: **chained PR slice** (feature-branch-chain), WU4B only. The
  conflict-reload/evidence correction pass brings the slice to **1,326 changed
  code lines** (over the ≤800 budget including SDD docs), covered by the
  maintainer-approved WU4B `size:exception`.
- Boundary: base = tracker `feat/epic-06-clinical` @ `7128cf7` (contains WU1 +
  WU2A + WU2B + WU3 + WU4A); ends with the workspace component, its RTL tests,
  and the `patient-detail.tsx` mount. WU4A proxy/client, WU5, Portal,
  Scheduling, files, and reports are explicitly OUT.
- Staging guidance (for the deferred commit): stage only
  `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.tsx`,
  `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.test.tsx`,
  `apps/web/src/app/(app)/app/patients/[id]/patient-detail.tsx`, and the SDD doc
  updates; exclude the pre-existing `.atl/` dirtiness and the `.codegraph/` tool
  index. Do **NOT** run `git add -A` / `git add .`.

## Branch / Worktree State — WU4B

- Current branch: `feat/epic-06-clinical-wu4b-workspace-ui`, HEAD =
  `7128cf77e38f00457672cd4f262d0a919ea33ca6` = tracker `7128cf7` (no commits
  beyond the tracker; local upstream unset so no accidental push to the
  tracker).
- Working tree: `clinical-workspace.tsx` (sha256
  `02a8c322391babdeddee8a943af3936b9ce118dbc25d81f304325edea3aee5f7`, 668 lines)
  and `clinical-workspace.test.tsx` (sha256
  `20838dca20061e9b40c96b916ef242cb50b24d1715ba65819ee2dd3ae2f7fef9`, 656 lines)
  untracked/new; `patient-detail.tsx` modified (+2). Pre-existing `.atl/`
  dirtiness and `.codegraph/` preserved and never staged.
- Phase result: WU4B implementation, both maintainer-authorized correction
  passes and verification are complete (focused 23/23, full web 174/174,
  typecheck/lint/build green). The corrected slice is 1,326 changed code lines
  and over budget including SDD docs, covered by the maintainer-approved WU4B
  `size:exception`. No push, PR, or merge.

---

# WU4B Review Correction Pass (2026-09-12, maintainer-authorized)

Scope: `clinical-workspace.tsx`, `clinical-workspace.test.tsx` and the SDD
artifacts only. No WU4A proxy/client, WU5, Portal, Scheduling, files, or reports
change; `.atl/` and `.codegraph/` untouched; no commit/push/PR/merge.

## Corrections applied

1. **Debounced on-change versioned autosave replaces the manual-only save.**
   `EncounterEditor` now debounces content changes and writes through
   `updateDraft` with the `version` last read from the server. The write is
   dirty-gated (`sameContent` against a baseline ref), suspended while a write
   is in flight or while in conflict, and its pending timer is cleared on every
   change and on unmount. An in-flight response adopts only the server echo when
   the draft did not change mid-flight, so newer local edits are never
   clobbered; the shared encounter-list cache is updated from the authoritative
   response. The explicit **Close encounter** and **Record amendment** actions
   are preserved.
2. **Permission-aware mutation UX.** Mutation failures with `FORBIDDEN` /
   `FEATURE_NOT_ENTITLED` (and `UNAUTHENTICATED`) render the neutral
   `PermissionDeniedAlert` instead of a red error, and the unavailable action is
   disabled: create disables **New encounter**, save disables the editor fields
   and stops the autosave retry loop, close disables **Close encounter**, amend
   disables the amendment submit. The list-level 403 state is unchanged.
3. **Conflict reload clears the stale error.** `handleReload` calls
   `saveMutation.reset()` and `closeMutation.reset()` in addition to clearing
   the conflict flag and invalidating the list, so no stale mutation error
   survives the reload; the local draft is preserved.
4. **Accessibility.** Success notices and the autosave status render inside a
   `role="status" aria-live="polite"` region; the selected encounter button
   exposes `aria-current="true"`.
5. **Honest size/accounting.** See `Measured size — WU4B`: 1,150 changed code
   lines after this pass, over budget including SDD docs, covered by the
   maintainer-approved WU4B `size:exception`.

## Evidence — focused and web verification

| Command                                                         | Result                                              |
| --------------------------------------------------------------- | --------------------------------------------------- |
| focused WU4B `vitest run …/clinical-workspace.test.tsx`         | exit 0 — 1 file, **20 passed** (was 11)             |
| focused clinical set (workspace + api + proxy + patient-detail) | exit 0 — 4 files, **63 passed**                     |
| `pnpm --filter @newsaas/web test` (full web)                    | exit 0 — **26 files / 171 passed** (was 26/162; +9) |
| `pnpm --filter @newsaas/web typecheck`                          | exit 0                                              |
| `pnpm --filter @newsaas/web lint`                               | exit 0                                              |
| `pnpm --filter @newsaas/web build`                              | exit 0; `verify-build-output.mjs` passed            |
| `prettier --check` on the two corrected files                   | clean                                               |

RED proof (one-variable, reverted): the debounce/`setTimeout` was temporarily
replaced with an immediate write; `does not autosave when the draft is reverted`
then failed (`Expected 0, received 1`), proving the test observes the debounce.
The file was restored byte-for-byte (sha256 verified against the pre-experiment
hash). No other file was touched by the experiment.

## Residual risks

- **Size**: the corrected slice is over budget including SDD docs and is covered
  by the maintainer-approved WU4B `size:exception`.
- `patient-detail.test.tsx` still uses a non-UUID `patient-1` fixture, so the
  mounted workspace renders its error state there; test-only coupling, not a
  production defect. **RESOLVED by the 2026-09-13 final parent PatientDetail
  UUID fixture correction (below).**
- No live database: cross-tenant/concurrent-409 semantics remain WU5-owned; the
  UI only renders the stable error-code states.

---

# WU4B Conflict-Reload/Evidence Correction Pass (2026-09-12, maintainer-authorized)

Scope: `clinical-workspace.tsx`, `clinical-workspace.test.tsx` and the SDD
artifacts only. No WU4A proxy/client, WU5, Portal, Scheduling, files, or reports
change; `.atl/` and `.codegraph/` untouched; no commit/push/PR/merge.

## Corrections applied

1. **Autosave suspended across the whole conflict-reload lifecycle.**
   `EncounterEditor` gained a `reloading` state set the moment "Reload latest"
   is acknowledged. The debounced autosave effect returns early while
   `reloading` is true, and `handleReload` only clears it after the list refetch
   resolves and the refreshed authoritative encounter version is adopted into
   the ref and the baseline. A stale-version write can therefore never fire
   before or during a delayed refetch. The status region reports "Reloading
   latest version...".
2. **In-flight edits are reachable.** The editor fields are disabled only on a
   permission denial, not while a save is in flight, so a user can keep typing
   during an autosave. The existing in-flight no-clobber guard (adopt the server
   echo only when the draft did not change mid-flight) is now covered by a test.
3. **Focused regression tests.** Three tests added: a delayed conflict reload
   (no write while the refetch gate is pending, then a write with the refreshed
   version), unmount timer cancellation (no write after the debounce), and an
   in-flight save resolving after a newer local edit (the stale echo must not
   clobber it). Focused WU4B is now **23 tests** (was 20).
4. **Size/accounting corrected.** WU4B is **1,326 changed code lines** (668
   workspace + 656 RTL + 2 mount) measured after this pass; the
   maintainer-approved WU4B `size:exception` (~1,520 changed lines including SDD
   docs at review, now larger) is recorded and the contradictory
   "no-exception/deferred" statements removed from `tasks.md` and this document.

## Evidence — focused and web verification (this pass)

| Command                                                         | Result                                          |
| --------------------------------------------------------------- | ----------------------------------------------- |
| focused WU4B `vitest run …/clinical-workspace.test.tsx`         | exit 0 — 1 file, **23 passed** (was 20)         |
| focused clinical set (workspace + api + proxy + patient-detail) | exit 0 — 4 files, **66 passed**                 |
| `pnpm --filter @newsaas/web test` (full web)                    | exit 0 — **26 files / 174 passed** (was 26/171) |
| `pnpm --filter @newsaas/web typecheck`                          | exit 0                                          |
| `pnpm --filter @newsaas/web lint`                               | exit 0                                          |
| `pnpm --filter @newsaas/web build`                              | exit 0; `verify-build-output.mjs` passed        |
| `prettier --check` on the two corrected files                   | clean                                           |

RED proof (one-variable, reverted): removing the `reloading` guard from the
autosave effect made the new delayed-refetch test fail at
`expect(saveCalls(fetchMock)).toHaveLength(1)` with `expected length 1, got 2` —
a stale-version write fired while the refetch gate was still pending, exactly
the regression being prevented. The file was restored byte-for-byte (sha256
`6773cd637b808565ebaf59c88fa40ff5fd4aa24a794e89b67defd77fbd6b1f9f` verified
before/after); a later lint fix (`no-misused-promises` on the async reload
handler) produced the final hash
`02a8c322391babdeddee8a943af3936b9ce118dbc25d81f304325edea3aee5f7`. No other
file was touched by the experiment.

## Residual risks (this pass)

- The conflict-reload suspension depends on the refetch promise resolving;
  `handleReload` clears `reloading` in a `finally`, so a failed refetch resumes
  the editor and any stale write would re-surface as a 409 rather than hang.
- `patient-detail.test.tsx` still uses a non-UUID `patient-1` fixture (test-only
  coupling, not a production defect). **RESOLVED by the 2026-09-13 final parent
  PatientDetail UUID fixture correction (below).**
- No live database: cross-tenant/concurrent-409 semantics remain WU5-owned; the
  UI only renders the stable error-code states.

---

# WU4B Parent PatientDetail UUID Fixture Correction (2026-09-13, maintainer-authorized final correction)

Scope: `apps/web/src/app/(app)/app/patients/[id]/patient-detail.test.tsx` and
the SDD artifacts only. No WU4A proxy/client, WU4B component/mount, WU5, Portal,
Scheduling, files, or reports change; `.atl/` and `.codegraph/` untouched; no
commit/push/PR/merge.

## Why

The WU4A client (`clinical-api.ts`) rejects any non-UUID patient/encounter id
before building a proxy path or issuing a request. `PatientDetail` mounts
`ClinicalWorkspace`, which calls `listEncounters(patientId)`, so the parent
`patient-detail.test.tsx` `useParams` id and guardian/patient fixtures had to
become canonical UUIDs. Previously the file passed only because it never
asserted the clinical state, while the mounted workspace silently rendered its
`INVALID_IDENTIFIER` ("Invalid patient id.") error.

## Correction applied

- Added a single `vi.hoisted` constant holding
  `11111111-1111-4111-8111-111111111111`, consumed by the `useParams` mock, the
  `PATIENT` fixture, both guardian fixtures, and every `mockWorkflow` URL
  matcher and assertion (one source of truth so the fixture set cannot drift).
- Replaced every `patient-1` occurrence with `PATIENT_ID` (object fields keep
  the constant; URL matchers/assertions use template literals).
- Added a test: mounting with a canonical patient id awaits the settled clinical
  error (proving the UUID passed the guard and the encounter list request
  reached the proxy), asserts no `Invalid patient id.` text is rendered, and
  asserts the fetch was issued to `/api/clinical/${PATIENT_ID}/encounters`.
- Focused parent suite: **10 tests** (was 9). Focused parent+WU4B: **33/33**.

## Evidence — focused and web verification (this pass)

| Command                                                            | Result                                          |
| ------------------------------------------------------------------ | ----------------------------------------------- |
| focused parent+WU4B `vitest run patient-detail clinical-workspace` | exit 0 — 2 files, **33 passed** (10 + 23)       |
| focused clinical slice (patient-detail + workspace + api + route)  | exit 0 — 8 files, **85 passed**                 |
| `pnpm --filter @newsaas/web test` (full web)                       | exit 0 — **26 files / 175 passed** (was 26/174) |
| `pnpm --filter @newsaas/web typecheck`                             | exit 0                                          |
| `pnpm --filter @newsaas/web lint`                                  | exit 0                                          |
| `pnpm --filter @newsaas/web build`                                 | exit 0; `verify-build-output.mjs` passed        |
| `prettier --check` on `patient-detail.test.tsx`                    | clean                                           |

RED proof (one-variable, reverted): with the migrated assertion in place,
setting the `PATIENT_ID` constant **value** back to `patient-1` (keeping every
fixture consistent) made only the new test fail — the mount rendered "Invalid
patient id." — while the other 9 passed; the UUID value was then restored
byte-for-byte (sha256
`85f25859c3c710bc8cd090cad4e958ca7566fb04385480c01ceb37150a3f52f5`).
`patient-detail.tsx` was not modified by this pass (sha256 unchanged
`0076d6d35c4435d9760efe6d07e96521939eec3f0f12d80a90a53d7c8fafe5f3`).

## Size

`patient-detail.test.tsx`: **58 changed lines** (46 insertions / 12 deletions).
WU4B cumulative code measure is now **1,384 changed code lines** (668
workspace + 656 workspace RTL + 58 parent RTL + 2 mount); the
maintainer-approved WU4B `size:exception` remains in force. No test or comment
minified.

## Residual risks (this pass)

- None new. The previously recorded `patient-1` residual risk is resolved; the
  canonical UUID fixture now matches the WU4A identifier contract.
- No live database: cross-tenant/concurrent-409 semantics remain WU5-owned; the
  UI only renders the stable error-code states.

---

# WU5 — Verification Evidence & Delivery Documentation (2026-09-13)

> Additive to the cumulative record above (obs #2289 and the WU4B addenda); no
> prior content was overwritten. Implemented on
> `feat/epic-06-clinical-wu5-verification` from tracker `feat/epic-06-clinical`
> @ `6230f837` (contains WU1–WU4B). **Not committed; fresh review is required.**
> `.atl/` and `.codegraph/` are intentionally excluded from the slice.

## Environment and live-PG provisioning (blocker + honest workaround)

- Docker is unavailable in this WSL distro (`docker` not found, no daemon), so
  the project `docker-compose.yml` PostgreSQL could not be used.
- Workaround (real, not faked): a disposable PostgreSQL 16 cluster was created
  from the system package binaries (`/usr/lib/postgresql/16/bin/initdb` +
  `pg_ctl`) as the unprivileged user, listening on `127.0.0.1:55433`, data dir
  under `/tmp/opencode`. The suite provisions an ephemeral database, applies
  migrations (`pnpm db:deploy`), seeds reference data (`pnpm db:seed`), then
  drops it — the same sequence the CI migrations job runs against its PG16
  service container.
- No Docker-specific evidence was claimed; every result below came from an
  actual run against that live PostgreSQL.

## Root gates (this pass)

| Command                                   | Result                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @newsaas/api test:live-pg` | exit 0 — 1 file, **24 passed** (16 EPIC-05 + 8 EPIC-06)                                                    |
| `pnpm lint`                               | exit 0 — 14/14 tasks                                                                                       |
| `pnpm typecheck`                          | exit 0 — 14/14 tasks                                                                                       |
| `pnpm test`                               | exit 0 — API 52 files / **476 passed / 24 skipped** (live-PG skipped without its URL)                      |
| `pnpm build`                              | exit 0 — 9/9 tasks; web `verify-build-output.mjs` passed                                                   |
| `pnpm format-check`                       | **fails only on pre-existing `.atl/skill-registry.md`** (excluded dirtiness); all WU5 files Prettier-clean |

## Clinical application-path tests added (8)

`apps/api/test/live-pg-isolation.e2e-spec.ts` — "EPIC-06 clinical
application-path isolation":

1. allowlisted staff encounter DTO + version-advancing autosave with one
   co-committed `clinical_encounter.updated` audit row;
2. live migration **encounter** trigger enforcement: raw `UPDATE` of a CLOSED
   encounter and raw `DELETE` both raise, and the row is unchanged. The five
   subdomain no-delete triggers are pinned statically by the WU1 schema
   migration test, not live-executed here.
3. linked audited amendment (`amendsEncounterId`, reason, copied content) with
   the original CLOSED row untouched and one `clinical_encounter.amended` row;
4. byte-equivalent cross-tenant `404` for a foreign Patient anchor (list +
   create), no persistence and no audit row;
5. byte-equivalent cross-tenant `404` for a foreign encounter UUID reached
   through the caller's own Patient (get + autosave), foreign row unchanged;
6. **negative cross-tenant amendment** `404` via the caller's own Patient and
   via a foreign Patient anchor, with exact before/after DB assertions: no
   amendment row for the foreign original, no audit row for either tenant, the
   own original (`clinicalClosedAId`) and the foreign original
   (`clinicalClosedBId`) byte-equal before/after, and no other tenant B
   encounter created;
7. byte-equivalent cross-tenant `404` for a foreign vaccination UUID (update),
   foreign row unchanged;
8. deterministic-barrier **parallel-autosave** race: two version-1 autosaves
   park on the same `updateMany(status=DRAFT, version=1)` row, then exactly one
   succeeds and one returns `409 CONFLICT`; version advances exactly once and
   exactly one audit row commits.

## RED proofs (one-variable, both reverted byte-for-byte)

1. Removed `await this.assertPatient(tenantId, patientId)` from
   `ClinicalService.listEncounters` → the cross-tenant Patient-anchor test
   failed (`expected 404 "Not Found", got 200 "OK"`). `clinical.service.ts`
   restored (sha256
   `a8406575b472dd66924348916763921ed24cf931e173e4d29f5ca76a90278725`).
2. Removed `version: input.version` from the `updateDraft` `updateMany` guard →
   the parallel-autosave test failed
   (`expected [ …(2) ] to have a length of 1 but got 2`). Same file restored to
   the identical sha256.

## Migration / routes / tests recorded

- Migration:
  `packages/database/prisma/migrations/20260912000001_clinical/migration.sql` (6
  tables, composite tenant-ownership FKs, indexes, CLOSED/no-delete triggers,
  positive-weight CHECK), applied live by the suite. Live assertion scope: the
  encounter CLOSED-immutability and encounter no-delete triggers are
  live-executed; the five subdomain no-delete triggers are pinned statically by
  the WU1 schema migration test.
- Routes: the 21 `vet.clinical.*` routes under
  `/patients/:patientId/clinical/**` plus the `/api/clinical/[...path]` web
  proxy.
- Tests: WU2A/WU2B service tests, WU3 HTTP integration + route-contract probe,
  WU4A/WU4B web tests, and the WU5 live-PG block above.

## Delivery documentation (task 5.2)

- Added: `docs/01-roadmap/EPIC-06-Clinical.md`,
  `docs/02-stories/VET-004-clinical-encounter.md`,
  `docs/05-modules/Clinical.md`.
- Updated: `docs/01-roadmap/ROADMAP.md` (EPIC-06 → `in-progress`),
  `docs/05-modules/README.md`, `docs/09-releases/CHANGELOG.md`, and
  `docs/08-tech-debt/TD-006-live-pg-isolation-run.md` (EPIC-06 extension +
  verification checkbox).
- Known-limitation reconciliation: TD-006 records the EPIC-06 live-PG extension
  and that the broader Batch 5/RBAC gates remain open; the clinical amendment
  race is natively `409 CONFLICT` (unlike the EPIC-05 promotion race in
  [[TD-011]]); the WU5 size overage is recorded as a delivery risk.

## Open questions (design §10) — unresolved

Do **not** resolve without an accepted decision:

- Confirm the minimal encounter field set (`reasonForVisit`, `anamnesis`,
  `diagnosis`, `treatmentPlan`).
- Should `close` require a non-empty `clientSummary`? (default: no.)

## Size and residual risks

- WU5 measured **1,208 changed lines** excluding `.atl/` and `.codegraph/`: 530
  test (`live-pg-isolation.e2e-spec.ts`), 410 new delivery docs (`EPIC-06`,
  `VET-004`, `Clinical`), 112 updated docs (roadmap/modules/CHANGELOG/TD-006),
  and 156 SDD artifacts (`tasks.md`, `apply-progress.md`). This exceeds the
  ≤800-line review budget by ~408 lines; **the maintainer approved the WU5
  `size:exception`** for the honest, non-minified measure. No test or comment
  was minified.
- Updated measure after the authorized 2026-09-13 review-correction pass:
  **~1,315 changed lines** excluding `.atl/`/`.codegraph/` (553 test + 421 new
  docs + 122 updated docs + 219 SDD artifacts, additions + deletions vs tracker
  `6230f837`), still covered by the same approved WU5 `size:exception`.
- Residual risk: the live-PG evidence was produced **locally only** against a
  disposable PG16 cluster (the WU5 branch is not pushed), so **CI has not yet
  observed the WU5 clinical block**. The existing CI migrations job already runs
  the same `pnpm --filter @newsaas/api test:live-pg` target once a pushed commit
  triggers it; that CI observation remains pending.

---

# WU5 Review Correction Pass (2026-09-13, maintainer-authorized)

Scope: `apps/api/test/live-pg-isolation.e2e-spec.ts` and the WU5
evidence/delivery docs only. No product behavior, WU1–WU4, portal, `.atl/`, or
`.codegraph/` change; no commit/push/PR/merge/archive. Corrects the fresh WU5
review findings while keeping the cumulative record above intact.

1. **WU5 `size:exception` recorded consistently.** The maintainer-approved
   ~1,208-line WU5 exception is now recorded in `tasks.md` (forecast row, the
   WU5 note, task 5.2), this addendum, `docs/01-roadmap/EPIC-06-Clinical.md` and
   `docs/02-stories/VET-004-clinical-encounter.md`. The prior "no
   `size:exception` is approved / delivery risk" statements are superseded. This
   authorized correction pass raises the measured slice to **~1,315 changed
   lines** (excluding `.atl/`/`.codegraph/`), still covered by the same approved
   exception; no test or comment was minified.
2. **Cross-tenant amendment test strengthened.** The live test now captures a
   `clinicalClosedBId` snapshot before the negative cases and asserts after: the
   foreign original is byte-equal (and non-null / `CLOSED`), the foreign
   tenant-B encounter count is unchanged (no unintended foreign mutation), the
   own original is byte-equal, and no audit row exists for either tenant. The
   documentation claims are aligned to this evidence.
3. **Truthful format-check evidence.** Root `pnpm format-check` fails only on
   the excluded pre-existing `.atl/skill-registry.md`; every WU5 file is
   Prettier-clean. `tasks.md` task 5.2 no longer lists `pnpm format-check` as
   uniformly green.
4. **Unsupported "encrypted" wording removed.** The live-suite doc comment now
   states the tenant-scoped aggregate path (no encryption claim).
5. **No-delete scope narrowed.** Docs now state that the live evidence asserts
   the **encounter** CLOSED-immutability and encounter no-delete triggers; the
   five subdomain no-delete triggers remain pinned statically by the WU1 schema
   migration test, not live-executed.
6. **TD-006 CI wording corrected.** The EPIC-06 verification entry distinguishes
   the locally verified 24/24 result (WU5 not pushed) from CI, which has not yet
   observed the WU5 clinical block, and a separate unchecked item now tracks
   that pending CI observation.
