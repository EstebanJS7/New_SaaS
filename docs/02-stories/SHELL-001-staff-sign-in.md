---
id: SHELL-001
type: story
title: The staff sign-in surface
status: in-progress
epic: EPIC-03
priority: high
depends_on:
  - DAT-003
created: 2026-10-18
updated: 2026-10-18
---

# SHELL-001 — The staff sign-in surface

## Objective

Give a human a way to sign in to the staff app from a browser. The API has had
`POST /auth/login` since [[DAT-003]], and the shell has rendered for as long as
[[EPIC-03]] has existed — but there is **no page anywhere that sets the session
cookie**, so every staff surface (fiscal, cash, agenda, notifications, branding)
is reachable only by hand-crafting a request. This Story builds the front door.

## Context

The finding is worth stating plainly because it is the reason this Story exists
at all: searching the web app for a login form returns nothing — not for staff
and not for the portal — and the session cookie is `HttpOnly`, so it cannot be
set from the browser by any other means. The app is **API-complete and
browser-unusable**.

Three pieces of the ground are already there:

- `POST /auth/login` issues the session and sets the hardened cookie
  ([[DAT-003]]).
- The app's **first public route** exists at `/reset-password` ([[TD-048]]), so
  the shape of a public page and of a session-less BFF is established — the
  login needs the same shape with one difference that matters: it must **relay a
  `Set-Cookie`**.
- The **public brand resolution** ([[BRAND-006]]) already serves a signed-out
  surface, which is what lets a login page render in the product's identity
  before anybody is authenticated.

And one gap this Story closes as a side effect: [[DAT-007]] left the recovery
flow complete except for its **entry point**. The link belongs on this form, and
nowhere else.

## In Scope

- `GET /login` — a public page, outside the `(app)` shell, rendering the
  resolved brand.
- `POST /api/auth/login` — a BFF that forwards to the API and **relays the
  session cookie** to the browser.
- The form: email and password, the failure states the API actually produces, a
  link to `/reset-password`'s **request** half (the forgot-password entry
  point), and a redirect into `/app` on success.
- The shell's gate: a signed-out visitor to `/app/*` is sent to `/login` rather
  than shown an empty shell.

## Out of Scope

- **A `?next=` return path.** Deliberate, and recorded as a limitation: honoring
  a caller-supplied destination is an open-redirect surface, and it is not
  needed for the Story to be coherent. Signing in lands on `/app`.
- **The portal's login.** `PortalCredential` is a separate identity with its own
  cookie and the repository already requires that neither cookie authorize the
  other domain ([[DEC-008]]). It is its own Story.
- **Registration, invitations, MFA, SSO, "remember me".** None exists in the
  API.
- **A password policy on the login path.** It is enforced where a password is
  SET ([[TD-048]]), which is the only place it can be.
- **Self-service sign-out UI.** `POST /auth/logout` exists and the topbar's
  entry for it is a separate concern.

## Acceptance Criteria

- [ ] `/login` is a **public** page — no session required — and lives
      **outside** the `(app)` route group, so it renders no sidebar, no topbar
      and no session-derived tenant.
- [ ] It renders the **resolved public brand**, so a signed-out surface is
      branded without leaking a tenant's private data.
- [ ] `login` is added to the middleware's reserved first segments, with a case
      asserting it: an unreserved bare path is read as a portal tenant slug,
      which is exactly the near-miss [[TD-048]] hit with `reset-password`.
- [ ] The BFF forwards to `POST /auth/login` and **relays the API's `Set-Cookie`
      to the browser**, preserving `HttpOnly`, `Path`, `SameSite` and `Secure`
      as the API set them.
- [ ] The BFF **never puts the cookie in a response body, a response header of
      its own making, or a log line**, and it allowlists the one route it
      serves, so `logout` and the recovery routes stay unreachable through it.
- [ ] The form shows the **API's own refusal** for bad credentials (one message
      for an unknown address and a wrong password, because that is what the API
      says) and surfaces `RATE_LIMITED` as its own state rather than as a
      generic failure.
- [ ] On success the browser lands on `/app` with a working session — asserted
      rather than assumed, by following the redirect with the relayed cookie.
- [ ] The **password is never** in a URL, in storage, in a log line or in an
      error message; the field is cleared on a failed attempt.
- [ ] The form links to the recovery **request** half, which is what makes
      [[DAT-007]]'s flow reachable: today an operator can only reach
      `/reset-password` by receiving a message nobody can ask for.
- [ ] A **signed-out visitor to `/app/*` is redirected to `/login`** instead of
      being shown an empty shell, and that redirect is asserted.
- [ ] Tenant isolation is enforced when applicable. Evidence: the login page
      renders the PUBLIC brand DTO and no tenant-scoped read; the session it
      establishes is the API's.
- [ ] Backend authorization is enforced when applicable. Evidence: no new
      backend route; the page is a client of the existing `/auth/login`.
- [ ] Required loading/error/empty/success UX exists. Evidence: the form's own
      states.
- [ ] Required audit exists. Evidence: not applicable — the API audits
      `auth.login_succeeded` and `auth.login_failed` already, and this surface
      adds no operation.
- [ ] Tests required by the Story pass.

## Domain Invariants

- The session cookie is set by the API and relayed unchanged; this surface never
  mints, rewrites or reads one.
- A signed-out visitor never sees a tenant's data. The login page's only data
  source is the public brand resolution.
- The failure the user sees is the API's, verbatim: a UI that distinguishes
  "unknown address" from "wrong password" would be a louder oracle than the API
  it fronts.
- Next.js' server-side `redirect` is used for the gate, never a client-side one,
  so a signed-out visitor never renders a protected shell first.

## API

### Added

```text
POST /api/auth/login   (web BFF; forwards to the existing POST /auth/login)
```

### Changed

```text
apps/web/src/middleware.ts        `login` joins the reserved first segments
apps/web/src/app/(app)/layout.tsx the shell redirects a session-less visitor to /login
```

## Database

None. This Story persists nothing.

## UI

- A public form: email, password, the submit state, the failure states, and the
  recovery link.
- Semantic tokens only, and the resolved brand's tokens rather than the
  product's hardcoded.
- Loading, error, rate-limited and success-transition states are required, not
  optional.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- The BFF: the `Set-Cookie` relay with its attributes intact, the allowlist, and
  that the cookie never reaches a body.
- The form: bad credentials, rate-limited, success, and that the password is
  cleared and never appears in an error.
- The middleware: `login` resolves to no tenant slug.
- The gate: a signed-out request to `/app` redirects to `/login`.

## Known Limitations

- **No `?next=` return path**, deliberately: an arbitrary caller-supplied
  destination is an open-redirect surface, and this Story does not need one.
- **No sign-out affordance in the topbar**, so ending a session is still
  `POST /auth/logout`.
- **The portal has the same hole** and is not fixed here.

## Technical Debt

- None yet; anything raised here is recorded and triaged.

## Decisions / ADRs

- No new ADR: one page, one proxy and one redirect, with no new dependency.
- [[DEC-008]] — the portal identity boundary this Story does not touch.
- [[BRAND-006]] — the public brand resolution the page consumes.

## Files / Modules

- `apps/web/src/app/login/` — the page and its form.
- `apps/web/src/app/api/auth/[[...path]]/route.ts` — extended with the login
  route.
- `apps/web/src/middleware.ts` and `apps/web/src/app/(app)/layout.tsx`.
- `docs/05-modules/Identity-Sessions.md` and `docs/05-modules/Branding.md`.

## Completion Notes

_Status must remain non-done until all required gates pass._
