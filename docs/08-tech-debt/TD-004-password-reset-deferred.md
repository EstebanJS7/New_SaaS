---
id: TD-004
type: tech-debt
title: Defer password reset until email delivery exists
status: resolved
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

## RESOLVED — 2026-10-17 by DAT-007

**This record is resolved.** The recovery flow exists:
`POST /auth/forgot-password` and `POST /auth/password-reset`, a single-use token
hashed at rest with a real database guard around it, the reset changing the hash
and ending **every** session for the profile in one transaction, a uniform
answer for every address, a rate limit keyed by address and IP, and the fence in
`auth.integration.test.ts` **inverted** so the suite proves the routes exist
instead of proving they are absent.

The evidence gate this record set, against what landed:

```text
The gate required                                    What DAT-007 delivered
---------------------------------------------------- ------------------------------------
forgot-password and reset flows backed by            both routes; single-use, expiring,
single-use, expiring, hashed reset tokens            SHA-256-at-rest tokens with four
issued through EPIC-17 email delivery                SQL guards, delivered through the
                                                     notification aggregate
request → token → reset → re-login                   the end-to-end suite, plus the reset
old-password rejection after reset                   changing the stored hash
session invalidation on reset                        EVERY session deleted in the same
                                                     transaction
rate limiting of reset requests                      address+IP budget, namespaced from
                                                     login's
the fence test inverted                              done: it asserts behavior now
```

**Two things this record's own draft got wrong**, corrected by the Story that
resolved it: it proposed `/api/v1/auth/reset-password`, and this repository
mounts no `/api/v1` and already probed `password-reset`; and it assumed the
whole flow was one Story when the delivery's tenancy
(`notification_delivery.tenant_id` is NOT NULL, and a reset belongs to an
identity rather than a tenant) was a decision nobody had taken. Both are in
[[DAT-007]]'s record.

**What is still open, and it is not this record's**: the delivered link points
at a page the web app does not have, and the repository still has no password
policy. Both are [[TD-048]], named rather than left implicit.

## Status update — 2026-10-17 (EPIC-17 closed)

**Step 1 of the resolution has landed, and the item stays `open`.**
Transactional email delivery now exists: the channel boundary with a real SMTP
adapter ([[ADR-011]]), a fail-closed selection that refuses to start production
without a configured channel, and a delivery aggregate whose lifecycle, dedupe
and read surface are implemented and tested ([[NOTIF-002]], [[NOTIF-004]],
`docs/05-modules/Notifications.md`).

**What that changes**: this record's blocker is gone. It is no longer "waiting
on a capability that does not exist"; it is waiting on its own Story. The
remaining steps 2 through 5 are a feature — reset-token issuance, two routes
with uniform no-enumeration responses, session invalidation, audit and the fence
test's inversion — and none of them is a closure chore for another epic to
absorb.

**What it does not change**: the item is `open`, the ops workaround stands, and
the "recovery endpoints absent" fence still passes, which is still the correct
state while no reset flow exists. The owner decision (recorded in [[EPIC-17]]'s
triage) is to carry it forward as the next candidate Story rather than to fold
it into the closure.

**One thing this epic does NOT unblock**: sending a reset email through the
delivery aggregate needs a **new source type** —
`notification_delivery.source_type` admits `APPOINTMENT` and `FISCAL_DOCUMENT` —
and a recipient reader for a staff profile. That is part of the Story, not a
prerequisite, and it is named here so the next unit does not discover it late.

## Proposed Resolution

1. ~~Land EPIC-17 transactional email delivery and its provider boundary.~~
   **Done.**
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
