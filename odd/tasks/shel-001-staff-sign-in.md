# SHELL-001 — The staff sign-in surface (feature tasks)

The finding that created this Story: the web app has **no login page anywhere**
(not for staff, not for the portal), the session cookie is `HttpOnly`, and the
API has had `POST /auth/login` since [[DAT-003]]. Every staff surface was
reachable only by hand-crafting a request.

Ground that already exists: the app's first public route (`/reset-password`,
[[TD-048]]), so the shape of a public page and a session-less BFF is established
— with one difference that matters here: this BFF must relay a `Set-Cookie`. And
the public brand resolution ([[BRAND-006]]) is what lets a signed-out page
render in the product's identity.

## Work units

- [x] **WU-A — the page and the form.** `GET /login`, outside the `(app)` group,
      _Done: `/login` (page + form) and `/forgot-password` (page + form), both
      outside the `(app)` group and both under the root layout. 13 cases. The
      recovery page was NOT in the original plan and had to be:
      `/reset-password` is where a link LANDS, so a "forgot your password" link
      pointing there would have been the same dead end this Story exists to
      remove. The success state says "if that address has an account" because
      the API answers 202 identically either way, and a form claiming "sent"
      would be the enumeration oracle the API is built to avoid._ in the
      resolved public brand; the form with email and password, the API's own
      failure states, and the recovery link that closes [[DAT-007]]'s loop.
- [x] **WU-B — the BFF and the cookie.** `POST /api/auth/login` forwarding to
      _Done: one BFF file serving THREE allowlisted shapes, which differ in the
      one way that matters — whether a session crosses. `login` relays the API's
      `Set-Cookie` VERBATIM (the attributes are the API's hardening decisions,
      and a proxy that rebuilt the header could quietly drop `HttpOnly`),
      forwards NO inbound cookie, and never puts the session in a body or a log;
      the two recovery routes are session-less. `logout` is refused outright. 10
      cases._ the API and relaying `Set-Cookie` to the browser with its
      attributes intact — `HttpOnly`, `Path`, `SameSite`, `Secure` — while never
      putting the cookie in a body, in a header of its own making, or in a log
      line. The existing auth BFF is a session-LESS proxy; this one is the
      opposite, so the allowlist matters more, not less.
- [x] **WU-C — the gate and the reservation.** `login` joins the middleware's
      _Half done: `login` and `forgot-password` are reserved in the middleware,
      with a case. The `(app)` gate — a signed-out visitor redirected to
      `/login` instead of shown an empty shell — is NOT in yet and is the next
      unit._ reserved first segments (an unreserved bare path is a portal tenant
      slug — the near-miss TD-048 hit), and a signed-out visitor to `/app/*` is
      redirected to `/login` rather than shown an empty shell.
- [ ] **WU-D — the documentation and the closure.** `Identity-Sessions.md` gains
      the sign-in surface, `Branding.md` gains the public-brand consumer, and
      the Story's evidence is recorded.

## Decisions taken before the first write

**No `?next=` return path.** Honoring a caller-supplied destination is an
open-redirect surface, and the Story does not need one: signing in lands on
`/app`. Recorded as a limitation rather than left as an omission, and the guard
is simply that the parameter does not exist.

**The gate is a server-side `redirect`,** not a client-side one: a signed-out
visitor must never render a protected shell and then be sent away, because the
shell is what fetches tenant-scoped data.

**The cookie is relayed, never read.** This surface has no business knowing a
session's value, and the assertion is that it never appears in a body or a log.

## One open question, resolved by scope

**Does the portal need this in the same unit?** No: `PortalCredential` is a
separate identity with its own cookie, and the repository requires that neither
cookie authorize the other domain ([[DEC-008]]). Its login is its own Story.
