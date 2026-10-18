---
id: PORTAL-002
type: story
title: Portal password recovery
status: in-progress
epic: EPIC-08
priority: high
depends_on:
  - PORTAL-001
  - DAT-007
created: 2026-10-18
updated: 2026-10-18
---

# PORTAL-002 — Portal password recovery

## Objective

Give a customer a way back into the portal when they forget their password.
[[PORTAL-001]] named this as the largest gap it left: the API's recovery
authorises a `UserCredential` change, a portal identity holds a
`PortalCredential`, and there is no flow for the second.

## Context

Everything the flow needs exists on one side or the other, and nothing connects
them:

```text
What exists
  the staff recovery (DAT-007)   a single-use hashed token, two public routes, the delivery
                                 aggregate carrying the message, the token minted at send time
  the portal identity            CustomerPortalAccess (tenant + contactEmail + status) and its
                                 PortalCredential, resolved by (slug, contactEmail, ACTIVE)
  the portal's public shell      /[slug]/… under an ANONYMOUS layout (PORTAL-001)

What does not
  a token that belongs to a PORTAL access rather than a user profile
  a route that is public on the portal surface — a test today asserts login is the ONLY one
  a message whose recipient is a portal holder rather than a customer contact
  a page to ask for a reset, and a page for the link to land on
```

**The identity boundary is the whole design.** [[DEC-008]] requires that a
portal session and a staff session never authorise each other, and its recovery
tokens are the same question one level down: a staff recovery token is keyed to
`user_profile` and MUST NOT be redeemable for a portal password, and vice versa.
That is why this Story adds a token of its own rather than widening the staff
one — the staff table's `user_profile_id` foreign key cannot even hold a portal
access id, and a polymorphic owner would trade referential integrity for the
appearance of reuse.

## In Scope

- A `portal_password_reset_token` aggregate: hashed at rest, single-use,
  short-lived, with the same guards the staff token has.
- `POST /portal/forgot-password` and `POST /portal/password-reset`, both
  `@Public`, both taking the tenant slug because the portal surface is
  tenant-scoped.
- The delivery: a `PORTAL_ACCOUNT` source, a `PORTAL_HOLDER` recipient whose
  reader resolves the access's own `contactEmail`, and the message with the
  token minted at send time.
- `/[slug]/forgot-password` and `/[slug]/reset-password` inside the anonymous
  portal layout, and the link on the login form that PORTAL-001 deliberately
  omitted.
- The fence: the route-contract test asserts login is the only public portal
  route, and it is **updated** to name all three.

## Out of Scope

- **Changing the staff recovery.** DAT-007 stands; this is its sibling, not its
  successor.
- **Any shared token table.** See the identity boundary above.
- **Changing the login or the session model.**
- **Self-service portal registration or email change.**
- **A `?next=` return path**, for the same reason as PORTAL-001.

## Acceptance Criteria

- [ ] The token table stores **only what a reset needs** — the portal access, a
      **hash**, an expiry and a consumption instant — and no plaintext token, no
      email address and no requester address.
- [ ] It is **single-use** and **short-lived**: a second consumption and an
      expired one are refused, the consumption instant can neither be rewritten
      nor cleared, and the expiry is after creation.
- [ ] The token is keyed to the **portal access**, never to a `user_profile`: a
      staff token cannot be redeemed here and a portal token cannot be redeemed
      there, asserted in both directions.
- [ ] `POST /portal/forgot-password` answers **byte-equivalently** for a holder
      that exists, one that does not, an ambiguous login identity and a holder
      with no credential.
- [ ] It is rate-limited per address and client IP, and namespaced away from
      both the staff recovery and the portal login budgets.
- [ ] It creates a delivery intent through the Notifications aggregate; it sends
      nothing inline.
- [ ] The token is minted **at send time**, so no plaintext token is ever
      persisted.
- [ ] The recipient is resolved as the **access's own `contactEmail`**, which is
      the login id — not the customer's primary contact, which may be a
      different address and would let a holder of one address reset a session
      for another.
