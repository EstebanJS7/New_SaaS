```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:0971b2202db35aefaf28ab07a19d844f51d255b8f140c000e0c64c70ed550bb9
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 10/10
scenarios: 16/16
test_command: pnpm test
test_exit_code: 0
test_output_hash: sha256:fd8c1da9376f904adf6ecba8f1c835b38eea0935a46e3b7c93d91f7264a33bf1
build_command: pnpm build
build_exit_code: 0
build_output_hash: sha256:2eb5334f588aff98d275b7c5d51c7ffc781aa179dfcf468aa94e8193bd2bcef7
```

## Verification Report

**Change**: `2026-09-11-epic-06-clinical` **Candidate**: tracker
`feat/epic-06-clinical` at `4f05da1a0441da43e6728983fc53ef2ce911cb71`
**Version**: N/A **Mode**: Standard

All 19 implementation tasks are checked. All 10 requirements and 16 scenarios
have passing runtime coverage. The local HEAD and requested merge have the same
tree (`f96d55a13d3376862ce9a43bdcd190753ab2d9be`); excluded local `.atl/`,
`.codegraph/`, and prior untracked verify-report state are not candidate code.

### Command Evidence

| Command                                                                 | Exit |  Duration | Summary                                                                                                                         | SHA-256                                                            | External log                                                                            |
| ----------------------------------------------------------------------- | ---: | --------: | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| candidate/task inventory                                                |    0 |    117 ms | Remote tracker equals requested merge; candidate tree matches local HEAD; 19/19 tasks, 10 requirements, 16 scenarios.           | `53e4bdc375df73b075fde58ebd901e629b41eecc28f3425b31710895b25c7a8b` | `/tmp/opencode/epic06-final-verify-20260913/candidate-and-task-inventory-corrected.log` |
| `pnpm lint`                                                             |    0 |  2,668 ms | 14/14 Turbo tasks successful; local cache replayed.                                                                             | `8733303bc8d9886d40dcafecdb3f494220aa3db097b99d759c6289625a7a7f46` | `/tmp/opencode/epic06-final-verify-20260913/root-lint.log`                              |
| `pnpm format-check`                                                     |    1 |  9,516 ms | Local workspace-only failure: dirty `.atl/skill-registry.md` plus the prior untracked verify report; neither is candidate code. | `53285d6b58e2787fbe3a8a3c1e13196284a263e612c311bb46f9dfb9451cd9aa` | `/tmp/opencode/epic06-final-verify-20260913/root-format-check.log`                      |
| tracked files, excluding `.atl/**`, `prettier --check --ignore-unknown` |    0 |  9,845 ms | All tracked non-`.atl` files are Prettier-clean.                                                                                | `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20` | `/tmp/opencode/epic06-final-verify-20260913/format-tracked-excluding-atl-corrected.log` |
| candidate diff, `prettier --check --ignore-unknown`                     |    0 |  3,432 ms | Every Prettier-supported file changed by the candidate is clean.                                                                | `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20` | `/tmp/opencode/epic06-final-verify-20260913/format-candidate-diff-corrected.log`        |
| `pnpm typecheck`                                                        |    0 |  1,512 ms | 14/14 Turbo tasks successful; local cache replayed.                                                                             | `9aa7d9d6116dc42b681d53205974a7e19a6abedccbbf69b6565e3ba794dc9771` | `/tmp/opencode/epic06-final-verify-20260913/root-typecheck.log`                         |
| `pnpm test`                                                             |    0 |  1,481 ms | 15/15 Turbo tasks; database 124, web 175, API 476 with 24 live-PG skipped, worker 37; local cache replayed.                     | `fd8c1da9376f904adf6ecba8f1c835b38eea0935a46e3b7c93d91f7264a33bf1` | `/tmp/opencode/epic06-final-verify-20260913/root-test.log`                              |
| `pnpm build`                                                            |    0 |  1,536 ms | 9/9 Turbo tasks; web output verification passed; local cache replayed.                                                          | `2eb5334f588aff98d275b7c5d51c7ffc781aa179dfcf468aa94e8193bd2bcef7` | `/tmp/opencode/epic06-final-verify-20260913/root-build.log`                             |
| `DATABASE_URL_TEST=<redacted> pnpm --filter @newsaas/api test:live-pg`  |    0 | 11,270 ms | Fresh local PostgreSQL 16 execution: 1 file, 24/24 passed, including 8 EPIC-06 direct application-path tests.                   | `002b9a75b5d3afdbd04bb1ed3b89cf4e19171ce79b4f739cf646faa3ca0168f8` | `/tmp/opencode/epic06-final-verify-20260913/live-pg-correct-role.log`                   |
| `git ls-remote` + `gh run view 34766414847`                             |    0 |  2,496 ms | Remote tracker is the requested merge; exact-candidate CI succeeded for quality and PostgreSQL migration/live-isolation jobs.   | `95cc5302895d19024d219702169e02e67ccff6d7e62912357afdeb7e4de0e94f` | `/tmp/opencode/epic06-final-verify-20260913/remote-tracker-ci.log`                      |

