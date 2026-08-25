---
id: TD-005
type: tech-debt
title:
  Login rate limiter is single-replica; shared-store revision before scaling
status: open
severity: medium
related_epics:
  - EPIC-01
related_stories:
  - DAT-003
created: 2026-08-24
updated: 2026-08-24
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

- [ ] One global budget proven across simulated concurrent replicas.
- [ ] Window/ceiling behavior preserved on the new backing store.
- [ ] Deployment invariant documented; single-replica limitation removed.
- [ ] This record closed with a link to the resolving commit.
