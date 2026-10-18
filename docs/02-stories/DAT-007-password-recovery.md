---
id: DAT-007
type: story
title: Staff password recovery
status: done
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

- [x] A `password_reset_token` row stores **only what a reset needs**: the
      profile, a **hash** of the token, its expiry and its consumption instant.
      No plaintext token, no email address, no IP.
- [x] The token is **single-use**: consuming it twice fails the second time, the
      consumption instant is never cleared or rewritten, and the guard refuses
      both.
- [x] The token is **short-lived**: an expired token is refused, and the refusal
      is indistinguishable from an unknown one.
- [x] `POST /auth/forgot-password` answers **byte-equivalently** for a known and
      an unknown address, and the same for a suspended profile or a profile with
      no credentials.
- [x] The endpoint is **rate-limited**, and the limit is per address-and-IP so
      that one attacker cannot lock a known address out of recovery.
- [x] The request creates a **delivery intent** through the Notifications
      aggregate; it sends nothing inline and makes no external call in the
      request path.
- [x] The reset **token is issued at send time**, so no plaintext token is ever
      persisted, and a token's TTL starts when it is delivered rather than when
      it was requested.
- [x] The token is **tenant-independent** and the reasoning is recorded: the
      credentials it authorises are global to the profile, not to a membership,
      so no tenant scopes it.
- [x] `POST /auth/password-reset` consumes the token, replaces the hash with
      argon2id parameters identical to the login path, and **invalidates every
      outstanding session** for that profile.
- [x] Both operations are **audited**, with the profile as the subject and no
      token value in the record.
- [x] No token, no hash and no plaintext credential appears in a log line, an
      event payload, a job payload or a response.
- [x] The fence is **inverted**: the suite proves both routes exist and behave,
      rather than proving they return `NOT_FOUND`.
- [x] Tenant isolation is enforced when applicable. Evidence: the token is
      profile-scoped and asserts no tenant, and the delivery it creates is
      tenant-scoped like every other.
- [x] Backend authorization is enforced when applicable. Evidence: both routes
      are `@Public` — a locked-out user cannot authenticate — and are therefore
      rate-limited and enumeration-resistant by construction.
- [x] Required loading/error/empty/success UX exists. Evidence: not applicable
      in this Story — no UI.
- [x] Required audit exists. Evidence: the audit cases for request and reset,
      with the profile as subject.
- [x] Tests required by the Story pass.

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

Five work units, each committed and gated on its own.

**WU-A - the token's data foundation.** `password_reset_token`, whose absence of
a tenant column is an invariant rather than an oversight (the credential is
global to the profile). Four guard families the migration owns: identity fixed
at insert, single use with the rewrite and the clear refused **separately**, and
`expires_at > created_at` as a CHECK. The same migration appends `STAFF_ACCOUNT`
and `STAFF` to the delivery aggregate's enums. Proven on a disposable PostgreSQL
16, not only parsed.

**WU-B - the token service.** `issue` stores the digest and returns the
plaintext once; `consume` marks with a **compare-and-set**, so two requests with
one link cannot both win; `spendAllForProfile` is what makes "after a reset no
other link works" true. One refusal for an unknown, a spent and an expired
token, and a non-string token is refused without a query.

**WU-C1 - the request.** A seeded **platform tenant** owns identity-scoped
messages, since the delivery's `tenant_id` is NOT NULL and a reset belongs to an
identity. The route answers `202` **byte-equivalently** for every address, is
rate-limited by address **and** IP, and **publishes an event** rather than
touching the delivery aggregate - so identity knows no queue, producer or
delivery table.

**WU-C2 - the reset.** One transaction: spend the token, replace the hash, end
**every** session, spend the other links, audit. The hash is computed **before**
it opens, because argon2 at the OWASP floor would otherwise hold locks for tens
of milliseconds. The fence is fully inverted.

**WU-D - the wiring.** The harness gained the delegates it was missing, and
seven end-to-end cases prove a request becomes a delivery under the platform
tenant and a real token changes a real credential. The worker's recipient reader
resolves a staff profile by id alone, and the content builder **mints the token
at send time** - the issuance model, made concrete.

