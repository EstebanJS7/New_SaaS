---
id: TD-015
type: tech-debt
title: Database scripts sit outside the package lint and typecheck scope
status: open
severity: low
related_epics:
  - EPIC-09
related_stories:
  - CAT-001
created: 2026-09-25
updated: 2026-09-25
---

# TD-015 — Database scripts sit outside the package lint and typecheck scope

## Context

`@newsaas/database` carries scripts that CI executes but that no quality gate
covers. In `packages/database/package.json`:

```text
"lint":      "eslint \"src/**/*.ts\" --ignore-pattern src/generated"
"typecheck": "tsc -p tsconfig.json --noEmit"
```

and `packages/database/tsconfig.json` declares `"include": ["src/**/*.ts"]`. The
script directory is therefore outside both gates:

| Script                             | Covered by lint | Covered by typecheck |
| ---------------------------------- | --------------- | -------------------- |
| `scripts/live-migration-verify.ts` | no              | no                   |
| `scripts/ci-seed-counts.mjs`       | no              | no                   |
| `scripts/copy-prisma-client.mjs`   | no              | no                   |

Both `.ts` and `.mjs` files are affected. `pnpm db:live-verify` (the TypeScript
verifier) runs in the CI `Database migrations` job, and
`scripts/ci-seed-counts.mjs` is the seed-idempotency probe that job compares, so
these files are part of the release gate while being invisible to `pnpm lint`
and `pnpm typecheck`.

This surfaced concretely during EPIC-09 WU1 ([[CAT-001 Catalog item
foundation]]): the author of `scripts/live-migration-verify.ts` had to check that
one file in isolation with an ad-hoc scoped
`tsc --noEmit --strict --module NodeNext` invocation, because the package
`typecheck` script does not see it. That ad-hoc check is recorded in the Story;
it is evidence of the gap, not a substitute for coverage.

## Debt

The repository's Definition of Done treats lint and typecheck as required gates,
but a directory it executes in CI is excluded from both. A type error or a lint
violation in a database script lands undetected until the migrations job fails
at runtime, and a stale script can diverge from the schema or the seed it
verifies without any signal — which is exactly the class of drift the verifier
exists to catch.

The scripts themselves are currently correct: the local 2026-09-25 closure run
applied all migrations, ran the seed idempotency probe and passed
`db:live-verify`, so nothing is known to be broken.

## Why It Is Safe to Defer

- CI executes `db:live-verify` and the count probe in the `Database migrations`
  job, so a runtime failure is still caught before merge; the uncovered class is
  type-level and lint-level only.
- The scripts are small, few, and changed rarely, so the exposure window is
  narrow.
- EPIC-09 already passed its migration, seed and live-verification evidence with
  the current scripts, so no acceptance criterion depends on the change.

## Risk

- A compile error in a future script edit reaches the migrations job instead of
  `pnpm typecheck`, producing a red CI run that is slower and noisier to
  diagnose.
- A `.mjs` script has no typecheck at all by construction, so its correctness
  rests entirely on the runtime path it is asserted against.
- The gap is invisible from the root gates: `pnpm lint` and `pnpm typecheck`
  report success and give no hint that a CI-executed directory was skipped.

## Proposed Resolution

1. Add an explicit quality scope for the script directory: either extend
   `packages/database/tsconfig.json` with a second `include` (for example
   `scripts/**/*.ts` while keeping `rootDir`/build output for `src`), or add a
   dedicated `typecheck:scripts` / `lint:scripts` task wired into the package
   scripts.
2. Keep `.mjs` files under ESLint at minimum, and prefer `.ts` for scripts that
   need type safety so one configuration covers them.
3. Make the root `pnpm typecheck` / `pnpm lint` tasks depend on the new scope so
   the gate is not optional.

## Trigger / Target

The next edit to any file under `packages/database/scripts/`, or the next time a
script is added there.

## Verification After Resolution

- [ ] `pnpm --filter @newsaas/database typecheck` covers
      `packages/database/scripts/**`.
- [ ] `pnpm --filter @newsaas/database lint` covers
      `packages/database/scripts/**`.
- [ ] The root `pnpm typecheck` and `pnpm lint` remain green with the widened
      scope.
- [ ] A deliberately broken type in a script makes the package typecheck fail,
      proving the coverage is real.
