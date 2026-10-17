---
id: DEC-060
type: decision
title:
  The appointment reminder policy — a 24 h tenant-configurable lead time, its
  dedupe key and its cancellation
status: accepted
date: 2026-10-16
related_epics:
  - "EPIC-17"
related_decisions:
  - "DEC-058"
  - "DEC-059"
related_stories:
  - "NOTIF-001"
  - "NOTIF-003"
prd_change_required: false
---

# DEC-060 — The appointment reminder policy

## Context

PRD §24 states the epic's one hard functional requirement:

> Appointment reminders must be idempotent and cancelled if the appointment is
> cancelled.

Two obligations, one sentence. The first needs a key that makes a repeated
intent idempotent; the second needs a pending unit of work that a cancellation
can find and remove.

`docs/03-architecture/INTERNAL-EVENTS.md` names **delayed execution** as one of
the four conditions that select BullMQ over the in-process dispatcher, and a
reminder 24 h ahead is delayed execution by definition. PRD §38 lists
`notifications` among the initial tenant-settings namespaces, and
`docs/03-architecture/TENANT-SETTINGS.md` gives the implementation contract for
adding one.

The appointment's own lifecycle is already fixed by EPIC-07:
`confirm: SCHEDULED → CONFIRMED` and `cancel: SCHEDULED|CONFIRMED → CANCELLED`,
both terminal-aware and both already writing `appointment.confirmed` /
`appointment.cancelled` audit rows. This decision does not change either.

## Question

When does the reminder fire, how is it configured per tenant, what makes it
idempotent, and what exactly cancels it?

## Options

### Option A — 24 h before, per-tenant configurable, delayed BullMQ job, dedupe key per (appointment, channel, window) (recommended)

The delivery intent is created when the appointment is confirmed, with
`scheduled_at = appointment.startsAt − lead time`, and enqueued as a **delayed**
job. Idempotency is a dedupe key over (appointment, channel, window). The
cancellation reaction cancels the record and removes the pending job by its
deterministic identity.

Benefits: the requirement is met as stated; the lead time is tenant policy in
the typed settings service rather than a constant; idempotency is enforced by
the database rather than by application cooperation; and the cancellation has a
concrete, addressable unit of work to remove.

### Option B — A fixed 24 h constant

Rejected: PRD §38 lists `notifications` as a settings namespace, so the policy
is tenant-configurable by the PRD's own design, and a constant would leave that
namespace empty.

### Option C — Schedule on read, or send from a periodic sweep

Rejected: a sweep that decides at delivery time whether a reminder is due turns
one delayed job into a repeated scan, makes idempotency a scan artifact, and
gives cancellation nothing to remove. The delayed job is exactly what
`INTERNAL-EVENTS.md` selects BullMQ for.

### Option D — An in-process dispatcher reaction with no queue

Rejected: the reaction needs an external network call, retry, delayed execution
and durable processing — all four BullMQ conditions, none of which the
dispatcher provides.

## Recommendation

Option A.

## Impact

### Product

Every tenant gets a reminder 24 h ahead by default and can change the lead time.
WhatsApp is only usable by an entitled tenant ([[DEC-058]]).

### Architecture

A BullMQ delayed job on the queue contract from [[NOTIF-001]]. The reaction
lives in the deployable that publishes the triggering event ([[DEC-059]]).

### Database/API

- A `notifications` tenant-settings namespace from the
  `docs/03-architecture/TENANT-SETTINGS.md` expansion convention: a registry
  entry in `apps/api/src/settings/registry.ts`, a seeded
  `notifications.settings.manage` permission, and a union-sync test.
- The namespace declares **no** `requiresFeature`, because email is ungated
  ([[DEC-058]]).
- The delivery record's `scheduled_at` and its dedupe key are [[NOTIF-001]]'s.

### Delivery

[[NOTIF-003]] owns the namespace, the schedule, the dedupe key and the
cancellation path.

## Decision

Accepted by the maintainer on 2026-10-16. **The reminder fires 24 h before the
appointment by default, configurable per tenant through a typed `notifications`
settings namespace; it is a BullMQ delayed job; it is idempotent by a dedupe key
per (appointment, channel, window); and cancelling the appointment removes the
pending job.**

The policy details this fixes, so the implementation does not invent them:

- **Lead time**: a bounded integer in hours, default **24**. The bounds are the
  registry schema's, and an out-of-range value is refused server-side rather
  than clamped silently.
- **Window**: the window is derived from the appointment's **start instant**, so
  the key is stable for one appointment start and a reschedule to a different
  instant is a **different** window — the dedupe key does not suppress a
  legitimately new reminder. Clearing the previous window's pending job needs an
  event PRD §39 does not define; that gap is recorded in [[NOTIF-003]], not
  papered over.
- **Channels**: a configured set, defaulting to `EMAIL`. `WHATSAPP` in the set
  requires the tenant's `whatsapp` grant, checked per channel value.
- **Cancellation**: admissible while the delivery is non-terminal and not
  `SENDING`, which is what makes "cancel the pending job" implementable; and the
  send path **re-reads the appointment's authoritative status**, so a cancelled
  appointment produces no reminder even if the cancellation reaction was lost.
  The read is the invariant; the event is the optimization.

## PRD Update

No PRD change. This decision implements PRD §24's requirements and PRD §38's
existing `notifications` namespace slot; it adds no scope.
