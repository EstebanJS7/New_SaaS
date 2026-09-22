```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:3eddc315bafaadc60f379347b3a542fea47518f3cd334f8ba34a3f147a3b3dfe
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 3/3
scenarios: 4/4
test_command: "pnpm --filter @newsaas/database test"
test_exit_code: 0
test_output_hash: sha256:2ac1c4cd7ec5a755c34f44d3dd7e02d768caf3cef086a0699c6c8be6cbac1b64
build_command: "pnpm --filter @newsaas/database build"
build_exit_code: 0
build_output_hash: sha256:089c7e4245549cedc388432fe613ebb32b94fc5563777f0242bb46d71b5c622f
```

# EPIC-08 WU1 re-verification

## Result

WU1 (tasks 1.1–1.3) passes its focused persistence/settings verification against
committed predecessor `74820e5`. The prior inherited-diff blocker is resolved:
all 15 WU1 manifest paths form a stable, independently captured candidate.
WU2–WU5 and root quality gates were intentionally not assessed.

## Traceability and scope

| Item          | Evidence                                                                                                                             | Result  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| Baseline      | `74820e5` is `HEAD`; 15 manifest paths are unstaged/untracked WU1 changes only                                                       | PASS    |
| Candidate     | 13 tracked paths plus the migration and `portal.test.ts`; SHA-256 `3eddc315bafaadc60f379347b3a542fea47518f3cd334f8ba34a3f147a3b3dfe` | PASS    |
| Stability     | Candidate bytes were unchanged before/after focused checks and build                                                                 | PASS    |
| Review budget | 1,159 additions + 74 deletions = 1,233 changed lines, above the 800-line budget                                                      | WARNING |

## Behavioral evidence

| WU1 acceptance scope                                 | Runtime evidence                                                                                       | Result |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| 1.1 persistence RED coverage                         | Database suite: 12 files, 176/176 tests; `portal.test.ts`: 28/28; audit actor tests: 7/7               | PASS   |
| 1.2 additive schema/migration and PORTAL audit actor | Database build generated Prisma client and completed TypeScript compilation; database typecheck passed | PASS   |
| 1.3 portal permissions, seed, and typed namespace    | API settings suite: 2 files, 35/35 tests; API typecheck passed                                         | PASS   |

The WU1 scoped count is 3 requirements (tasks 1.1–1.3) and 4 scenarios: portal
default, invalid portal value, portal-specific settings permission, and
synthetic demo population. Later portal security, tenant-isolation, audit
co-commit, and booking runtime scenarios belong to WU2–WU5 and are not claimed.

## Command evidence

| Command                                                                                                                                           | Exit | Duration | Summary                                                | SHA-256                                                            | Log                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---: | -------: | ------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| `pnpm --filter @newsaas/database test`                                                                                                            |    0 | 5,531 ms | 12 files, 176/176 passed; portal 28/28                 | `2ac1c4cd7ec5a755c34f44d3dd7e02d768caf3cef086a0699c6c8be6cbac1b64` | `/tmp/opencode/epic-08-wu1-reverify-database-test.log`      |
| `pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts src/settings/tenant-settings.service.test.ts src/settings/registry.test.ts` |    0 | 6,148 ms | 2 files, 35/35 passed                                  | `3c7cf54b9ab2ea8adaaad2bd6a5c82cd32839f08c950ff806b55584d43e1715f` | `/tmp/opencode/epic-08-wu1-reverify-api-settings-test.log`  |
| `pnpm --filter @newsaas/database typecheck`                                                                                                       |    0 | 5,844 ms | no errors                                              | `38ac890c60e7f38d59ddfb410325cdfb5fca83c9411765c5481754e01c021630` | `/tmp/opencode/epic-08-wu1-reverify-database-typecheck.log` |
| `pnpm --filter @newsaas/api typecheck`                                                                                                            |    0 | 6,639 ms | no errors                                              | `38ac890c60e7f38d59ddfb410325cdfb5fca83c9411765c5481754e01c021630` | `/tmp/opencode/epic-08-wu1-reverify-api-typecheck.log`      |
| `pnpm --filter @newsaas/database build`                                                                                                           |    0 | 8,098 ms | Prisma generation and TypeScript compilation completed | `089c7e4245549cedc388432fe613ebb32b94fc5563777f0242bb46d71b5c622f` | `/tmp/opencode/epic-08-wu1-reverify-database-build.log`     |

## Capability preflight

Node and pnpm were available (`v24.14.0`, `11.1.2`). The root `vitest` binary
probe was unavailable, but package-scoped Vitest was available and executed
through pnpm; it was not retried. Strict TDD is inactive
(`openspec/config.yaml`). Docker/live PostgreSQL, lint, format, and root gates
were not run because this re-verification is WU1-only and resolves traceability,
not WU5 broad-gate ownership.

## Issues

No critical findings. The autonomous WU1 candidate now exceeds the 800-line
review budget by 433 changed lines. Split it further before review, or record an
explicit size exception; do not treat the resolved predecessor baseline as a
budget waiver.

## Execution efficiency

| Candidate diff SHA-256                                                    | Root gate runs | Focused runs | Duplicate runs avoided | Bounded reads | Speculative probes |
| ------------------------------------------------------------------------- | -------------: | -----------: | ---------------------: | ------------: | -----------------: |
| `sha256:3eddc315bafaadc60f379347b3a542fea47518f3cd334f8ba34a3f147a3b3dfe` |              0 |            5 |                      3 |            16 |                  0 |

Focused runs uniquely cover database schema/seed/audit and API settings
behavior. Root gates and later-WU tests were avoided by the requested boundary.
