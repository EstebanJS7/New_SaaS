---
id: TD-048
type: tech-debt
title:
  The recovery flow's two open ends — the page the link points at, and the
  password policy nobody has
status: open
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

## Related

- `docs/05-modules/Identity-Sessions.md` — the flow as implemented.
- `docs/02-stories/DAT-007-password-recovery.md` — the Story that raised this.