- [ ] `POST /portal/password-reset` consumes the token, replaces the hash with
      the **same argon2id parameters** as the login path, ends **every**
      outstanding portal session for that access, and audits — in one
      transaction, with the hash computed before it opens.
- [ ] Both operations are audited with the access as the subject and **no token
      value** in the record.
- [ ] No token, hash or plaintext password appears in a log, an event payload, a
      job payload or a response.
- [ ] The route-contract probe's **"login is the only public portal route"**
      test is updated to the three routes, and the pin states why each is
      public.
- [ ] `/[slug]/forgot-password` and `/[slug]/reset-password` are public, inside
      the anonymous layout, and the login form links to the first.
- [ ] The reset page's refusals are the API's own: one message for an unknown,
      spent or expired token, so the UI is not a louder oracle than the API it
      fronts.
- [ ] Tenant isolation is enforced when applicable. Evidence: every read is
      predicated on the tenant resolved from the slug, and a token from another
      tenant is refused.
- [ ] Backend authorization is enforced when applicable. Evidence: both routes
      are `@Public` by necessity, rate-limited and enumeration-resistant by
      construction.
- [ ] Required audit exists. Evidence: the two audit cases, with the access as
      subject.
- [ ] Tests required by the Story pass.

## Domain Invariants

- A portal reset token authorises **one** password change for **one** portal
  access, once.
- Requesting a reset never reveals whether a holder exists, nor that a login
  identity is ambiguous.
- **The two identities never cross**: a portal token is not a staff token, and
  neither table can hold the other's subject.
- The reset ends sessions: a password change invalidates every live portal
  session for that access.
- The message goes to the address the holder LOGS IN with, which is the only
  address whose holder is proven to be the account's owner.

## API

### Added

```text
POST /portal/forgot-password   (@Public, rate-limited, uniform 202)
POST /portal/password-reset    (@Public, single-use token)
```

Both take `tenantSlug`: the portal surface is `/[slug]/…`, and the API's login
already resolves the tenant that way.

### Changed

```text
apps/api/src/rbac/route-contract.probe.test.ts   the "only public portal route" test
apps/web/src/app/api/portal/[[...path]]/route.ts the two public shapes
apps/web/src/app/(portal)/[slug]/login/…         the recovery link
```

## Database

### Migration

```text
One additive migration:
  - create table portal_password_reset_token with its guards;
  - add PORTAL_ACCOUNT to notification_source_type and PORTAL_HOLDER to
    notification_recipient_type.
```

## UI

- `/[slug]/forgot-password`: the request form, in the portal's resolved brand.
- `/[slug]/reset-password`: where the link lands — the page PORTAL-001's message
  pointed at and did not exist for the portal.
- The login form gains the link, and its comment explaining its absence goes
  with it.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- The token's lifecycle and its guards, against live PostgreSQL.
- The uniform answer for four cases: a holder, no holder, an ambiguous identity
  and no credential.
- The identity boundary in both directions.
- The delivery: the intent, the recipient resolved to the login address, the
  send-time token.
- The reset: hash replaced, every session ended, audited, in one transaction.
- The route-contract pin and the two pages.

## Known Limitations

- **The portal's recovery is email-only**, like the staff one, and for the same
  reason.
- **No `?next=` return path**, deliberately.
- **The live run will be pending** unless credentials and a seeded holder exist
  at closure.

## Technical Debt

- None yet; anything raised here is recorded and triaged.

## Decisions / ADRs

- No new ADR: a table, two routes, two enum values and two pages, with no new
  dependency.
- [[DEC-008]] — the identity boundary this Story extends to the tokens.
- [[DAT-007]] — the flow this mirrors.

## Files / Modules

- `packages/database/prisma/schema.prisma` and one migration.
- `apps/api/src/portal/` — the token service, the two routes and their wiring.
- `apps/worker/src/notification-delivery/` — the portal holder reader and the
  message.
- `apps/web/src/app/(portal)/[slug]/{forgot-password,reset-password}/`.
- `docs/05-modules/Portal.md` and `docs/05-modules/Notifications.md`.

## Completion Notes

_Status must remain non-done until all required gates pass._
