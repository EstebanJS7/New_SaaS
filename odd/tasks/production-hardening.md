# EPIC-20 — Production Hardening (feature tasks)

PRD §29 (Security) and §30 (Observability and recovery) ask for a hardened
surface. Most of what this epic needs does not exist, and part of what it asks
for cannot live in this repository at all.

## What exists / what does not

Verified against the code on 2026-10-22 at `feaa53e`, not assumed.

```text
exists        /health/live and /health/ready with a Redis probe and a 1500ms
              per-dependency budget (apps/api/src/health/)
              HSTS when NODE_ENV !== development, plus nosniff, frame-deny and
              referrer-policy on EVERY response including errors
              CORS: exact-match allowlist, deny-by-default (403 on unknown
              origin), Vary: Origin, preflight — with a real integration test
              structured pino logs, request-id echo, and a global exception
              filter that returns a generic message for every 5xx
              session cookies with flags, staff and portal separated
              packages/secret-store: EnvelopeSecretStore over a key ring
              packages/storage: S3 driver (real) + per-process in-memory fallback
              a login rate limiter, IN-PROCESS, covering four paths: staff
              login, staff password recovery, portal login, portal password
              recovery
does not      any Content-Security-Policy anywhere (zero matches)
exist         any shared rate-limit store (TD-005)
              any object storage in docker-compose.yml or in CI (TD-060)
              any backup, PITR, RPO or recovery artifact (PRD §30, second half)
              a timezone pin on the live-PG lane (TD-054)
              lint/typecheck coverage of packages/database/scripts (TD-015)
              any performance measurement for a report (TD-053)
```

## The distinction that shapes the whole epic

PRD §29's first eight bullets are code in this repository. PRD §30's second half
— automatic backups, PITR, an RPO target, "recovery must be tested" — is
operational: it lives in a hosting control plane, not in a Node process.

[[DEC-074]] splits them and fixes the evidence standard: the repository owns the
runbook **and** an executed restore drill, because "recovery must be tested" is
a claim that can be falsified here even though the production backup job cannot.

## What already satisfies the PRD, and must be recorded not rewritten

Two of PRD §29's bullets were already implemented and have real tests. The
epic's job there is to **prove and record**, not to re-implement:

```text
controlled CORS            transport-security.integration.test.ts
no production stack traces global-exception.filter.ts (5xx => generic message)
```

Rewriting either would be churn with a regression risk and no gain.

## Decisions that bind this feature

| Decision    | What it fixes                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| [[DEC-074]] | Which half of the epic is code and which is an operational runbook, and the restore-evidence standard     |
| [[DEC-075]] | CSP with a per-request nonce on `script-src` AND `style-src`, no `unsafe-inline`                          |
| [[DEC-076]] | The rate-limit budget moves to Redis as an atomic sliding window, with an explicit degradation mode       |
| [[DEC-077]] | Shared object storage becomes part of the environment contract, so the browser lane can run a full import |
| [[DEC-078]] | Report performance is a seeded dataset plus a declared p95 budget, enforced as a gate                     |

## Tasks

- [x] **T1 — HARD-001: CSP with a per-request nonce.**
  - [x] `apps/web/src/middleware.ts` mints a nonce per request and sets the
        `Content-Security-Policy` request header.
  - [x] The three layouts that emit inline `<script>` / `<style>` read the nonce
        and stamp it on every inline node.
  - [x] A test asserts the header's exact policy string and that a rendered
        document's inline nodes carry the same nonce the header declares.
  - [x] The browser lane passes: no CSP violation in the console, branding still
        applies its CSS variables on first paint.
  - [x] Commit.

- [x] **T2 — HARD-002: shared rate limiting (TD-005).**
  - [x] `LoginRateLimiterService` keeps its interface; a Redis-backed store
        implements the same contract with one atomic Lua script.
  - [x] The four call sites (staff login, staff recovery, portal login, portal
        recovery) move without changing their keys.
  - [x] A test proves ONE global budget across two independent connections.
  - [x] The degradation mode when Redis is unavailable is decided by [[DEC-076]]
        and covered by a test.
  - [x] Commit.

- [x] **T3 — HARD-003: shared object storage in the environment contract
      (TD-060).**
  - [x] MinIO in `docker-compose.yml` with a bucket bootstrap.
  - [x] A MinIO service container in the CI browser job, with the `STORAGE_S3_*`
        variables wired to it.
  - [x] The import spec that skips for TD-060 now runs the full flow.
  - [x] Commit.

- [x] **T4 — HARD-004: operational recovery (PRD §30).**
  - [x] `docs/09-operations/BACKUP-RECOVERY.md`: the hosting requirements, the
        RPO target, the PITR preconditions and the drill procedure.
  - [x] A runnable drill script under `scripts/` that takes a backup from a
        disposable cluster and restores it into a second database.
  - [x] The drill is EXECUTED and its real output is pasted as evidence.
  - [x] Commit.

- [x] **T5 — HARD-005: gate determinism.**
  - [x] TD-054: the live-PG lane stops depending on the cluster timezone.
  - [x] TD-021: the `DATABASE_URL_TEST` fallback becomes an explicit contract.
  - [x] TD-015: `packages/database/scripts` enters lint and typecheck, with a
        deliberately broken type proving the coverage is real.
  - [x] TD-003: the worker's shutdown is guarded against repeated signals.
  - [x] Commit per item.

- [x] **T6 — HARD-006: report performance budgets (TD-053, TD-056).**
  - [x] A deterministic seeded dataset sized to make the reports' range scans
        real.
  - [x] A p95 budget per report, asserted as a gate.
  - [x] The `take: LIMIT + 1` cap refusal proven against real PostgreSQL.
  - [x] Commit.

- [~] **T7 — HARD-007: closure and evidence.**
  - [x] Criterion-to-evidence map for PRD §29 and §30.
  - [ ] `docs/10-qa/CI-EVIDENCE.md` block with the real CI run id.  **PENDING: the
        branch is not pushed, so no run exists. The block is written and says so.**
  - [x] Changelog, roadmap row, module docs, debt triage.
  - [x] A closure statement that says exactly how far production readiness was
        proven and where it stops.
  - [x] Commit.

## What this epic will NOT do, and why

| Deferred                               | Why                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [[TD-020]] idempotency retention       | PRD §41 forbids a purge before an approved retention policy exists. A cleanup here would violate the rule it looks like it satisfies.             |
| [[TD-026]] list pagination             | A public response-shape change on every staff list. It needs its own Decision and its own slice; a silent cap would be worse than the status quo. |
| [[TD-051]] asynchronous CSV export     | Trigger-driven by definition: no tenant has hit `REPORTS_EXPORT_TOO_LARGE`.                                                                       |
| [[TD-058]] import artefact retention   | Same class as TD-020: no approved policy. The 72-hour TTL stays a recorded limitation.                                                            |
| Production backup job, PITR enablement | Belongs to the hosting control plane. [[DEC-074]] records what the repository can and cannot prove.                                               |
