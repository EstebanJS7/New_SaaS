---
id: DEC-081
type: decision
title: Patient identity in staff scheduling workflows
status: accepted
date: 2026-10-26
related_epics: [EPIC-06, EPIC-07]
related_stories: [UX-002, UX-003]
updated: 2026-10-27
prd_change_required: false
---

# DEC-081 — Patient identity in staff scheduling workflows

## Context

The agenda's appointment and booking-request contracts expose `patientId`, not
the patient's display name. The staff member therefore sees an opaque UUID when
creating a booking, reviewing one, or scanning the calendar. A direct link to
the patient record avoids copying the UUID after a booking is open, but does not
solve patient selection or event identity.

The current patient list call is unbounded and has its own `patients.read`
permission. Loading it inside scheduling would couple agenda availability to a
different permission and would fetch the entire private patient set just to
resolve visible rows. Extending the Core Scheduling domain to import Veterinary
patient details would cross the approved domain boundary.

## Options

### A — Add a bounded, tenant-scoped patient search for authorized staff (recommended)

Define the permission and privacy boundary, a minimum search input, a strict
result limit, and an allowlisted identity projection in a Veterinary-owned read.
Agenda uses it only when the authenticated user is authorized to read patients.
Tenant context remains server-derived; no clinical fields or portal identities
are exposed. Add tenant-isolation and authorization coverage before using it in
booking forms or calendar event projection.

### B — Return patient identity from Scheduling

This simplifies the agenda client but would make the reusable Core Scheduling
domain know about the Veterinary implementation unless a separate application
composition boundary is approved.

### C — Keep the UUID-only workflow

No backend changes are needed, but staff must continue to identify a patient by
opaque ID and cannot reliably scan a busy calendar.

## Recommendation and status

Option A is accepted following the user's approval on 2026-10-27 to continue
with named patient/guardian selection and the complete staff journeys. The
additive API contract is scoped in [[UX-003]]; the PRD remains unchanged.

`POST /patients/lookup` is a read-only Veterinary projection requiring BOTH
`patients.read` and `customers.read`, plus the existing `veterinary`
entitlement. Its strict body accepts either `q` (2–80 trimmed characters, at
most 20 active patients) or `ids` (1–50 UUIDs, including inactive patients for
existing appointments). A foreign or unknown explicit ID returns the same 404
with no partial results, preserving the repository's UUID isolation rule. Search
matches patient or active primary guardian names. Tenant context is
server-derived. Every joined guardian/customer is tenant-scoped; only an active
primary guardian's display name is returned. The allowlist is patient
ID/name/active state, species name and primary guardian name. Existing
names/links remain CONFIDENTIAL; no clinical/contact fields are returned. POST
keeps search text out of logged request URLs; payloads and responses must not be
logged or persisted in browser storage.

## Current composition

[[UX-003]] implements the accepted lookup in the Veterinary module and composes
it in the staff agenda. Search uses native input/radio controls with explicit
selection, while calendar/list/open-panel identities resolve from the IDs the
existing scheduling reads already returned. The agenda keeps its direct link to
the staff patient record. If identity access is unavailable, staff see an
explicit hint and a neutral label while existing scheduling operations remain
available. Verification status is recorded in UX-003.
