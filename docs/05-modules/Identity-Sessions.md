---
type: module
module: identity-sessions
status: implemented
updated: 2026-08-24
---

# Module — Identity & Sessions

## Responsibility

First-party staff authentication: credential verification, PostgreSQL-backed
revocable sessions, hardened session cookies and the login rate limiter.

## Does Not Own

- Tenant authority (see [[Tenancy]]).
- Role/permission policy evaluation (EPIC-02).
- Password reset / account recovery (deferred: [[TD-004]], blocked on EPIC-17
  email delivery).
- Customer portal identity (separate scaffold; no shared controllers).

## Public Capabilities

- `POST /auth/login` — email+password login; issues an opaque session token.
- `POST /auth/logout` — hard-deletes the server-side session; clears cookie.
- `GET /auth/me` — server-derived identity probe for the active session.
- `POST /auth/forgot-password` — requests a recovery message;
  `202 {status:"accepted"}` for every address, known or not (DAT-007).
- `POST /auth/password-reset` — consumes a recovery token, replaces the password
  and ends every session for the profile (DAT-007).
- `GET /login` — the staff sign-in page, with `POST /api/auth/login` as the web
  BFF that relays the session cookie ([[SHELL-001]]).
- `GET /forgot-password` — the recovery **request** page: the entry point the
  flow below was missing, since `/reset-password` is where a link LANDS
  ([[SHELL-001]]).

## Main Entities

```text
UserProfile   (global person, email UNIQUE app-lowercased)
UserCredential (1:1 RESTRICTED argon2id hash; never selected by app reads)
StaffSession  (token_hash UNIQUE; SHA-256 at rest; insert-per-login rotation)
PasswordResetToken (token_hash UNIQUE; SHA-256 at rest; single-use; NO tenant column)
```

`PasswordResetToken` is the one row here with no tenant, and the absence is an
invariant rather than an oversight: the credential it authorises is global to
the profile, so scoping it to a tenant would mean the flow could only reset the
password of a member of the tenant it happened to have in hand. Its guards are
the database's: the identity is fixed at insert (a mutable digest could be
repointed, a mutable expiry could resurrect a dead token), `consumed_at` moves
once from NULL and can neither be rewritten nor cleared, and
`expires_at > created_at` is a CHECK.

## Session Semantics

- Opaque token: `randomBytes(32)` base64url; only its SHA-256 is stored.
- Idle TTL 2h rolling (`SESSION_IDLE_TTL`, refreshed when >60s stale); absolute
  TTL 12h (`SESSION_ABSOLUTE_TTL`); env-tunable.
- Logout hard-deletes the row; replaying that cookie yields `401`.
- Cookie `ns_staff_session`: HttpOnly, Path=/, SameSite=Lax, Secure outside
  development (secure-by-default for unset NODE_ENV).

## Rate Limits

Sliding window per (email, IP-hash): ≥10 failed logins in 15 min ⇒
`429 RATE_LIMITED` envelope; success resets the counter. Blocked attempts are
rejected before any database/crypto work and are NOT audited (flood defense).

**The budget is SHARED, not per process** ([[HARD-002]], [[DEC-076]]). When
`REDIS_URL` is configured the window lives in Redis as one atomic sliding window
(prune + count in a single server-side evaluation), so the documented threshold
does NOT multiply by `api` replica count. One interface — `isBlocked`,
`recordFailure`, `reset` — serves all four paths that carry a failure budget:
staff login, staff password recovery, portal login and portal password recovery,
each with its own key namespace.

**Degradation is fail-OPEN and deliberately so.** The in-process window is
written on EVERY recorded failure even while the shared store is healthy, so it
reflects recent traffic at the moment a fallback is needed. When Redis is
unreachable the request proceeds on that local budget instead of being rejected:
locking every user of every tenant out of every surface because a cache tier is
down would turn a degraded dependency into a total-availability incident. During
the outage the effective budget is per replica — exactly the pre-revision
behaviour — and the store logs one diagnostic per minute rather than one per
request, because an outage that floods logs is the same failure wearing a
different hat.

Residual limitation, stated rather than hidden: keying by `(email, IP-hash)`
gives an attacker who distributes attempts across proxy pools a fresh budget per
egress IP, at any replica count. [[TD-005]] records the per-account budget that
would close it.

**Recovery has its own budget**, namespaced away from login's and keyed by
address AND client IP. Namespaced because the person asking for a reset is
exactly the person about to try to log in; keyed by the IP as well because,
keyed by the address alone, one attacker could exhaust a victim's budget and
deny that person their own recovery. The delivery's own window is the second
limit: one recovery message per profile per hour, which is what keeps the
endpoint from being an email amplifier.

## The sign-in surface (SHELL-001)

```text
GET  /login              public, outside the (app) shell
POST /api/auth/login     the web BFF: forwards the credentials and RELAYS the Set-Cookie
```

The API has issued sessions since [[DAT-003]], and the browser had **no page
that asked for one** until [[SHELL-001]]: the session cookie is `HttpOnly`, so
this hop is the only way it can reach a browser at all. Three things about it
are load-bearing:

- **The BFF relays the API's `Set-Cookie` verbatim.** The attributes are the
  API's hardening decisions; a proxy that rebuilt the header could quietly drop
  `HttpOnly`. It forwards no inbound cookie, because the browser is asking FOR a
  session, and it never puts the session in a body or a log.