The tracked-file inclusive format isolation exits 123 because Prettier
identifies only `.atl/skill-registry.md`; excluding `.atl/**` passes. The two
initial live-PG attempts exited 1 because the verifier supplied, respectively, a
`psql`-incompatible `schema` query parameter and a nonexistent local role. A
role preflight identified `postgres`; the corrected command then passed 24/24.
These were verifier setup errors, not candidate failures. Complete logs:
`format-tracked-inclusive-corrected.log`, `live-pg.log`,
`live-pg-corrected-url.log`, and `pg-role-preflight.log` in the evidence
directory.

Failure excerpt (`pnpm format-check`, complete six-line output):

```text
$ prettier --check .
Checking formatting...
[warn] .atl/skill-registry.md
[warn] openspec/changes/2026-09-11-epic-06-clinical/verify-report.md
[warn] Code style issues found in 2 files. Run Prettier with --write to fix.
[ELIFECYCLE] Command failed with exit code 1.
```

### Capability Preflight

| Check                           | Result    | Reason                                                                          | Retried?        |
| ------------------------------- | --------- | ------------------------------------------------------------------------------- | --------------- |
| Node, pnpm, dependencies        | AVAILABLE | Commands resolved and all root gates executed.                                  | No              |
| GitHub CLI/API                  | AVAILABLE | Authenticated; tracker ref and exact candidate CI queried.                      | No              |
| Docker daemon                   | SKIPPED   | System PG16 fallback was available; Docker was unnecessary.                     | No              |
| PostgreSQL 16                   | AVAILABLE | System binaries and disposable live server worked; corrected live suite passed. | Setup corrected |
| `gentle-ai sdd-verify-validate` | AVAILABLE | CLI resolved in preflight.                                                      | No              |

### Evidence Map

