---
id: TD-049
type: tech-debt
title:
  A schema-valid portal login body through the proxy answers 500, while the API
  answers 401
status: open
severity: high
owner: portal
related_epics:
  - EPIC-08
related_stories:
  - PORTAL-001
created: 2026-10-18
updated: 2026-10-18
---

# TD-049 — the portal proxy's 500 on a body that validates

Found by the **live run** of [[PORTAL-001]]'s sign-in against a real API and a
real database, which is the only place it could have been found: every suite
passes, and the unit tests exercise the proxy's streamed body with a mocked
`ReadableStream`.

## The reproduction

With the API and the web both running (`next start`, not `next dev`):

```text
POST http://127.0.0.1:3000/api/portal/login
content-type: application/json

{"tenantSlug":"demo","email":"ana.garcia@demo.newsaas.test","password":"demo-owner-password"}
  -> 500

{"tenantSlug":"demo","email":"ana.garcia@demo.newsaas.test"}
  -> 400   (the API's validation envelope)
```

The web logs
`[TypeError: fetch failed] { [cause]: [Error: expected non-null body source] }`.

## What was ruled out, by experiment

```text
The API receives it and answers correctly   the API's own log shows POST /portal/login arriving and
                                            returning 401 for exactly those requests
Relaying an ERROR body is not the problem    POST /api/auth/login with a wrong password returns 401
                                            through the STAFF BFF, envelope and all
It is not the body's SIZE                    a padded 104-byte body returns 400
It is not the payload's VALUES               {"tenantSlug":"demo","email":"x@y.test","password":"…"}
                                            fails the same way
It correlates with VALIDATION                every body missing a key returns 400; every body that
                                            satisfies the schema returns 500
```

## The prime suspect

The two proxies differ in exactly one place that matches: the **staff** BFF
reads the body as text (`await request.text()`) and forwards a string; the
**portal** proxy pipes the incoming stream (`body: request.body`, with
`duplex: "half"`) so the API's Zod sees the caller's exact input. The finding's
shape — the API receives and answers, the client sees a 500 raised by a fetch —
fits a stream that somewhere between Next's runtime and undici is no longer a
valid body source.

**Not a change [[PORTAL-001]] made.** The Story added the login shape to the
allowlist and, on that shape only, the cookie relay; the body path is untouched
and pre-existing. Which means the same failure is reachable from the routes that
already used it — a booking or a cancellation POST — and **that is the reason
this record is `high` rather than cosmetic**: a customer submitting a booking
may be getting a 500 where the UI expects the proxy to relay the API's answer.

## What a fix needs first

1. Reproduce it in a test. The suite pipes a `ReadableStream` into the handler
   and passes, so the test does NOT model what Next's `start` runtime hands a
   route handler — that gap is the real defect and it outlives this bug.
2. Only then choose: read the body as text like the staff BFF does (losing the
   exact-stream property the comment there argues for), or find the correct way
   to forward a stream from an App Router route handler.
3. And check the other POST shapes on this proxy for the same symptom, since
   they share the path.

## Related

- `apps/web/src/app/api/portal/[[...path]]/route.ts` — the proxy.
- `docs/02-stories/PORTAL-001-portal-sign-in.md` — the live run that found it.