- **The failure the user sees is the API's.** One message for an unknown address
  and a wrong password, because that is what the API says - a form that guessed
  which was which would be a louder existence oracle than the API it fronts.
- **The shell's gate is a `401` from a private read, and nothing else.**
  `(app)/layout.tsx` already fetches `/branding/current` with the session
  cookie; a 401 sends the visitor to `/login`, and every other failure (a 500, a
  timeout) falls back to the product preset and renders. That asymmetry is the
  design: only a 401 proves there is no session, and treating an outage as
  "signed out" would log every staff member out the moment branding hiccups.

Ending a session is still `POST /auth/logout`; there is no sign-out affordance
in the shell yet, which is recorded rather than implied.

## The portal's sign-in surface (PORTAL-001)

The portal's identity is a **separate one** - a `PortalCredential` behind
`ns_portal_session`, with its own guard chain - and its sign-in surface mirrors
the staff one without sharing anything with it:

```text
GET  /[slug]/login        public; the tenant comes from the PATH
POST /api/portal/login    the portal BFF's one ESTABLISHING hop
```

The two cookies never cross, in either direction: the portal's layout is
anonymous by design (it resolves the tenant's PUBLIC brand and reads no session,
which is what lets a login page live inside it), the portal BFF forwards only
the portal cookie, and the staff BFF forwards none on its own login hop. A
customer's session satisfies neither the staff gate nor the staff API, and a
staff session does not satisfy the portal's - the isolation [[DEC-008]]
requires, now asserted on BOTH sign-in hops, which is exactly where a change
could break it.

**A customer who forgets their password now has a way back** ([[PORTAL-002]]),
and it is the staff flow's sibling rather than a widened one: a
`portal_password_reset_token` keyed to the ACCESS — the staff table's foreign
key could not even hold one — two more `@Public` routes, the same 30-minute
single-use hashed token, and the same single-transaction reset that ends every
session and audits.

The two identities' tokens never cross, and that is [[DEC-008]]'s boundary one
level below the sessions: a staff token cannot be redeemed for a portal
password, nor the reverse. The route-contract test that asserted "login is the
ONLY public portal route" now names the three, with the invariant worth keeping
stated beside them — no OTHER portal route is public.

## The recovery flow (DAT-007)

```text
POST /auth/forgot-password
  rate-limited, uniform 202
  → publishes PasswordResetRequested  (tenantId: null — a platform-level event)
  → the notification module's subscriber creates a delivery under the PLATFORM tenant
  → the worker mints the token AT SEND TIME and mails the link

POST /auth/password-reset
  consumes the token · replaces the hash · ENDS EVERY session · spends the other
  links · audits   — in ONE transaction, with the hash computed BEFORE it opens
```

Three things about it are worth knowing before changing anything:

1. **The request sends nothing.** It publishes an event; the reaction lives in
   the notification module, so this module knows no queue, no producer and no
   delivery table. The dispatcher is fire-and-forget, which is also why a
   subscriber failure cannot turn the route's answer into an account-existence
   oracle.
2. **The token is minted when the mail is sent, not when it is asked for.**
   Content is built at send time and a plaintext token cannot be rebuilt from a
   digest, so issuing earlier would force persisting the plaintext, carrying it
   in a job payload, or sending inline from the request. It also makes the
   lifetime honest: it starts when the message does.
3. **A reset ends every session for the profile**, not the caller's: a reset is
   how somebody who suspects their account is compromised takes it back, and a
   surviving session is the attacker's. It also spends the profile's other
   outstanding links, so a second message cannot be redeemed against the
   password just set.

## Invariants

- Unknown email and wrong password produce byte-identical `401` envelopes; both
  paths burn one full argon2id verification (anti-enumeration).
- Hash parameters: argon2id m=19456 KiB, t=2, p=1 (OWASP floor, env-tunable);
  the hash never leaves the credentials store.
- `/auth/me` reflects ONLY server-derived session context; client-sent identity
  fields/headers are ignored.
- Recovery answers identically for an address that exists, one that does not,
  and a profile with no credentials. The refusals it can produce say nothing
  about an account.
- A used, expired or unknown recovery token is refused identically
  (`401 UNAUTHENTICATED`, one message): distinguishing them would tell the
  holder of a stale link that it was once real.
- The plaintext token exists between generation and the message, and nowhere
  else — not in a table, a log, a job payload or a response.
- Recovery is public by necessity, and is therefore the most carefully bounded
  public surface in the system: rate-limited, uniform, and silent.
- **The password policy is enforced at the credential boundary**: a minimum of 8
  characters, no composition rules, and a ceiling of 1024 that mirrors the login
  body's so a password that can be set can always be typed.
  `CredentialService.hash` applies it, so every caller inherits it rather than
  each endpoint remembering it. It refuses before argon2 runs, so a refused
  password costs no CPU.

## Security / Tenant Rules

- Login/logout are `@Public`; everything else requires a live session
  (`AuthGuard` populates the RequestContext).
- No password or hash material appears in responses or logs (redaction rules
  - leak-scan tests).

## Related Stories

- [[EPIC-01]] DAT-003 (Slice S3).

## Related ADRs

- Route-prefix deferral: [[DEC-002]] (unprefixed `/auth/*` paths shipped).
