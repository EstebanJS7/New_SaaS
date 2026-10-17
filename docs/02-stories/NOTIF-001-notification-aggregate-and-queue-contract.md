---
id: NOTIF-001
type: story
title: The notification aggregate and the queue contract
epic: EPIC-17
status: planned
priority: high
depends_on: []
prd_sections:
  - "24"
  - "39"
  - "41"
permissions: []
branch:
created: 2026-10-17
updated: 2026-10-17
---

# NOTIF-001 — The notification aggregate and the queue contract

## Objective

Persist what a notification _is_ before any channel can send one: a
tenant-scoped delivery record with an explicit lifecycle, a dedupe key that
makes a repeated intent idempotent, a `scheduled_at` that makes a delayed
reminder cancellable, and a queue contract whose job identity is deterministic —
so the path that cancels an appointment can find and remove the pending job.

Everything this epic does afterwards hangs on this aggregate. It is deliberately
the epic's first work unit.

## Context

No notification delivery record exists anywhere in `apps` or `packages` today:
no table, no service, no queue, no template. This Story creates the persistence
and the queue contract, and nothing else — it sends no message and exposes no
route.

The pattern to copy is proven twice and is named in the ROADMAP as the shape:
`apps/worker/src/fiscal-submission/` and
`apps/worker/src/branding-reset-cleanup/` — a BullMQ consumer, a handler, and a
reconciliation sweep. This Story mirrors the first.

`docs/03-architecture/INTERNAL-EVENTS.md` is what selects BullMQ here rather
than the in-process dispatcher: a notification needs an **external network
call**, **retry**, **delayed execution** and **durable asynchronous
processing**. That is all four of the conditions it lists.

## In Scope

- The `notification_delivery` table and its migration.
- The lifecycle: named statuses, a transition guard, and the write paths that
  respect it.
- The dedupe key and its uniqueness constraint.
- `scheduled_at`, and the delayed-job contract that reads it.
- The queue name, the job name, the job payload shape (stable IDs only), the
  deterministic job identity, the retry budget and the backoff.
- The producer helper that enqueues one delivery.
- The worker consumer registered in `apps/worker`, with no handler logic beyond
  the claim (the channels arrive in [[NOTIF-002]], the reminder in
  [[NOTIF-003]]).
- Tenant-scoped persistence with its isolation coverage.

## Out of Scope

- Any channel, adapter or message content — [[NOTIF-002]].
- The reminder's schedule, its settings namespace, its cancellation path, and
  the three emitters — [[NOTIF-003]].
- Any HTTP route, any permission, any UI — [[NOTIF-004]].
- A manual re-drive of a `FAILED` delivery. BullMQ's attempts and backoff carry
  the automatic path; an operator-triggered re-drive needs a primitive this
  Story does not have. Recorded as a known limitation, and the fiscal epic's
  [[TD-029]] is the precedent for not inventing one locally.
- A reconciliation sweep. Unlike a fiscal submission, a notification has no
  remote state to reconcile; a delivery that exhausts its attempts is `FAILED`
  and the record says so.
- Payload content, templates or tenant-editable copy.
- A generic `PATCH status=…` route — never, per `ENGINEERING-RULES.md`'s
  explicit-state-transition rule.

## Acceptance Criteria

- [ ] `notification_delivery` is tenant-scoped: every read and write is
      tenant-predicated, a foreign or unknown UUID is indistinguishable from an
      absent one at any surface that later consumes it, and the ownership key
      `@@unique([tenantId, id])` exists.
- [ ] The dedupe key is unique per tenant, and inserting a second row for the
      same key is refused by the database rather than by application
      cooperation. A partial unique index is the guard for keys that are
      released by a terminal state, if the design needs one — the
      `invoice`/`fiscal_document` partial-index precedent.
- [ ] The status set is explicit and the guard is enforced: an illegal edge
      changes nothing and reports a stable domain error code; a terminal status
      is terminal.
- [ ] Cancellation is admissible from every non-terminal, non-sending status,
      which is what makes [[NOTIF-003]]'s requirement implementable; once a
      delivery is `SENDING` the guard refuses to cancel it, and that refusal is
      tested rather than assumed.
- [ ] `scheduled_at` is persisted in UTC, and a delivery whose `scheduled_at` is
      in the future is enqueued as a **delayed** BullMQ job, not as an immediate
      one.
- [ ] The job identity is deterministic and derived from a stable identifier, so
      a second enqueue of the same intent dedupes in the queue and the
      cancelling path can address exactly the pending job.
- [ ] The job payload carries stable identifiers only: no recipient contact
      datum, no message body, no aggregate dump.
- [ ] Retry is bounded and exponential, and the database row — not the queue's
      failed set — is the record of failure.
- [ ] The worker registers the consumer for exactly this queue and exposes the
      handler through DI, and a delivery for a status the guard does not admit
      is a no-op rather than a crash.
- [ ] Tenant isolation is enforced when applicable. Evidence: the live
      PostgreSQL isolation cases over the new aggregate.