| Requirement / Scenario                              | Bounded source or test evidence                                                                                                                | Runtime evidence                                 | Result    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------- |
| Encounter lifecycle — Create draft encounter        | `clinical.service.test.ts:216`; `clinical.http.integration.test.ts:525`; `schema-clinical.test.ts:34-44`                                       | Root suites + exact-candidate CI                 | COMPLIANT |
| Encounter lifecycle — Closed encounter is immutable | `clinical.service.test.ts:280-323`; `live-pg-isolation.e2e-spec.ts:1248`                                                                       | Root API + local live PG + CI live PG            | COMPLIANT |
| Clinical records — Record a vaccination             | `clinical.records.service.test.ts:229`; all five HTTP paths at `clinical.http.integration.test.ts:566`                                         | Root API + exact-candidate CI                    | COMPLIANT |
| Clinical records — Invalid weight rejected          | `clinical.records.service.test.ts:332`; HTTP no-write at `clinical.http.integration.test.ts:403`; DB check at `schema-clinical.test.ts:111`    | Root API/database + CI                           | COMPLIANT |
| Autosave — Successful autosave                      | `clinical.service.test.ts:242`; `live-pg-isolation.e2e-spec.ts:1218`                                                                           | Root API + local/CI live PG                      | COMPLIANT |
| Autosave — Stale autosave conflict                  | `clinical.service.test.ts:260`; deterministic race at `live-pg-isolation.e2e-spec.ts:1543`                                                     | Root API + local/CI one-success/one-409 evidence | COMPLIANT |
| Amendments — Amend a closed encounter               | `clinical.service.test.ts:325`; live preservation/audit at `live-pg-isolation.e2e-spec.ts:1266`                                                | Root API + local/CI live PG                      | COMPLIANT |
| Amendments — Without permission                     | `clinical.service.test.ts:354`; HTTP route matrix `clinical.http.integration.test.ts:327-391`                                                  | Root API + exact-candidate CI                    | COMPLIANT |
| Amendments — Without reason                         | `clinical.service.test.ts:374`; strict Zod/HTTP contract in API suite                                                                          | Root API + exact-candidate CI                    | COMPLIANT |
| Authorization — Missing permission                  | HTTP exact-key matrix `clinical.http.integration.test.ts:327-391`; route inventory `route-contract.probe.test.ts:178-218`                      | Root API + exact-candidate CI                    | COMPLIANT |
| Entitlement — Missing entitlement                   | `clinical.http.integration.test.ts:393`; service denial `clinical.service.test.ts:632`                                                         | Root API + exact-candidate CI                    | COMPLIANT |
| Tenant isolation — Cross-tenant access              | HTTP checks `clinical.http.integration.test.ts:418-523`; live checks `live-pg-isolation.e2e-spec.ts:1296-1541`                                 | Root HTTP + direct local/CI live-PG evidence     | COMPLIANT |
| Confidential API — Response leaks no internals      | `clinical.service.test.ts:669-705`; HTTP allowlist at `clinical.http.integration.test.ts:525`; classification at `schema-clinical.test.ts:213` | Root API/database + CI                           | COMPLIANT |
| Transactional audit — Close audited atomically      | `clinical.service.test.ts:293,574-629`; live audit at `live-pg-isolation.e2e-spec.ts:1218`                                                     | Root API + direct local/CI live-PG evidence      | COMPLIANT |
| Staff workspace — Authorized staff workflow         | `clinical-workspace.test.tsx:169-657`; mount at `patient-detail.test.tsx:418`                                                                  | Root web 175/175 + exact-candidate CI            | COMPLIANT |
| Synthetic data — Demo populated                     | `demo-seed.test.ts:643-710`; `demo-seed.ts:454-515`                                                                                            | Root database 124/124 + CI seed-twice step       | COMPLIANT |

### Design and Task Traceability

- Design decisions are implemented: leaf Clinical module; six typed
  tenant-scoped models; version-guarded conditional update; DB immutability;
  linked CLOSED amendments; shared entitlement/RBAC/audit boundaries; no new
  runtime, dependency, or unused event.
- Routes, authenticated proxy, staff workspace, semantic tokens, and Portal
  exclusion align with design §§4-7.
- Tasks are 19/19 checked. WU5 is merged, and exact tracker CI run `34766414847`
  passed both required jobs, including migration and live-PG steps.

### Issues Found

**CRITICAL**: None. **WARNING**:

1. Local root format-check is contaminated by excluded local state. Among
   tracked files, only user-owned `.atl/skill-registry.md` fails; the candidate
   diff and all tracked non-`.atl` files pass, as does the exact-candidate CI
   format step. The prior untracked verify report also appeared in the raw root
   check but is not candidate code.
2. The five specialized-record no-delete triggers are statically covered by
   migration/schema tests and successful CI migration application; only the
   encounter no-delete/CLOSED-update trigger is directly exercised by the
   live-PG suite.

**SUGGESTION**: Keep design §10 questions unresolved until an accepted product
decision; they do not contradict current acceptance criteria.

### Execution Efficiency

| Candidate diff SHA-256                                             | Root gate runs | Focused runs | Duplicate runs avoided | Bounded reads | Speculative probes |
| ------------------------------------------------------------------ | -------------: | -----------: | ---------------------: | ------------: | -----------------: |
| `f1d4516f1e553119bf330b8ca8c8d43dcae937403be00b670d2d204f83cba265` |              5 |            3 |                      3 |            19 |                  0 |

The focused runs were the direct live-PG security/tenancy/audit/concurrency
suite and two format-isolation checks required to separate candidate formatting
from excluded `.atl` dirtiness. Separate API/web/database focused test reruns
were avoided because root evidence and exact-candidate CI already cover them.
