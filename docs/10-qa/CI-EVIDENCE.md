---
type: qa
status: active
updated: 2026-09-07
---

# CI Evidence — EPIC-00 Foundation

## Workflow

`.github/workflows/ci.yml` defines two jobs that run on every push and pull
request to `main`/`master`:

### `migrations` — Database migrations

1. `pnpm install --frozen-lockfile`
2. `pnpm --filter @newsaas/database db:deploy`
3. `pnpm --filter @newsaas/database db:seed`
4. `pnpm --filter @newsaas/database db:live-verify`
5. `pnpm build --filter=@newsaas/api`
6. `pnpm --filter @newsaas/api test:live-pg`

### `quality` — Lint, Typecheck, Test, Build

1. `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. `pnpm format-check`
4. `pnpm typecheck`
5. `pnpm test`
6. `pnpm build`

## Build-order defect and fix

The `migrations` job previously ran `pnpm --filter @newsaas/api build`, which
invokes the API package's `build` script directly. Because `@newsaas/api`
depends on `@newsaas/config`, `@newsaas/shared` and `@newsaas/database` through
workspace `dist/` exports, TypeScript could not resolve those package
declarations on a clean runner and failed with `TS2307`.

The fix routes the build through Turbo so the workspace dependency graph is
respected:

```text
pnpm build --filter=@newsaas/api
```

Turbo builds the three workspace dependencies before `@newsaas/api`, so the
required `dist/index.js` and `dist/index.d.ts` files exist before the API
compilation runs.

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
from the workflow file. The workflow provides two required checks:

- `Database migrations` (job ID `migrations`)
- `Lint, Typecheck, Test, Build` (job ID `quality`)

An admin must configure the default branch protection rule to require **both**
checks before merging.

Required settings:

- Branch: `main`
- Require status checks to pass before merging: **enabled**
- Required status checks:
  - `Database migrations`
  - `Lint, Typecheck, Test, Build`
- Require branches to be up to date before merging: **enabled** (recommended)

Until an admin enables this rule, the CI gates are defined and green but not
automatically merge-blocking.
