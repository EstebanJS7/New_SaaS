---
id: NOTIF-003
type: story
title: The appointment reminder and the missing emitters
epic: EPIC-17
status: planned
priority: high
depends_on:
  - NOTIF-001
  - NOTIF-002
prd_sections:
  - "24"
  - "34"
  - "36"
  - "38"
  - "39"
permissions:
  - notifications.settings.manage
branch:
created: 2026-10-17
updated: 2026-10-17
---

# NOTIF-003 — The appointment reminder and the missing emitters

## Objective

Deliver PRD §24's one hard functional requirement:

> Appointment reminders must be idempotent and cancelled if the appointment is
> cancelled.

and deliver the three events that make it possible, because none of them is
emitted anywhere today: `AppointmentConfirmed`, `AppointmentCancelled` and
`FiscalApproved`.

## Context

- The reminder fires **24 h before** the appointment by default, **configurable
  per tenant** through a typed `notifications` tenant-settings namespace
  ([[DEC-060]]).
- The delivery is a **BullMQ delayed job**: `INTERNAL-EVENTS.md` names _delayed
  execution_ as the BullMQ case, and it is one of the four conditions a
  notification meets.
- Idempotency is a **dedupe key per (appointment, channel, window)**, which is
  what makes a repeated intent — a retried command, a re-delivered job, a
  re-scheduled window — produce at most one reminder.
- `AppointmentConfirmed`, `AppointmentCancelled` and `FiscalApproved` appear in
  **zero files**. Publishing them crosses EPIC-07's confirmation/cancellation
  paths and EPIC-16's fiscal approval path; that crossing is declared as
  boundary debt in [[EPIC-17]] and recorded in [[DEC-059]].
- EPIC-07's own _Out of Scope_ deferred both the reminders and these two
  appointment events here, and the ROADMAP carries EPIC-07 as this epic's
  dependency.
- PRD §36's journey is what binds `FiscalApproved` to a notification:
  `→ fiscal approval → KuDE available → notification`.
- **A documentation drift to fix while here**:
  `docs/03-architecture/TENANT-SETTINGS.md` says `PUT /settings/:namespace`
  "declares `sales.settings.manage`". It does not.
  `apps/api/src/settings/settings.controller.ts` is authenticated-only at the
  route layer, and the per-namespace key is enforced inside
  `TenantSettingsService` — with the reasoning in the controller's own comment
  ("a static decorator cannot express a per-namespace key"). The doc is what is
  wrong; the code is what makes this Story's extension clean.

## In Scope

- The `notifications` tenant-settings namespace: registry entry, closed schema,
  defaults, `schemaVersion`, the seeded `notifications.settings.manage`
  permission key, and the union-sync test.
- The reminder's scheduling: the `SCHEDULED` delivery intent and the delayed
  job.
- The dedupe key and its per-(appointment, channel, window) semantics.
- The cancellation path: `AppointmentCancelled` removes the pending job and
  lands the delivery in a terminal, non-sendable state.
- The send-time gate: the handler re-reads the appointment's authoritative row
  before sending and refuses anything that is not sendable.
- The three emitters, published post-commit per
  `docs/03-architecture/INTERNAL-EVENTS.md`, through the in-process dispatcher
  in `packages/shared/src/events/` — its first production producer.
- The WhatsApp channel's entitlement re-check on the configured channel set.
- The `TENANT-SETTINGS.md` correction named above.

## Out of Scope

- Any HTTP route for deliveries, and the delivery permission family —
  [[NOTIF-004]].
- A tenant-editable message template.
- **`AppointmentRescheduled` does not exist in PRD §39's catalog, and this Story
  does not invent it.** See _Known Limitations_ — the gap is recorded, not
  papered over with an event nobody approved.
- Reminders for anything other than an appointment: no invoice reminder, no
  payment due, no marketing.
- A scheduling re-drive for an enqueue lost between commit and queue. Recorded
  as a limitation rather than solved by an unapproved mechanism.
- Changing EPIC-07's appointment lifecycle, its transitions or its audit rows.
  This Story adds a publish call after the existing commit, nothing else.

## Acceptance Criteria

- [ ] The `notifications` namespace is registered in
      `apps/api/src/settings/registry.ts` with a closed `z.object(...).strict()`
      schema, a `schemaVersion`, code defaults, and
      `requiredPermissionKey: "notifications.settings.manage"`; an unknown key
      is refused server-side and **nothing is persisted** on refusal.