- [ ] Backend authorization is enforced when applicable. Evidence: not
      applicable in this Story — no route is added; [[NOTIF-004]] owns the
      surface and its permissions.
- [ ] Required loading/error/empty/success UX exists. Evidence: not applicable
      in this Story — no UI.
- [ ] Required audit exists. Evidence: not applicable — PRD §27's list of
      critical audited actions does not include a notification delivery, and the
      delivery record is its own trace. This is stated rather than left silent
      so the omission reads as a decision.
- [ ] Tests required by the Story pass. Evidence: the unit suite for the guard
      and the dedupe key, and the live-PostgreSQL block.

## Domain Invariants

- One logical notification intent produces at most one delivery row per (dedupe
  key), per tenant.
- A status only moves along the guard's edges; no code path writes a status
  outside the guard.
- A `SENT` or `CANCELLED` delivery is never re-sent and never re-scheduled.
- The record holds references, never content: recipient contact data lives
  behind the channel boundary ([[NOTIF-002]]) and is classified **RESTRICTED**.

## API

### Added

```text
None yet
```

### Changed

```text
None yet
```

## Database

### Migration

```text
Planned: one additive migration creating notification_delivery
```

Additive only: it creates one table with its enum, its constraints and its
indexes, and it rewrites no existing migration and alters no existing table. The
timestamp and directory name are assigned when the Story opens against the then
current `packages/database/prisma/migrations/` order.

### Models/Tables

- `NotificationDelivery` (table `notification_delivery`) — the tenant-scoped
  record: `channel`, `status`, `dedupe_key`, `scheduled_at`, `attempt_count`,
  `last_attempt_at`, `last_error_code`, `last_error_message`, the source
  reference (a stable type + id pair, e.g. an appointment or a fiscal document),
  the recipient reference (an identifier the channel boundary resolves to
  RESTRICTED contact data — never the datum itself), terminal timestamps, and
  `created_at` / `updated_at`.

| Guarantee              | Planned shape                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| Tenant scope           | RESTRICT tenant FK plus an `@@unique([tenantId, id])` ownership key                              |
| Idempotent intent      | `UNIQUE (tenant_id, dedupe_key)`, or a partial variant when a cancelled row must release its key |
| Explicit lifecycle     | An enum plus a guard; a CHECK or trigger rejects an out-of-band status write                     |
| Cancellable reminder   | `scheduled_at` NOT NULL for a scheduled delivery, and a terminal `CANCELLED`                     |
| No secrets in payloads | Column set only; no content, no contact datum                                                    |
| Durable failure record | `attempt_count`, `last_attempt_at`, bounded `last_error_code` / `last_error_message`             |

## Queue

```text
Queue:  notification-delivery
Job:    deliver
Job id: deterministic, derived from the delivery's stable identity
Payload: { notificationDeliveryId, tenantId } — stable ids only
Retry:  bounded attempts with exponential backoff
```

The reasoning mirrors `packages/fiscal/src/fiscal-submission.queue.ts`
([[DEC-049]]): the deterministic job identity makes queue dedupe and the
database's uniqueness constraint agree on what "the same logical request" means,
and `removeOnFail` stays false so a human inspecting the queue sees the attempt
the database already recorded.

## UI

- None. This Story adds no surface.
- If any UI is added later in this epic, it must consume semantic branding
  tokens rather than project-specific literals.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- The transition guard's legal and refused edges.
- The dedupe key's uniqueness, including the second-insert refusal.
- The delayed enqueue: a future `scheduled_at` produces a delayed job with the
  deterministic identity and a payload free of contact data.
- The handler's no-op on a status the guard does not admit.
- Live-PostgreSQL tenant isolation over the new aggregate.

## Known Limitations

- No manual re-drive of a `FAILED` delivery.
- No reconciliation sweep, because there is no remote state to reconcile.
- The cancellation path is implemented in [[NOTIF-003]]; this Story only makes
  it addressable.

## Technical Debt

- None yet; anything raised by the implementation is recorded here and triaged
  at [[NOTIF-005]].

## Decisions / ADRs

- [[DEC-060]] — the reminder's policy, its dedupe key and its cancellation
  requirement shape this aggregate's `scheduled_at` and status set.
- [[DEC-061]] — the channel boundary. This Story must not resolve contact data;
  it stores a reference only.
- No new ADR: BullMQ is the approved queue technology and this adds no runtime,
  broker or ORM.

## Files / Modules

- `packages/database/prisma/schema.prisma` and the new migration.
- `packages/notifications/` (new package) — the aggregate's types, the queue
  constants and the job contract. _Placement is confirmed against the existing
  package layout when the Story opens; the fiscal precedent puts the queue
  contract in the domain package and the consumer in `apps/worker`._
- `apps/worker/src/notification-delivery/` — the consumer.
- `apps/worker/src/app.module.ts` — the consumer's registration.

## Completion Notes

_Status must remain non-done until all required gates pass._
