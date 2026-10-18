---
id: EPIC-17
type: epic
title: Notifications
status: in-progress
priority: high
depends_on:
  - EPIC-07
prd_sections:
  - "10"
  - "24"
  - "34"
  - "36"
  - "38"
  - "39"
  - "41"
created: 2026-10-17
updated: 2026-10-17
---

# EPIC-17 — Notifications

## Objective

Give the platform a notification capability it does not have today in any form:
a tenant-scoped delivery record, two channels (`EMAIL`, `WHATSAPP`) behind a
single provider boundary, and the appointment reminder PRD §24 requires.

The epic's single hard functional requirement is PRD §24's sentence:

> Appointment reminders must be idempotent and cancelled if the appointment is
> cancelled.

The epic is also the first epic that gives `packages/shared/src/events/` a
**production producer**. That dispatcher (`createEventDispatcher`,
`ApplicationEvent`, `ApplicationEventHandler`) exists and is tested, and has
**no caller**: every `SaleCompleted` / `InvoiceConfirmed` reference in the
repository is inside `dispatcher.test.ts`. No catalog event is emitted by any
service today. Publishing the three emitters this epic needs is therefore not an
incidental detail — it is what turns [[ADR-003]]'s mechanism from a tested
abstraction into a used one.

## Scope

- **The notification aggregate** — a tenant-scoped record of one intended
  delivery: its channel, its recipient reference, its status, its attempts, its
  dedupe key and its `scheduled_at`, with sanitized payload references and no
  payload dump.
- **The queue contract** — a BullMQ queue name, a deterministic job identity and
  a lifecycle guard over the record's statuses, mirroring the proven
  `apps/worker/src/fiscal-submission/` shape.
- **The channel port** — `EMAIL` and `WHATSAPP` behind one boundary, with a
  deterministic fake and the real adapters behind it, selected fail-closed in
  production exactly as `FISCAL_PROVIDER` already is (a pattern proven twice, in
  EPIC-15 and EPIC-16).
- **The appointment reminder** — a delayed job scheduled 24 h before the
  appointment, tenant-configurable, idempotent by a dedupe key per (appointment,
  channel, window), and **removed when the appointment is cancelled**.
- **The three missing emitters** — `AppointmentConfirmed`,
  `AppointmentCancelled` and `FiscalApproved`, published post-commit per
  `docs/03-architecture/INTERNAL-EVENTS.md`. None of the three appears in any
  file today.
- **The typed `notifications` tenant-settings namespace** — schema, defaults,
  `schemaVersion`, server-side validation, unknown keys rejected, per
  `docs/03-architecture/TENANT-SETTINGS.md` and its expansion convention.
- **The transactional surface** — the tenant's view of a delivery's status and
  history, plus the `notifications.*` permission family.

## Boundary debt (declared, not accidental)

Publishing the three emitters means editing the surfaces of **two closed
epics**. This is deliberate, and it is recorded here rather than discovered in a
diff:

- **EPIC-07 (Scheduling) — the confirmation and cancellation paths.** EPIC-07's
  own _Out of Scope_ reads: "Recurring appointments/blocks, **reminders**, and
  internal appointment events (`AppointmentConfirmed`/`AppointmentCancelled` are
  intentionally not emitted)". So EPIC-07 declined these events on purpose and
  the ROADMAP carries EPIC-07 as this epic's dependency. Emitting them here is
  the dependency being exercised, not a reopened scope.
- **EPIC-16 (SIFEN Direct) — the fiscal approval path.** `FiscalApproved` has no
  producer. PRD §36's journey places `→ notification` immediately after
  `→ KuDE available`, so the post-approval notification needs an event the
  closed fiscal epic never emitted.

Both crossings are **emitter additions only**: a post-commit publish after the
existing authoritative transaction commits. The crossing does not reopen either
epic's decisions, does not change either epic's transactional invariants, and
does not move logic out of the transactions that own it — which is exactly what
`INTERNAL-EVENTS.md` requires of a handler's failure ("does not roll back the
already committed sale/appointment/etc.").

### Two properties of the mechanism, recorded because neither is obvious

Read from the code rather than assumed, and both are load-bearing for the
implementation ([[DEC-059]]):

1. **The dispatcher is in-process, so a subscriber must live where the event is
   published.** `createEventDispatcher`'s own documentation says it "does not
   cross process boundaries". The appointment events are published in `api`, so
   the reminder's scheduling reaction is registered in `api` — which enqueues
   the delayed job, exactly as the fiscal producer does. `FiscalApproved` is
   published in `worker`, where the fiscal handler and the recovery service run,
   so the post-approval reaction is registered in `worker`. A subscriber
   registered in the wrong deployable would silently never fire.