## Verification

## Verification

```text
pnpm format-check                   clean
pnpm lint                           22/22 packages
pnpm typecheck                      22/22 packages
pnpm build                          13/13 packages
@newsaas/api test                   1313 passed
@newsaas/worker test                 236 passed
@newsaas/database test               525 passed
@newsaas/notifications test           84 passed
@newsaas/shared test                  16 passed
@newsaas/web test                   1101 passed
```

**Live PostgreSQL 16**, on a disposable cluster: all 46 migrations applied in
one pass - including the `ALTER TYPE ... ADD VALUE` inside Prisma's single
transaction, which is the real risk of the enum extension - and the guards
refused an expiry before its creation, a duplicate digest, a second consumption
instant, an un-consume, an extended expiry, a repointed digest and a reassigned
profile, while a fresh token consumed once, a deleted profile cascaded, and the
two new enum values were usable as literals in a later transaction with the
delivery aggregate's own guard still holding.

**The first live run passed VACUOUSLY** - an `UPDATE` matching no rows commits
happily - so the rerun asserts the row exists before every negative case.

**No review lineage**: this Story was implemented without an RDD review, by the
maintainer's choice to work the units directly. Each unit is committed
separately.

### The closure searches

Run rather than remembered, because each of them is a claim no single test
asserts:

```text
The event has exactly one publisher and one subscriber, in the SAME deployable
  publish    apps/api/src/auth/password-recovery.service.ts
  subscribe  apps/api/src/notifications/password-recovery.scheduler.ts
  -> both in `api`, which is what the in-process dispatcher requires; a subscriber
     in another deployable would silently never fire

No contact datum reaches a log or a job payload
  the only reads of an email are the recipient reader's select and its return; the
  job payload is the delivery id; no log line in either recovery path carries it

No token is logged anywhere
  the words console/logger appear in none of the token, request, reset or
  content-builder files

The token's plaintext never reaches a table
  the one write is `password_reset_token` with `tokenHash`, asserted in both the
  builder's suite and the end-to-end suite
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

- **The link points at `/reset-password`, a page the web app does not have
  yet**, so the flow ends in a 404 for the recipient until that Story lands -
  [[TD-048]]. The message is right; the destination is not built.
- **There is no password policy**, so a user-chosen password is bounded by
  length alone. Left undecided rather than invented, because inventing one is a
  product decision - and named in [[TD-048]] with the candidates.
- **A reset ends sessions for the WHOLE profile**, which is broader than the
  tenant the user had in mind. That is deliberate: sessions are per profile, the
  password is per profile, and a surviving session is the attacker's.
- **The live delivery run is still pending** ([[NOTIF-005]]): the reset email is
  proven against the deterministic fake, like every other message in EPIC-17.
- **No staff surface**: the flow is the contract, exercised by the API's suites.
- **A retried send mints a second token.** Bounded rather than harmful - the
  hour window caps how many messages can exist, and the moment the password
  changes every outstanding token is spent - but it is a fact worth knowing.

## Technical Debt

- [[TD-048]] - the page the link points at, and the password policy.

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

Every criterion is satisfied, the gates are green, and [[TD-004]] - the record
this Story exists to resolve - is `resolved` with this Story named as its
resolution.

**A correction this Story made in its own record**: [[TD-004]]'s proposed
resolution named `POST /api/v1/auth/reset-password`. This repository mounts no
`/api/v1`, and the fence it was resolving already probed `/auth/password-reset`.
The Story followed the repository.

**Two things worth carrying forward.** The first is that the delivery's tenancy
was a decision nobody had taken: the aggregate's `tenant_id` is NOT NULL, the
reset belongs to an identity, and the maintainer chose a seeded platform tenant.
The second is that the first live PostgreSQL run of the token's guards **passed
vacuously**, because an `UPDATE` that matches no rows commits - every negative
case now asserts its row exists first.

**What this Story deliberately did not build**, each named rather than implied:
the reset page the link points at, and a password policy. Both are [[TD-048]].
