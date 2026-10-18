---
id: PORTAL-001
type: story
title: The portal sign-in surface
status: done
epic: EPIC-08
priority: high
depends_on:
  - SHELL-001
created: 2026-10-18
updated: 2026-10-18
---

# PORTAL-001 — The portal sign-in surface

## Objective

Give a customer a way to sign in to the portal from a browser. [[SHELL-001]]
closed this hole for STAFF and found it; this Story closes it for the other
identity, which is the one a customer actually uses.

## Context

The API is complete and has been since [[EPIC-08]]:

```text
POST /portal/login    @Public, body { tenantSlug, email, password }, sets `ns_portal_session`
POST /portal/logout   guarded by the portal's own chain
GET  /portal/me       the isolated identity probe
```

The portal's **web surface** is `/[slug]/…` — pets, appointments, profile — and
it has **no login page**, exactly as the staff app did not. Its BFF is the
reason to read before changing: it forwards **only** the portal cookie and never
the staff one, so "a staff session cannot reach the portal", and it
**deliberately refuses** `login` and `logout`. That refusal is not an oversight
— it is the proxy's session model: every route it serves RELAYS an established
session, and `login` is the hop that ESTABLISHES one. [[SHELL-001]] hit the same
distinction on the staff side and answered it with a BFF that relays a
`Set-Cookie`.

Two things make this Story different from its staff twin, and both matter:

- **The tenant is in the path.** `/[slug]/login` already knows which tenant the
  visitor means, and the API's body takes `tenantSlug` — so the form never asks
  for it. That also means the login page is the portal surface's first path
  segment that is NOT a customer-facing page, and it must not be mistaken for
  one by the middleware or by the portal's own routing.
- **There is no recovery path.** The API's recovery ([[DAT-007]]) is staff-only:
  it authorises a `UserCredential` change, and a portal identity holds a
  `PortalCredential`. A customer who forgets their password therefore has **no
  way back**, and this Story does not invent one. Naming it is the point; it is
  a separate Story with its own decisions.

## In Scope

- `GET /[slug]/login` — a public page, rendering the tenant's resolved brand.
- `POST /api/portal/login` — the portal BFF gains the one
  **session-establishing** route, relaying the API's `ns_portal_session` cookie
  to the browser.
- The form: email and password, the API's own failure states, and the tenant it
  is signing in to.
- The portal shell's gate: a visitor with no portal session is sent to
  `/[slug]/login`.

## Out of Scope

- **Portal password recovery.** The API has none for portal identities;
  inventing a flow would mean a token model for a second credential type. Named
  as a gap, and its own Story.
- **Portal registration or invitations.** There is no self-service portal
  sign-up in the API.
- **The staff surface.** Closed by [[SHELL-001]], and the two must not share a
  cookie or a controller: [[DEC-008]] requires that neither cookie authorize the
  other domain.
- **A `?next=` return path**, for the same reason as its staff twin.

## Acceptance Criteria

- [x] `/[slug]/login` is public and renders the **tenant's resolved brand**, so
      a customer sees the clinic they are signing in to rather than the
      platform's default identity.
- [x] The page takes the tenant from the **path**, never from a field: the form
      asks for an email and a password, and `tenantSlug` is filled from the
      route.
- [x] `POST /api/portal/login` **relays the API's `ns_portal_session` cookie
      verbatim**, with its attributes intact, and never puts it in a body or a
      log line.
- [x] The portal BFF still **never forwards the staff cookie**, and a case
      asserts it: the isolation [[DEC-008]] requires is exactly what a new hop
      on this proxy could break.
- [x] The refusal of `POST /portal/logout` **stays**, with its reason recorded:
      it revokes a session, and this proxy's other routes are reads.
- [x] The form shows the **API's own refusal** for bad credentials, which is one
      message for an unknown address, a wrong password and a wrong tenant alike.
- [x] On success the visitor lands on `/[slug]` with a working portal session.
- [x] The password is never in a URL, in storage, in a log line or in an error
      message.
- [x] A visitor with **no portal session** to `/[slug]/…` is sent to
      `/[slug]/login` rather than shown an empty portfolio, and a visitor
      holding only a STAFF session is sent there too — the staff cookie must not
      satisfy the portal gate.
- [x] Tenant isolation is enforced when applicable. Evidence: the login page's
      only read is the public brand resolution; the session it establishes is
      the API's and is tenant-scoped by the slug it was issued for.
- [x] Backend authorization is enforced when applicable. Evidence: no new
      backend route; the page is a client of the existing `/portal/login`.
- [x] Required loading/error/empty/success UX exists. Evidence: the form's own
      states.
- [x] Required audit exists. Evidence: not applicable — the API audits portal
      login outcomes already, and this surface adds no operation.
- [x] Tests required by the Story pass.

## Domain Invariants

- The portal cookie is set by the API and relayed unchanged; this surface never
  mints, rewrites or reads one.
- **The two cookies never cross.** A staff session does not authorize the portal
  and a portal session does not authorize the staff app; the login page asserts
  neither.
- A visitor with no portal session never sees another customer's data, and the
  gate is server-side.
- The failure the user sees is the API's, verbatim: distinguishing "wrong
  tenant", "unknown address" and "wrong password" would be a louder oracle than
  the API it fronts.

## API

### Added

