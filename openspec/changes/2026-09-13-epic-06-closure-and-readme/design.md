# Design: EPIC-06 Closure Reconciliation and Root README

## Technical Approach

Documentation-only, evidence-first closure. Two immutable sources:

- **E-REPORT** — archived
  `openspec/changes/archive/2026-09-13-2026-09-11-epic-06-clinical/verify-report.md`
  (`pass_with_warnings`, 0 blockers, 10/10 requirements, 16/16 scenarios, 19/19
  tasks).
- **E-CI** — push-to-main run
  [`34793644348`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34793644348)
  at `ff786138b359317b1afb1c33c2350bd605ff84ef` (`push`/`main`, both jobs
  `success`, live-PG 24/24).

Every status transition cites E-REPORT + E-CI. The PR run `34766414847` and the
EPIC-02–04 totals (`640 passed / 6 skipped`) MUST NOT be cited. Scope:
`README.md`, `docs/**`, `openspec/config.yaml` only — no `apps/**`,
`packages/**`, migration, PRD, or TD-011 change.

## Architecture Decisions

| #   | Decision             | Choice                                                                                                                              | Alternatives                                    | Rationale                                                   |
| --- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| D1  | Evidence authority   | Cite E-CI; E-REPORT for criteria mapping                                                                                            | Reuse PR run `34766414847`                      | Post-merge closure needs the immutable main baseline        |
| D2  | CI-evidence strategy | Append "EPIC-06 baseline" to `docs/10-qa/CI-EVIDENCE.md`, keep the EPIC-02–04 section verbatim; retitle H1 to rolling "CI Evidence" | New `CI-EVIDENCE-EPIC-06.md`; rename/generalize | Additive; no audit content deleted                          |
| D3  | CHANGELOG model      | Keep `## Unreleased`, add EPIC-06 closure under `### Changed`                                                                       | Cut a versioned release                         | Nothing is released; EPIC-20 pending                        |
| D4  | `FILE-MANIFEST.md`   | Leave untouched, disposition undecided; README MUST NOT reference it                                                                | Reconcile/replace/delete                        | Spec forbids deciding; silent deletion banned               |
| D5  | README language      | Neutral professional Spanish; link, don't copy                                                                                      | English; bilingual                              | Onboarding requirement; avoids `docs/README.md` duplication |
| D6  | Debt handling        | Check only TD-006's CI-observation item; keep TD-006 `open`; TD-011 untouched                                                       | Close TD-006; fix TD-011                        | Only the observed item is proven; no code in scope          |
| D7  | `done` authorization | Flip only after a dated maintainer authorization is recorded                                                                        | Flip on green CI alone                          | Mirrors the EPIC-02–04 closure discipline                   |

## Data Flow

```
E-REPORT + E-CI → criterion-to-evidence map → status/evidence edits
                              ↓
                README (Spanish) → link/secret/scope checks → verify → archive
```

## File Changes

| File                                                | Action    | Description                                                                                        |
| --------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| `README.md`                                         | Modify    | Spanish onboarding rewrite                                                                         |
| `docs/01-roadmap/ROADMAP.md`                        | Modify    | EPIC-06 → `done`; closure note citing E-CI                                                         |
| `docs/01-roadmap/EPIC-06-Clinical.md`               | Modify    | `status: done`; check WU5 exit criterion; cite E-REPORT+E-CI; retain TD-006 + WU5 `size:exception` |
| `docs/02-stories/VET-004-clinical-encounter.md`     | Modify    | `status: done`; drop "must remain non-done"; keep design §10 limitation                            |
| `docs/05-modules/README.md`                         | Modify    | Remove `Clinical.md` from "Recommended files"                                                      |
| `docs/08-tech-debt/TD-006-live-pg-isolation-run.md` | Modify    | Check only the CI-observation item (24/24, E-CI); keep `open`                                      |
| `docs/09-releases/CHANGELOG.md`                     | Modify    | Add closure `### Changed` entry citing E-CI                                                        |
| `docs/10-qa/CI-EVIDENCE.md`                         | Modify    | Add EPIC-06 baseline + dated authorization                                                         |
| `openspec/config.yaml`                              | Modify    | Roadmap → EPIC-06 done / EPIC-07 next; add baseline                                                |
| `FILE-MANIFEST.md`                                  | No change | Disposition explicitly out of scope (D4)                                                           |

`docs/07-decisions/`, `openspec/specs/**`, and archived folders are untouched.

## Interfaces / Contracts

No code interfaces. Document contracts:

- **Citation**: each assertion states run ID + SHA `ff786138…`.
- **README order**: title → product summary → prerequisites → quick path
  (`cp .env.example .env`, `pnpm install`, `pnpm services:up`, `pnpm build`,
  `pnpm preflight`, `pnpm --filter @newsaas/database db:migrate`, `pnpm dev`) →
  services/ports → database
  (`pnpm --filter @newsaas/database db:migrate|db:seed|db:deploy|db:live-verify`,
  `ENABLE_DEMO_SEED`) → quality (`pnpm lint|format-check|typecheck|test|build`)
  → structure → authoritative links → license.
- **Links**: repository-relative only, each verified to exist.
- **Secrets**: placeholder-safe values only; `.env.example` is the versioned
  safe environment template to copy, not the sole source of runtime values
  (`.env` and exported overrides supply runtime values).
- **Status**: `done` = implementation closure only; retain "not production
  readiness; [[EPIC-20]] + open debt".

## Testing Strategy

| Layer    | Verify                            | Approach                                                                                                                                                                |
| -------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence | No stale cites                    | grep rejects `34766414847`, `640 passed / 6 skipped`, production-readiness claims                                                                                       |
| Links    | Links resolve                     | extract relative links; assert each path exists                                                                                                                         |
| Secrets  | No credentials                    | scan added lines for secret patterns/real `.env` values                                                                                                                 |
| Debt     | TD-006 one item; TD-011 unchanged | `git diff`: one `- [ ]`→`[x]`; TD-011 diff empty                                                                                                                        |
| Scope    | Docs-only                         | intended staged/candidate diff ⊆ `README.md`, `docs/**`, `openspec/config.yaml`, change folder; unrelated `.atl/**` and `.codegraph/**` working-tree artifacts excluded |
| Format   | Prettier clean                    | `prettier --check` on changed files                                                                                                                                     |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file
classification, or process-integration boundary.

## Migration / Rollout

No migration. Docs-only, single-revertible. Work units (feature-branch-chain):
**WU1** evidence + status reconciliation (CI-EVIDENCE, TD-006, EPIC-06, VET-004,
ROADMAP, CHANGELOG, `openspec/config.yaml`, `docs/05-modules/README.md`),
matching Phases 1-2; **WU2** root README rewrite + documentation verification,
matching Phases 3-4. Archive runs as the subsequent SDD phase after
verification. Chained PRs recommended (budget 800; forecast 400–700 changed
lines).

## Open Questions

- [ ] Dated maintainer authorization for `done` is required before WU1 status
      reconciliation and WU2 verification (blocking).
- [ ] README depth vs `docs/README.md` overlap: keep README short and link.
