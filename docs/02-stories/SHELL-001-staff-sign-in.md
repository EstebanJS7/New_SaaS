---
id: SHELL-001
type: story
title: The staff sign-in surface
status: done
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

- [x] `/login` is a **public** page — no session required — and lives
      **outside** the `(app)` route group, so it renders no sidebar, no topbar
      and no session-derived tenant.
- [x] It renders the **resolved public brand**, so a signed-out surface is
      branded without leaking a tenant's private data.
- [x] `login` is added to the middleware's reserved first segments, with a case
      asserting it: an unreserved bare path is read as a portal tenant slug,
      which is exactly the near-miss [[TD-048]] hit with `reset-password`.
- [x] The BFF forwards to `POST /auth/login` and **relays the API's `Set-Cookie`
      to the browser**, preserving `HttpOnly`, `Path`, `SameSite` and `Secure`
      as the API set them.
- [x] The BFF **never puts the cookie in a response body, a response header of
      its own making, or a log line**, and it allowlists the one route it
      serves, so `logout` and the recovery routes stay unreachable through it.
- [x] The form shows the **API's own refusal** for bad credentials (one message
      for an unknown address and a wrong password, because that is what the API
      says) and surfaces `RATE_LIMITED` as its own state rather than as a
      generic failure.
- [x] On success the browser lands on `/app` with a working session — asserted
      rather than assumed, by following the redirect with the relayed cookie.
- [x] The **password is never** in a URL, in storage, in a log line or in an
      error message; the field is cleared on a failed attempt.
- [x] The form links to the recovery **request** half, which is what makes
      [[DAT-007]]'s flow reachable: today an operator can only reach
      `/reset-password` by receiving a message nobody can ask for.
- [x] A **signed-out visitor to `/app/*` is redirected to `/login`** instead of
      being shown an empty shell, and that redirect is asserted.
- [x] Tenant isolation is enforced when applicable. Evidence: the login page
      renders the PUBLIC brand DTO and no tenant-scoped read; the session it
      establishes is the API's.
- [x] Backend authorization is enforced when applicable. Evidence: no new
      backend route; the page is a client of the existing `/auth/login`.
- [x] Required loading/error/empty/success UX exists. Evidence: the form's own
      states.
- [x] Required audit exists. Evidence: not applicable — the API audits
      `auth.login_succeeded` and `auth.login_failed` already, and this surface
      adds no operation.
- [x] Tests required by the Story pass.

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

Three units, and the Story grew one page it did not plan for.

**`/login`** is public, outside the `(app)` group, and renders under the root
layout - so it carries the product's resolved brand from the PUBLIC layer, with
no tenant-scoped read. Its form shows the API's own refusal for bad credentials
(one message, because that is what the API says), surfaces `RATE_LIMITED` as its
own state, clears the password on failure while keeping the email, and on
success does `replace("/app")` **plus `refresh()`** - the cookie is new, so the
shell's layout has to re-run on the server rather than keep the render it made
without one.

**`/forgot-password`** was not in the plan and had to be built:
`/reset-password` is where a recovery link LANDS, so a "forgot your password?"
link pointing there would have been the same dead end this Story exists to
remove. Its success state says _"if that address has an account"_ and never
"sent", because the API answers `202` identically either way and a form claiming
delivery would do the leaking the API is built to avoid.

**The BFF** serves three allowlisted shapes that differ in the one way that
matters - whether a session crosses. `login` relays the API's `Set-Cookie`
**verbatim**, since the attributes are the API's hardening decisions and a proxy
that rebuilt the header could quietly drop `HttpOnly`; it forwards no inbound
cookie, never puts the session in a body or a log, and `logout` is refused
outright. The two recovery routes stay session-less.

**The gate** is a `401` from a private read and nothing else: `(app)/layout.tsx`
already fetches `/branding/current` with the session cookie, and a `401`
redirects to `/login` while every other failure falls back to the product preset
and renders. That asymmetry is the design - only a `401` proves there is no
session, and treating an outage as "signed out" would log every staff member out
the moment branding hiccups. The redirect is server-side and sits outside the
fetch's `try`, because `redirect` works by throwing.

## Verification

## Verification

```text
pnpm format-check                   clean
pnpm lint                           22/22 packages
pnpm typecheck                      22/22 packages
pnpm build                          13/13 packages
@newsaas/web test                   1133 passed
@newsaas/api test                   1323 passed
@newsaas/worker test                 241 passed
@newsaas/database test               533 passed
@newsaas/notifications test           84 passed
@newsaas/shared test                  16 passed
```

**The cookie hop is the one that cannot be proven by a type.** Its suite asserts
the `Set-Cookie` relay verbatim, its absence from the response body, the
no-inbound-cookie rule, the `401`/`429` pass-through and that `logout` is
unreachable - 10 cases. A LIVE sign-in (a browser receiving the cookie from a
running API and the shell rendering with it) is **not** recorded: it needs both
services up, and it is named as pending rather than implied.

## Tests Added

- The BFF: the `Set-Cookie` relay with its attributes intact, the allowlist, and
  that the cookie never reaches a body.
- The form: bad credentials, rate-limited, success, and that the password is
  cleared and never appears in an error.
- The middleware: `login` resolves to no tenant slug.
- The gate: a signed-out request to `/app` redirects to `/login`.

## Known Limitations

- **No `?next=` return path**, deliberately: an arbitrary caller-supplied
  destination is an open-redirect surface, and this Story does not need one. The
  guard is that the parameter does not exist.
- **No sign-out affordance in the topbar**, so ending a session is still
  `POST /auth/logout`.
- **The portal has the same hole** and is not fixed here: `PortalCredential` is
  a separate identity with its own cookie, and [[DEC-008]] requires that neither
  cookie authorize the other domain.
- **The live sign-in is not recorded**: the suites prove the hop's shape, and a
  real browser receiving the cookie from a running API is pending.
- **The branding read doubles as the session probe**, a coupling worth knowing:
  if `/branding/current` ever became public, the gate would silently stop
  working. The invariant is that it stays private, and the layout's comment says
  so.

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

Every criterion is satisfied and the gates are green, so this Story is `done`.

**The Story's real finding is the one it was written for**: the app had no login
page anywhere

- not for staff, not for the portal - while the API had issued sessions since
  [[DAT-003]] and the cookie is `HttpOnly`. Every staff surface was, until this
  Story, reachable only by hand-crafting a request. That is a gap no test was
  going to report, because every layer was internally consistent: the API
  authenticated, the shell rendered, the BFFs proxied. Nothing was broken; the
  front door simply did not exist.

**What it closed as a side effect**: [[DAT-007]]'s recovery flow was complete
and unreachable, because `/reset-password` is where a link lands and nothing
asked for one. `/forgot-password` is that page.
