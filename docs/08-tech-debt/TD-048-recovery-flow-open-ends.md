---
id: TD-048
type: tech-debt
title:
  The recovery flow's two open ends — the page the link points at, and the
  password policy nobody has
status: resolved
severity: medium
owner: identity
related_epics:
  - EPIC-01
related_stories:
  - DAT-007
created: 2026-10-17
updated: 2026-10-17
---

# TD-048 — the recovery flow's two open ends

Raised by [[DAT-007]], which built the contract and deliberately not these two.

## 1. The link points at a page that does not exist

A recovery message carries `<STAFF_APP_BASE_URL>/reset-password?token=<token>`,
and the web app has no `/reset-password` route. So the flow is complete on the
API side and **ends in a 404 for the recipient** — the one thing the message
must never do.

It was not built here because a reset form is a UI with its own decisions (token
handling in the browser, the password rules it enforces before submitting, what
it shows for an expired link), and this Story's scope was explicitly the
contract. It is a Story, not a patch:

```text
What the page needs                                  Why it is not one line
---------------------------------------------------- ---------------------------------
read the token from the query string                 and never log it
POST /auth/password-reset with the JSON body         and map a 401 to "this link expired"
send the user to login on success                    and tell them every session ended
render the SAME refusals for every bad token         so the UI is not a second, louder oracle
```

**Until it exists, every recovery message is a dead end**, and no operator
should enable the feature expecting otherwise. The API side is proven end to end
(`apps/api/src/auth/password-recovery.integration.test.ts`), so the remaining
work is entirely in `apps/web`.

## 2. There is no password policy anywhere in this repository

`DAT-007`'s reset path bounds the new password by **length alone** (`1..1024`,
mirroring the login body), because that is what every existing path does and
accounts have been ops-provisioned until now. The reset is the first place a
**human chooses** the password, which makes it the first place a policy would
matter.

It was left undecided rather than invented, because a complexity or length rule
is a product decision with a support cost, and an implementation taking it would
be a work unit changing what users may type. The candidates, for whoever takes
it:

- a minimum length (the simplest rule that helps, and the only one with broad
  agreement);
- a breach-list check against a service (a new dependency, so an
  [[ADR-001]]-style decision);
- nothing, and a note that the repository's posture is "the operator provisions,
  the user changes" with no strength rule at all.

Whatever is chosen belongs in the credential boundary, **not** in the reset
endpoint: a rule enforced by one caller is a rule the other callers do not have.

## RESOLVED — 2026-10-17

**The page exists** at `/reset-password`, and the flow no longer ends in a 404.

## 1. The page, and what building it uncovered

It is the app's **first public page**, and three things came out of that which
are worth knowing:

- **It had to be reserved in the middleware.** Any first segment that is not
  reserved is read as a portal tenant slug (the portal surface is `/[slug]`), so
  `/reset-password` would have been treated as a tenant called "reset-password"
  — the page would still have rendered, because the branding lookup fails closed
  to the product preset, but the route would have been quietly squatting on a
  namespace that belongs to tenants.
- **It needed the app's first PUBLIC BFF.** Every other proxy attaches the staff
  session cookie; this one must not, because the caller is locked out and has no
  session — and sending one would hand an unrelated session's authority to a
  route with no use for it. It is a proxy of **one** shape, allowlisted, so
  `login` (which sets a cookie) and `logout` (which revokes a session) do not
  become reachable through it.
- **It lives outside the `(app)` route group**, which renders the staff shell
  from a session a locked-out user does not have.

The form's refusals are the API's own: **one message for an unknown, a spent and
an expired link**, because the API deliberately does not distinguish them and a
UI that invented a distinction would be a louder oracle than the API it fronts.
Its minimum length mirrors the policy below as a convenience, not as the rule.

**Still missing, and it is a different dead end**: there is no **login page** in
this app, so nothing links to "forgot my password" — the request has no entry
point in the UI. It is the next Story, not this one.

## 2. The password policy

**Decided: a minimum of 8 characters, with no composition rules.** Eight is the
floor NIST SP 800-63B sets for a password used alone; composition rules are
explicitly discouraged by the same source, because they push people toward
`Password1!` and punish the long passphrase that is actually strong.

**It lives in the credential boundary**, not in the reset endpoint:
`CredentialService.hash` applies it, so every path that sets a password inherits
it — a rule enforced by one caller is a rule the other callers do not have. Two
details of the implementation are decisions rather than incidentals:

- **`hash` is `async` now**, because it was the one method that could throw
  SYNCHRONOUSLY while returning a promise — and a promise-returning method that
  throws instead of rejecting is one whose callers' `.catch()` never runs.
- **It runs before argon2**, so a refused password costs no CPU. One existing
  test had to change: it hashed `"pw"`, which the boundary now refuses.

**Still not covered, and named**: `aaaaaaaa` passes, and there is no
breached-password list. The second needs a dependency (so an ADR) and a decision
about what leaves the process. Both are recorded here for whoever wants them;
neither blocks the flow.

## Related

- `docs/05-modules/Identity-Sessions.md` — the flow as implemented.
- `docs/02-stories/DAT-007-password-recovery.md` — the Story that raised this.
