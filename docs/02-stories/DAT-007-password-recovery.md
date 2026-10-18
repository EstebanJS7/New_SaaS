---
id: DAT-007
type: story
title: Staff password recovery
status: in-progress
epic: EPIC-01
priority: high
depends_on:
  - DAT-003
  - NOTIF-002
created: 2026-10-17
updated: 2026-10-17
---

# DAT-007 — Staff password recovery

## Objective

Give a staff member a way back into their account without an operator touching
the database. The Story resolves [[TD-004]], which deferred recovery because a
credible reset flow requires transactional email delivery — and that now exists.

## Context

[[DAT-003]] shipped staff identity with argon2id credentials and server-side
sessions, and deliberately shipped **no** recovery path:
`apps/api/src/auth/auth.integration.test.ts` asserts that
`POST /auth/forgot-password` and `POST /auth/password-reset` return `NOT_FOUND`,
so the deferral is an enforced contract rather than an omission. The reason was
that a reset flow without a delivery mechanism is worse than none — it either
leaks whether an account exists or strands the user at "check your email".

[[EPIC-17]] closed on 2026-10-17 and delivered that mechanism: a delivery
aggregate with a lifecycle, a fail-closed channel boundary with a real SMTP
adapter, dedupe, retries, and a read surface that shows what happened.
[[TD-004]] therefore moves from _blocked_ to _unblocked in principle_, and the
maintainer reopened [[EPIC-01]] to carry it.

**Two decisions were taken before this Story was written** (maintainer,
2026-10-17):

1. The Story lives in **EPIC-01**, not a new epic, because recovery is identity
   and the fence, the credential service and the session service are all there.
2. **The email goes through the Notifications aggregate**, not directly through
   the channel port. EPIC-17 built the aggregate to be the single send path —
   dedupe, lifecycle, retries, and a delivery that is visible in the read
   surface — and a second path would make it optional. A reset that fails to
   send must not be silent.

## In Scope

- A `password_reset_token` aggregate: hashed at rest, single-use, short-lived,
  with its own SQL guards.
- `POST /auth/forgot-password` — a uniform response for a known and an unknown
  address, rate-limited, which creates a delivery **intent** rather than sending
  inline.
- `POST /auth/password-reset` — consumes a token, replaces the argon2id hash,
  invalidates every outstanding session for that profile, and audits.
- The token is issued **at send time**, not at request time (see the decision
  below).
- The Notifications wiring: a `STAFF_ACCOUNT` source type, a `STAFF` recipient
  type, a staff recipient reader, and the message the reset email carries.
- The fence inversion: the suite proves the routes exist and behave instead of
  proving they are absent.
- A uniform no-enumeration response on both routes.

## Out of Scope

- **Portal/customer recovery.** `PortalCredential` is a separate identity with
  its own lifecycle; it is not this Story.
- **Changing the login path, the hashing parameters, or the session model.**
- **A reset audit of the whole membership.** The audited subject is the profile.
- **Self-service email change or account deletion.**
- **Sending through a second path.** [[DEC-061]]'s channel boundary is the only
  adapters, and the delivery aggregate is the only sender.
- **A UI.** The staff surface for recovery is a later Story; this one is the
  contract.

## Acceptance Criteria

- [ ] A `password_reset_token` row stores **only what a reset needs**: the
      profile, a **hash** of the token, its expiry and its consumption instant.
      No plaintext token, no email address, no IP.
- [ ] The token is **single-use**: consuming it twice fails the second time, the
      consumption instant is never cleared or rewritten, and the guard refuses
      both.
- [ ] The token is **short-lived**: an expired token is refused, and the refusal
      is indistinguishable from an unknown one.
- [ ] `POST /auth/forgot-password` answers **byte-equivalently** for a known and
      an unknown address, and the same for a suspended profile or a profile with
      no credentials.
- [ ] The endpoint is **rate-limited**, and the limit is per address-and-IP so
      that one attacker cannot lock a known address out of recovery.
- [ ] The request creates a **delivery intent** through the Notifications
      aggregate; it sends nothing inline and makes no external call in the
      request path.
- [ ] The reset **token is issued at send time**, so no plaintext token is ever
      persisted, and a token's TTL starts when it is delivered rather than when
      it was requested.
- [ ] The token is **tenant-independent** and the reasoning is recorded: the
      credentials it authorises are global to the profile, not to a membership,
      so no tenant scopes it.
