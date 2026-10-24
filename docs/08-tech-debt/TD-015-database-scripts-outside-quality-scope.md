---
id: TD-015
type: tech-debt
title: Database scripts sit outside the package lint and typecheck scope
status: resolved
severity: low
related_epics:
  - EPIC-09
related_stories:
  - CAT-001
created: 2026-09-25
updated: 2026-10-22
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

## Resolution (2026-10-22, [[HARD-005]])

### Scope

```text
packages/database/tsconfig.scripts.json   new: noEmit, rootDir ".", includes scripts/**/*.ts
package.json typecheck                    tsc -p tsconfig.json --noEmit && tsc -p tsconfig.scripts.json
package.json lint                         eslint "src/**/*.ts" "scripts/**/*.ts" "scripts/**/*.mjs"
```

The scripts could NOT join `tsconfig.json`: it pins `rootDir: ./src`, and a file
outside it fails with `TS6059`. Moving that rootDir would relocate every emitted
path and break `main: ./dist/index.js` for every consumer of the package. A
second project with `noEmit` is the change that fits.

Lint needed two more fixes, both real:

1. The shared config set `parserOptions.project`, so `scripts/**/*.ts` had to be
   in a project the parser could find — hence
   `project: ["./tsconfig.json", "./tsconfig.scripts.json"]` in this package's
   own config, applied only to entries that already had a project.
2. `.mjs` files are in NO tsconfig, so the shared config now disables
   type-checked rules for them explicitly with `project: null`. Disabling only
   the RULES is not enough: `languageOptions` merge across flat-config entries,
   so the parser still receives a `project` and fails with "The file was not
   found in any of the provided project(s)".

### What the new scope found immediately

Ten lint errors that no gate had ever seen, eight of them auto-fixable
(`@typescript-eslint/array-type`: `Array<T>` → `T[]`, `ReadonlyArray<T>` →
`readonly T[]`). Eleven `no-console` warnings remain, which the repository's own
rule allows.

### The coverage is real, and it was proven the hard way

A deliberate `const drillTypeProbe: number = "this is a string, not a number";`
was inserted into `scripts/live-migration-verify.ts`:

```text
$ pnpm --filter @newsaas/database typecheck
scripts/live-migration-verify.ts(21,7): error TS2322: Type 'string' is not
  assignable to type 'number'.
```

The probe was then reverted and the gate re-run green. Without that step the
resolution would be a configuration change asserting its own effectiveness.

### Verification after resolution

- [x] `pnpm --filter @newsaas/database typecheck` covers `scripts/**/*.ts`.
- [x] `pnpm --filter @newsaas/database lint` covers `scripts/**/*.ts` and
      `scripts/**/*.mjs`.
- [x] A deliberately broken type fails the package typecheck; the probe was
      reverted.
- [x] `pnpm --filter @newsaas/database test` remains 550 passed.
