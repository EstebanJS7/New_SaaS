# PORTAL-001 — The portal sign-in surface (feature tasks)

The same finding [[SHELL-001]] made on the staff side, on the other identity:
the API has had `POST /portal/login` since [[EPIC-08]] — body
`{ tenantSlug, email, password }`, sets `ns_portal_session` — and the portal's
web surface (`/[slug]/…`) has no page that asks for one.

The portal BFF **deliberately refuses** `login` and `logout`, and the reason is
its session model rather than an oversight: every route it serves RELAYS an
established session, and login is the hop that ESTABLISHES one. It also forwards
ONLY the portal cookie, never the staff one, which is what [[DEC-008]] requires
— and that is the isolation a new hop on this proxy could break.

## Work units

- [ ] **WU-A — the BFF's establishing route.** `POST /api/portal/login`,
      relaying the API's `ns_portal_session` verbatim, with the staff cookie
      still never crossing and `logout` still refused.
- [ ] **WU-B — the page and the form.** `/[slug]/login`: the tenant comes from
      the PATH, the form asks only for an email and a password, the refusal is
      the API's own, and success lands on `/[slug]`.
- [ ] **WU-C — the portal shell's gate.** No portal session sends the visitor to
      `/[slug]/login`, and a STAFF-only session does too: the staff cookie must
      not satisfy the portal gate.
- [ ] **WU-D — the documentation and the closure.** `Portal.md` and
      `Identity-Sessions.md`, and the Story's evidence.

## Decisions taken before the first write

**The tenant comes from the path, never from a field.** `/[slug]/login` already
knows which tenant the visitor means, and asking would invite a typo that
produces "wrong tenant" as a failure — a distinction the API deliberately does
not make.

**The `logout` refusal stays.** The new route establishes a session; `logout`
revokes one. A proxy whose other routes are reads has one reason to carry a
session outbound and none to revoke one.

**No recovery, and that is the Story's largest named gap.** The API's recovery
authorises a `UserCredential` change and a portal identity holds a
`PortalCredential`; a customer who forgets their password has no way back.
Inventing a token model for a second credential type is its own Story, with its
own decisions about what the token authorises.
