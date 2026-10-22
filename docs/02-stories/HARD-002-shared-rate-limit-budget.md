---
id: HARD-002
type: story
title: A shared rate-limit budget across replicas
epic: EPIC-20
status: planned
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

- [ ] The limiter contract is preserved exactly: only verified failures are
      recorded; blocked checks happen before any credential work; a successful
      login resets the key; entries older than the window are pruned; a blocked
      request neither records nor extends the window.
- [ ] The Redis implementation evaluates prune + count + record in **one** Lua
      script so the check-and-record is atomic across replicas.
- [ ] A test proves **one global budget**: two independent Redis connections,
      driving failures through both, trip the threshold once for the pair rather
      than once per connection.
- [ ] The keys carried by the Redis path expire, so an abandoned budget cannot
      live forever, and a key's history stays bounded.
- [ ] A Redis error degrades to the existing in-process window for that request
      and logs the condition — it does not admit unlimited attempts and it does
      not lock everyone out. A test covers the fallback.
- [ ] All four call sites are covered: the existing behaviour tests for staff
      login, staff password recovery, portal login and portal password recovery
      pass unchanged.
- [ ] The module documentation states the enforced deployment invariant and
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
