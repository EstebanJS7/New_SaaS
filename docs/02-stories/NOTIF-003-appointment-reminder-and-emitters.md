---
id: NOTIF-003
type: story
title: The appointment reminder and the missing emitters
epic: EPIC-17
status: in-progress
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

**WU-D1 (the policy and the settings namespace) is implemented. WU-D2 (the
emitters and the scheduler) and WU-D3 (the content builder) are not**, which is
why this Story is `in-progress`.

Landed:

- **`packages/notifications/src/reminder.policy.ts`** — the policy as pure
  functions: the lead time's bounds (`1..168` hours, default 24) and the default
  channel set, `reminderWindowKey` (the start instant truncated to the minute),
  `reminderDedupeKey` (`appointment:<id>:<channel>:<window>`),
  `reminderScheduledAt` and `isReminderOverdue`. Pure so the setting, the
  scheduler and the cancellation path derive the SAME key from the same inputs
  rather than each building one, and so the arithmetic is testable without a
  database, a queue or a clock.
- **The `notifications` settings namespace** — a closed schema, `version: 1`, a
  24 h default, the channel set defaulting to `EMAIL` alone, and **no
  `requiresFeature`** because email is ungated ([[DEC-058]]). Its bounds and
  default are imported from the package rather than repeated in the registry, so
  a schema that accepted a lead time the scheduler would refuse cannot exist.
  The channel list is deduplicated by the schema because the dedupe key includes
  the channel.
- **`notifications.settings.manage`** seeded and granted to OWNER and ADMIN,
  like every other `*.settings.manage` key.
- **`docs/03-architecture/TENANT-SETTINGS.md`** brought current: the
  `notifications` section, and three drift fixes — the
  `PUT /settings/:namespace` claim (it said the route declares
  `sales.settings.manage`; the route is authenticated-only and the per-namespace
  key is enforced in the service), the "v1 ships exactly one namespace" line
  (four ship now), and the reminder-policy pointer.

### Where the value-level WhatsApp gate lives

The namespace validates SHAPE only, and that is a decision rather than an
omission: a value-level entitlement check is not expressible through
`requiresFeature`, and adding a hook to the shared settings service to express
it would change a reviewed contract for one namespace's convenience. The gate is
therefore enforced **per channel value at the scheduling boundary** (WU-D2,
where the entitlement read already exists) and **again at the send path**, which
[[DEC-058]] names as the authoritative one. A tenant can therefore _configure_ a
channel it is not entitled to; nothing is scheduled for it, and nothing is sent.

### The WU-D1 review

`review-1e2d96c3a65e27b4` (medium tier, one lens) **approved WU-D1 on the first
pass** with one SUGGESTION: `reminderScheduledAt` validates the lead time's
floor and its integrality but not the ceiling the same module exports, so a
caller passing a very large lead would get a silently wrong date. The settings
schema refuses such a value, which is why nothing reachable mishandles it yet —
the guard is missing from the boundary that should be self-contained. Recorded
as [[TD-043]] and fixed in WU-D2, which consumes this policy from the scheduler.

### WU-D2 — the emitters, the scheduling and the cancellation, landed

- **`apps/api/src/events/application-events.module.ts`** — the in-process
  dispatcher as an `@Global` provider. `packages/shared` ships the factory and
  no Nest module, so each deployable composes its own, which is also the only
  correct shape: the dispatcher is in-process, so a reaction only observes an
  event published by its own deployable ([[DEC-059]]).
- **The emitters, in `AppointmentService`** — `AppointmentConfirmed` and
  `AppointmentCancelled`, published **after** the transition's transaction
  commits. The payload carries ids only and the subscriber re-reads the row,
  because a payload built from the emit-time snapshot would let a reschedule
  schedule a reminder for an instant the appointment no longer has. Only the two
  commands a subscriber exists for publish: `INTERNAL-EVENTS.md` forbids an
  event with no consumer, and the other four transitions (including `no-show`,
  whose reminder window has already closed) publish nothing.
- **`notification-reminder.scheduler.ts`** — the first production subscriber.
  Confirmation schedules one intent per configured channel, dedupe-keyed by
  (appointment, channel, window), with the delayed job; cancellation CASes each
  pending row to `CANCELLED` with its own accounting and then removes the job.
  The order is the point in both directions: the row is written **before** the
  enqueue (so a lost enqueue leaves a diagnosable `SCHEDULED` row rather than a
  job pointing at nothing) and the job is removed **after** the row is cancelled
  and only by the caller that won the compare-and-swap.
