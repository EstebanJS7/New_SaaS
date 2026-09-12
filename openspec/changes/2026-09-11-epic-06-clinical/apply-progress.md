# Apply Progress: EPIC-06 Comprehensive Clinical Records

Change: `2026-09-11-epic-06-clinical`
Artifact store: `openspec` (+ Engram `sdd/2026-09-11-epic-06-clinical/apply-progress`)
Mode: **Standard** (`openspec/config.yaml` `strict_tdd: false`; no strict-TDD module loaded)
Delivery strategy: **force-chained** / chain strategy **feature-branch-chain**
Tracker branch: `feat/epic-06-clinical` (from `origin/main` @ `b7529a2`)
Work-unit branch: `feat/epic-06-clinical-wu1` (from the tracker branch)
Batch: **WU1 — Data Foundation** (only)
Correction pass: **WU1 data-foundation repair** (authorized by fresh review) — composite
tenant-ownership FKs so PostgreSQL rejects a clinical row owned by tenant A that
references a Patient of tenant B, and rejects cross-tenant amendment links.
No WU2/WU3/WU4/WU5 work; no commit/push/PR/merge.

## Completed Tasks

- [x] 1.1 RED: `packages/database/src/schema-clinical.test.ts` pins six models, enum,
      RESTRICT FKs, indexes, Decimal weight, and the CLOSED-update/DELETE trigger.
- [x] 1.2 GREEN: `schema.prisma` clinical section + additive migration
      `20260912000001_clinical/migration.sql` with guarded immutability triggers.
