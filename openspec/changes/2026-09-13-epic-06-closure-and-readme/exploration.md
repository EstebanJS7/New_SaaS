# Exploration: EPIC-06 Closure/Reconciliation and Root README

**Change (proposed)**: `2026-09-13-epic-06-closure-and-readme`
**Mode**: read-only SDD explore. No code, docs, migrations, or Git state were
modified. Only this exploration file was written.
**Artifact store**: hybrid — `openspec/changes/2026-09-13-epic-06-closure-and-readme/exploration.md`
+ Engram `sdd/2026-09-13-epic-06-closure-and-readme/explore`.
**CodeGraph**: `.codegraph/` exists and was used for structural inspection; docs
and Git state were inspected with built-in tools.
**Language**: technical artifact in English.

> Naming note: the launch prompt did not fix a change name. The proposed name
> follows the EPIC-02–04 closure precedent
> (`2026-09-11-epic-02-04-closure-reconciliation`) and the repo's
> date-prefixed change folders. Rename before `sdd-propose` if the orchestrator
> prefers a different slug.

---

## Current State

### Canonical code/CI state

- `origin/main` = `ff786138b359317b1afb1c33c2350bd605ff84ef` ("Merge pull request
  #4 from EstebanJS7/feat/epic-06-clinical"); local `HEAD` (`feat/epic-06-clinical`
  at `3091f18`) has the **same tree** as `origin/main`.
- EPIC-06's implementation is merged to `main`, so this is a **post-merge
  closure/reconciliation**, not a delivery.
- Canonical CI baseline for this closure: run
  [`34793644348`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34793644348)
  (`push`, `main`, head `ff786138…`, `success`, started 2026-09-14T00:44:35Z):
  - `Lint, Typecheck, Test, Build` (job `103822468217`): lint 14/14,
    format-check, typecheck 14/14, test 15/15 (API 52 files passed / 1 skipped),
    build 9/9.
  - `Database migrations` (job `103822468335`): fresh migrate, seed
    count-equality probe, `db:live-verify`, API build, and
    `pnpm --filter @newsaas/api test:live-pg` → **live-PG suite 24/24 passed**.
- The archived EPIC-06 verify report cites PR run `34766414847`; the closure must
  cite the newer **push-to-main** run `34793644348` as the immutable baseline.

### EPIC-06 delivery and archive state

- Change archived at
  `openspec/changes/archive/2026-09-13-2026-09-11-epic-06-clinical/`
  (`proposal.md`, `design.md`, `tasks.md` 19/19, `apply-progress.md`,
  `explore.md`, `specs/clinical-management/spec.md`, `verify-report.md`).
- Archive verdict: `pass_with_warnings`, 0 blockers, 10/10 requirements, 16/16
  scenarios; 19/19 tasks; remote CI passed at merge `4f05da1`.
- Canonical main spec synced: `openspec/specs/clinical-management/spec.md`.
- Residual (non-blocking) warnings to preserve: local `format-check` fails only
  on excluded `.atl/skill-registry.md`; five subdomain no-delete triggers are
  covered statically (only the encounter trigger is live-executed); design §10
  open questions remain unresolved.

### Stale documentation to reconcile

