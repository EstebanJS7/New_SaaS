---
id: TD-001
type: tech-debt
title: Verify and configure main branch protection
status: resolved
severity: high
related_epics:
  - EPIC-00
related_stories:
  - FOUND-006
created: 2026-08-23
updated: 2026-09-21
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

**Update (2026-09-11): definite finding.** The GitHub CLI is now available and
an authenticated read-only probe was executed:

```text
gh api repos/EstebanJS7/New_SaaS/branches/main/protection
→ HTTP 404 "Branch not protected"
```

The default branch has **no protection rule**, so the `quality` check is not a
required status check today. The debt is therefore a confirmed governance gap,
not an unverifiable item, and it remains **open** until protection is
configured. See the canonical evidence baseline in `docs/10-qa/CI-EVIDENCE.md`
(CI run `34605178149` at `c9cff613`).

## Resolution (2026-09-21)

Branch protection is now enabled on `main` with both required checks. The rule
was applied through the authenticated GitHub API during the EPIC-08 closure work
and read back immediately:

```text
gh api repos/EstebanJS7/New_SaaS/branches/main/protection
→ required_status_checks.contexts = ["Database migrations", "Lint, Typecheck, Test, Build"]
   required_status_checks.strict   = false
   required_pull_request_reviews   = null
   enforce_admins.enabled          = false
   allow_force_pushes.enabled      = false
   allow_deletions.enabled         = false
```

The gate is now **merge-blocking**: a red `Database migrations` or
`Lint, Typecheck, Test, Build` check prevents merging into `main`, which is what
`.github/workflows/ci.yml` has documented as required since it was written.

Decisions taken with the enablement, recorded rather than left implicit:

- **`strict: false`** — branches are not required to be up to date before
  merging. Deliberate: the epic landed as a long chain of stacked PRs, and
  requiring up-to-date branches would have forced a rebase before every merge
  for no safety the CI runs did not already provide.
- **No required approving reviews** — a single-maintainer repository cannot
  satisfy a reviewer requirement with a second account.
- **`enforce_admins: false`** — an administrator can still bypass the checks.
  That is a deliberate escape hatch and the honest residual gap in this record:
  the gate blocks ordinary merges, not an admin override.
- **Force pushes and branch deletions remain disabled** on `main`.

## Debt

Until branch protection is verified as enabled, the CI quality gate is green but
**not merge-blocking**: nothing technically prevents merging commits to `main`
while lint/typecheck/test/build fail. _(Resolved 2026-09-21; see above.)_

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

**Status (2026-09-11):** the read-only probe returned HTTP 404 "Branch not
protected", which is recorded in `docs/10-qa/CI-EVIDENCE.md`. The finding is now
immutable, but the debt is **not resolved**: the branch still has no protection
rule, so the required check is not enforced.

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

- [x] Protection rule for `main` lists both `Database migrations` and
      `Lint, Typecheck, Test, Build` as required status checks. _(2026-09-21:
      applied and read back through the authenticated API; the response is
      quoted in the Resolution section above.)_
- [x] Evidence recorded in `docs/10-qa/CI-EVIDENCE.md` — the 2026-09-11 HTTP 404
      finding (CI run `34605178149` at `c9cff613`) plus the EPIC-08 closure
      baseline.
- [x] This record closed: status `resolved`, API response quoted. The residual
      gap — `enforce_admins: false`, so an administrator can bypass the checks —
      is stated rather than hidden.