- [x] 1.3 RED then GREEN: `reference-seed` (`vet.clinical.read/update/close/amend` +
      role matrix) and `demo-seed` (`seedDemoClinical`, synthetic no-PII fixture).

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/database/prisma/schema.prisma` | Modified | `ClinicalEncounterStatus` enum + 6 tenant-scoped, Patient-anchored clinical models (encounter, treatment, vaccination, deworming, study, weight) with RESTRICT relations and back-relations on `Tenant`/`Patient`/`UserProfile`. Correction: `Patient`/`ClinicalEncounter` gain `@@unique([tenantId, id])`, and every clinical patient/amendment relation is a composite FKs on `(tenantId, patientId)`/`(tenantId, amendsEncounterId)` → same-tenant key. |
| `packages/database/prisma/migrations/20260912000001_clinical/migration.sql` | Created | Additive DDL: 6 tables, enum, 14 RESTRICT FKs (6 tenant + 6 COMPOSITE `(tenant_id, patient_id) → patient(tenant_id, id)` + 1 COMPOSITE same-tenant amendment self-FK + 1 close actor), 2 tenant-ownership unique keys, 8 indexes/unique, `quantity > 0` CHECK, CLOSED-immutability + no-delete triggers. |
| `packages/database/src/schema-clinical.test.ts` | Created | 15 schema/migration inventory assertions for WU1, including composite tenant-ownership FK/index coverage and key-before-FK ordering. |
| `packages/database/src/reference-seed.ts` | Modified | Added `vet.clinical.read/update/close/amend` permissions; granted the full clinical set to OWNER/ADMIN/VETERINARIAN. |
| `packages/database/src/reference-seed.test.ts` | Modified | New clinical catalog/matrix test; updated pinned `VETERINARIAN` array and permission volume (19 → 23). |
| `packages/database/src/demo-seed.ts` | Modified | Exported `DEMO_PATIENT_DOG_ID`; added `seedDemoClinical` + structural client contracts; synthetic encounter + weight fixture. |
| `packages/database/src/demo-seed.test.ts` | Modified | 5 tests: anchoring/state, no-PII synthetic content, single transaction, rerun convergence, missing-patient failure. |
| `packages/database/prisma/demo-seed.ts` | Modified | Wired `seedDemoClinical` into the guarded entrypoint and extended the run log. |

## Verification Evidence (focused, WU1)

| Command | Result |
|---------|--------|
| `pnpm --filter @newsaas/database exec prisma validate` | exit 0 — "The schema is valid" (re-run after correction) |
| `pnpm --filter @newsaas/database test` | exit 0 — 10 files, **124 passed** (incl. `schema-clinical.test.ts` **15/15**, `demo-seed.test.ts` 22/22, `reference-seed.test.ts` 16/16) |
| `pnpm --filter @newsaas/database typecheck` | exit 0 — no errors |
| `pnpm --filter @newsaas/database lint` | exit 0 — no errors |
| `prisma migrate diff --from-empty --to-schema-datamodel` structural alignment | **9/9** composite tenant-ownership statements (2 unique keys + 6 composite patient FKs + 1 composite amendment FK) match Prisma's derived DDL verbatim (normalized whitespace), exit 0 |

Live-PostgreSQL migration application was **not** run: this environment has no Docker
daemon and no reachable Postgres (`pg_isready` reports "no response"). The WU1 runtime
harness is the migration/test harness; live-PG evidence is explicitly owned by WU5/H1.

## Deviations from Design

- Added defense-in-depth `BEFORE DELETE` triggers for the five subdomain tables (design
  names only the encounter immutability trigger). Rationale: the spec states subdomain
  records "MUST NOT be hard-deleted"; DB enforcement matches that invariant and mirrors
  the EPIC-05 DB-enforced-pattern precedent. No schema/contract change.
- Added a `CHECK ("quantity" > 0)` constraint for `ClinicalWeight` from the design's
  `Decimal(10,3) > 0` note; API validation remains the primary 400 path in WU3.

## Correction Pass — WU1 data-foundation repair

Fresh review found the WU1 foundation allowed a clinical row whose `tenant_id`
was tenant A but whose `patient_id` referenced a Patient owned by tenant B, and
allowed an amendment (`amends_encounter_id`) to link across tenants. Both were
separate single-column FKs (`patient_id → patient(id)`), which do not prove
tenant ownership.

Fix (smallest correct DB-level enforcement, Prisma-native composite keys):

- `Patient` gains `@@unique([tenantId, id])` (migration: unique index
  `patient_tenant_id_id_key`); `ClinicalEncounter` gains `@@unique([tenantId, id])`
  (`clinical_encounter_tenant_id_id_key`) as the amendment self-FK target.
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
untouched. The migration is still one additive migration (not yet committed or
applied anywhere), so it was corrected in place with no new migration.

## Issues Found

- None blocking. `prisma validate` passes and relations resolve on first attempt.
- The environment lacks a live database (no Docker daemon, no reachable Postgres), so
  migration execution and a live negative cross-tenant INSERT are unverified until WU5/H1.
  The correction is verified structurally (`prisma validate`, migration-vs-schema DDL
  alignment, and focused DDL assertions) rather than by executing the constraint.
- Fresh-review correction applied: composite tenant-ownership FKs now make a
  cross-tenant Patient reference and a cross-tenant amendment link impossible at the DB
  level (see Correction Pass above).

## Remaining Tasks (not started — out of WU1 scope)

- [ ] 2.1 / 2.2 Clinical service lifecycle, version guard, entitlement, audit, isolation (WU2).
- [ ] 3.1 / 3.2 Controllers, Zod/DTO allowlist, routes, route-contract probe (WU3).
- [ ] 4.1 / 4.2 Web proxy + clinical workspace, RTL tests (WU4).
- [ ] 5.1 / 5.2 Live-PG isolation/concurrency evidence, root gates, documentation (WU5).

## Workload / PR Boundary

- Mode: **chained PR slice** (feature-branch-chain), WU1 only.
- Boundary: starts at `feat/epic-06-clinical` (= `origin/main` @ `b7529a2`); ends with the
  data foundation (schema + migration + permissions + seeds) and its focused tests.
  WU2/WU3/WU4/WU5 are untouched.
- Measured WU1 diff (excl. unrelated `.atl/` dirtiness and `.codegraph/` tool index):
  **~1,012 changed lines** (536 insertions/deletions in modified files + 476 new-file
  lines: migration 253 + schema test 223). The fresh-review correction added ~82 lines
  (composite keys/FKs + focused tests) over the prior ~930. This **exceeds the 800-line
  review budget**.
- Maintainer pre-approved `size:exception` for WU1 (~930 lines); the corrected WU1 stays
  the same single work unit and remains `size:exception`. The diff was not minified:
  comments, invariant documentation, and tests are retained in full.
- Alternative if the growth is unacceptable: planning-level re-split of WU1
  (e.g. 1.1–1.2 schema/migration vs 1.3 seeds).

## Risks

- WU1 exceeds the 800-line review budget → reviewer-load risk; the maintainer-approved
  `size:exception` covers WU1 (now ~1,012 lines including the correction).
- Migration SQL is validated structurally and by `prisma validate` but not applied to a live
  Postgres here; residual risk is limited to DDL runtime behavior (composite FKs,
  triggers and CHECK) until the WU5/H1 live-PG negative cross-tenant proof.
- `internalNotes` is CONFIDENTIAL/staff-only; WU3 must enforce the client-safe allowlist (not in WU1).

## Branch / Worktree State

- Current branch: `feat/epic-06-clinical-wu1`.
- No commit, no push, no PR, no merge performed (fresh-context review required first).
- Pre-existing unrelated dirtiness: `.atl/.skill-registry.cache.json`, `.atl/skill-registry.md`.
- Tool artifacts (not WU1): `.codegraph/` (CodeGraph index initialized for exploration),
  untracked `openspec/changes/2026-09-11-epic-06-clinical/`.
