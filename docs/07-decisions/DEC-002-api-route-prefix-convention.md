---
id: DEC-002
type: decision
title: API route prefix convention — unprefixed EPIC-01 routes, /api/v1 deferred
status: proposed
date: 2026-08-24
related_epics:
  - EPIC-01
related_stories:
  - DAT-002
  - DAT-003
prd_change_required: false
---

# DEC-002 — API route prefix convention: unprefixed EPIC-01 routes, `/api/v1` deferred

## Context

PRD §28 declares the API base path as `/api/v1`. The SDD change
`epic-01-database-auth-tenancy` was specified and implemented with UNPREFIXED
routes instead:

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
  (`openspec/changes/epic-01-database-auth-tenancy/design.md`, D3 wire order,
  which names `/health*` and `/auth/login` as `@Public` opt-outs);
- `GET /health/live`, `GET /health/ready`
  (`specs/api-contract-security-baseline/spec.md`, health-probes requirement);
- the identity delta spec (`specs/identity-staff-auth/spec.md`) pins login,
  logout, guard, and cookie behavior against those same shipped paths.

The deviation surfaced at apply time (Batch 3): design D3's wire order and both
delta specs consistently describe unprefixed paths, and the implemented suites
assert them, so shipping followed the deeper artifact (spec + design) over task
prose. This record makes that choice explicit and governs what happens next; the
PRD itself is NOT edited by this decision.

## Question

Which route-prefix convention does the API ship under for EPIC-01, and when does
the PRD §28 `/api/v1` base take effect?

## Options

### Option A — Ship unprefixed now; adopt `/api/v1` in the API-versioning slice

EPIC-01 ships `/auth/*` and `/health/*` as implemented. A global `/api/v1`
prefix (Fastify `setGlobalPrefix`/rewrite) is introduced once API versioning is
actually designed, in one coordinated slice that migrates all routes and
contract consumers together.

### Option B — Prefix EPIC-01 routes immediately (`/api/v1/auth/*`, `/api/v1/health/*`)

Rewrite controllers and every spec/scenario/test now to satisfy §28 literally,
even though no versioning mechanism exists yet.

### Option C — Keep both (alias `/api/v1/auth/*` → `/auth/*`)

Serve both surfaces indefinitely to ease consumer migration.

## Recommendation

Option A. Option B spends change budget on a mechanical rename whose real
content — versioning strategy, deprecation policy, contract publication — has
not been designed yet, and would churn specs/tests without product value. Option
C doubles the public surface and violates single-contract hygiene. Deferring
keeps one coherent migration moment instead of two half-steps; the route set
shipped so far is tiny, so the eventual move is cheap.

## Impact

### Product

None today. Approved scope is unchanged; this record defers §28 conformance
rather than redefining it. No PRD edit accompanies this decision.

### Architecture

None on security posture: guards, cookies (`Path=/` is prefix-independent),
error envelopes, and request-id correlation are path-independent. Wire-order
guarantees (D3) are unaffected.

### Database/API

Contract consumers MUST know that EPIC-01 endpoints live at `/auth/*` and
`/health/*`, not `/api/v1/auth/*`. Any external integration built against
EPIC-01 routes must be revisited when the versioning slice lands.

### Delivery

Adoption of `/api/v1` becomes an acceptance item of the future API-versioning
slice, which must include a route inventory sweep and test/spec migration in one
atomic change.

## Decision

_Pending._ Acceptance is a maintainer gate: this proposal requires explicit
maintainer approval before it is treated as binding. Until then, the recorded
state is exactly what shipped: unprefixed EPIC-01 routes per design D3 and both
delta specs, with §28 adoption consciously deferred.

## PRD Update

None required either way: §28 already specifies `/api/v1`; accepting this
decision only schedules WHEN conformance lands (versioning slice), it does not
alter approved scope.
