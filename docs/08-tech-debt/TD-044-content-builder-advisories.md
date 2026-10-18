---
id: TD-044
type: tech-debt
title:
  The content builder's review advisories, and the one that did not reproduce
status: open
severity: low
owner: notifications
related_epics:
  - EPIC-17
related_stories:
  - NOTIF-003
related_decisions:
  - DEC-060
created: 2026-10-17
updated: 2026-10-17
---

# TD-044 — the content builder's three advisories

Raised by `review-0c34f0614742a5a3` (EPIC-17 WU-D3's first half): **approved on
the first pass**, no correction, three non-blocking advisories. The closure
lists ids and coordinates and no claim text, so each entry is the coordinate
plus a READING, explicitly marked as one — and the first of the three was
**measured**, so its entry says what the measurement found rather than what it
feared.

## R3-001 — `apps/worker/src/notification-delivery/notification-content.builder.ts:83` (WARNING)

The instant is rendered with `hour12: false`. **A reading:** `hour12: false`
resolves to `h23` or `h24` depending on the LOCALE's preferred hour cycle, so on
another ICU build or another locale midnight can render as `24:00`, and a
reminder that says 24:00 is a message a customer can misread by a day.

**Measured here, and it does not reproduce**: with Node 24 and `es-PY`, midnight
at `2026-10-18T03:00:00Z` renders `00:00`, and hour `11:00Z` renders `08:00` —
the same under `hourCycle: "h23"`. So the current behaviour is correct in this
environment and the risk is version- and locale-dependent.

**The fix is one line and removes the dependency rather than relying on it**:
state `hourCycle: "h23"` explicitly, which is unambiguous, and add a midnight
case so the boundary is pinned.

## R3-002 — `apps/worker/src/notification-delivery/notification-content.builder.ts:100-102` (SUGGESTION)

The dispatch is a ternary:
`delivery.sourceType === "APPOINTMENT" ? buildAppointmentReminder(...) : buildFiscalNotice(...)`.
**A reading:** that is **fail-open**. Any source type that is not `APPOINTMENT`
— including a third one added later by a migration before this file learns to
build it — is routed to the fiscal notice and would be announced as an invoice.
A `switch` with an explicit default that fails closed (`SOURCE_UNAVAILABLE`)
would make a new source type a named refusal instead of somebody else's message.

## R3-003 — `apps/worker/src/notification-delivery/notification-content.builder.test.ts:166` (SUGGESTION)

The fiscal case asserts the subject and the parameters with `toMatchObject` and
then reads the body inside `if (outcome.outcome === "READY")`. **A reading:**
the guard is redundant — the `toMatchObject` above it already required `READY` —
and a conditional assertion is one a later edit can silently stop performing.
The alternative is to narrow the outcome once and assert the body
unconditionally, which is the shape the appointment case uses.

## Why this is one item

They are one review's advisories on one unit, and none blocks anything: the
builder is approved, its 19 cases are green, and the send path is not live. The
closure's own wording says _"Treat them as separate later work, never as a
reason to re-run review on this candidate."_

R3-001 and R3-002 are cheap — a line and a handful — and they belong in the same
small pass as the rest of WU-D3's remaining half, the way [[TD-043]] was folded
into WU-D2 rather than given a unit of its own.

## Related

- `docs/02-stories/NOTIF-003-appointment-reminder-and-emitters.md` — the Story.
- [[DEC-060]] — the policy whose send-time read this builder is.