```text
POST /api/portal/login   (web BFF; forwards to the existing POST /portal/login)
```

### Changed

```text
apps/web/src/app/api/portal/[[...path]]/route.ts   the establishing route, allowlisted
apps/web/src/app/(portal)/[slug]/layout.tsx        the portal shell's gate
```

## Database

None. This Story persists nothing.

## UI

- A public form inside the portal's own visual identity, resolved from the
  tenant slug.
- Semantic tokens only, never a tenant literal in a reusable component.
- Loading, error and success-transition states are required, not optional.

## Implementation Summary

Three units, and the Story's shape was decided by what the portal ALREADY is
rather than by copying its staff twin.

**The BFF gained the one shape where the session crosses OUTBOUND.**
`POST /api/portal/login` forwards no cookie - not a stale portal one, not the
staff one - and relays the API's `Set-Cookie` verbatim, attributes included.
`logout` stays refused, and `GET` on the login shape answers `405` rather than
`404`, because the path exists and the method does not. The staff cookie is
still never read, and that isolation now has a case on the new hop - which is
exactly where a change like this could have broken it.

**The page** is at `/[slug]/login`, inside `(portal)/[slug]`, whose layout is
deliberately ANONYMOUS: it resolves the tenant's public brand from the slug and
reads no session at all. That is what lets a login page live inside it without
the redirect loop a session-aware layout would create. The tenant comes from the
PATH and travels in the BODY, because that is the API's contract, so the form
never asks which clinic and "wrong tenant" cannot be a typo the visitor made. It
shows the API's own refusal and offers **no recovery link**: the API's recovery
authorises a `UserCredential` and a portal identity holds a `PortalCredential`,
so a link to the staff flow would send a customer into a page that cannot help
them.

**The gate** is a `(protected)` route group under `[slug]`, so the check happens
once in a server layout instead of in every page or, worse, in the browser. A
route group does not change a URL - `/[slug]/pets` is still `/[slug]/pets` - and
what changed is that it now has a parent that can refuse to render. It
**verifies the session** with `GET /portal/me` rather than trusting a cookie's
presence, because a cookie that exists is not a session that is live, and only a
`401` redirects: an outage renders, for the same reason the staff gate chose
that asymmetry.

## Verification

## Verification

```text
pnpm format-check                   clean
pnpm lint                           22/22 packages
pnpm typecheck                      22/22 packages
pnpm build                          13/13 packages
@newsaas/web test                   1147 passed
@newsaas/api test                   1323 passed
@newsaas/worker test                 241 passed
@newsaas/database test               533 passed
@newsaas/notifications test           84 passed
@newsaas/shared test                  16 passed
```

**What the suites cannot prove**, named rather than implied: a LIVE portal
sign-in (a browser receiving `ns_portal_session` from a running API, then a
protected page rendering with it). The suites assert the hop's shape - the
verbatim relay, the absence of any inbound cookie, the isolation, the `405`, and
the gate's branches - and the live run needs both services up.

## Tests Added

- The BFF: the `ns_portal_session` relay, the staff cookie never crossing, the
  `logout` refusal, and the body allowlist.
- The form: the uniform refusal, the rate limit if the API produces one, the
  success transition, and that the password never appears in an error.
- The gate: no session sends the visitor to `/[slug]/login`, and a STAFF-only
  session does too.

## Known Limitations

- **A customer who forgets their password has no way back.** The API's recovery
  authorises a `UserCredential` change and a portal identity holds a
  `PortalCredential`, so there is nothing for this surface to link to. The Story
  deliberately renders **no** recovery link rather than sending a customer into
  a page that cannot help them - the largest gap it leaves, and the portal's
  recovery is its own Story with its own token model.
- **No `?next=` return path**, for the same reason as the staff twin.
- **No sign-out affordance**, so ending a portal session is still
  `POST /portal/logout`.
- **The live sign-in is not recorded**: the suites prove the hop's shape.
- **The gate costs one API call per protected render** (`GET /portal/me`). That
  is the price of verifying rather than trusting, and it is deliberately not
  cached across requests: a revoked session must stop working immediately.

## Technical Debt

- None yet; anything raised here is recorded and triaged.

## Decisions / ADRs

- No new ADR: one page, one proxy route and one redirect, with no new
  dependency.
- [[DEC-008]] — the first-party portal identity, and the reason the two cookies
  never cross.

## Files / Modules

- `apps/web/src/app/(portal)/[slug]/login/` — the page and its form.
- `apps/web/src/app/api/portal/[[...path]]/route.ts` — the establishing route.
- `apps/web/src/app/(portal)/[slug]/layout.tsx` — the gate.
- `docs/05-modules/Portal.md` and `docs/05-modules/Identity-Sessions.md`.

## Completion Notes

Every criterion is satisfied and the gates are green, so this Story is `done`.

**It found the same thing its staff twin did, on the other identity**: the
portal's API has been complete since [[EPIC-08]] - login, logout, `/me`, a
guarded surface - and no page asked for a session, so a CUSTOMER could not sign
in at all.

**The shape was decided by what the portal already is.** The staff gate
piggybacks on a private read the shell was already making; the portal's layout
is anonymous by design, so the check went into a route group instead. Copying
the staff solution would have produced a redirect loop - which is the kind of
mistake a Story catches and a template does not.
