---
id: TD-041
type: tech-debt
title: The delivery path's review advisories, and the one that leaves no trace
status: open
severity: medium
owner: notifications
related_epics:
  - EPIC-17
related_stories:
  - NOTIF-002
related_decisions:
  - DEC-058
created: 2026-10-17
updated: 2026-10-17
---

# TD-041 — the delivery path's three advisories

Raised by `review-8fe9d3d492192a6e` (EPIC-17 WU-C2, NOTIF-002): **approved on
the first pass with no blocking finding** and three non-blocking advisories, one
WARNING and two SUGGESTION. The published closure lists ids and coordinates and
no claim text, so each entry is the coordinate plus a READING, explicitly marked
as a reading.

## R3-001 — `apps/worker/src/notification-delivery/notification-delivery.handler.ts:107` (WARNING)

`await this.deliver(delivery)` — the last line of `handle`. **A reading, and I
judge it real:** the pre-send gates are awaited outside any `try`, so an
UNEXPECTED throw from the content seam or the entitlement reader propagates
while the row keeps the claim that was already committed: `SENDING`, a **fresh
lease**, an incremented `attempt_count`, and **no `last_error_*`**. An operator
looking at that delivery sees an attempt in progress with no explanation, and
has to wait for the lease to expire before anything can touch it.

The adapters' own failures are handled (they return outcomes, and the boundary's
throw is caught and recorded), and a _failed read_ propagating is deliberate.
What is not deliberate is that it propagates with nothing written. The likely
fix is to wrap the gate phase so an unexpected error records a bounded reason
before it rethrows — the row would then say what happened even when the reason
is "the content builder threw".

## R3-002 — `packages/notifications/src/entitlement.port.ts:19-21` (SUGGESTION)

The port's doc comment says _"A read that cannot answer must answer `false`"_,
while the implementation (and the handler) do something better: the reader
**propagates** an unanswerable read, and the handler retries it rather than
settling a delivery the tenant is entitled to. **A reading:** the sentence is
wrong, or at least says something the code does not do. If that is the finding,
the fix is a wording change — the contract that matters is "never answer `true`
when unanswerable", not "answer `false`".

## R3-003 — `apps/worker/src/notification-delivery/notification-delivery.consumer.test.ts:54` (SUGGESTION)

`expect(typeof NotificationDeliveryConsumer).toBe("function")` in a case named
"is a Nest provider the worker module can register". **A reading:** every class
is a function, so the assertion cannot fail and the case's name promises a check
it does not perform. The honest options are to delete the case or to assert the
wiring where it actually lives (the module's provider list), which would need a
module-level test.

## Why this is one item

They are one review's advisories on one unit. None blocks anything: the delivery
path is approved, its 39 cases are green, and nothing has been sent to a real
provider yet. The closure's own wording says _"Treat them as separate later
work, never as a reason to re-run review on this candidate."_

Worth noting for triage: **R3-002 and R3-003 are cheap and are quality rather
than behaviour** — a doc sentence and a tautological test — so they belong in
the same small pass as [[TD-040]]'s two real defects.

## Related

- `docs/02-stories/NOTIF-002-channel-port.md` — the unit the review covered.
- [[TD-040]] — the same Story's WU-C1 advisories.
- [[DEC-058]] — the entitlement decision R3-002's wording is about.
