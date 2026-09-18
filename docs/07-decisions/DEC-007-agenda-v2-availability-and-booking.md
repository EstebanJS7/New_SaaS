---
id: DEC-007
type: decision
title:
  Agenda v2 — availability, pending requests on the calendar, and portal booking
status: accepted
date: 2026-09-18
related_epics:
  - EPIC-07
  - EPIC-08
related_stories: []
prd_change_required: false
---

# DEC-007 — Agenda v2 — availability, pending requests on the calendar, and portal booking

## Context

The booking area is expected to carry real weight in the veterinary product and
in later verticals, so it deserves to be a properly built agenda rather than a
form. Verified current state (see the capability map behind this record):

**What already exists and is good.** EPIC-07 delivered a substantive staff
agenda at `apps/web/src/app/(app)/app/agenda/`: FullCalendar day/week/month plus
an accessible list view, drag and resize normalized into a version-guarded
reschedule, branch/professional/status filters, create, the six lifecycle
transitions with a named-command-only state machine, and stale-version conflict
handling. `@fullcalendar/*` 6.1.21 is already a dependency, so no new package is
needed. The backend is equally solid: typed `scheduling` settings
(`conflictPolicy`, availability windows as local weekday + minute-of-day,
one-off blocks), `assertAppointmentAvailability`, `pg_advisory_xact_lock` plus
overlap detection under `REJECT`, tenant/branch/professional anchors with the
VETERINARIAN rule, and a byte-equivalent 404 shape.

**What does not exist.**

1. **Any notion of free slots.** Exhaustive search finds availability logic only
   as a boolean check inside create, reschedule and booking approval. There is
   no endpoint that answers "which slots are free for professional X on date Y",
   and the frontend computes none either. A booking UX built today would have to
   invent availability in the browser.
2. **Appointment types, services or durations.** No column, no table, no
   setting. Duration is always caller-supplied. The schema comment states this
   deliberately, and Catalog is EPIC-09.
3. **Pending booking requests on the calendar.** `listAppointments` reads the
   `appointment` table only, so a holder's request is invisible in the very view
   where staff decide their day. Staff reach requests through a separate
   `GET /booking-requests` surface that has **no UI at all**.
4. **Portal booking UX beyond the API.** Phase 4.3 of EPIC-08 (portal pages) is
   still unchecked; only the landing page exists.
5. **Holder cancellation or reschedule.** `PortalBookingRequestStatus.CANCELLED`
   exists in the enum and nothing sets it.

## Question

How far should the agenda go, and in what order, so that the booking flow is
trustworthy for staff and holders without inventing capacity the backend cannot
honour?

## Options

### Option A — Availability first, then the portal grid (recommended)

Add a read-only availability capability that reuses the existing invariants,
then build the portal booking UX on it, then let the staff agenda show pending
requests.

- **A1 Availability endpoint**: `GET /appointments/availability` taking branch,
  professional, date and duration, returning the concrete free slots for that
  day. It must compute from the same `isWithinAvailability`, `intersectsBlock`
  and overlap reads the write path uses, under the same tenant scoping. It is a
  read, so it takes no advisory lock; its answer is a hint that the write path
  re-validates. This is the backbone: without it, a slot picker lies.
- **A2 Portal booking grid**: the holder picks a real slot instead of typing an
  arbitrary range, and the request is submitted as that slot.
- **A3 Pending requests in the staff agenda**: render PENDING requests as a
  visually distinct layer so staff see demand where they look, with approve and
  reject reachable from there. Backend and permissions already exist.

Benefits: it makes the two halves agree — the slots offered are the slots the
write path accepts — and it fixes a real operational hole (invisible demand)
before adding more surface.

Costs: A1 is net-new capability with no PRD section behind it; A2 and A3 change
EPIC-08 and EPIC-07 surfaces, so both need to be recorded as scope decisions.

### Option B — Staff-side only

Build the availability overlay on the existing staff agenda and stop there:
shade availability windows and blocks in day/week views and surface the
booking-request decision list. No new endpoint, no schema change, no permission
change.

Benefits: cheapest, entirely inside already-approved scope, and it delivers
visible value immediately.

Costs: the holder still types a free-form range, so the mismatch that makes
booking feel unreliable stays. It improves the staff view without improving
booking.

### Option C — Pull the Catalog forward

Do EPIC-09 (services with durations and types) first, then availability and the
portal grid on top of real services.

Benefits: the most complete destination — a clinic books "consulta de 30 min" or
"vacunación de 15 min", and durations stop being arbitrary.

Costs: the largest scope jump, a new epic's worth of schema and UI, and it
delays every improvement to booking. The agenda is not blocked on Catalog:
durations can be an explicit input first and a catalog lookup later without
rework, as long as the duration is an explicit parameter rather than an
assumption.

### Option D — Keep the request-then-approve model as the only model

Accept that the portal submits an arbitrary range, staff decides, and the portal
never sees availability.

Benefits: zero new capability, and it matches the epic as written.

Costs: this is what exists today and it is what the user says does not feel like
a real agenda. Requests that cannot be honoured arrive constantly because the
holder had no way to know.