2. **`APPROVED` has two writers, and `FiscalApproved` must be published from
   both.** A fiscal document enters `APPROVED` in
   `FiscalSubmissionHandler.persistResult` _and_ in
   `apps/worker/src/fiscal-submission/fiscal-recovery.service.ts`'s conditional
   update. Publishing from only one site would silently lose every approval
   resolved by the reconciliation sweep, so the emitter comes from both paths or
   from one shared helper both call.

## Out of Scope

- **A thirteenth feature code.** PRD §10 fixes the twelve; the epic uses the
  existing `whatsapp` code and gates nothing else. See [[DEC-058]].
- **Marketing or bulk messaging.** PRD §24: MVP WhatsApp is **transactional
  only**.
- **A second notification module per channel.** The second channel is a provider
  behind one port, not a second domain.
- **A distributed broker, an external producer or a generic event bus.** PRD §39
  and [[ADR-003]] forbid it; a broad cross-domain bus would need an ADR under
  the Complexity Budget.
- **Templates as a product surface.** The epic sends a defined transactional
  message; a tenant-editable template editor is not in it.
- **In-app / realtime notifications, push, SMS.** Not in PRD §24.
- **Reports and dashboards over deliveries** — [[EPIC-18]].
- **The password-reset flow itself** — [[TD-004]] stays blocked on this epic's
  email delivery and is not implemented here.
- **New deployables.** Notifications live in the existing `api` and `worker`.

## Acceptance Criteria

- [ ] A tenant-scoped notification aggregate exists with an explicit lifecycle,
      and no generic status-update route: transitions move through named
      commands, and an illegal or terminal edge returns `409 CONFLICT` with
      state unchanged.
- [ ] The reminder is **idempotent**: a second scheduling attempt for the same
      (appointment, channel, window) does not produce a second delivery.
- [ ] **Cancelling the appointment removes the pending reminder** — the pending
      job is removed, and the record reaches a terminal, non-sendable state.
      This is PRD §24's hard requirement and the epic's primary exit gate.
- [ ] `EMAIL` and `WHATSAPP` are reached only through the channel port, and the
      selection is fail-closed in production exactly as `FISCAL_PROVIDER` is: a
      closed set of accepted values, an unknown value refused **by name**, an
      absent value refused in production, and **no silent fallback to the
      fake**. The fake stays selectable when an operator types it on purpose,
      which is the documented demo path — the refusal is about absence, not
      about the fake.
- [ ] The recipient's contact data is classified **RESTRICTED**, is never
      logged, and never appears in an API response body or a job payload.
- [ ] `AppointmentConfirmed`, `AppointmentCancelled` and `FiscalApproved` are
      published **after** their originating transaction commits, and a handler
      failure does not roll back the appointment, the invoice or the fiscal
      document.
- [ ] Each reaction is registered in the deployable that publishes its event,
      because the dispatcher is in-process; and `FiscalApproved` is published
      from **both** paths that enter `APPROVED` — the submission handler and the
      recovery service — so the sweep's approvals are not lost.
- [ ] Every notification handler is tenant-aware and idempotent under a retried
      delivery.
- [ ] The `notifications` tenant-settings namespace is registered, typed and
      versioned, rejects unknown keys server-side, defaults the reminder lead
      time to 24 h, and is writable only behind its permission key.
- [ ] Every route enforces a `notifications.*` permission and the service
      re-asserts it as defense in depth.
- [ ] Tenant isolation is enforced on every new aggregate and every new read;
      cross-tenant UUID access returns `404`.
- [ ] DTOs are allowlisted, and `notifications` is treated as a **Core**
      capability: no Veterinary import reaches into it and it imports no
      Veterinary detail.
- [ ] The production adapters are proven against a real provider, **or the live
      run is recorded as pending and named**, with the deterministic fake
      carrying the test evidence — the FISC-013 precedent.
- [ ] EPIC-17 exits with required checks green or explicit non-green evidence
      recorded.

## Stories

| Story     | Scope                                                                                                                                                                                                                                                                          | Depends on           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| NOTIF-001 | **The aggregate and the queue contract** — the tenant-scoped table (status, attempts, dedupe key, `scheduled_at`, sanitized payload refs), its migration, the lifecycle guard, the queue name and the deterministic job identity. Mirrors `apps/worker/src/fiscal-submission/` | —                    |
| NOTIF-002 | **The channel port** — `EMAIL` and `WHATSAPP` behind one boundary, a deterministic fake, the real adapters, fail-closed production selection, and the recipient's contact data as RESTRICTED. **The email library's ADR is this Story's gate**                                 | NOTIF-001            |
| NOTIF-003 | **The appointment reminder** — the delayed job, the typed setting, the idempotency key, the cancellation path, and the three missing emitters ([[DEC-059]])                                                                                                                    | NOTIF-001, NOTIF-002 |
| NOTIF-004 | **The transactional surface and the permissions family** — the delivery's status and history for the tenant, and the `notifications.*` permission family                                                                                                                       | NOTIF-001, NOTIF-003 |
| NOTIF-005 | **Epic closure** — module doc, CI evidence, changelog, roadmap, advisory triage                                                                                                                                                                                                | all                  |

