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

- [x] **WU-A — the BFF's establishing route.** `POST /api/portal/login`, _Done:
      `POST /api/portal/login` is the ONE shape on this proxy where the session
      crosses OUTBOUND. It forwards NO cookie — not a stale portal one, not the
      staff one — and relays the API's `Set-Cookie` verbatim. `logout` stays
      refused, and `GET` on the login shape answers 405 rather than 404, because
      the path exists and the method does not. The staff cookie is still never
      read. 4 cases, replacing the one that asserted the old refusal._ relaying
      the API's `ns_portal_session` verbatim, with the staff cookie still never
      crossing and `logout` still refused.
- [x] **WU-B — the page and the form.** `/[slug]/login`: the tenant comes from
      _Done: `/[slug]/login` inside `(portal)/[slug]`, whose layout is
      deliberately ANONYMOUS — it resolves the public brand from the slug and
      reads no session, which is what lets a login page live here without a
      redirect loop. The tenant comes from the PATH and travels in the BODY (the
      API's contract); the form shows the API's own refusal and offers NO
      recovery link, because the API has nothing a portal identity could recover
      with. 5 cases._ the PATH, the form asks only for an email and a password,
      the refusal is the API's own, and success lands on `/[slug]`.
- [x] **WU-C — the portal shell's gate.** No portal session sends the visitor to
      _Done: a `(protected)` route group under `[slug]` whose server layout
      checks the session ONCE. A route group does not change a URL, so
      `/[slug]/pets` is still `/[slug]/pets` and what changed is that it has a
      parent that can refuse to render. It VERIFIES with `GET /portal/me`
      instead of trusting a cookie's presence, and only a 401 redirects. The
      staff gate could piggyback on a read the shell already made; this one
      could not, because the portal's layout is anonymous by design — copying
      the staff solution would have produced a redirect loop. 5 cases._
      `/[slug]/login`, and a STAFF-only session does too: the staff cookie must
      not satisfy the portal gate.
- [x] **WU-D — the documentation and the closure.** `Portal.md` and _Done:
      `Portal.md` gained the sign-in surface and the gate,
      `Identity-Sessions.md` gained the portal's half of the two-cookie
      isolation, and the Story records the largest gap it leaves — a customer
      who forgets their password has no way back, deliberately with NO recovery
      link rather than a link into a flow that cannot help them._
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

## The live run, and what it found

Performed against real services (PostgreSQL 16, Redis, the built API,
`next start`). Verified: `/portal/me` with a **staff** cookie answers 401 —
DEC-008's isolation, live.

**NOT verified, and the cause is outside this Story**: a schema-VALID body
through `POST /api/portal/login` answers **500** while the API answers 401.
Recorded as TD-049 with its reproduction and what the experiments ruled out —
the API receives it, relaying an error body works on the staff BFF, and it is
neither the size nor the values but the fact that the body VALIDATES. The
suspect is the streamed request body this proxy pipes (the staff BFF reads
`text()`), which is pre-existing and reachable from the booking and cancellation
POSTs too — hence its being `high`.
