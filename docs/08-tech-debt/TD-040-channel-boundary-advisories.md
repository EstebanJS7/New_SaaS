---
id: TD-040
type: tech-debt
title: The channel boundary's review advisories, and four that are worth fixing
status: resolved
severity: low
owner: notifications
related_epics:
  - EPIC-17
related_stories:
  - NOTIF-002
related_decisions:
  - DEC-061
created: 2026-10-17
updated: 2026-10-17
---

# TD-040 — the channel boundary's five advisories

Raised by `review-02c5036e0cf9a762` (EPIC-17 WU-C1, NOTIF-002): **approved on
the first pass with no blocking finding** and five non-blocking advisories, four
WARNING and one SUGGESTION. The published closure lists ids and coordinates and
**no claim text**, so each entry below is the coordinate plus a READING of it,
explicitly marked as a reading. Two of the readings I judge to be real defects;
say which of them you want fixed and they become a small unit of their own.

## R3-001 — `packages/notifications/src/channel/whatsapp.channel.ts:162-167` (WARNING) — FIXED

The `catch` around the request. **A reading:** it classifies **every** thrown
error as an unreachable API, which is retryable. Most of them are — but a
**malformed `WHATSAPP_CLOUD_API_BASE_URL`** or an invalid header value makes
`fetch` throw a `TypeError` before any network attempt, and that is a
configuration error, not a transient one. It would be retried to the end of the
budget and then settle on `FAILED` with "could not be reached", which is
attributable to nobody. If that is the finding, the fix is to narrow the catch
to a transport-shaped error and let a programming error become a non-retryable
configuration failure.

## R3-002 — `packages/notifications/src/channel/email.channel.ts:211-213` (WARNING) — FIXED

The `finally { transport.close?.() }`. **A reading:** `close()` is not guarded,
so a teardown that **throws synchronously** turns an already-successful send
into a rejection — the delivery would be recorded as failed after the message
left. The same shape would produce an unhandled rejection if `close()` returned
a rejected promise. If that is the finding, the fix is to wrap the teardown so a
close failure can never change the attempt's outcome.

## R3-003 — `packages/notifications/src/channel/channel.module.ts:207` (WARNING) — FIXED

`readPort`'s `Number.parseInt`. **A reading:** `parseInt` is lenient, so
`SMTP_PORT="587abc"` resolves to `587` and is accepted; only a value with no
leading digits is refused. In a deployment input, a typo that silently becomes a
different port is worth refusing. If that is the finding, the fix is `Number()`
with the same bounds check.

## R3-004 — `packages/notifications/src/channel/fake.channel.ts:72-90` (WARNING) — FIXED

The fake's `attemptsLog.push`. **A reading:** the log is **unbounded**. The fake
is selectable in production for the documented dedicated-demo path, so a
long-running process using it would grow that array for every delivery it ever
sends, holding a RESTRICTED datum per entry. The fake documents that the log is
in-memory only, which is true and not sufficient. If that is the finding, the
fix is a bounded ring buffer (and it also reduces how much a demo process
keeps).

## R3-005 — `packages/notifications/src/channel/dependency-boundary.test.ts:14` (SUGGESTION) — FIXED

`PACKAGE_SRC`'s resolution. **A reading:** the walk derives the package root
from the test file's own location, so if the file moved the scan would silently
cover the wrong directory — and the suite has a non-vacuity case that would then
fail loudly rather than pass, which is why this is a suggestion and not a
defect. A `package.json` existence check would make the intent explicit.

## Resolution (2026-10-17)

All five fixed on `fix/notif-review-advisories`, each with a case that fails
without the fix:

1. **R3-001 — the base URL is validated at construction.** `new URL(baseUrl)` in
   `createWhatsAppCloudChannel`, refusing `WHATSAPP_CLOUD_API_BASE_URL` by name
   when it is not absolute. With the URL proven up front, every throw in the
   request path is a transport failure in fact, so the catch keeps classifying
   them as retryable and nothing needs to guess from an error's type — which it
   could not: a real network failure and a malformed URL both surface as
   `TypeError`, so narrowing the catch by type would have broken the retries it
   was meant to protect. Case: a malformed URL throws at construction.
2. **R3-002 — teardown cannot revise an outcome.** The `close?.()` call is
   wrapped, so a throwing teardown can no longer turn a message that already
   left into a recorded failure (and a rejected promise into an unhandled
   rejection). Case: a transport whose `close` throws still resolves `SENT`.
3. **R3-003 — `Number`, not `parseInt`.** `587abc` is now refused instead of
   silently becoming `587`. Cases: the exact port accepted; `0`, `65536`, `-1`,
   `smtp` and `5 8 7` refused.
4. **R3-004 — the fake's log is bounded** at 100 retained attempts, and its
   provider-reference counter was **separated from the log's length**: driving
   the index from a saturated log would have started repeating references, which
   the first version of this fix would have introduced. Case: after 101 sends
   the log holds 100 and the next reference is `fake-email-102`.
5. **R3-005 — the walked root is proven.** The guard asserts the source
   directory exists, and its first version checked `package.json` and
   **failed**: the constant points at `src/`, not at the package root. That is
   the assumption the guard was written to catch, caught by the guard.

## Why this is one item and not four

They are one review's advisories on one unit, and none of them blocks anything:
the boundary is approved, its 53 cases are green, and the delivery path that
would exercise these lines does not exist yet (WU-C2). Fixing them lands them in
a review of their own rather than in a reopened one, which is what
`gentle-ai.review-last-event-closure/v1`'s own wording requires: _"Treat them as
separate later work, never as a reason to re-run review on this candidate."_

## Related

- `docs/02-stories/NOTIF-002-channel-port.md` — the unit the review covered.
- [[DEC-061]] — the boundary's shape.
- [[ADR-011]] — the email dependency and its guardrails, which these advisories
  do not contradict.
