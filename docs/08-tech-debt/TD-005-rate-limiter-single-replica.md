---
id: TD-005
type: tech-debt
title:
  Login rate limiter is single-replica; shared-store revision before scaling
status: resolved
severity: medium
related_epics:
  - EPIC-01
  - EPIC-20
related_decisions:
  - "DEC-076"
related_stories:
  - DAT-003
created: 2026-08-24
updated: 2026-10-22
---

# TD-005 — Login rate limiter is single-replica; shared-store revision before scaling

## Context

Design D4 deliberately ships the login rate limiter as an in-process sliding
window (`LoginRateLimiterService`, `apps/api/src/auth/`): ≥10 verified failures
per 15 minutes keyed by `(email, sha256(IP))` ⇒ `429 RATE_LIMITED`. State lives
in one Node process' memory — bounded by a per-key history cap and a 10,000-key
ceiling with oldest-insertion eviction. The single-replica scope was an explicit
design decision for the MVP (the API deploys as exactly one replica), and this
record files that promise instead of leaving it implicit.

## Debt

The limiter's budget is per-process. With more than one API replica:

- each replica enforces its own independent budget, so the effective threshold
  multiplies by replica count;
- load-balanced retries can spread one attacker's attempts across replicas until
  every individual budget stays under the trip point.

The documented contract ("≥10 failures / 15 min") only holds while the API is a
single replica.

## Why It Is Safe to Defer

The MVP deployable topology is exactly one `api` replica, so today the
documented budget IS the effective budget; integration suites prove the contract
against the real adapter. Bounded-memory hardening (empty-key eviction,
key-count ceiling) keeps the in-process design safe against memory-exhaustion
churn even under attack. No acceptance criterion of EPIC-01 depends on
multi-instance behavior.

## Risk

If horizontal scaling happens without this revision, brute-force protection
silently weakens: thresholds multiply per replica and lockout guarantees become
unpredictable per request routing. Likelihood low (topology change is visible),
impact high (auth control degrades without any error signal).

Design-level consideration (accepted with D4): keying by `(email, IP-hash)`
gives attackers distributing attempts across PROXY POOLS a fresh budget per
egress IP — distributed spraying is not stopped by this limiter even at one
replica. The credential layer's constant-work pattern and uniform 401s bound the
information leak, but spray resistance itself must be revisited together with
the shared-store design (per-account budgets independent of IP).

## Evidence Gate

Resolution requires ALL of:

- a shared-store implementation behind the same service interface (approved
  stack only: PostgreSQL or Redis via BullMQ-adjacent primitives — no new data
  store), with atomic check-and-record semantics;
- automated tests proving ONE global budget across simulated replicas
  (concurrent increments from isolated clients trip the threshold once);
- bounded-memory properties carried over (window pruning, key ceiling);
- updated module documentation stating the enforced deployment invariant.

## Proposed Resolution

1. When horizontal scaling of `api` becomes a real requirement, move limiter
   state to Redis (already an approved deployable) using a sliding-window
   primitive with atomic `check + record`.
2. Keep `LoginRateLimiterService` as the interface seam so callers do not
   change; swap the backing store.
3. Add cross-replica budget tests and update the D4 documentation pointer.
4. Re-evaluate anti-spray keying (per-account budget) in the same revision.

## Trigger / Target

MUST be resolved BEFORE any multi-replica deployment of `api` — add it as a
blocking checklist item to any scaling/HA work. Not tied to a specific epic
today because no such work is planned in the MVP chain.

## Verification After Resolution

- [x] One global budget proven across simulated concurrent replicas.
- [x] Window/ceiling behavior preserved on the new backing store.
- [x] Deployment invariant documented; single-replica limitation removed.
- [x] This record closed with a link to the resolving commit.

## Resolution (2026-10-22, [[HARD-002]])

Resolved by moving the failure budget to Redis behind the existing service seam,
following [[DEC-076]].

### What changed

