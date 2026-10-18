---
id: PORTAL-002
type: story
title: Portal password recovery
status: done
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

- [x] The token table stores **only what a reset needs** — the portal access, a
      **hash**, an expiry and a consumption instant — and no plaintext token, no
      email address and no requester address.
- [x] It is **single-use** and **short-lived**: a second consumption and an
      expired one are refused, the consumption instant can neither be rewritten
      nor cleared, and the expiry is after creation.
- [x] The token is keyed to the **portal access**, never to a `user_profile`: a
      staff token cannot be redeemed here and a portal token cannot be redeemed
      there, asserted in both directions.
- [x] `POST /portal/forgot-password` answers **byte-equivalently** for a holder
      that exists, one that does not, an ambiguous login identity and a holder
      with no credential.
- [x] It is rate-limited per address and client IP, and namespaced away from
      both the staff recovery and the portal login budgets.
- [x] It creates a delivery intent through the Notifications aggregate; it sends
      nothing inline.
- [x] The token is minted **at send time**, so no plaintext token is ever
      persisted.
- [x] The recipient is resolved as the **access's own `contactEmail`**, which is
      the login id — not the customer's primary contact, which may be a
      different address and would let a holder of one address reset a session
      for another.
- [x] `POST /portal/password-reset` consumes the token, replaces the hash with
      the **same argon2id parameters** as the login path, ends **every**
      outstanding portal session for that access, and audits — in one
      transaction, with the hash computed before it opens.
- [x] Both operations are audited with the access as the subject and **no token
      value** in the record.
- [x] No token, hash or plaintext password appears in a log, an event payload, a
      job payload or a response.
- [x] The route-contract probe's **"login is the only public portal route"**
      test is updated to the three routes, and the pin states why each is
      public.
- [x] `/[slug]/forgot-password` and `/[slug]/reset-password` are public, inside
      the anonymous layout, and the login form links to the first.
- [x] The reset page's refusals are the API's own: one message for an unknown,
      spent or expired token, so the UI is not a louder oracle than the API it
      fronts.
- [x] Tenant isolation is enforced when applicable. Evidence: every read is
      predicated on the tenant resolved from the slug, and a token from another
      tenant is refused.
- [x] Backend authorization is enforced when applicable. Evidence: both routes
      are `@Public` by necessity, rate-limited and enumeration-resistant by
      construction.
- [x] Required audit exists. Evidence: the two audit cases, with the access as
      subject.
- [x] Tests required by the Story pass.

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

Five units, each committed and gated on its own, and the flow was then
**verified live end to end**.

**WU-A — the token's data foundation.** `portal_password_reset_token` with the
staff token's four guards, keyed to a portal ACCESS and never to a user profile
— the schema case asserts the absence of `user_profile_id`, because that column
is how [[DEC-008]]'s boundary would be lost. No tenant column, deliberately: the
access carries the tenant and the read asserts they agree. Proven on a
disposable PostgreSQL 16, where the guards refused an expiry before its
creation, a duplicate digest, a rewritten consumption instant, an un-consume, an
extended expiry, a repointed digest and a reassigned access.

**WU-B — the token service and the two routes.** The CAS, the uniform refusal,
the request publishing an event, the reset in ONE transaction with the hash
computed before it opens. And the **fence inverted**: a test asserted login was
the ONLY public portal route, which was the deferral's contract rather than a
property; it now names the three and states the invariant worth keeping.

**WU-C — the delivery.** The policy (the hour window, a key per ACCESS so two
accesses cannot suppress each other, and the URL with the tenant's slug), the
reader's `PORTAL_HOLDER` branch, the builder's `PORTAL_ACCOUNT` branch that
mints the token at send time, and a scheduler that needs no read of its own.

**WU-D — the two pages.** Both inside the anonymous portal layout, the token
read server-side, and the login form's link restored — its case had asserted the
link's ABSENCE, because there was no flow to point at.

**WU-E — this record.**

## Verification

## Verification

```text
pnpm format-check                   clean
pnpm lint                           22/22 packages
pnpm typecheck                      22/22 packages
pnpm build                          13/13 packages
@newsaas/api test                   1349 passed
@newsaas/worker test                 245 passed
@newsaas/web test                   1156 passed
@newsaas/database test               543 passed
@newsaas/notifications test           84 passed
```

### The live run: the whole loop, with a real SMTP conversation

Against PostgreSQL 16, Redis, the built API, the built **worker with the real
SMTP adapter** pointing at a local sink, and `next start`:

```text
POST /api/portal/forgot-password (holder)     202, and an unknown address byte-identical
the delivery                                  PORTAL_ACCOUNT | PORTAL_HOLDER | SENT, under the CLINIC's tenant
the token row                                 minted at send time, a 64-character digest
the email, read from the sink                 to the ACCESS's contactEmail, Spanish subject,
                                              a link with a 43-character token
POST /api/portal/password-reset (that token)  200
  every portal session for the access         1 -> 0
  the password                                the OLD one answers 401, the NEW one 200
  the audit                                   portal.password_reset_requested + _completed
  the same token again                        401, the uniform refusal
a second request inside the hour              202, and NO second email: the window deduped
```

**The message was read out of a real SMTP conversation** rather than a fake's
memory: the sink received the quoted-printable body, and decoding it is what
produced the token the reset then consumed. Nothing in that list is inferred
from a stub.

**Not verified**: the WhatsApp channel, which no recovery message uses (the
channel is fixed to EMAIL), and a browser driving the two pages (the suites
cover their states).

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

- **The recovery message is email-only**, like the staff one: the channel is
  fixed because a link is inherently an email-shaped thing and a WhatsApp
  variant would need a template and a decision nobody has taken.
- **The two token services duplicate the compare-and-set and the uniform
  refusal.** The primitives they share — entropy, digest, lifetime — live in
  `@newsaas/shared`, so those cannot drift; the CAS is duplicated because the
  two are bound to different tables and the repository prefers explicit code to
  a generic base. Named rather than hidden: a future fix to the CAS has to land
  in both.
- **`STAFF_APP_BASE_URL` is reused for the portal's link**, because one web app
  serves both surfaces. The deployment input's name is a misnomer, and renaming
  it would break every existing deployment for a word.
- **No `?next=` return path**, deliberately.
- **A browser driving the two pages is not recorded**; the suites cover their
  states, and the live run drove the API through the BFF.

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

Every criterion is satisfied, the gates are green, and **the flow was verified
live end to end** — including the one thing no suite could have proven: that the
email a real SMTP server received carried the token that a reset then consumed,
and that the old password stopped working while the new one started.

**Two things this Story's work surfaced, both worth more than the code.** The
audit boundary REFUSED `actorType: "PORTAL"` for an anonymous request — _"PORTAL
attribution requires a portal access id"_ — and it was right: the requester is
nobody authenticated, so the record attributes to the ACCESS as the subject,
exactly as the staff flow attributes its request to the profile. And the
in-memory harness needed three delegates it did not have; it is the fifth time
this session that the harness was the gap, which is worth planning for whenever
a table is added.

**The epic's third test that encoded a gap** was found here too: the login
form's case asserted the recovery link's ABSENCE. A test that says something
does not exist has to be found and rewritten the day it exists, or someone will
delete the assertion instead of understanding it.
