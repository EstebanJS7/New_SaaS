---
id: TD-001
type: tech-debt
title: Verify and configure main branch protection
status: open
severity: high
related_epics:
  - EPIC-00
related_stories:
  - FOUND-006
created: 2026-08-23
updated: 2026-08-23
---

# TD-001 — Verify and configure `main` branch protection

## Context

The EPIC-00 closeout change (`openspec/changes/epic-00-closeout-and-archive/`)
requires verifying that the `Lint, Typecheck, Test, Build` status check (job id
`quality`, defined in `.github/workflows/ci.yml`) is a required check for the
`main` branch, through an authorized GitHub path.

At apply time (2026-08-23) this could not be performed:

- the GitHub CLI (`gh`) is not installed in the environment;
- no authenticated GitHub API access with repository-admin authority exists;
- branch protection can only be inspected or configured by a repository
  administrator.

This record was created under the maintainer authorization of 2026-08-23 that
deferred closeout Slice 1 to Tech Debt instead of blocking archive.

## Debt

Until branch protection is verified as enabled, the CI quality gate is green but
**not merge-blocking**: nothing technically prevents merging commits to `main`
while lint/typecheck/test/build fail.

## Why It Is Safe to Defer

All quality gates pass locally and are recorded in `docs/10-qa/CI-EVIDENCE.md`.
The workflow definition itself is correct and runs on every push/pull request.
No application code depends on this setting. The gap is purely repository
governance and is now explicitly tracked instead of being silently assumed.

## Risk

A red or skipped CI run could reach `main` without detection until an admin
enables protection. Likelihood is low while the team remains small, impact is
moderate (broken foundation baseline propagates to all branches).

## Evidence Gate

Resolution requires immutable evidence in `docs/10-qa/CI-EVIDENCE.md`, either:

- the GitHub branch-protection API response quoting
  `Lint, Typecheck, Test, Build` under required status checks; or
- an explicit blocker paragraph if verification remains impossible, naming the
  missing authority.

## Proposed Resolution

1. Obtain repository-admin access or authenticated GitHub API/CLI credentials
   (`gh auth login`).
2. Inspect read-only: `gh api repos/{owner}/{repo}/branches/main/protection`.
3. If the required check is missing, enable it as a repository administrator
   only (require `Lint, Typecheck, Test, Build`; recommend "require branches up
   to date").
4. Record the outcome in `docs/10-qa/CI-EVIDENCE.md` per the evidence gate.

## Trigger / Target

Immediately when any maintainer gains repository-admin access to the GitHub
repository. Must be resolved before EPIC-01 feature work starts landing on
`main` unattended.

## Verification After Resolution

- [ ] Protection rule for `main` lists `Lint, Typecheck, Test, Build` as a
      required status check.
- [ ] Evidence quote recorded in `docs/10-qa/CI-EVIDENCE.md`.
- [ ] This record closed with a link to the evidence commit.