| Artifact | Current stale state | Required reconciliation |
| --- | --- | --- |
| `docs/01-roadmap/ROADMAP.md` | EPIC-06 = `in-progress`; closure note only covers EPIC-02/03/04 | EPIC-06 → `done`; add closure note citing run `34793644348` @ `ff786138…`; keep "not production readiness; [[EPIC-20]] + open debt" |
| `docs/01-roadmap/EPIC-06-Clinical.md` | `status: in-progress`; Exit Criteria has `[ ] Fresh review of WU5 … before the WU5 commit/PR` | `status: done`; check the Exit Criterion (WU5 merged); cite run/SHA + archive; retain TD-006 + WU5 `size:exception` |
| `docs/02-stories/VET-004-clinical-encounter.md` | `status: in-progress`; Known Limitations "Fresh review of WU5 is required before commit/PR"; Completion Notes "must remain non-done" | `status: done`; remove merged-state claims; keep design §10 open-question limitation |
| `docs/09-releases/CHANGELOG.md` | EPIC-06 only under `Unreleased → Added`; `Changed` covers only EPIC-02–04 closure | Add EPIC-06 closure/reconciliation `Changed` entry with run/SHA; keep EPIC-06 `Added` entries |
| `docs/10-qa/CI-EVIDENCE.md` | Titled "EPIC-02–04 Closure Baseline"; no EPIC-06 content | Add EPIC-06 baseline (run `34793644348`, live-PG 24/24, quality counts) **or** generalize the file; decide file strategy (see Decisions) |
| `openspec/config.yaml` | Context says "EPIC-05 Veterinary Patients is next" and only the EPIC-02–04 baseline | Update roadmap line to EPIC-06 done; add EPIC-06 canonical baseline |
| `docs/08-tech-debt/TD-006-live-pg-isolation-run.md` | Unchecked item "CI has observed the EPIC-06 clinical live-PG block green on a pushed commit" | Check that single item (run `34793644348`, 24/24); **keep TD-006 open** for the broader Batch 5 + RBAC gates |
| `docs/05-modules/README.md` | Lists `Clinical.md` under "Recommended files" although it is implemented | Move/remove the duplicate from the recommended list |
| `README.md` (root) | EPIC-00-era "OpenCode + Obsidian starter"; see below | Rewrite for the current system |
| `FILE-MANIFEST.md` (root) | EPIC-00 subset; omits `apps/**`, `packages/**`, EPIC-02/04/05/06 docs, OpenSpec | Decide: reconcile or remove (see Decisions) |

### Root README gaps

The current `README.md` (last changed in the first commit) describes a starter
package, not the built system:

- Title/framing: "Veterinary SaaS — OpenCode + Obsidian starter"; no statement of
  what the product does today.
- Structure diagram omits `apps/` and `packages/` and the OpenSpec/CI files.
- "Inicio recomendado" still says the first implementation task is
  `/story-start EPIC-00` (EPIC-00 is done).
- No summary of implemented capabilities (RBAC/entitlements, tenant settings,
  Customers, Patients, Clinical, Branding).
- No OpenSpec/SDD workflow pointer, no quality-gate/CI pointer, no
  roadmap/tech-debt pointer, no license/env notes.
- Mixed Spanish prose with an English "Developer startup" section; overlaps
  `docs/README.md` (current English quickstart).
- `FILE-MANIFEST.md` is a stale, unmaintained file list.

### Worktree hygiene

- Uncommitted local state must stay out of the change: `.atl/.skill-registry.cache.json`,
  `.atl/skill-registry.md` (modified) and `.codegraph/` (untracked).
- `main` branch protection is still absent (TD-001): CI is green but **not
  merge-blocking**.

---

## Affected Areas

Documentation / process (in scope):

- `README.md`, `FILE-MANIFEST.md` (repository root)
- `docs/01-roadmap/ROADMAP.md`, `docs/01-roadmap/EPIC-06-Clinical.md`
- `docs/02-stories/VET-004-clinical-encounter.md`
- `docs/05-modules/README.md` (and a status check of `docs/05-modules/Clinical.md`)
- `docs/08-tech-debt/TD-006-live-pg-isolation-run.md` (and `TD-011-…` if hardening is scoped)
- `docs/09-releases/CHANGELOG.md`
- `docs/10-qa/CI-EVIDENCE.md`
- `openspec/config.yaml`
- `openspec/changes/2026-09-13-epic-06-closure-and-readme/**` (new SDD artifacts)

Optional hardening slice (only if explicitly scoped — see Decisions):

- `apps/api/src/patients/patients.service.ts` — scope a PostgreSQL unique-violation
  on `patient_guardian_primary_active_key` to a `CONFLICT` domain response.
- `apps/api/src/patients/patients.service.test.ts` — scoped conflict mapping tests.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — flip the deterministic
  primary-promotion probe assertion from `500 INTERNAL` (currently pinned at
  lines ~1090–1093) to `409 CONFLICT`.
- `docs/08-tech-debt/TD-011-*.md` — close with the resolving commit.

---

## Hardening Analysis (TD-011 500 → 409)

### Smallest safe hardening