## Recommendation

Option A, sequenced A1 → A3 → A2, with Catalog explicitly deferred to EPIC-09.

A1 first because everything else depends on it and because it is where the real
risk lives: a free-slot read that drifts from the write invariants would be
worse than no availability at all. A3 second because it is cheap, it is inside
already-approved backend scope, and it closes the invisible-demand hole. A2 last
because it is the largest UI surface and the one whose shape depends on A1's
contract.

Explicit non-goals for this work: appointment types and the service catalog
(EPIC-09), recurring appointments or blocks, reminders (EPIC-17), waitlist,
per-tenant timezone, and any soft hold of pending requests (see the open
question below — it changes overlap semantics and must be decided on its own).

## Impact

### Product

The holder stops guessing: offered slots are slots the clinic can actually take.
Staff see demand on the same screen where they plan the day. Neither change
touches the approval model.

### Architecture

No new service, no new datastore, no new dependency: FullCalendar is already
present and the availability endpoint reuses the scheduling module's invariants
rather than duplicating them. The main architectural risk is exactly that reuse
— if the endpoint re-implements the availability math instead of calling it, the
two will diverge.

### Database/API

No schema change for A1 and A3. One new read route and its permission mapping;
the route-contract probe pins both collections, so it must be added there. A2
adds portal routes only if cancel/reschedule is decided in.

### Delivery

A1 and A3 are small and independently verifiable. A2 is a UI slice on top of a
settled contract. The portal pages themselves (EPIC-08 phase 4.3) remain the
prerequisite for A2.

## Decision

Accepted on 2026-09-18 as **Option A**, sequenced **A1 → A3 → A2**:

1. **A1 — availability endpoint first.** A read-only
   `GET /appointments/availability` returns the concrete free slots for a
   professional, branch and date, computed by CALLING the shared scheduling
   invariants rather than re-deriving them: a candidate slot is offered only
   when the same predicate the write path uses would accept it, with the same
   active-status overlap exclusion. Any slot endpoint that re-implements the
   availability math instead of calling it is rejected by this record.
2. **A3 — pending requests visible in the staff agenda.** PENDING booking
   requests render as a visually distinct layer in the staff agenda, with
   approve and reject reachable from there. No retention: a pending request
   still does not occupy the slot, and overlap semantics stay unchanged. Demand
   becomes visible instead of reserved.
3. **A2 — portal booking grid, cancellation and reschedule.** The holder picks a
   real slot from the availability contract, and gains cancellation and
   reschedule of their own request or appointment, with guardian-ownership
   revalidation, one co-committed PORTAL audit row per mutation, and the state
   rules unchanged (nothing that has already started is rescheduled).

**Professional assignment stays with staff**, decided at approval as today. The
holder requests a time, not a practitioner.

**Catalog stays deferred to EPIC-09.** Duration is an explicit parameter of the
availability query and of the booking request; it becomes a catalog lookup later
without rework.

## Approval and Governance

The four decisions above are the user's, taken on 2026-09-18. They authorize
implementation of A1, A3 and A2 in that order.

**Scope note that must be recorded in the epics, not hidden here:** A1 is
net-new capability with no PRD section behind it; A3 extends the EPIC-07 agenda
surface; A2 extends the EPIC-08 portal boundary with new write routes
(cancel/reschedule) that the epic does not currently list. The epic tracker and
the portal module documentation must state all three rather than presenting them
as already-planned work.

No ADR is required: this record adds no runtime service, datastore, queue or
dependency. FullCalendar is already present.

## Non-Goals

- Appointment types and the service catalog (EPIC-09).
- Recurring appointments or recurring blocks.
- Reminders and notifications (EPIC-17).
- Waitlist.
- Per-tenant or per-branch timezone: v1 keeps the single `America/Asuncion`.
- Any soft hold or reservation of a slot by a pending request.

## Open questions a human must decide

1. **Do pending requests hold capacity?** Today they deliberately do not: the
   overlap check reads `appointment` only, and the schema comment says a request
   is not an active appointment. Without a hold, two holders can request the
   same slot and staff discovers the conflict only when approving the second. A
   soft hold changes overlap semantics and needs its own decision.
2. **Does the holder choose the professional, or "any available"?** Today staff
   assigns at approval. Choosing requires expanding the portal request contract
   and deciding what happens when that professional has no slot.
3. **Can the holder cancel or reschedule?** Both are absent, and each is a
   portal write route with its own ownership and audit rules.
4. **Is a service/type catalog pulled forward?** Option C. If yes, this record
   becomes the umbrella and EPIC-09 supplies the catalog.

## PRD Update

PRD §14 already asks for branch/professional/status/service filters and
availability handling in the agenda, and §26 lists portal appointments and
booking as portal capabilities, so Option A can be read as fulfilling existing
intent rather than extending it. Two gaps remain worth recording: PRD §14
mentions a **service filter** with no epic owning it, and the free-slot query
has no PRD section at all. If the catalog is pulled forward, PRD §15 needs
revisiting; no other PRD change is required by this record.
