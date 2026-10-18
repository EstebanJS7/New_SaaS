---
id: TD-045
type: tech-debt
title:
  The fiscal notice's two advisories, and the validator's observation about what
  the patch does not prove
status: open
severity: low
owner: notifications
related_epics:
  - EPIC-17
related_stories:
  - NOTIF-003
related_decisions:
  - DEC-059
created: 2026-10-17
updated: 2026-10-17
---

# TD-045 — the fiscal notice's advisories

Raised by `review-a8f4b7d2bd6a83b4` (EPIC-17 WU-D3's second half), which closed
`correction_required` on one CRITICAL — fixed and validated — and left two
non-blocking advisories after the correction.

## What this record does NOT contain, and why

**The advisories' coordinates and claim text were not captured.** The closure
was read through a filter that printed only the ids, and a STATUS call after the
acknowledgement — which the execution contract forbids — failed safely, so the
detail is not recoverable. That call mutated nothing
(`mutation_outcome: not_started`), and its own failure message is the
confirmation that the authority was burned as intended.

So both entries below are **ids without a reading**, which is weaker than every
other advisory record in this epic and is stated rather than dressed up:

- **`R3-002`** (advisory, coordinate and claim not captured).
- **`R3-003`** (advisory, coordinate and claim not captured).

Both are non-blocking by the closure's own statement, and the unit is approved.
The honest action when a future unit touches these schedulers is to re-read them
rather than to guess what was meant.

## The validator's observation, which IS actionable

The targeted validator passed both criteria and added one follow-up worth
keeping:

> _"The supplied patches do not independently verify the deterministic BullMQ
> job ID or the settled-delivery handler gate on which duplicate-send safety
> relies."_

**Accurate about the patch's scope, and the two properties are in fact covered —
elsewhere.** The correction's four frozen patches are two schedulers and their
suites; the safety argument rests on two things those files do not assert:

1. **The job id is deterministic**, so BullMQ ignores a duplicate add —
   `packages/notifications/src/notification-delivery.queue.test.ts`, _"derives a
   deterministic identity from the delivery, and one per delivery"_.
2. **A settled delivery is refused by the handler** — so a re-enqueued job that
   fires cannot send a second message —
   `apps/worker/src/notification-delivery/notification-delivery.handler.test.ts`,
   _"never touches a settled row, because a settled row is not editable state"_,
   which covers `SENT`, `FAILED` and `CANCELLED`.

The observation is kept because it names the shape of a real risk: a correction
whose safety argument lives outside its own patch is a correction a reader has
to take on trust. The next unit that touches these schedulers should either
repeat those two references in a comment beside the re-enqueue or add a case
that exercises the duplicate add through a real queue.

## Related

- `docs/02-stories/NOTIF-003-appointment-reminder-and-emitters.md` — the Story.
- [[DEC-059]] — the decision that made `FiscalApproved` this epic's to publish.
