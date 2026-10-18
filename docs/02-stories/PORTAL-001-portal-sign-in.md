---
id: PORTAL-001
type: story
title: The portal sign-in surface
status: in-progress
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

- [ ] `/[slug]/login` is public and renders the **tenant's resolved brand**, so
      a customer sees the clinic they are signing in to rather than the
      platform's default identity.
- [ ] The page takes the tenant from the **path**, never from a field: the form
      asks for an email and a password, and `tenantSlug` is filled from the
      route.
- [ ] `POST /api/portal/login` **relays the API's `ns_portal_session` cookie
      verbatim**, with its attributes intact, and never puts it in a body or a
      log line.
- [ ] The portal BFF still **never forwards the staff cookie**, and a case
      asserts it: the isolation [[DEC-008]] requires is exactly what a new hop
      on this proxy could break.
- [ ] The refusal of `POST /portal/logout` **stays**, with its reason recorded:
      it revokes a session, and this proxy's other routes are reads.
- [ ] The form shows the **API's own refusal** for bad credentials, which is one
      message for an unknown address, a wrong password and a wrong tenant alike.
- [ ] On success the visitor lands on `/[slug]` with a working portal session.
- [ ] The password is never in a URL, in storage, in a log line or in an error
      message.
- [ ] A visitor with **no portal session** to `/[slug]/…` is sent to
      `/[slug]/login` rather than shown an empty portfolio, and a visitor
      holding only a STAFF session is sent there too — the staff cookie must not
      satisfy the portal gate.
- [ ] Tenant isolation is enforced when applicable. Evidence: the login page's
      only read is the public brand resolution; the session it establishes is
      the API's and is tenant-scoped by the slug it was issued for.
- [ ] Backend authorization is enforced when applicable. Evidence: no new
      backend route; the page is a client of the existing `/portal/login`.
- [ ] Required loading/error/empty/success UX exists. Evidence: the form's own
      states.
- [ ] Required audit exists. Evidence: not applicable — the API audits portal
      login outcomes already, and this surface adds no operation.
- [ ] Tests required by the Story pass.

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

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- The BFF: the `ns_portal_session` relay, the staff cookie never crossing, the
  `logout` refusal, and the body allowlist.
- The form: the uniform refusal, the rate limit if the API produces one, the
  success transition, and that the password never appears in an error.
- The gate: no session sends the visitor to `/[slug]/login`, and a STAFF-only
  session does too.

## Known Limitations

- **No portal password recovery**: a customer who forgets their password has no
  way back, and the API has no flow for a `PortalCredential`. The largest gap
  this Story names.
- **No `?next=` return path**, deliberately.
- **No sign-out affordance**, so ending a portal session is still
  `POST /portal/logout`.
- **The live sign-in is not recorded**: the suites prove the hop's shape.

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

_Status must remain non-done until all required gates pass._