- [ ] The namespace sets **no `requiresFeature`**, because email is ungated
      ([[DEC-058]]); the absence is deliberate and is asserted so a later edit
      cannot quietly gate the whole namespace behind a feature code.
- [ ] The defaults are the decision's: a **24 h** lead time and the `EMAIL`
      channel. Changing the lead time changes when the next reminder is
      scheduled; the change is validated server-side.
- [ ] A configured `WHATSAPP` channel requires the tenant's `whatsapp` grant,
      and a tenant without it is refused before anything is scheduled. The
      authoritative gate is re-asserted at send time regardless of what the
      setting says.
- [ ] `notifications.settings.manage` is seeded in `PERMISSION_SEEDS` and the
      union-sync test proves the key exists in the catalog; a write without the
      key is refused and a write with it is accepted.
- [ ] **Idempotency**: scheduling the same (appointment, channel, window) twice
      produces exactly one delivery and exactly one pending job, and the second
      attempt is a stable no-op rather than a new record or a new job.
- [ ] The window is derived from the appointment's start instant, so the key is
      stable for one appointment start and a **reschedule to a different instant
      is a different window** — the dedupe key does not silently suppress a
      legitimately new reminder.
- [ ] `scheduled_at` is the appointment's start minus the tenant's configured
      lead time, in UTC, and the job is enqueued **delayed** so it does not run
      early.
- [ ] **Cancelling the appointment removes the pending job**: the
      `AppointmentCancelled` reaction cancels the scheduled delivery and removes
      its job from the queue by its deterministic identity. A cancelled
      appointment's reminder never sends, and the assertion covers the record's
      state _and_ the queue's.
- [ ] The send path **re-reads the appointment's authoritative row** and refuses
      to send unless it is in a sendable status. This is defense in depth
      against a lost or delayed cancellation reaction, and it is the assertion
      that makes "a cancelled appointment is never reminded" true rather than
      likely.
- [ ] The message content is built **at send time** from the appointment's
      current row, never from a snapshot taken when the job was enqueued, so a
      reschedule before delivery cannot produce a reminder carrying a stale
      time.
- [ ] A `NO_SHOW` needs no cancellation, and the reasoning is recorded rather
      than assumed: the transition is reachable only from `CONFIRMED` or
      `ARRIVED`, both of which are at or past the appointment instant, so the
      reminder window has already closed. The send-time gate covers the
      remainder.
- [ ] A retried delivery of a job whose record is already `SENT` or `CANCELLED`
      is a no-op: no second message, no state regression.
- [ ] `AppointmentConfirmed` is published **after** the confirmation transaction
      commits, carries stable IDs and no contact datum, and a subscriber failure
      does not roll back the appointment. The non-emission asserted by EPIC-07's
      acceptance criteria is superseded by [[DEC-059]].
- [ ] `AppointmentCancelled` is published after its transaction commits, under
      the same rules.
- [ ] `FiscalApproved` is published after the fiscal approval is committed,
      under the same rules, and it is what PRD §36's post-KuDE notification
      rides on.
- [ ] `FiscalApproved` is published from **both** places a document enters
      `APPROVED` — `FiscalSubmissionHandler.persistResult` and
      `fiscal-recovery.service.ts`'s conditional update — or from one shared
      helper both call. A single publisher at one site would lose every approval
      the reconciliation sweep resolves.
- [ ] Each reaction is registered in the deployable that publishes its event,
      because the dispatcher is **in-process** and a subscriber in another
      deployable would silently never fire: the appointment reactions in `api`
      (which owns the delayed enqueue, as the fiscal producer does) and the
      post-approval reaction in `worker`.
- [ ] A tenant-aware handler: a cross-tenant identifier never resolves, and an
      event for a tenant the handler has no context for does not deliver.
- [ ] The dispatcher gains its first production producer: a repository search
      shows a `publish(...)` call in a service outside test files, and a test
      proves the emitter fires post-commit and not inside the transaction.
- [ ] Tenant isolation is enforced when applicable. Evidence: the live
      PostgreSQL cases over the delivery intent and the reminder scheduling.
- [ ] Backend authorization is enforced when applicable. Evidence: the settings
      write path's key enforcement and the deny-by-default pin for the
      `notifications.settings.manage` key.
- [ ] Required loading/error/empty/success UX exists. Evidence: not applicable
      in this Story — no UI.
- [ ] Required audit exists. Evidence: the appointment's own
      `appointment.confirmed` / `appointment.cancelled` rows are unchanged and
      no second audit row is added by the emitter; the delivery record is the
      notification's trace.
