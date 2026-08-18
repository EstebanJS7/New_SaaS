---
type: qa
status: active
updated: 2026-08-18
---

# CI Evidence — EPIC-00 Foundation

## Workflow

`.github/workflows/ci.yml` defines a single job with ID `quality` and display
name `Lint, Typecheck, Test, Build`. It runs on every push and pull request to
`main`/`master`:

1. `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. `pnpm format-check`
4. `pnpm typecheck`
5. `pnpm test`
6. `pnpm build`

## Local gate evidence

The full gate sequence was executed successfully after the final blocker fixes:

```text
pnpm lint          → exit 0
pnpm format-check  → exit 0
pnpm typecheck     → exit 0
pnpm test          → exit 0 (36 tests across workspace packages)
pnpm build         → exit 0
```

## Merge-blocking policy

GitHub branch protection is a repository-admin setting and cannot be enabled
from the workflow file. The workflow provides the `Lint, Typecheck, Test, Build`
check; an admin must configure the default branch protection rule to require
that check before merging.

Required settings:

- Branch: `main`
- Require status checks to pass before merging: **enabled**
- Required status checks: `Lint, Typecheck, Test, Build`
- Require branches to be up to date before merging: **enabled** (recommended)

Until an admin enables this rule, the CI gate is defined and green but not
automatically merge-blocking.