`GlobalExceptionFilter.mapExceptionToError` maps `DomainError` by code, Zod
issues, Fastify multipart errors, and `HttpException`; anything else (including
Prisma `P2002`) collapses to `500 INTERNAL`. Under a proven concurrent
primary-promotion race, the losing transaction's `patient_guardian.updateMany`
hits the immediate partial unique index `patient_guardian_primary_active_key`;
the loser currently returns `500 INTERNAL`.

Smallest safe remediation (per TD-011's own proposed resolution):

1. Wrap the primary-promotion write(s) in `PatientsService`
   (`setPrimaryGuardian`, `updateGuardian(isPrimary:true)`,
   `createGuardian(isPrimary:true)`) so a `P2002` whose `meta.target` is the
   `patient_guardian_primary_active_key` (or the `(patient_id)` pair) is
   translated to `new DomainError("CONFLICT", …)`.
2. **Do not** add a blanket "all `P2002` → 409" mapping; scope to the patient
   primary index only (mirrors the exact-target matcher precedent in
   `clinical.service.ts` / `isAmendmentIdempotencyConflict`).
3. Update `apps/api/test/live-pg-isolation.e2e-spec.ts` to assert one `201` +
   one `409 CONFLICT` (instead of `500 INTERNAL`), invariant intact.
4. Close TD-011 with the resolving commit; keep the single-writer `409` paths and
   the sequential demote-then-promote `2xx` swap unchanged.

Estimated size: roughly 30–80 changed code lines plus test/assertion updates. It
is small but it is **runtime code**, so it cannot ride a docs-only closure
without breaking the docs-only scope bound.

### Live-PG evidence feasibility

- The CI `Database migrations` job already provisions PG16, applies migrations,
  and runs the full `test:live-pg` suite (24/24 on `main`). Adding a TD-011
  assertion is feasible with **no workflow change** — only the test body changes.
- TD-006's specific unchecked item ("CI has observed the EPIC-06 clinical
  live-PG block green on a pushed commit") is **already satisfied** by run
  `34793644348` and can be checked without new code.
- The broader TD-006 gates (Batch 5 cross-tenant suite against live PG, RBAC
  `FOR UPDATE` interleavings, RBAC audit-rollback) remain unproven and must stay
  open; they are not part of this closure.

---

## Approaches

1. **Docs-only closure + README reconciliation, TD-011 deferred (recommended)** —
   one SDD change reconciling EPIC-06 status/evidence/debt and rewriting the root
   README; TD-011 remediation stays a separate future change or EPIC-20 item.
   - Pros: matches the EPIC-02–04 precedent; clean `docs/**` + `openspec/**`
     scope; no runtime risk; CI baseline already green; TD-011 keeps its own
     focused review/verification.
   - Cons: TD-011 remains open; two changes instead of one.
   - Effort: Medium.

2. **Closure + README + TD-011 hardening in one change (code-bearing)** —
   include the scoped `P2002 → CONFLICT` mapping and the live-PG assertion flip.
   - Pros: closes TD-011 now; removes an opaque `500` from the Patient surface.
   - Cons: breaks the docs-only bound; mixes code review with doc closure; needs
     a push to prove the live-PG change in CI (not merge-blocking, TD-001); larger
     review surface.
   - Effort: Medium–High.

3. **README-only change, defer all reconciliation** — rewrite the README now,
   leave epic status/debt stale.
   - Pros: smallest.
   - Cons: leaves EPIC-06 `in-progress` after merge and the debt/evidence docs
     stale; does not satisfy the closure requirement.
   - Effort: Low but incomplete.

---

## Recommended Delivery Slices (docs-only, chained)

| Unit | Scope | Notes |
| --- | --- | --- |
| WU1 | CI evidence + debt: `CI-EVIDENCE.md` EPIC-06 baseline; check the TD-006 "CI observed" item; record TD-011 disposition | Evidence only; no code |
| WU2 | Epic/roadmap/release: `EPIC-06-Clinical.md` → `done`, `VET-004` → `done`, `ROADMAP.md`, `CHANGELOG.md`, `openspec/config.yaml`, `docs/05-modules/README.md` | Criterion-to-evidence map; no production-ready claim |
| WU3 | Root README rewrite (+ `FILE-MANIFEST.md` disposition) | Use the `cognitive-doc-design` shape; link, do not duplicate, `docs/README.md` |
| WU4 | Verify + archive SDD records; dated maintainer closure authorization | Required by DEC-001 / `story-finish` |

Forecast: docs/README surface is likely 400–700 changed lines total; chained PRs
are recommended (review budget 400 by default, 800 in this preflight). A single
combined PR risks exceeding 400. `sdd-tasks` must confirm and emit the guard
lines.

---

## Recommendation

Adopt **Approach 1**. Reconcile EPIC-06 to `done` only after mapping every
acceptance criterion to its evidence (archive verify report + run `34793644348`),
checking the now-satisfiable TD-006 CI-observation item, recording the design §10
open questions as unresolved limitations, and obtaining dated maintainer closure
authorization. Rewrite the root `README.md` for the current system using the
cognitive-doc-design structure. Keep TD-011 (500→409) and the broader TD-006
gates **separate and future**, unless the maintainer explicitly chooses
Approach 2 and accepts a code-bearing change with its own push/CI proof.

---

## Risks

- **"done" misread as production-ready** — `done` = epic implementation closure
  only; EPIC-20 and open debt remain.
- **Design §10 product questions unresolved** (minimal encounter field set;
  whether `close` requires a non-empty `clientSummary`) — must be recorded as
  open limitations, never silently resolved.
- **TD-006 over-closure** — only the CI-observation item is satisfiable; the
  broader Batch 5/RBAC gates must stay open.
- **TD-011 scope creep** — if hardened, a blanket `P2002 → 409` mapping is
  explicitly forbidden; the mapping must be scoped to the patient primary index.
- **CI not merge-blocking** (TD-001) — green main CI does not by itself gate the
  closure; keep the evidence + authorization discipline.
- **Stale counts** — use run `34793644348` totals; do not copy the older
  `640 passed / 6 skipped` baseline or the PR run `34766414847`.
- **README duplication/scope creep** — avoid turning the README into a copy of
  `docs/README.md` and the roadmap; link instead.
- **Language/register** — the root README mixes Spanish and English; the rewrite
  language is an unresolved decision.
- **Worktree dirt** — exclude `.atl/**` and `.codegraph/**` from the change.
- **EPIC-05 archive gap (observation, out of scope)** —
  `openspec/changes/archive/2026-09-11-epic-05-veterinary-patients/` contains only
  `specs/` (no proposal/design/tasks/verify/archive-report); note as possible
  follow-up, do not fold into this change without a decision.

---

## Unresolved Decisions

1. **Scope** — docs-only closure + README (Approach 1) vs include TD-011 runtime
   hardening (Approach 2)?
2. **README language/register** — rewrite in English (consistent with
   `docs/README.md`) or preserve the existing Spanish overview?
3. **CI evidence file strategy** — add an EPIC-06 section to
   `docs/10-qa/CI-EVIDENCE.md`, or generalize/rename it into a rolling CI
   evidence record?
4. **CHANGELOG release model** — keep EPIC-06 under `Unreleased` with a closure
   `Changed` note, or cut a versioned release section?
5. **`FILE-MANIFEST.md` fate** — reconcile, replace, or remove (removal needs an
   explicit decision; the repo rules forbid silent deletion of records)?
6. **Design §10 product questions** — remain open; no change without an accepted
   product decision.
7. **Dated maintainer authorization** — explicit go-ahead for EPIC-06 `done`
   status and any archive/process moves is required (per the EPIC-02–04
   precedent).

---

## Ready for Proposal

**Yes, conditional on decision 1 and dated maintainer authorization.** The change
is a docs/process-only closure/reconciliation of an already-merged, CI-green
EPIC-06 plus a root-README rewrite. If the maintainer wants TD-011 remediated,
that becomes a separate code-bearing slice/change and must not be hidden inside
the docs closure. The orchestrator should tell the user: EPIC-06 can truthfully
move to `done` on run `34793644348` @ `ff786138…` paired with a
criterion-to-evidence map; TD-006/007/009/010/001 stay open, TD-008 stays
accepted; design §10 questions stay open; and the root README needs a rewrite to
describe the current system.