Story numbering uses the `NOTIF-` prefix, which is new and stable; EPIC-17 is
its first user.

**Landed**: [[NOTIF-001]] (WU-B) is `done` on 2026-10-17 — the aggregate, the
migration with its four guards, and the queue contract. Its evidence, its local
gates and its live PostgreSQL run are recorded in the Story. Two shape changes
came out of building it rather than out of planning it: the "payload refs"
column was dropped as an abstraction with no consumer, and the worker consumer
plus the delivery handler moved to [[NOTIF-002]] because a claim with nothing to
send cannot be a unit.

**The review found one CRITICAL, and it was the kind no local gate can reach.**
`review-2ab7f3074e541ccd` (medium tier, one lens) rejected the queue contract's
job identity, because BullMQ refuses a custom job id containing `:` and the id
had copied the fiscal boundary's `fiscal-submit:<id>` shape. It was measured
against `bullmq@5.81.3` with a real Redis, corrected, and the corrected
candidate was validated. The same review exposed **[[TD-039]]**: the fiscal
boundary still carries that id, so the fiscal producer's enqueue throws in
production, and its unit test asserts the wrong literal against a mocked `Queue`
— which is why `main`'s CI is green over a production blocker. **TD-039 is open,
and it is the most valuable thing this session found.**

## Dependencies

- [[EPIC-07]] — the appointment's confirmation and cancellation paths this epic
  adds emitters to. The ROADMAP carries it as this epic's dependency, and
  EPIC-07's own _Out of Scope_ deferred both the reminders and the internal
  appointment events to here.
- [[EPIC-02]] — the RBAC, Entitlements and Tenant Settings machinery the
  `notifications` namespace and the permission family extend.
- [[EPIC-16]] — the fiscal path `FiscalApproved` is published from. Completed;
  the crossing is emitter-only boundary debt, declared above.
- **An operator's provider credentials** (an SMTP or email-provider key; a
  WhatsApp Business account) before a live delivery can be run. Without them the
  run is recorded pending — the FISC-013 precedent.

## Exit Criteria

- [ ] Lint/typecheck/tests/build required for the epic are green.
- [ ] The live-PostgreSQL gate covers every new aggregate, guard and constraint.
- [ ] Documentation is current: `docs/05-modules/Notifications.md`, the module
      index, CI evidence, changelog and roadmap.
- [ ] The live-delivery outcome is recorded, **including a pending result**.
- [ ] No contact datum is reachable from a log, a job payload, an API response
      or a repository file.
- [ ] Every new dependency is covered by an accepted ADR.

## Decisions / ADRs

1. **Email ungated, WhatsApp behind the existing `whatsapp` code — [[DEC-058]]
   (accepted).** PRD §10 fixes the twelve feature codes, `whatsapp` is already
   seeded in `packages/database/src/reference-seed.ts` and mapped to the starter
   plan, so email is not gated at all and **no thirteenth code is added**. A
   thirteenth would be a PRD change and a maintainer decision.
2. **Scope: this epic publishes the three missing emitters — [[DEC-059]]
   (accepted).** `AppointmentConfirmed`, `AppointmentCancelled` and
   `FiscalApproved` appear in zero files. Publishing them crosses EPIC-07's and
   EPIC-16's surfaces, which is why the boundary-debt section above exists.
3. **The reminder fires 24 h before, configurable per tenant — [[DEC-060]]
   (accepted).** A typed `notifications` settings namespace with a 24 h default,
   a BullMQ delayed job, idempotency by a dedupe key per (appointment, channel,
   window), and a cancellation that removes the pending job.
4. **The channel boundary ships complete: port + deterministic fake + real
   adapters, live run recorded pending — [[DEC-061]] (accepted).** The
   FISC-012/FISC-013 precedent.
5. **The email library requires an ADR — proposed, and the gate for
   [[NOTIF-002]].** `AGENTS.md` requires a concrete requirement before a new
   dependency, and the choice of library is architectural in the same way
   [[ADR-006]] treated the signing library. **No email dependency may be added
   before that ADR is `accepted`.** The number is assigned when the Story opens
   (`ADR-011` is the next free slot) so an unused number is not burned here.

## Technical Debt

- [[TD-004]] — `open`, blocked: the password reset is deferred until email
  delivery exists. It is this epic's real external caller and a good acceptance
  case, and it stays blocked until [[NOTIF-002]] lands.
- No new Tech Debt item is raised by WU-A; nothing is implemented yet. Debt
  raised by the stories is triaged at [[NOTIF-005]].
