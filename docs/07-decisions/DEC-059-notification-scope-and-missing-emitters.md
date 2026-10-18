---
id: DEC-059
type: decision
title:
  Notification scope and the three missing emitters as declared boundary debt
status: accepted
date: 2026-10-16
related_epics:
  - "EPIC-17"
  - "EPIC-07"
  - "EPIC-16"
related_decisions:
  - "DEC-047"
related_stories:
  - "NOTIF-003"
prd_change_required: false
---

# DEC-059 — Notification scope and the three missing emitters

## Context

`AppointmentConfirmed`, `AppointmentCancelled` and `FiscalApproved` are all in
PRD §39's initial catalog, and none of them appears in **any** file in `apps` or
`packages` today. `InvoiceConfirmed` appears only inside
`packages/shared/src/events/dispatcher.test.ts` — which is the measure of the
problem: `packages/shared/src/events/` ships a tested dispatcher
(`createEventDispatcher`, `ApplicationEvent`, `ApplicationEventHandler`) with
**no production caller at all**.

Three consequences meet here:

1. **EPIC-17 cannot have a reminder without a trigger.** PRD §24 requires the
   reminder; the confirmation and cancellation paths that would drive it are
   EPIC-07's, and EPIC-07's own _Out of Scope_ says "Recurring
   appointments/blocks, **reminders**, and internal appointment events
   (`AppointmentConfirmed`/`AppointmentCancelled` are intentionally not
   emitted)". The ROADMAP carries EPIC-07 as EPIC-17's dependency — which is
   exactly this deferral being exercised.
2. **PRD §36's journey requires a notification after fiscal approval**
   (`→ fiscal approval → KuDE available → notification`), and `FiscalApproved`
   has no producer. EPIC-16 closed without one.
3. **[[DEC-047]] chose an explicit fiscal issue command** over automatic
   post-confirmation issuance, so `InvoiceConfirmed` was correctly left
   unemitted. That decision is not reopened here.

## Question

Does EPIC-17 reach into two closed epics' surfaces to publish the three missing
events, and how is that crossing governed?

## Options

### Option A — EPIC-17 publishes all three, declared as boundary debt (recommended)

Publish `AppointmentConfirmed` and `AppointmentCancelled` in the scheduling
command paths, and `FiscalApproved` in the fiscal approval path — each
post-commit, emitter-only, through the shared in-process dispatcher. Declare
both crossings in the epic file as **boundary debt** so they read as deliberate.

Benefits: unblocks PRD §24's hard requirement and PRD §36's journey, gives the
existing dispatcher its first production producer, keeps the reaction decoupled
from Scheduling and Fiscal, and honours [[ADR-003]] rather than inventing a bus.

Costs: two closed epics' files are touched. Mitigated by the crossing being
emitter-only — a publish after the existing commit, with no transaction
restructured, no lifecycle changed, no invariant moved, and no handler able to
roll back the origin.

### Option B — Defer the emitters and drop the reminder

Rejected: PRD §24 states the reminder as a product requirement, and PRD §36
places a notification after fiscal approval. Deferring is a scope reduction the
maintainer did not choose.

### Option C — Have the scheduling and fiscal services call notifications directly

Rejected: it inverts the dependency the modular monolith is built on. Scheduling
would import a notification service, and the fiscal path would import a
notification producer, coupling two domains for a reaction that must not
participate in their transactions. This is what `INTERNAL-EVENTS.md` exists to
avoid, and `AGENTS.md`'s domain-boundary rule forbids it.

### Option D — Introduce a distributed event bus

Rejected: PRD §39, [[ADR-003]] and `AGENTS.md`'s Complexity Budget all forbid a
generic cross-domain bus without an accepted ADR, and nothing measured requires
one.

## Recommendation

Option A.

## Impact

### Product

PRD §24's reminder becomes implementable, and PRD §36's post-approval
notification gains a trigger.

### Architecture

**Two properties of the mechanism are load-bearing and are recorded here because
they are not obvious:**

1. **The dispatcher is in-process.** `createEventDispatcher`'s own documentation
   says it "does not cross process boundaries". An event published in one
   deployable is therefore observed only by subscribers registered in **that
   same process**. The consequence for this epic: the appointment events are
   published in `api`, so the reminder's scheduling reaction is registered in
   `api` (which enqueues the delayed job, exactly as the fiscal producer does);
   and `FiscalApproved` is published in `worker`, where the fiscal handler and
   the recovery service run, so the post-approval notification reaction is
   registered in `worker`. A subscriber placed in the wrong deployable would
   silently never fire.
2. **`APPROVED` has two writers.** A fiscal document enters `APPROVED` both in
   `FiscalSubmissionHandler.persistResult` and in the recovery service's
   conditional update. `FiscalApproved` must be published from **both** paths,
   or from one shared helper both call, so one path cannot be missed. A single
   publisher at one of the two sites would silently lose every approval resolved
   by the reconciliation sweep.

The emitter remains emitter-only: it publishes after the existing transaction
commits, its failure does not roll back the appointment, the invoice or the
fiscal document, and no transactional invariant moves out of the transactions
that own them.

### Database/API

No schema change. The events carry stable IDs and minimal metadata, never an
aggregate dump and never a contact datum.

### Delivery

[[NOTIF-003]] owns the three emitters and the reminder. The epic file declares
the crossings under _Boundary debt_, so a reviewer reads them as a decision
rather than as scope leakage.

## Decision

Accepted by the maintainer on 2026-10-16. **EPIC-17 publishes
`AppointmentConfirmed`, `AppointmentCancelled` and `FiscalApproved` post-commit
through the shared in-process dispatcher, declares the EPIC-07 and EPIC-16
crossings as boundary debt in the epic file, and keeps every crossing
emitter-only. The reaction to each event is registered in the deployable that
publishes it.** [[DEC-047]]'s explicit-issue choice is not reopened, so
`InvoiceConfirmed` stays unemitted.

## PRD Update

No PRD change. All three events are already in PRD §39's catalog; this decision
publishes them rather than extending the catalog. **`AppointmentRescheduled` is
not added**, precisely because PRD §39 lists the catalog and adding a member is
a product-scope change — the gap it leaves is recorded as a limitation in
[[NOTIF-003]] instead of an invented event.
