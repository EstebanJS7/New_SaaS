---
id: EPIC-20
type: epic
title: Production Hardening
status: done
priority: high
depends_on:
  - EPIC-00
  - EPIC-01
  - EPIC-02
  - EPIC-03
  - EPIC-04
  - EPIC-05
  - EPIC-06
  - EPIC-07
  - EPIC-08
  - EPIC-09
  - EPIC-10
  - EPIC-11
  - EPIC-12
  - EPIC-13
  - EPIC-14
  - EPIC-15
  - EPIC-16
  - EPIC-17
  - EPIC-18
  - EPIC-19
prd_sections:
  - "29"
  - "30"
branch: feat/epic-20-production-hardening
created: 2026-10-22
updated: 2026-10-22
---

# EPIC-20 — Production Hardening

## Objective

Make the security and recovery claims of PRD §29 and §30 true, measurable and
provable — and be explicit about the part of them that this repository cannot
prove at all.

Every epic in this chain closed with the same sentence: `done` is **never** a
production-readiness statement. This is the epic whose job is to earn the right
to stop repeating it, and the first honest thing it does is split the claim in
two: the half that is code in this repository, and the half that is a hosting
control plane. See [[DEC-074]].

## What the exploration found before writing anything

Verified against the code at `feaa53e` on 2026-10-22, not assumed from the PRD.

```text
exists        /health/live and /health/ready, with a Redis probe under a 1500ms
              per-dependency budget (apps/api/src/health/)
              HSTS when NODE_ENV !== development, plus nosniff, frame-deny and
              referrer-policy on EVERY response, errors included
              CORS: exact-match allowlist, deny-by-default 403 for an unknown
              origin, Vary: Origin, preflight — proven by a real Nest + Fastify
              integration test (transport-security.integration.test.ts)
              structured pino logs with request-id echo on success and error
              a global exception filter that returns a generic message for
              every 5xx, so no stack trace or Prisma detail reaches a client
              session cookies with flags; staff and portal policies separate
              packages/secret-store: an envelope secret store over a key ring
              packages/storage: a real S3 driver and a fallback in-memory driver
              a login rate limiter — IN-PROCESS — covering four paths
does not      any Content-Security-Policy in the repository (zero matches)
exist         a shared rate-limit store (TD-005)
              object storage in docker-compose.yml or in the CI browser job
              (TD-060)
              any backup, PITR, RPO or recovery artifact of any kind
              a timezone pin on the live-PG lane (TD-054)
              lint or typecheck coverage of packages/database/scripts (TD-015)
              any measured latency for any report (TD-053)
```

Three of those shaped the whole plan:

- **Two PRD §29 bullets are already satisfied.** CORS and "no production stack
  traces" both exist with real tests. The work there is to prove and record, not
  to rewrite — rewriting a passing control is churn with regression risk.
- **The single missing header is the expensive one.** CSP cannot be added as a
  fixed string: the root layout emits a pre-paint bootstrap `<script>` and every
  layout emits a branded `<style>`, so a `style-src 'self'` policy breaks the
  tenant's first paint. [[DEC-075]] chose the nonce.
- **PRD §30's second half is not code.** Backups, PITR and an RPO target live in
  a hosting control plane. [[DEC-074]] fixes what the repository can prove
  instead: a runbook **and an executed restore drill**, because "recovery must
  be tested" is falsifiable here even though the production backup job is not.

## Scope

- **CSP with a per-request nonce** on `script-src` and `style-src`, with no
  `unsafe-inline` in either, plus the confinement directives; the existing
  transport-security baseline re-verified and pinned by tests.
- **A shared rate-limit budget** in Redis as one atomic sliding window, so the
  documented contract holds for more than one replica — the four failure-budget
  paths (staff login, staff password recovery, portal login, portal password
  recovery) move together. Closes [[TD-005]].
- **Shared object storage as part of the environment contract**: MinIO in
  `docker-compose.yml` and as a CI service container, so the browser lane runs a
  complete asynchronous import instead of skipping it. Closes [[TD-060]].
- **Operational recovery**: `docs/09-operations/BACKUP-RECOVERY.md` with the
  hosting requirements, the RPO target and the PITR preconditions, plus a
  runnable drill that takes a backup and restores it, **executed**, with the
  real output recorded as evidence.
- **Gate determinism**: the live-PG lane stops depending on the cluster timezone
  ([[TD-054]]), the `DATABASE_URL_TEST` fallback becomes an explicit contract
  ([[TD-021]]), `packages/database/scripts` enters lint and typecheck
  ([[TD-015]]), and the worker's shutdown is guarded against repeated signals
  ([[TD-003]]).
- **Report performance as a measurement**: a deterministic seeded dataset and a
  declared p95 budget per report, enforced as a gate ([[TD-053]]), which also
  makes the `take: LIMIT + 1` cap refusal reachable against real PostgreSQL
  ([[TD-056]]).

## Out of Scope

Each of these is a recorded decision, not an oversight.

