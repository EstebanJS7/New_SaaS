---
id: HARD-007
type: story
title: The epic closure and evidence
epic: EPIC-20
status: done
priority: high
depends_on:
  - HARD-001
  - HARD-002
  - HARD-003
  - HARD-004
  - HARD-005
  - HARD-006
prd_sections:
  - "29"
  - "30"
permissions: []
branch: feat/epic-20-production-hardening
created: 2026-10-22
updated: 2026-10-22
---

# HARD-007 — The epic closure and evidence

## Objective

Close [[EPIC-20]] the way [[EPIC-19]] was closed: a criterion-to-evidence map
against PRD §29 and §30, a real CI run id, the changelog, the roadmap row, the
module documentation and a triage of everything the epic did not do.

## Context

Every epic in this chain closed with the sentence "this is **never** production
readiness". This is the epic whose whole purpose is to earn the right to stop
repeating it — and the honest answer is that it can earn it for the half that is
code, and cannot for the half that is a hosting control plane.

The closure must therefore say something more precise than either extreme:

- §29 is **proven**: every control has a test in this repository that fails if
  the control is removed.
- §30's first half is **proven**: health probes and request-id logging have
  tests.
- §30's second half is **rehearsed**: the restore drill ran and its output is
  recorded, and the backup schedule, retention and PITR window remain hosting
  obligations that this repository states and cannot verify.

## Acceptance Criteria

- [ ] A criterion-to-evidence map covers every bullet of PRD §29 and both halves
      of PRD §30, naming the test or artifact that proves each one.
- [ ] Two PRD §29 bullets are recorded as **already satisfied before this epic**
      (CORS, no stack traces), with their evidence, rather than claimed as new
      work.
- [ ] The live-PostgreSQL lane is executed and its case count recorded.
- [ ] The browser lane is executed and its pass/skip counts recorded exactly,
      including whether any skip attributable to [[TD-060]] remains.
- [ ] The restore drill's real output is in the evidence block.
- [ ] `docs/10-qa/CI-EVIDENCE.md` gains an EPIC-20 block with the **real** CI
      run id and each required job's result.
- [ ] The roadmap row moves to `done` with a closure statement that separates
      what was proven from what is an operational contract.
- [ ] The changelog records the epic.
- [ ] Module documentation is current: the auth module's rate-limit section, the
      storage module's environment contract, and the new operations area.
- [ ] Debt triage: each of [[TD-005]], [[TD-060]], [[TD-054]], [[TD-021]],
      [[TD-015]], [[TD-003]], [[TD-053]], [[TD-056]] is `resolved` with a link
      to its resolving commit, or explicitly still open with a reason.
- [ ] Each of [[TD-020]], [[TD-026]], [[TD-051]], [[TD-058]] carries a recorded
      reason for remaining open and a trigger.
- [ ] `pnpm format-check && pnpm lint && pnpm typecheck && pnpm build && pnpm test`
      green on the closing tree, with the totals recorded.

## Verification

```text
pnpm format-check && pnpm lint && pnpm typecheck && pnpm build && pnpm test
gh pr create --base main          (the only thing that triggers CI)
```

## Implementation summary — prepared, and one item genuinely outstanding

### The criterion-to-evidence map

Every bullet of PRD §29 and both halves of PRD §30, with what proves it.

#### PRD §29 Security

| Requirement                                     | Evidence                                                                                                                                                                                          | Status                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| strict server-side authentication/authorization | `apps/api/src/auth/auth.guard.ts` + `AppModule`'s `APP_GUARD`; `rbac/permission-enforcement.integration.test.ts`                                                                                  | pre-existing, verified                                       |
| tenant-safe repository/data access              | the live-PostgreSQL isolation suite, 266/266; `cross-tenant-isolation` suites                                                                                                                     | pre-existing, verified                                       |
| portal/staff separation                         | separate session tables, cookies and guards; `portal-*.integration.test.ts`                                                                                                                       | pre-existing, verified                                       |
| secure session cookies                          | `auth/session-cookie.ts`, HttpOnly/SameSite/Secure-outside-dev, asserted in `auth.integration.test.ts`                                                                                            | pre-existing, verified                                       |
| **controlled CORS**                             | `common/http/transport-security.integration.test.ts`: deny-by-default 403, exact-match allowlist, `Vary: Origin`, preflight                                                                       | **already satisfied before this epic**, recorded not rebuilt |
| **CSP/HSTS/security headers**                   | CSP: `lib/csp.ts` + `middleware.ts` + the nonce suite (HARD-001), asserted verbatim. HSTS/nosniff/frame-deny/referrer-policy: `transport-security.integration.test.ts`                            | **delivered by HARD-001**                                    |
| rate limits for sensitive endpoints             | `rate-limit-shared.redis-spec.ts` 12/12 against a real Redis: one global budget across two connections, four paths                                                                                | **delivered by HARD-002**                                    |
| secret manager/environment secrets              | `packages/secret-store` envelope store over a key ring; env schema validation refuses to boot on a missing secret                                                                                 | pre-existing, verified                                       |
| private storage                                 | `packages/storage` `S3StorageDriver`; no public/signed route for an import artefact, asserted by the runtime suite                                                                                | pre-existing, verified                                       |
| sanitized structured logs                       | `api-logger.factory.ts` redaction; `error-envelope.integration.test.ts` "never writes credential header values into log lines"                                                                    | pre-existing, verified                                       |
| **no production stack traces**                  | `common/filters/global-exception.filter.ts`: every 5xx returns a generic message. `error-envelope.integration.test.ts` asserts the 500 body contains neither the marker nor the substring `stack` | **already satisfied before this epic**, recorded not rebuilt |