```text
apps/api/src/auth/rate-limit-store.port.ts          the contract + the four bounds
apps/api/src/auth/in-process-rate-limit.store.ts    the pre-revision window, extracted
apps/api/src/auth/redis-rate-limit.store.ts         one atomic sliding window (Lua)
apps/api/src/auth/login-rate-limiter.service.ts     the seam: shared store + degradation
apps/api/src/auth/auth.module.ts                    a factory reading REDIS_URL
```

Two round trips, each a single server-side script evaluation:

```text
isBlocked     ZREMRANGEBYSCORE (-inf .. now-window) ; ZCARD ; DEL if empty ; PEXPIRE
recordFailure ZREMRANGEBYSCORE ; ZPOPMIN if at the per-key cap ; ZADD ; PEXPIRE ; ZCARD
```

Pruning and counting in one evaluation is what makes the count agree across
replicas about what has expired.

### Scope was wider than this record said

This record described a staff-login limiter. The exploration found the same
service is the failure budget for **four** authentication paths:

```text
apps/api/src/auth/auth.service.ts:50                          staff login
apps/api/src/auth/password-recovery.service.ts:96             staff password recovery
apps/api/src/portal/portal-auth.service.ts:107                portal login
apps/api/src/portal/portal-password-recovery.service.ts:102   portal password recovery
```

All four use `isBlocked` / `recordFailure` / `reset` with their own key
namespaces, so the seam fix covered all four with no per-path work. The methods
became asynchronous — the only signature change the revision forced.

### The evidence gate, item by item

**A shared-store implementation behind the same interface, atomic
check-and-record.** `RedisRateLimitStore` implements `RateLimitStore`; the four
call sites are untouched apart from `await`. Prune, count and record are each
one Lua evaluation.

**Automated tests proving ONE global budget across simulated replicas.**
`apps/api/test/rate-limit-shared.redis-spec.ts` opens two independent `ioredis`
connections — what a second API replica is from Redis' point of view — and
drives `LOGIN_FAILURE_THRESHOLD` failures split between them. Both then report
blocked. The split is asserted to be below the threshold on each side, so a
per-process budget could not have tripped: that is what makes the test decisive
rather than decorative.

**Bounded-memory properties carried over.** The per-key member count is capped
inside the write script at `MAX_RECORDED_FAILURES` (100, asserted by count), and
the TTL is re-armed on every touch so an abandoned key expires instead of living
forever (asserted `0 < PTTL <= window`). The in-process ceiling of 10,000 keys
is unchanged, and its five existing bound tests still pass.

**Deployment invariant documented; the single-replica limitation removed.**
`docs/05-modules/Identity-Sessions.md` now states that the budget is shared,
names the four paths, and documents the fail-open degradation instead of the old
single-replica sentence.

**Record closed with a link to the resolving commit.** This section; the commit
is `feat(HARD-002)` on `feat/epic-20-production-hardening`.

### Two things the resolution deliberately did NOT fix

1. **Anti-spray keying.** A spray distributed across proxy pools still receives
   a fresh budget per egress IP, at any replica count. A per-account budget
   independent of IP is the change that closes it, and it is a product decision
   about lockout risk rather than a store swap. Recorded here as still open in
   substance, though this record closes on its own stated gate.
2. **Fail-closed was rejected.** See [[DEC-076]]: rejecting every login because
   Redis is down would convert a cache outage into a total-availability
   incident. The reserve of the decision is that during an outage the budget is
   per replica — the pre-revision behaviour.

### Verification

```text
pnpm --filter @newsaas/api test        120 files / 1760 passed | 266 skipped  (unchanged)
pnpm --filter @newsaas/api test:redis  1 file / 12 passed, against a real Redis 7
pnpm --filter @newsaas/api typecheck   pass
```

The cross-replica suite runs in CI's `quality` job, which now provisions a
`redis:7-alpine` service container. A double would have proven nothing here: a
fake that returns the same numbers agrees with the code by construction.