- **The per-VALUE WhatsApp gate** ([[DEC-058]]): a channel the tenant is not
  entitled to is refused **before** anything is scheduled, so an unentitled
  tenant never has a pending WhatsApp reminder at all. Email never asks.
- **`notification-delivery.producer.ts`** — the BullMQ producer, the fiscal
  producer's shape (port, fail-fast Redis options, a two-second deadline) plus
  the one capability a delayed reminder needs: `cancel`, which is idempotent by
  contract because the row is the record of the cancellation.
- **[[TD-043]] closed**: `reminderScheduledAt` now enforces the ceiling it
  exports.
- **`FiscalApproved` is deliberately NOT published yet**, and that is a recorded
  deviation about ORDER, not substance: its subscriber is the fiscal notice,
  which is WU-D3's, and publishing an event before its consumer exists is
  exactly what `INTERNAL-EVENTS.md` forbids. [[DEC-059]] still decides that this
  epic publishes it, and it does so with the notice.

### The WU-D2 review escalated, and what the validator caught

`review-5898fbf624566375` was **high risk** (22 files, 1599 lines) and ran
**four lenses**. It closed `correction_required` on two CRITICALs, both mine,
both real in the shape they describe:

- **R4-CANCEL-SWALLOW** (deterministic): `cancel()` attached an unconditional
  `.catch()`, so this port's own deadline and a Redis failure were
  indistinguishable from "the job was already gone". The consequence it claimed
  — a deliverable reminder after a cancellation — is **wrong, and that is
  measured rather than argued**: the handler returns early for a settled row and
  its own case asserts it, so the row's status is the guarantee. What the
  swallow cost was a lingering job nobody could see.
- **R3-001** (inferential): the create and the enqueue are two steps, so a
  cancellation can interleave between them.

The first correction removed the swallow and added a compensation, and the
**targeted validator then REJECTED it** with three findings, all legitimate:

1. a removal failure **rejected the whole reaction**, so a failure on one
   channel left the remaining channels unprocessed — a regression the correction
   itself introduced;
2. the failure report carried the driver's **message**, which is where a
   connection URL with a password lives;
3. the compensation closed one interleaving and **missed the wider one**: a
   cancellation that ran _before_ the intent existed found nothing to cancel
   while the reaction still held the appointment as `CONFIRMED` from its earlier
   read.

The lineage then **escalated and stopped** (`native_stop_required`): a
lifecycle-level stop that only the maintainer can resolve. The three findings
are fixed in a follow-up unit — one **total** cancellation helper shared by the
reaction and the compensation (it never throws, and reports the error's NAME
rather than its text), and an `isStillSchedulable` re-read of the
**appointment** before and after the enqueue, which is the authority for whether
a reminder may exist at all. The residual window between that read and the
enqueue is closed by the send-time gate still pending in WU-D3.

**The lesson is the one the previous round taught, one level up**: a correction
validated against the finding it closes can still introduce a regression, and
this one did — it is worth reviewing the fix, not only the defect.

### The fix's own review, and what it caught on the fix

`review-27c3b70cd8046dfd` (medium, one lens) reviewed **the fix** in a fresh
transaction — the stopped lineage cannot host one — and closed
`correction_required` on **two more CRITICALs, both deterministic and both
correct**, both about the helper the previous correction had introduced:

- **R3-002**: the removal depended on winning the compare-and-swap, which broke
  the post-enqueue compensation exactly where it was needed. A cancellation that
  landed between the pre-check and the enqueue has **already** cancelled the
  row, so this caller's CAS lost and the job it had just enqueued was left
  orphaned — the very lingering job the compensation exists to close. The
  removal is not the cancellation, and `queue.remove` is idempotent.
- **R3-001**: the row write and the removal shared one `try`, so a database
  failure logged and returned without touching the job.

Both fixed by making the two halves independent and total. A case that **used to
assert the opposite** ("does not remove a job it did not cancel") now documents
why that assertion encoded the defect. The correction passed the targeted
validator on both criteria, and it left one follow-up — a comment on
`onCancelled` that still described the old conditional removal — which is
corrected here.

**Two rounds, four CRITICALs, all four on this one cancellation path**: the
first round found the defect, the second found the defect in the fix for it. The
lesson is not that the reviews are noisy; it is that this path is where the
concurrency lives, and that reviewing the fix caught a regression and a broken
compensation that no test had been written to notice.