#### PRD §30 Observability and recovery

| Requirement                     | Evidence                                                                                                                                                                   | Status                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| structured logs with request ID | `api-logger.factory.ts`; `error-envelope.integration.test.ts` "binds the request id to EVERY structured log line"                                                          | pre-existing, verified    |
| `/health/live`                  | `health/health.controller.ts` + `health.controller.test.ts`                                                                                                                | pre-existing, verified    |
| `/health/ready`                 | the same, with `RedisHealthService` and a 1500 ms per-dependency budget; 503 on degraded/unhealthy                                                                         | pre-existing, verified    |
| automatic backups               | `docs/09-operations/BACKUP-RECOVERY.md` §"Requirements on the hosting provider"                                                                                            | **operational contract**  |
| PITR preferred                  | the same §"PITR preconditions"; four settings named                                                                                                                        | **operational contract**  |
| initial RPO ≤ 24 h              | the same §"RPO target", stated as a target and not a guarantee                                                                                                             | **operational contract**  |
| **recovery must be tested**     | `scripts/verify-restore-drill.sh`, EXECUTED: logical restore into a second cluster (73 tables, 51 migrations, 66 permissions, marker survived) and PITR in both directions | **delivered by HARD-004** |

#### What this closure cannot say, and does not

```text
1  No CI run. The branch is not pushed, so every claim above rests on a local run.
   docs/10-qa/CI-EVIDENCE.md says so as its headline rather than in a footnote.

2  No browser lane ran. Chromium needs libasound.so.2 and this environment lacks it.
   The CSP has a partial substitute (a next start of the production build, 16/16
   scripts and 1/1 style carrying the nonce) which is NOT a browser.

3  TD-060 is implemented but NOT proven end to end. Four bucket control-flow paths
   were verified with the real AWS SDK against a stub S3 endpoint; no MinIO server
   ran here because the environment has no Docker and no MinIO binary.

4  The production backup job, its retention, the PITR window and the RPO are hosting
   obligations. The repository states them and rehearses the procedure; it cannot
   observe whether a provider honours either.
```

### Debt triage

**Resolved, each with executed evidence:**

```text
TD-005  shared rate-limit store        HARD-002  12/12 against a real Redis
TD-003  worker repeat-signal guard     HARD-005  283 worker tests, mid-flight case
TD-015  database scripts in the gates  HARD-005  10 lint errors found, probe proved coverage
TD-021  live-PG env contract           HARD-005  fails naming DATABASE_URL_TEST
TD-053  report performance unmeasured  HARD-006  p95 4,081 ms recorded, defect in TD-063
TD-054  live-PG timezone dependence    HARD-005  266/266 at two cluster timezones
TD-056  fake cannot prove take/select  HARD-006  refusal observed against real PostgreSQL
TD-060  no shared storage in the lane  HARD-003  bucket bootstrap + CI wiring
```

**Opened, because the work found something it could not fix in this epic:**

```text
TD-061  minio/minio is unpinned          MinIO publishes release-stamped tags only,
                                         and choosing one needs the registry
TD-062  the relation load holds the cap   chunked load is a redesign of a read three
         down                             surfaces depend on; not a hardening change
TD-063  a month of sales takes ~4 s       needs a profile first; DEC-062 forbids a
                                         cache without a measured need
```

**Deliberately still open, with the reason recorded in the epic's Out of
Scope:**

```text
TD-020  idempotency retention      PRD §41 forbids a purge before an approved policy
TD-026  unbounded list endpoints   a public response-shape change; needs its own Decision
TD-051  asynchronous CSV export    trigger-driven: no tenant has hit the export cap
TD-058  import artefact retention  PRD §41 again; the 72 h TTL stays a limitation
```

### The one outstanding item

**A CI run.** The branch must be pushed and a pull request opened against
`main`, because `.github/workflows/ci.yml` triggers only on PRs targeting `main`
or `master` and on pushes to them. Until then:

```text
Criterion                                            State
real CI run id in the evidence block                 PENDING
every required job green                              PENDING
browser lane pass/skip counts recorded                PENDING
TD-060's end-to-end import against MinIO              IMPLEMENTED, UNPROVEN
```

The roadmap row therefore stays `in-progress`, which is the honest state: eight
debt items resolved and five gates green is a strong local result, and it is not
the same thing as a merged pull request with four green checks.

### Verification run

```text
pnpm format-check   PASS
pnpm lint           PASS   29/29 turbo tasks
pnpm typecheck      PASS   29/29 turbo tasks
pnpm build          PASS   16/16 turbo tasks
pnpm test           PASS   29/29 turbo tasks
  api 1760 passed | 266 skipped · web 1366 · worker 283 · database 550
  imports 132 · fiscal 788 · fiscal-persistence 100 · notifications 84
  secret-store 50 · ui 36 · shared 23 · customers 9 · patients 8 · preflight 6
pnpm --filter @newsaas/api test:live-pg   266/266 at America/Asuncion, 266/266 at UTC,
                                          + 6/6 reporting performance
pnpm --filter @newsaas/api test:redis     12/12 against a real Redis 7
bash scripts/verify-restore-drill.sh      exit 0, both drills PASS
```
