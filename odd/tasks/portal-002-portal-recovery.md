# PORTAL-002 — Portal password recovery (feature tasks)

The gap [[PORTAL-001]] named as its largest: the API's recovery ([[DAT-007]])
authorises a `UserCredential` change and a portal identity holds a
`PortalCredential`, so a customer who forgot their password had no way back.

Everything the flow needs exists on one side or the other and nothing connects
them:

```text
exists          the staff recovery (a single-use hashed token, two public routes, the delivery
                aggregate, the token minted at send time)
                the portal identity (CustomerPortalAccess + PortalCredential, resolved by
                slug + contactEmail + ACTIVE)
                the portal's anonymous layout (PORTAL-001)
does not exist  a token belonging to a PORTAL access rather than a user profile
                a public route on the portal surface — a test today asserts login is the ONLY one
                a message whose recipient is a portal holder
                a page to ask for a reset, and one for the link to land on
```

## The design, derived rather than invented

**A token table of its own.** The staff table's `user_profile_id` foreign key
cannot hold a portal access id, so reuse is impossible without a polymorphic
owner — which would trade referential integrity for the appearance of it. And
[[DEC-008]]'s boundary applies one level down: a staff token must not be
redeemable for a portal password, nor the reverse. Two tables, each with its
subject.

**The recipient is the access's own `contactEmail`.** That is the login id, and
it is the only address whose holder is proven to be the account's owner. The
customer's primary contact may be a DIFFERENT address, and sending the link
there would let a holder of one address reset a session for another. Hence a
`PORTAL_HOLDER` recipient type whose reader resolves the access, rather than
reusing `CUSTOMER`.

**The tenant comes from the slug**, exactly as the portal login resolves it, and
every read is predicated on it.

**Everything else mirrors DAT-007**, because there is no reason to differ:
30-minute single-use hashed tokens with the same four database guards, a uniform
`202`, a rate limit namespaced per identity, the delivery through the aggregate,
and the token minted **at send time** so the plaintext never reaches a table.

## Work units

- [ ] **WU-A — the token's data foundation.** `portal_password_reset_token` and
      its guards, plus the two enum values the delivery needs (`PORTAL_ACCOUNT`,
      `PORTAL_HOLDER`). Schema cases and a live PostgreSQL run.
- [ ] **WU-B — the token service and the two routes.** Issue and consume, the
      uniform answer for the four cases, the rate limit, the reset's single
      transaction, and the route-contract test that currently says login is the
      only public portal route.
- [ ] **WU-C — the delivery.** The portal-holder recipient reader, a
      `PORTAL_ACCOUNT` branch in the content builder that mints the token and
      builds the link with the tenant's slug, and the scheduler reaction.
- [ ] **WU-D — the two pages.** `/[slug]/forgot-password` and
      `/[slug]/reset-password`, and the link on the login form whose comment
      currently explains its absence.
- [ ] **WU-E — the documentation and the closure.** `Portal.md`,
      `Notifications.md`, `Identity-Sessions.md`, and the Story's evidence.

## The one thing this Story must not do

**Widen the staff flow.** DAT-007 stands as it is; a shared token table or a
shared route would make the two identities' credentials interchangeable exactly
where the repository says they are not.
