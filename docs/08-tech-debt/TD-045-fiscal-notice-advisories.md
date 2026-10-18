---
id: TD-045
type: tech-debt
title:
  The fiscal notice's two advisories, and the validator's observation about what
  the patch does not prove
status: resolved
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

## Resolution (2026-10-17)

**The validator's observation is addressed at the site where the argument is
made.** Both schedulers now name the two properties their re-enqueue depends on,
with the exact file and case:

- the deterministic job identity — `notification-delivery.queue.test.ts`,
  _"derives a deterministic identity from the delivery, and one per delivery"_;
- the settled-row refusal — `notification-delivery.handler.test.ts`, _"never
  touches a settled row, because a settled row is not editable state"_, covering
  `SENT`, `FAILED` and `CANCELLED`.

A reader standing at the re-enqueue can now follow the safety argument instead
of taking it on trust, which was the actionable half of the observation. The
alternative it also offered — a case that exercises a duplicate add through a
real queue — is not taken: the two referenced cases are the assertions, and
adding a third that re-tests them through Redis would assert BullMQ's behavior
rather than this module's.

**`R3-002` and `R3-003` stay unresolved and unidentified.** Their text and
coordinates were never captured (see above), so there is nothing to fix and
nothing honest to claim about them. The closure that raised them called them
non-blocking and approved the unit. The next unit that touches these schedulers
should re-read them rather than guess, which is exactly what this TD's first
section says.

**Reviewed by `review-75fc1f73824e8c54`** — medium tier, one lens
(`review-reliability`), 11 paths, 187 changed lines — which **approved with no
findings at all**, so there are no new advisories to record and nothing to
interpret. Authority burned by the exact acknowledgement.

## The re-read — 2026-10-17, and it found a real defect

[[TD-045]]'s own instruction was that _"the next unit that touches these
schedulers should re-read them rather than guess"_, so this section is that
re-read performed rather than the two advisories invented.

**What it found, in `notification-reminder.scheduler.ts`, is worse than either
of them:** `onConfirmed` and `onCancelled` had **no error guard at all**. Five
awaited calls inside them can fail transiently — the appointment read, the
recipient port, the settings read, the entitlement read, the intent insert and
the enqueue — and the **dispatcher invokes handlers as
`void (async () => handler(event))()`**. So any of those failures produced an
**unhandled rejection**, and nothing in either deployable installs a
`process.on("unhandledRejection")` handler (verified by search). Node terminates
the process on an unhandled rejection by default: **one failed settings read
during one confirmation would take down every request the API serves.**

It was invisible because the two suites that covered those paths drove the
scheduler's methods directly, where a rejection is just a test failure — the
property that mattered (what the DISPATCHER does with a rejection) was asserted
nowhere.

**The fix**: both handlers now delegate to a private method inside a `try`, log,
and end. The failure is not swallowed, it is **reported**: the log carries the
error's **name** and its **code**, which is what lets an operator tell "we hit
the wrong unique index" (`P2002`) from "the database was unreachable"
(`ECONNREFUSED`) from "that is our own `TypeError`". The message never appears,
because a driver's text is where a connection string with credentials lives.

**Three cases assert it**, replacing two that asserted the opposite: a
non-dedupe `P2002` (which must not be accepted as "already scheduled" — the old
test's intent, kept), a transient failure on the first read, and a failure
inside the cancellation reaction. All three assert the handler RESOLVES and that
the report names the failure. The old tests were not wrong about what they
wanted; they were asserting it at the layer where propagation is the correct
behavior, which is `NotificationIntentService.ensureIntent` — and that still
propagates.

**`R3-002` and `R3-003` are still identified only by id.** The re-read surfaced
one real defect, not those two, and inventing a reading for them would be worse
than leaving them named as unknown.

## Related

- `docs/02-stories/NOTIF-003-appointment-reminder-and-emitters.md` — the Story.
- [[DEC-059]] — the decision that made `FiscalApproved` this epic's to publish.
