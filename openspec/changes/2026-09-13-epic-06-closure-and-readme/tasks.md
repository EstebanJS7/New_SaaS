# Tasks: EPIC-06 Closure Reconciliation and Root README

## Review Workload Forecast

| Field                   | Value                                                              |
| ----------------------- | ------------------------------------------------------------------ |
| Estimated changed lines | 450-650                                                            |
| 400-line budget risk    | High                                                               |
| Review budget           | 800 changed lines (preflight)                                      |
| Chained PRs recommended | Yes                                                                |
| Suggested split         | PR 1 evidence/status records -> PR 2 Spanish README + verification |
| Delivery strategy       | force-chained                                                      |
| Chain strategy          | feature-branch-chain                                               |

Decision needed before apply: Resolved 2026-09-13 (force-chained /
feature-branch-chain) Chained PRs recommended: Yes Chain strategy:
feature-branch-chain 400-line budget risk: High

### Suggested Work Units

| Unit | Goal                                                      | Likely PR | Notes                                               |
| ---- | --------------------------------------------------------- | --------- | --------------------------------------------------- |
| 1    | Reconcile evidence, debt, and closure statuses            | PR 1      | Base `main`; preserve limitations and open debt.    |
| 2    | Replace root onboarding README and verify docs-only scope | PR 2      | Base PR 1 branch; Spanish README plus verification. |

## Phase 1: Evidence Baseline

- [x] 1.1 Update `docs/10-qa/CI-EVIDENCE.md`: retain EPIC-02-04 content
      verbatim, add the EPIC-06 baseline from E-REPORT and CI run `34793644348`
      at `ff786138`, and record the 2026-09-13 maintainer authorization without
      a production-readiness claim.
- [x] 1.2 Update only TD-006's EPIC-06 CI-observation checkbox in
      `docs/08-tech-debt/TD-006-live-pg-isolation-run.md`; retain
      `status: open`, all remaining gates, and leave
      `docs/08-tech-debt/TD-011-patient-primary-concurrency-error-mapping.md`
      unchanged.

## Phase 2: Status Reconciliation

- [x] 2.1 Set `status: done` and document E-REPORT/E-CI closure evidence in
      `docs/01-roadmap/EPIC-06-Clinical.md`; check the WU5 review criterion and
      retain TD-006, WU5 size-exception, and all limitations.
- [x] 2.2 Set `status: done` in `docs/02-stories/VET-004-clinical-encounter.md`;
      replace the obsolete non-done completion note while preserving Design
      section 10 open questions and debt references.
- [x] 2.3 Reconcile EPIC-06 status and the implementation-only closure note in
      `docs/01-roadmap/ROADMAP.md`, `docs/09-releases/CHANGELOG.md`,
      `docs/05-modules/README.md`, and `openspec/config.yaml`; cite E-REPORT and
      E-CI and make EPIC-07 the next roadmap epic.

## Phase 3: Developer Onboarding

- [ ] 3.1 Rewrite `README.md` in neutral professional Spanish in the specified
      order: product summary, prerequisites, safe quick path, services/ports,
      database/migration/seed commands, quality commands, structure,
      authoritative links, and license.
- [ ] 3.2 Use only `.env.example`-safe placeholders and repository-relative
      links in `README.md`; link to governance, PRD, roadmap, module, and CI
      evidence without restating product scope or mentioning `FILE-MANIFEST.md`.

## Phase 4: Documentation Verification

- [ ] 4.1 Verify changed paths are limited to `README.md`, `docs/**`,
      `openspec/config.yaml`, and this change folder; confirm no application,
      migration, PRD, TD-011, manifest, main-spec, decision, or archive diff.
- [ ] 4.2 Verify all new relative README links exist; scan changed text for real
      credentials, stale run `34766414847`, stale `640 passed / 6 skipped`
      EPIC-06 claims, and production-readiness claims.
- [ ] 4.3 Run Prettier check on changed Markdown/YAML and review the diff to
      confirm TD-006 has exactly one unchecked-to-checked item and E-CI/E-REPORT
      citations support every done status.
