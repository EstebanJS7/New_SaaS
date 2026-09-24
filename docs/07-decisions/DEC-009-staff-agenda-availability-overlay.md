---
id: DEC-009
type: decision
title:
  Shade availability windows and one-off blocks in the staff agenda (DEC-007
  Option B, additive)
status: accepted
date: 2026-09-22
related_epics:
  - EPIC-07
related_decisions:
  - DEC-007
related_stories: []
prd_change_required: false
---

# DEC-009 — Shade availability windows and one-off blocks in the staff agenda (DEC-007 Option B, additive)

## Context

The staff agenda (`apps/web/src/app/(app)/app/agenda/`) renders day, week, month
and list views over the tenant's appointments, but it never shows the
`(professional, branch)` availability it already stores. Staff can only discover
that a slot is outside working hours or inside a one-off block by attempting a
write and receiving a `409 CONFLICT`. The data needed to prevent that is already
present: the typed `scheduling` settings namespace holds local wall-clock
`availability` windows
(`{membershipId, branchId, weekday 0–6, startMinute, endMinute}`, tenant
timezone `America/Asuncion`) and absolute-UTC `blocks`
(`{membershipId, branchId, startsAt, endsAt}`), and the authenticated settings
proxy already forwards `GET /api/settings/scheduling`.

Two facts bound this record:

- **DEC-007 evaluated exactly this overlay and did not select it.** It is
  DEC-007 **Option B** ("Staff-side only — shade availability windows and blocks
  in day/week views"). DEC-007 accepted **Option A**, sequenced **A1 → A3 → A2**
  (availability endpoint, then pending requests in the staff agenda, then the
  portal grid). This record does **not** claim DEC-007 delivered the overlay; it
  did not.
- **The product intent already exists.** PRD §14 ("Scheduling — Agenda must
  provide") lists **working hours** and **schedule blocks** alongside the views,
  drag/resize, time-range creation and filters that EPIC-07 shipped. The overlay
  is the agenda surface finally honouring those two bullets.

This is therefore **additive scope with existing product intent and explicit
authorization**: the maintainer asked for the overlay on 2026-09-22. It belongs
to the **staff agenda surface owned by EPIC-07**, not to the portal (EPIC-08);
no portal surface, route or identity is involved.

## Question

Should the staff agenda shade the selected professional's working hours and
one-off blocks in its day and week views, and if so, how — given that DEC-007
considered and deferred it?

## Options

### Option A — Implement DEC-007 Option B as a display-only overlay (chosen)

Read the `scheduling` namespace through the existing settings proxy and shade
the selected pair's windows and blocks on the FullCalendar day and week views.
The overlay is presentation only: it does not constrain selection or dragging.

Benefits: closes the gap between what staff see and what the API enforces, using
only web-side code and an already-forwarded read. It is small, independently
verifiable, and does not touch the portal, the API, the database, permissions or
the dependency set.

Costs: it does not change booking reliability for holders (that is A1/A2), and
it adds a second client read to the agenda.

### Option B — Leave the overlay out until the portal grid lands

Keep DEC-007's sequence and revisit the overlay only after A2.

Benefits: no new surface now.

Costs: PRD §14's "working hours" and "schedule blocks" stay unimplemented, and
staff keep discovering unavailability only through a failed write.

### Option C — Implement it as an enforced constraint

Shade the hours AND wire `selectConstraint`/`eventConstraint` so the calendar
blocks invalid selections.

Benefits: staff cannot even attempt an out-of-window write.

Costs: **incorrect as a reuse of this display overlay.** `businessHours` is a
union of ranges, while the write path requires the whole appointment inside ONE
window, and a forbidden block cannot be handed directly to `selectConstraint` as
an allowed-range constraint. Equivalent logic COULD be enforced with custom
allow callbacks or computed allowed ranges, but adopting it here would make the
calendar a second source of truth that drifts from the API; DEC-007 frames
availability as a hint, not a reservation, so the overlay stays display-only.

## Recommendation

Option A. It is the smallest change that makes the agenda honest about
availability, it uses only already-approved surfaces, and it keeps the API as
the single authority. Option C is rejected on correctness, not effort.

## Impact

### Product

Staff see a selected professional's working hours and one-off blocks where they
plan the day, instead of inferring them from `409`s. The hint asking for a
branch and a professional makes the overlay's precondition explicit.

### Architecture

Web-only. The pure mapping lives in `agenda-availability.ts` next to the agenda
with its own unit tests; the settings read stays in the agenda's client module;
the views receive already-computed props. No new service, datastore, queue,
dependency or API route.

### Database/API

None. `GET /api/settings/scheduling` and its proxy already exist; no schema,
route or permission change.

### Delivery

One bounded web slice: a pure mapping module, its unit tests, the agenda/views
wiring, and the FullCalendar style variables. The tri-state rule (unrestricted /
unavailable / complement) is pinned by tests, including the case that must shade
nothing.

## Decision

Accepted on 2026-09-22. The staff agenda's day and week views shade the selected
professional's configured availability and one-off blocks, subject to three
rules:

1. **Display only.** The overlay never feeds `selectConstraint`,
   `eventConstraint` or `overlap`. The write path
   (`apps/api/src/scheduling/appointment-invariants.ts` →
   `assertAppointmentAvailability`) requires the whole appointment inside ONE
   window (`isWithinAvailability`) and rejects every one-off block
   (`intersectsBlock`); a union-of-ranges constraint cannot express that, so
   enforcing the overlay would let staff select a range the API rejects with
   `409 CONFLICT`. The API remains the source of truth.
2. **Tri-state on `(membershipId, branchId)`.** No windows for the pair means
   the write path is unrestricted, so the overlay shades **nothing**. Windows
   exist for the pair but none on the weekday means the day is unavailable, so
   the **whole day** is shaded. Windows exist on the weekday means the
   **complement** of those windows is shaded.
3. **A pair must be selected.** `businessHours` is calendar-global while the
   windows carry a `branchId`, so with no branch or no professional selected the
   overlay cannot honestly represent anything: it is hidden and a short hint
   asks staff to pick a branch and a professional.
4. **Unknown availability is never rendered as unrestricted.** If the settings
   read fails, or the namespace does not match the settings contract, nothing is
   shaded and a non-blocking warning says the pair's availability could not be
   loaded; the agenda stays usable. The namespace is shape-checked at runtime
   before the mapping, and a malformed entry fails the whole namespace rather
   than being dropped — a dropped window could make a restricted pair read as
   unrestricted.

Scope stays on the **staff agenda surface (EPIC-07)**. The portal
(EPIC-08/DEC-007 A2) is out of scope, as is any change to the availability
endpoint (A1) or the pending-request layer (A3).

## Approval and Governance

Authorized by the maintainer on 2026-09-22 as additive scope within the existing
PRD §14 intent, recorded here rather than presented as DEC-007 delivery. DEC-007
remains the record for A1 → A3 → A2 and is unaffected; its Option B was not
selected there and is adopted here explicitly.

## PRD Update

No PRD change is required: PRD §14 already requires "working hours" and
"schedule blocks" in the agenda. This record implements existing intent; it does
not extend it.
