---
id: DEC-076
type: decision
title:
  The login failure budget moves to Redis as one atomic sliding window, and
  degrades open when Redis is unavailable
status: accepted
date: 2026-10-22
related_epics:
  - "EPIC-01"
  - "EPIC-20"
related_decisions: []
related_stories:
  - "HARD-002"
prd_change_required: false
---

# DEC-076 — Redis-backed sliding window, and what happens when Redis is down

## Context

[[TD-005]] records the limitation: `LoginRateLimiterService` keeps its sliding
window in one Node process' memory, so the documented contract "≥10 verified
failures per 15 minutes per `(email, sha256(IP))` ⇒ `429 RATE_LIMITED`" holds
only while `api` is a single replica.

The exploration for this epic found that the limitation is **wider than
TD-005 says**: the same service is the failure budget for four authentication
paths, not one.

```text
apps/api/src/auth/auth.service.ts:50                          staff login
apps/api/src/auth/password-recovery.service.ts:96             staff password recovery
apps/api/src/portal/portal-auth.service.ts:107                portal login
apps/api/src/portal/portal-password-recovery.service.ts:102   portal password recovery
```

All four read `isBlocked`, record `recordFailure` and call `reset` on the same
interface. A shared-store revision therefore fixes all four at once, with no
per-path work — which is the argument for doing it at the service seam rather
than at each call site.

Redis is already an approved deployable, already in `docker-compose.yml`, already
a CI service container for the browser job, and `ioredis` is already a direct
dependency of `apps/api` (used by `fiscal-submission.producer.ts`,
`branding-reset-cleanup.producer.ts` and `RedisHealthService`). No new technology
and no new dependency enters the stack.

The one question the choice does not answer by itself is what a request should do
when Redis is unreachable.

## Question

Which window primitive, and does an unreachable Redis block logins or let them
through?

## Options

### Window primitive

**A. Atomic sliding window in one Lua script.** `ZREMRANGEBYSCORE` to prune,
`ZCARD` to read the count, and `ZADD` to record, evaluated server-side in a
single round trip. Exact same semantics as today's array of timestamps, with the
pruning and the count happening in one atomic step.

**B. Fixed window with `INCR` + `EXPIRE`.** Two or three round trips, trivially
atomic, but a client can make up to twice the threshold of attempts across a
window boundary (10 at the end of one window plus 10 at the start of the next).

**C. `INCR` with a sliding approximation** (two counters + a weighted read). More
arithmetic, and the contract stops matching the documented number exactly.

### Degradation mode

**D. Fail open to the in-process limiter.** If Redis errors, that request uses the
local in-process window it already trusts, and the fallback is logged. Brute-force
protection narrows to per-replica during the outage; authentication keeps working.

**E. Fail closed.** If Redis errors, every login attempt is rejected with
`RATE_LIMITED`. Protection is never weakened; availability is.

**F. Fail open with no local budget.** If Redis errors, stop limiting entirely.
Simplest, and the worst of both.

## Decision

**A and D.**

1. **One Lua script, one round trip.** The script takes the key, the current
   timestamp in milliseconds, the window length and the threshold, and returns
   the decision. Pruning, counting and recording happen atomically, so two
   replicas cannot both observe a count below the threshold and both admit.
2. **The interface does not change.** `isBlocked`, `recordFailure` and `reset`
   keep their signatures and their documented semantics — including "only
   verified failures are recorded", "a successful login resets the key" and
   "entries older than the window are pruned lazily". Call sites are untouched,
   which is what lets one change cover four paths.
3. **Fail open to the in-process window on a Redis error, and log it.** Two
   reasons, and the second is the decisive one:
   - Locking out every user of every tenant because a cache tier is down turns a
     degraded dependency into a total-availability incident, which is a strictly
     worse failure than a temporarily narrower brute-force budget.
   - The threat being defended against is credential brute force, and the
     credential layer's own constant-work pattern plus uniform `401`s bound what
     an attacker learns. The limiter is a cost multiplier, not the authentication
     decision.
   The fallback is the existing, tested in-process implementation, so the
   degradation is "the previous behaviour, per replica" rather than "no limit".
   Every fallback logs at `error` with the failure, so the condition is visible
   rather than silent.
4. **The bounded-memory properties carry over.** The Redis path bounds a key's
   history by timestamp pruning and sets a TTL on the key so an abandoned budget
   cannot live forever; the in-process path keeps its 100-failure and 10,000-key
   ceilings.
5. **The evidence is one global budget across two independent connections.** The
   test opens two `ioredis` clients to represent two replicas, drives failures
   through both, and asserts the threshold trips once for the pair — not once per
   client.

## Consequences

- [[TD-005]] can be closed with its evidence gate satisfied: a shared store
  behind the same interface, atomic check-and-record, and a cross-replica budget
  test.
- The service gains a Redis dependency in the request path of login. The
  fail-open rule is what keeps that dependency from being a new single point of
  failure. `RedisHealthService` already reports Redis in `/health/ready` as
  `degraded` when it is down, so the condition is visible to operators.
- The anti-spray keying question TD-005 raised — a per-account budget that does
  not depend on the egress IP — is **not** resolved here and stays recorded in
  TD-005's own text as a follow-up. A distributed spray across proxy pools still
  gets a fresh budget per IP, at any replica count.
- Unit tests that construct the service without Redis keep working against the
  in-process path, which is also the fallback, so the two implementations stay
  exercised together.

## Rejected: E, and why

Fail-closed reads as the conservative choice and is not one. Redis is used by
this repository as a queue transport and a cache tier, not as a source of truth;
a restart, a failover or a network partition would lock every staff member and
every portal holder out of every tenant at once. That is an availability
incident caused by a security control, and PRD §29 asks for rate limits rather
than for a hard dependency on a cache for authentication.

The residual risk is stated rather than hidden: during a Redis outage the
effective budget is per replica, which is precisely the state the product is in
today. The shared store is an improvement when it is up, not a new requirement
for login to work.
