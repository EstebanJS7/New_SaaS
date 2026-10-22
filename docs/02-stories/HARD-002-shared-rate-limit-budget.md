---
id: HARD-002
type: story
title: A shared rate-limit budget across replicas
epic: EPIC-20
status: done
priority: high
depends_on: []
prd_sections:
  - "29"
permissions: []
branch: feat/epic-20-production-hardening
created: 2026-10-22
updated: 2026-10-22
---

# HARD-002 — A shared rate-limit budget across replicas

## Objective

Move the login failure budget from one process' memory into Redis as a single
atomic sliding window, so the documented contract holds for more than one `api`
replica. Closes [[TD-005]]. [[DEC-076]] fixes the primitive and the degradation
mode.

## Context

`LoginRateLimiterService` (`apps/api/src/auth/`) is an in-process sliding window
of verified failures keyed by `(email, sha256(IP))`, tripping at ≥10 failures
per 15 minutes with `429 RATE_LIMITED`. TD-005 records the single-replica
limitation.

The exploration for this story found the limitation is **wider than TD-005
states**: the same service is the failure budget for four authentication paths,
not one.

```text
apps/api/src/auth/auth.service.ts:50                          staff login
apps/api/src/auth/password-recovery.service.ts:96             staff password recovery
apps/api/src/portal/portal-auth.service.ts:107                portal login
apps/api/src/portal/portal-password-recovery.service.ts:102   portal password recovery
```

All four use the same `isBlocked` / `recordFailure` / `reset` interface, with
their own key namespaces. A shared store behind that interface covers all four
with no per-path change.

`ioredis` is already a direct dependency of `apps/api` (fiscal and branding
producers, `RedisHealthService`), and Redis is an approved deployable already
present in `docker-compose.yml` and in CI. No new dependency, no new technology.

## Acceptance Criteria

- [x] The limiter contract is preserved exactly: only verified failures are
      recorded; blocked checks happen before any credential work; a successful
      login resets the key; entries older than the window are pruned; a blocked
      request neither records nor extends the window.
- [x] The Redis implementation evaluates prune + count + record in **one** Lua
      script so the check-and-record is atomic across replicas.
- [x] A test proves **one global budget**: two independent Redis connections,
      driving failures through both, trip the threshold once for the pair rather
      than once per connection.
- [x] The keys carried by the Redis path expire, so an abandoned budget cannot
      live forever, and a key's history stays bounded.
- [x] A Redis error degrades to the existing in-process window for that request
      and logs the condition — it does not admit unlimited attempts and it does
      not lock everyone out. A test covers the fallback.
- [x] All four call sites are covered: the existing behaviour tests for staff
      login, staff password recovery, portal login and portal password recovery
      pass unchanged.
- [x] The module documentation states the enforced deployment invariant and
      removes the single-replica sentence.

## Verification

```text
pnpm --filter @newsaas/api test
pnpm format-check && pnpm lint && pnpm typecheck && pnpm build
```

The cross-replica test needs a real Redis; it uses the CI service container the
browser job already provisions, or a local one.

## Technical Debt / Limitations

- The anti-spray keying question TD-005 raised — a per-account budget
  independent of the egress IP — is **not** resolved here and remains recorded
  in TD-005's text: a spray distributed across proxy pools still gets a fresh
  budget per IP, at any replica count.
- During a Redis outage the effective budget narrows to per-replica, which is
  exactly today's behaviour. That is the accepted trade of [[DEC-076]], not a
  hidden regression.

## Implementation summary

### Shape

```text
rate-limit-store.port.ts          RateLimitStore + the four bounds (threshold, window, per-key cap, key cap)
in-process-rate-limit.store.ts    the pre-revision window, extracted unchanged
redis-rate-limit.store.ts         one atomic sliding window, two Lua scripts
login-rate-limiter.service.ts     the seam: shared store with in-process degradation
auth.module.ts                    factory reading REDIS_URL
```

The public interface was preserved exactly — `isBlocked`, `recordFailure`,
`reset` — so all four call sites changed by one token each (`await`). That is
the argument for fixing this at the seam rather than per path.

### Three defects found while implementing, each fixed rather than worked around