- [ ] Tests required by the Story pass.

## Domain Invariants

- One appointment start, one channel and one window produce at most one
  reminder.
- No `CANCELLED` appointment ever produces a reminder, whether the cancellation
  was observed by the event path or by the send-time re-read.
- An appointment whose status is not sendable at send time produces no reminder
  — the authoritative read beats any earlier intent.
- Scheduling never imports notifications, and notifications never reaches into
  Scheduling's repositories: the coupling is the dispatcher's typed event, which
  is what keeps EPIC-07's boundary intact while adding the emitter.
- Emitters publish only after commit, never inside the transaction, and never
  carry contact data or an aggregate dump.

## API

### Added

```text
None yet
```

### Changed

```text
None yet
```

The settings surface gains a namespace, not a route:
`PUT /settings/notifications` is the existing namespaced path.

## Database

### Migration

```text
Planned: one additive migration seeding the notifications.settings.manage permission key
```

The delivery table and its indexes belong to [[NOTIF-001]]. This Story's
migration, if the permission seed requires one, is additive and alters no
existing row.

### Models/Tables

- No new model.
- Permission seed catalog — the `notifications.settings.manage` key and its role
  matrix row.
- The `notifications` settings namespace row is data, not schema.

## UI

- None in this Story. [[NOTIF-004]] owns the surface.
- Any UI added later must consume semantic branding tokens rather than
  project-specific literals.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- The registry entry: defaults, closed schema, unknown-key refusal, tenant
  isolation, permission enforcement, and the deliberate absence of
  `requiresFeature`.
- Dedupe: the second schedule for one window is a no-op; a different window is
  not suppressed.
- The delayed job's identity, delay and payload.
- Cancellation: the record reaches its terminal state **and** the pending job is
  gone from the queue.
- The send-time gate: a `CANCELLED` appointment produces no message even when a
  pending job survives.
- Content freshness: a reschedule before delivery produces a message with the
  current time.
- The emitters: published post-commit, tenant-aware, payload free of contact
  data.

## Known Limitations

- **`AppointmentRescheduled` is not in PRD §39's catalog and is not invented
  here.** A reschedule therefore leaves the _previous_ window's pending job in
  place. The damage is bounded rather than eliminated: the send-time content
  read means the recipient gets the current time, and a reminder for a moved
  appointment is at worst duplicated, never wrong. Clearing the old window needs
  either a catalog change (a maintainer decision, since PRD §39 lists the
  events) or a rescheduling hook the catalog would otherwise make unnecessary.
  Recorded for triage at [[NOTIF-005]].
- **An enqueue lost between commit and the queue is not re-driven.** The
  send-time gate prevents a wrong send; it cannot conjure a reminder that was
  never enqueued. A scheduling re-drive would be its own unit, and the fiscal
  epic's [[TD-029]] is the precedent for not inventing one locally.
- A reminder is a fixed transactional message; there is no tenant-editable copy.

## Technical Debt

- None yet; the reschedule gap above and anything raised by the implementation
  are recorded here and triaged at [[NOTIF-005]].

## Decisions / ADRs

- [[DEC-059]] — the scope decision: this epic publishes the three emitters, and
  the crossings are boundary debt.
- [[DEC-060]] — the reminder's policy: 24 h configurable, the dedupe key, and
  the cancellation requirement.
- [[ADR-003]] — the minimal internal-events mechanism the emitters use. No new
  ADR: this Story uses the approved dispatcher and the approved queue, and adds
  no broker, runtime or abstraction.

## Files / Modules

- `apps/api/src/settings/registry.ts` — the `notifications` namespace entry.
- `packages/database/src/reference-seed.ts` — the permission key.
- `apps/api/src/scheduling/appointment.service.ts` — the two post-commit
  publishes after the existing commit (the boundary crossing, emitter-only).
- The fiscal approval path — the `FiscalApproved` publish, emitter-only, from
  **both** sites that enter `APPROVED`:
  `apps/worker/src/fiscal-submission/fiscal-submission.handler.ts` and
  `apps/worker/src/fiscal-submission/fiscal-recovery.service.ts`.
- `packages/shared/src/events/` — the dispatcher, used for the first time in
  production.
- `apps/worker/src/notification-delivery/` — the reminder scheduling, the
  cancellation reaction and the send-time gate.
- `docs/03-architecture/TENANT-SETTINGS.md` — the drift correction.

## Completion Notes

_Status must remain non-done until all required gates pass._
