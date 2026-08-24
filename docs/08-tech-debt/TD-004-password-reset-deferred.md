---
id: TD-004
type: tech-debt
title: Defer password reset until email delivery exists
status: open
severity: medium
related_epics:
  - EPIC-01
  - EPIC-17
related_stories:
  - DAT-003
created: 2026-08-24
updated: 2026-08-24
---

# TD-004 — Password reset deferred until email delivery exists

## Context

EPIC-01 ships staff accounts (`UserProfile`/`UserCredentials`) and first-party
email+password login without any forgot-password or password-reset flow. The
maintainer resolution of the proposal question round (2026-08-24, authoritative)
deferred account recovery because a credible reset flow requires transactional
email delivery, which only arrives with EPIC-17 (Notifications). The deferral
was made explicit at apply time — this record — instead of being left silent,
and the `identity-staff-auth` capability requirement "password recovery
explicitly deferred" is satisfied by it.

Until resolved, recovery from a lost password is an ops workaround: an operator
with database access replaces the stored argon2id hash directly and revokes
existing sessions for that profile.

## Debt

Staff accounts have no self-service recovery path. Any credential lockout
depends on manual operator intervention, and the workaround bypasses every
application-level guarantee (auditing, rate limiting, session policy) by writing
to the database out of band.

## Why It Is Safe to Defer

No production tenants or real staff accounts exist; accounts are ops-created.
The current spec actively requires recovery endpoints to be absent — scenario
"Recovery endpoints absent" (tasks 4.3) proves any recovery route returns a
`404` envelope — so the deferral matches approved acceptance criteria rather
than violating them. Security invariants are unaffected: argon2id hashing, login
rate limits, and server-side session revocation ship with EPIC-01.

## Risk

Every forgotten password becomes an ops ticket with direct database access,
which does not scale and is error-prone (wrong profile, missed session
revocation). If portal/customer-facing auth work begins before email delivery,
the gap surfaces to end users instead of staying an internal ops concern.
Likelihood medium over the epic chain, impact moderate (operational burden; no
data exposure beyond existing DB-access trust).

## Evidence Gate

Resolution requires:

- implemented forgot-password and reset flows backed by single-use, expiring,
  hashed reset tokens issued through EPIC-17 email delivery;
- automated tests covering request → token → reset → re-login, old-password
  rejection after reset, session invalidation on reset, and rate limiting of
  reset requests;
- removal (or inversion) of the "recovery endpoints absent" fence test so the
  suite proves the routes exist and behave, not that they are missing.

## Proposed Resolution

1. Land EPIC-17 transactional email delivery and its provider boundary.
2. Add reset-token issuance/consumption to the identity core (hashed at rest,
   single-use, short TTL), reusing the session-service hashing conventions.
3. Expose `POST /api/v1/auth/forgot-password` and
   `POST /api/v1/auth/reset-password` with uniform no-enumeration responses.
4. Invalidate outstanding sessions on successful reset; audit both operations.
5. Update the isolation/fence tests per the evidence gate and close this record
   with a link to the resolving commit.

## Trigger / Target

Re-entry as soon as portal/customer-facing authentication work begins, or when
EPIC-17 email delivery ships — whichever comes first. Must be resolved before
any production onboarding of real staff accounts.

## Verification After Resolution

- [ ] Forgot/reset flows pass the evidence-gate test matrix.
- [ ] No plaintext tokens or credentials logged; audit records exist for both
      operations.
- [ ] Fence test updated; recovery endpoints proven present and safe.
- [ ] This record closed with a link to the resolving commit.