1. **`mergeConfig` concatenates `include`.** The first `vitest.redis.config.ts`
   was built with `mergeConfig(baseConfig, …)`, which merged the two `include`
   globs instead of replacing them, so `pnpm test:redis` ran the ENTIRE api
   suite (122 files) before the two tests that mattered failed. The config is
   now standalone, with the reason recorded in it.
2. **The fallback was slow, which for a fail-open decision is a defect.** With a
   dead Redis the first version paid `commandTimeout` on every attempt — ten
   failures spent roughly fifteen seconds on the credential path before the
   local budget answered. Degradation is supposed to be invisible to a user, and
   a latency spike per attempt is not. The store now short-circuits when the
   connection is definitively down, and `commandTimeout` dropped from 1500 ms
   (the readiness probe's budget) to 500 ms, because a cache check is worth less
   than the latency it adds.
3. **`status !== "ready"` was the wrong test.** It also rejected `connecting`,
   which is the state of a freshly constructed store for a few milliseconds, so
   the first commands of every process would have been pushed onto the local
   budget for no reason. The down-states are `end`, `close` and `reconnecting`;
   `connecting`/`connect` are transient and must be attempted.

### Why the test is a real proof

`apps/api/test/rate-limit-shared.redis-spec.ts` opens **two independent
`ioredis` connections** — what a second `api` replica is from Redis' point of
view — and drives `LOGIN_FAILURE_THRESHOLD` failures split between them. Both
then report blocked. The split is asserted to be under the threshold on each
side:

```text
half = floor(10 / 2) = 5            expect(half).toBeLessThan(THRESHOLD)
10 - half = 5                        expect(10 - half).toBeLessThan(THRESHOLD)
combined 10 through two replicas  -> both blocked
```

Under a per-process budget neither five would ever have tripped. A fake
returning the same numbers would have proven nothing, which is why this suite is
the one thing in the epic that cannot be tested with the in-memory boundary.

### Twelve cases against a real Redis 7

```text
ONE global budget across two connections     + ambiguous split proven decisive
one failure short stays under the threshold
independent identities stay independent      (different email, same email/different IP)
window slides rather than resets             (blocked at last failure, clear 1ms past window)
reset clears the shared key for every replica
TTL armed: 0 < PTTL <= window
per-key history capped at 100 of 150 writes
two failures in one millisecond count as two (unique ZSET members)
fail-open read answers false, does not throw
fallback still LIMITS — ten failures then block, so degradation is not "no limit"
reset during an outage takes effect locally
one diagnostic line per minute, and the limiter key is never in it
```

### Lane separation

The default `pnpm test` must not require a Redis a contributor may not have, and
the dedicated lane must not skip quietly when the variable is missing. So:

```text
pnpm --filter @newsaas/api test         collects src/**/*.test.ts + test/**/*.e2e-spec.ts
pnpm --filter @newsaas/api test:redis   collects test/**/*.redis-spec.ts (standalone config)
```

The spec **throws** naming `REDIS_URL_TEST` rather than skipping, so the
dedicated lane cannot report green without measuring. That is the same contract
[[TD-021]] asks the live-PostgreSQL suite to adopt, applied here from the start.

### Observability of the degradation

The store logs at `error`, at most once per minute, and never includes the
limiter key — it is derived from the attempted email and a hashed IP, which
`docs/03-architecture/DATA-CLASSIFICATION-RETENTION.md` classifies as INTERNAL
security-forensics data. A test asserts both the single line and the key's
absence.

### One harness change

`apps/api/test/support/boot-test-app.ts` now overrides `LoginRateLimiterService`
with an instance constructed WITHOUT a URL, pinning HTTP suites to the
in-process window. It is the same reasoning the four producer overrides already
use: a suite asserting HTTP behaviour must not depend on a queue. It also means
every integration suite exercises the degradation path.

### Verification

```text
pnpm --filter @newsaas/api typecheck   pass
pnpm --filter @newsaas/api test        120 files / 1760 passed | 266 skipped   (unchanged)
pnpm --filter @newsaas/api test:redis  1 file / 12 passed  (real Redis 7, 890ms)
```