### The Core/Veterinary boundary this unit hit, and how it was resolved

The reminder's recipient is the patient's responsible customer, and the link
that makes a customer responsible for a patient is **Veterinary**-owned
(EPIC-05). `notifications` is a **Core** capability (PRD §34), and the
repository's boundary suite refuses to let any source file outside
`apps/api/src/patients/**` name that aggregate — it caught this unit's first
version, which read it directly.

The rule is right, and the resolution is inversion rather than an exemption:

- **Core declares the question**
  (`notifications/appointment-recipient.port.ts`), with a fail-closed default
  that resolves nobody: a reminder sent to the wrong customer would be worse
  than one not sent.
- **Veterinary answers it** (`patients/patient-guardian.recipient.ts`), because
  that is the only place the aggregate may be named.
- **The composition root binds them** (`app.module.ts`), which is the one place
  allowed to know both, exactly as `FiscalProviderModule.forRoot` takes a
  substitutable credential port.

So Core never imports Veterinary, Veterinary orchestrates a Core capability, and
the boundary suite keeps it that way. Two details are part of the fix rather
than incidental: the port's own comment **describes** the aggregate instead of
naming it, and the factory that implements it is named for what it returns
(`createResponsibleCustomerRecipientPort`) so importing it does not carry the
aggregate's identifier into a Core file.

**The test harness had to learn the aggregate too.** `boot-test-app` boots the
real `AppModule`, so the real subscriber runs: the in-memory Prisma now models
`notification_delivery`, **including its `(tenant_id, dedupe_key)` uniqueness**,
because a harness that let a duplicate through would hide the idempotency the
scheduler depends on.

### WU-D3 (first half) — the real content builder and the send-time gate

The seam that failed closed is now a real builder, and its read is also the gate
[[DEC-060]] relies on:

- **It reads the delivery, then the SOURCE, at send time.** For an appointment
  it re-reads the appointment's current status and refuses anything that is not
  `CONFIRMED` or `ARRIVED` — so a cancelled appointment produces no reminder
  whether or not the cancellation event ever arrived. That read is the
  invariant; the event is the optimisation, and it is also what closes the
  residual interleaving window the fix's own review named. For a fiscal document
  the same discipline: only `APPROVED` is notifiable, read now rather than
  trusted from the event that scheduled the intent.
- **The message is built here, never stored.** A delivery holds references only,
  so a reschedule before the reminder fires cannot send a stale time.
- **It renders in the tenant's timezone, in 24 hours.** The zone comes from the
  shared kernel (`TENANT_TIME_ZONE`), which the API's scheduling module now
  re-exports instead of owning a copy — the worker cannot import an API module,
  and two literals would let the two deployables disagree about which local time
  an appointment has. The clock is explicit because `es-PY`'s own default is
  12-hour: a reminder whose time can be misread by twelve hours is worse than
  one that reads slightly less naturally.
- **It reads no Veterinary aggregate.** An appointment's patient is Veterinary,
  so the message names the **branch** and the instant and not the patient: a
  Core builder naming a patient would cross the boundary the recipient port
  exists to respect. Recorded as a limitation, with the port option named,
  rather than worked around.
- **Both sources are built**: the appointment reminder, and the post-approval
  fiscal notice PRD §36's journey ends a step with, naming the invoice's
  allocated series and number (an unallocated document cannot be named, so it is
  not announced).

The review of this half (`review-0c34f0614742a5a3`, medium, one lens) **approved
it on the first pass** with three non-blocking advisories, recorded as
[[TD-044]]: the 24-hour option's locale-dependent resolution (measured, and it
does not reproduce here), a fail-open ternary dispatch that a third source type
would land in the fiscal branch, and a redundant conditional assertion. Its
first two are cheap and are folded into the rest of WU-D3.

The fiscal notice's **emitters and subscriber** are the other half of WU-D3 and
remain pending: publishing `FiscalApproved` from both worker write paths, and
the subscriber that creates the intent for the invoice's customer.

### WU-D3, still pending

WU-D2: the three emitters (`AppointmentConfirmed` and `AppointmentCancelled` in
the API process, `FiscalApproved` from **both** worker write paths), the
subscribers that create and cancel the delivery intent and enqueue/remove the
delayed job, and the send-time appointment gate. WU-D3: the real content builder
that replaces the seam which fails closed today.

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
