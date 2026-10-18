---
id: TD-050
type: tech-debt
title:
  Two more proxies forward a streamed body, and carry the defect TD-049 proved
status: open
severity: high
owner: web
related_epics:
  - EPIC-06
  - EPIC-07
related_stories:
  - PORTAL-001
related_decisions: []
created: 2026-10-18
updated: 2026-10-18
---

# TD-050 — the same streamed-body defect, in `clinical` and `scheduling`

[[TD-049]] proved, live and with instrumentation, why a proxy that forwards
`request.body` crashes against the real runtime: Next 15 hands a route handler a
`ReadableStream` that Node's internal undici refuses as a body source, and
undici only finds out when it has to **write** the body — which happens when the
upstream API **reads** it.

```text
apps/web/src/app/api/clinical/[[...path]]/route.ts      line ~165  body: request.body, duplex: "half"
apps/web/src/app/api/scheduling/[[...path]]/route.ts    line ~170  body: request.body, duplex: "half"
```

**The fix is the one line TD-049 shipped**: forward the body as text, which four
other proxies in this app already do.

## Why it is `high` and not cosmetic

`clinical` and `scheduling` are the STAFF surfaces a signed-in user drives:
closing an encounter, moving an appointment. Their POSTs reach the API's handler
— and therefore its body read — whenever the request is authorized, which is the
normal case. So the failure mode is a **500 on an action a staff member takes**,
silently, in the same way the portal's login was.

The reason it has not been reported is the reason it exists: the app only became
reachable in a browser on 2026-10-18 ([[SHELL-001]], [[PORTAL-001]]).

## What the unit needs

1. **A live verification, not only a unit one.** The suites assert
   `duplex: "half"` for these proxies exactly as the portal's did, so changing
   the code without changing them leaves the defect encoded in a passing test.
   TD-049's fix is the template: the mock gains a `text()` that reads the same
   body, and the case asserts a string with no `duplex`.
2. **A signed-in request for each**, because an unauthenticated POST never makes
   the API read the body — and so never reproduces the bug.
3. **A look at whether any other route handler streams a body**, since the
   pattern was copied rather than invented (`sales`, `cash` and `billing` read
   `text()`, and are the counter-example).

## Related

- [[TD-049]] — the defect proved, and its fix.
- `apps/web/src/app/api/{clinical,scheduling}/[[...path]]/route.ts` — the two
  call sites.