| Deferred                                                               | Why                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [[TD-020]] idempotency retention                                       | PRD §41 forbids a destructive purge before an approved retention policy. Shipping one here would violate the rule it appears to satisfy.                                                            |
| [[TD-026]] list pagination                                             | A public response-shape change on every staff list. It needs its own Decision and its own slice; a silent default cap is worse than the current shape, and an envelope breaks every client at once. |
| [[TD-051]] asynchronous CSV export                                     | Trigger-driven by definition: no tenant has reached `REPORTS_EXPORT_TOO_LARGE`.                                                                                                                     |
| [[TD-058]] import artefact retention                                   | Same class as TD-020 — no approved policy. The 72-hour TTL remains a recorded limitation.                                                                                                           |
| The production backup job and PITR enablement                          | Hosting control plane. [[DEC-074]] records exactly what the repository can and cannot prove about them.                                                                                             |
| [[TD-018]], [[TD-019]], [[TD-022]], [[TD-055]], [[TD-057]], [[TD-059]] | Domain debt from other epics, not hardening. They remain open with their own triggers.                                                                                                              |

## Acceptance Criteria

- [ ] A CSP with a per-request nonce is emitted on every web response, its exact
      policy is asserted by a test, and every inline `<script>` and `<style>` in
      the rendered document carries that same nonce.
- [ ] The existing security headers (nosniff, frame-deny, referrer-policy, HSTS
      outside development) remain proven by the transport-security suite.
- [ ] CORS deny-by-default and the absence of stack traces in 5xx responses are
      recorded as **already-satisfied** PRD §29 items with their evidence, not
      re-implemented.
- [ ] The login failure budget is a single global budget: a test proves two
      independent connections share it and trip it once.
- [ ] Both `/health/live` and `/health/ready` exist and are proven;
      `/health/ready` returns 503 when a primary dependency is down.
- [ ] Object storage is part of the environment contract, and the browser lane
      runs a complete asynchronous import with no skipped spec for [[TD-060]].
- [ ] `docs/09-operations/BACKUP-RECOVERY.md` states the RPO target, the PITR
      preconditions and the hosting requirements, and names what the repository
      cannot verify.
- [ ] A restore drill exists as a runnable script AND was executed; the real
      output is recorded as evidence.
- [ ] The live-PG lane is timezone-independent; a cluster at `America/Asuncion`
      and one at `UTC` produce the same result.
- [ ] `packages/database/scripts` is covered by lint and typecheck, proven by a
      deliberately broken type failing the gate.
- [ ] Report latency is measured against a seeded dataset with a declared p95
      budget per report, and the budget is a gate.
- [ ] `pnpm format-check && pnpm lint && pnpm typecheck && pnpm build && pnpm test`
      are green on the closing tree.
- [ ] The closure block in `docs/10-qa/CI-EVIDENCE.md` carries a real CI run id,
      not a local run standing in for one.

## Stories

| Story        | Title                                               | Status  |
| ------------ | --------------------------------------------------- | ------- |
| [[HARD-001]] | Content-Security-Policy with a per-request nonce    | planned |
| [[HARD-002]] | A shared rate-limit budget across replicas          | planned |
| [[HARD-003]] | Shared object storage in the environment contract   | planned |
| [[HARD-004]] | Operational recovery: runbook and an executed drill | planned |
| [[HARD-005]] | Gate determinism                                    | planned |
| [[HARD-006]] | Report performance budgets                          | planned |
| [[HARD-007]] | The epic closure and evidence                       | planned |

## Dependencies

- Every feature epic, because hardening evaluates surfaces they shipped.
- The `api`, `worker`, `web`, `packages/storage` and `packages/database`
  deployables, none of which change shape: no new runtime service is introduced.
  MinIO is the `object-storage` deployable `ENGINEERING-RULES.md` already lists
  and no code used, so it needs no ADR.
- PRD §29 and §30 as the acceptance source.

## Exit Criteria

- [ ] Lint/typecheck/tests/build required for the Epic are green.
- [ ] Documentation is current: this file, the seven Stories, the five
      Decisions, the operations runbook, the module docs touched, the changelog
      and the roadmap row.
- [ ] Every deferred item is a named Tech Debt record with a trigger, not a
      paragraph.
- [ ] The closure states exactly how far production readiness was proven and
      where the claim stops.

## Decisions / ADRs

- [[DEC-074]] — Epic scope split: what is code in this repository, what is an
  operational runbook, and the evidence standard for the restore drill.
- [[DEC-075]] — CSP with a per-request nonce on `script-src` and `style-src`,
  and no `unsafe-inline`.
- [[DEC-076]] — The rate-limit budget moves to Redis as one atomic sliding
  window, with an explicit degradation mode.
- [[DEC-077]] — Shared object storage becomes part of the environment contract.
- [[DEC-078]] — Report performance is a seeded dataset plus a declared p95
  budget, enforced as a gate.

No ADR: nothing here changes the architecture baseline. The object storage
deployable is already in `ENGINEERING-RULES.md`, and MinIO is an S3-compatible
implementation of a boundary that already exists, not a new technology.

## Technical Debt

Owned and addressed by this epic:

```text
TD-005  shared rate-limit store                       resolved by HARD-002
TD-060  shared storage for the browser lane           resolved by HARD-003
TD-054  live-PG timezone dependence                   resolved by HARD-005
TD-021  live-PG env contract                          resolved by HARD-005
TD-015  database scripts outside the quality scope     resolved by HARD-005
TD-003  worker shutdown repeated-signal guard         resolved by HARD-005
TD-053  report query performance unmeasured           resolved by HARD-006
TD-056  fake cannot prove take or select              resolved by HARD-006
```

Owned and deliberately not addressed, with the reason recorded in Out of Scope:

```text
TD-020  idempotency retention        needs an approved policy first
TD-026  unbounded list endpoints     a public shape change; needs its own Decision
TD-051  asynchronous CSV export      trigger-driven
TD-058  import artefact retention    needs an approved policy first
```