- [ ] `POST /auth/password-reset` consumes the token, replaces the hash with
      argon2id parameters identical to the login path, and **invalidates every
      outstanding session** for that profile.
- [ ] Both operations are **audited**, with the profile as the subject and no
      token value in the record.
- [ ] No token, no hash and no plaintext credential appears in a log line, an
      event payload, a job payload or a response.
- [ ] The fence is **inverted**: the suite proves both routes exist and behave,
      rather than proving they return `NOT_FOUND`.
- [ ] Tenant isolation is enforced when applicable. Evidence: the token is
      profile-scoped and asserts no tenant, and the delivery it creates is
      tenant-scoped like every other.
- [ ] Backend authorization is enforced when applicable. Evidence: both routes
      are `@Public` — a locked-out user cannot authenticate — and are therefore
      rate-limited and enumeration-resistant by construction.
- [ ] Required loading/error/empty/success UX exists. Evidence: not applicable
      in this Story — no UI.
- [ ] Required audit exists. Evidence: the audit cases for request and reset,
      with the profile as subject.
- [ ] Tests required by the Story pass.

## Domain Invariants

- A reset token authorises **one** password change for **one** profile, once.
- Requesting a reset never reveals whether an account exists.
- A password change invalidates sessions: a reset must not leave the attacker's
  or the previous holder's session alive.
- The plaintext token exists only in memory, between generation and the message
  payload, and never in a table, a log or a response.
- Recovery is public by necessity and is therefore the most carefully bounded
  public surface in the system.

## API

### Added

```text
POST /auth/forgot-password     (public, rate-limited, uniform response)
POST /auth/password-reset      (public, single-use token)
```

Both are unprefixed: this repository does not mount `/api/v1` ([[DEC-002]]
defers it), and the names are the ones the existing fence already probes —
`forgot-password` and `password-reset`, **not** `reset-password` as [[TD-004]]'s
draft proposed.

### Changed

```text
apps/api/src/auth/auth.integration.test.ts   the fence is inverted
```

## Database

### Migration

```text
One additive migration:
  - create table password_reset_token with its guards;
  - add STAFF_ACCOUNT to notification_source_type and STAFF to
    notification_recipient_type (EPIC-17's aggregate, extended by two values).
```

Additive: no existing row is altered, and both enum extensions append.

### Models/Tables

- `PasswordResetToken` — the profile, the token hash, `expires_at`,
  `consumed_at`, `created_at`. No tenant column, and the reason is an invariant
  rather than an oversight.
- `NotificationSourceType` gains `STAFF_ACCOUNT`; `NotificationRecipientType`
  gains `STAFF`. Both are additive enum values on EPIC-17's table.

## UI

None. This Story is the contract; a staff recovery surface is a later Story, and
the reset link is a URL the mail carries.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- The token's lifecycle: single-use, expiry, and the refusal of a second
  consumption.
- The guard: the consumption instant cannot be cleared or rewritten.
- The uniform response: a known and an unknown address are byte-equivalent, and
  so are a suspended profile and one without credentials.
- Rate limiting, per address and per IP.
- The request creates an intent and makes no external call.
- The token is issued at send time: no plaintext token ever reaches a table.
- The reset: hash replaced, **every** session invalidated, both audited.
- The fence inversion.

## Known Limitations

- **A reset does not invalidate sessions held by another tenant's membership** —
  sessions are per profile, so it invalidates all of them; the note is that this
  is broader than the tenant the user was thinking about, and that is
  deliberate.
- **No staff surface**, so the flow is exercised by the API and its suites.
- **The live delivery run is still pending** ([[NOTIF-005]]): the reset email is
  proven against the deterministic fake, like every other message in EPIC-17.

## Technical Debt

- None yet; anything raised here is recorded and triaged.

## Decisions / ADRs

- No new ADR: this Story adds a table, two routes and two enum values, and it
  introduces no dependency, runtime or abstraction.
- [[DEC-061]] — the channel boundary it sends through, unchanged.
- [[TD-004]] — the record this Story resolves.

## Files / Modules

- `packages/database/prisma/schema.prisma` and one migration — the token and the
  two enum values.
- `apps/api/src/auth/` — the token service, the two routes and their wiring.
- `apps/worker/src/notification-delivery/` — the staff recipient reader and the
  message.
- `docs/05-modules/Identity-Sessions.md` and `docs/05-modules/Notifications.md`.

## Completion Notes

_Status must remain non-done until all required gates pass._
