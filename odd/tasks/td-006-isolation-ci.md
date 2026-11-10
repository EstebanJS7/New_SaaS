# TD-006 — live PostgreSQL isolation evidence

Objective: close TD-006's open evidence gate. Branch `test/td-006-isolation-ci`
from `main` `c8c1f4e`. Runner: Vitest live-pg
(`DATABASE_URL_TEST='postgresql://postgres@127.0.0.1:55432/postgres?schema=public'`,
rebuild `@newsaas/*` dist first).

## Specs

- S1: "CI runs the broader cross-tenant isolation suite against live PG16 and
  stays green." — the Batch 5 cases of
  `apps/api/test/cross-tenant-isolation.e2e-spec.ts` run against real PostgreSQL
  inside `pnpm --filter @newsaas/api test:live-pg` (the CI migrations job).
- S2: "RBAC concurrency and audit-rollback evidence gates proven live." — (1)
  "parallel effective-holder-removal transactions across BOTH override
  replacement and membership assignment serialize on the `FOR UPDATE` lock
  (exactly one succeeds where both would strand the tenant)"; (2) "a rejected
  RBAC mutation (e.g., the composed stranding repro) leaves NEITHER the business
  write NOR its audit row behind".
- S3: "A deliberately broken predicate fails that CI job (one-off proof)." —
  assumption: proven by running the same live-pg command locally with one
  scoping predicate removed (not committed), recorded with output; no throwaway
  CI branch is pushed without approval.
- S4: "This record closed with a link to the enabling commit." Test-first where
  a rule is new; do not weaken existing tests.

## Tasks

| ID  | Specs | Route                        | Status      | Commit / evidence    |
| --- | ----- | ---------------------------- | ----------- | -------------------- |
| T1  | S1,S2 | delegated (context backstop) | done        | baff5fa              |
| T2  | S3,S4 | inline                       | in-progress | S3 done; S4 after CI |

Risk: item 4 (concurrency proof) and item 2 (tenant isolation evidence);
test-only, no product change expected. If a real defect appears, it is fixed
test-first and reported.

## Log

- L1 (2026-11-10): Recommendation accepted: "hazlo" (start TD-006).
- L2 (2026-11-10): Open TD-006 boxes: broader suite in CI, broken-predicate
  proof, RBAC concurrency + audit rollback live, close with commit link. Batch 5
  suite (490 lines, 14 cases) runs only over the in-memory boundary; live-pg
  spec has no RBAC holdership concurrency/rollback case. Started the stopped
  `newsaas-livepg` container (55432).
- L3 (2026-11-10): T1 (baff5fa, delegated): 14 Batch 5 cases ported to the
  live-pg lane on dedicated tenants (structured-log check not ported: the
  live-pg logger has no capture); RBAC concurrency proven in both interleavings
  with a FOR UPDATE barrier (one 200/201, one 409, ≥1 holder); rollback proven
  with a temporary audit_log trigger failing after the business write (no write,
  no audit). Full live-pg 301/301; in-memory API 2164 pass/295 skipped;
  typecheck/lint/prettier pass. No product defect.
- L4 (2026-11-10): S3 inline: broke tenant-membership.repository.ts:146 to
  `where: {}` (not committed); the Batch 5 block failed 2/14 (list length 5 vs
  2; tenant B id leaked); restored (src clean) → TD-006 block 18/18. Remaining:
  CI green on a pushed commit (S1 box) and closing TD-006 with the enabling
  commit (S4) — need push/PR/merge approval.
