---
id: DEC-070
type: decision
title: A patient import references an existing customer as its guardian
status: accepted
date: 2026-10-19
related_epics:
  - "EPIC-19"
  - "EPIC-05"
related_decisions:
  - "DEC-069"
related_stories:
  - "IMP-004"
prd_change_required: false
---

# DEC-070 — The guardian comes from an existing customer

## Context

The database requires **exactly one active primary guardian** per patient,
enforced by a `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`
(`patient_exactly_one_primary_guardian`). A patient import cannot avoid the
question.

The exploration then found the contract already answers it: `createPatientBody`
accepts **`primaryGuardianCustomerId`**, required unless the patient is created
inactive, and `PatientsService.create` creates the patient, the guardian link
and both audit rows **inside one `$transaction`**. So the API is already able to
satisfy the deferred trigger for a caller that knows the customer.

## Question

Where does a patient import get its guardian?

## Options

### Option A — The CSV names an existing customer; an unresolved reference is a row

error (accepted)

The patients file carries a guardian reference (document number or contact
value) that must resolve to a customer that already exists in the tenant. When
it does not resolve, the row fails with a stable message naming the reference —
never a silently created customer.

This keeps the two imports independent and ordered (customers first, then
patients), reuses the existing create contract exactly, and makes the failure
honest.

### Option B — The import creates the customer when it is missing

Convenient for a one-shot migration, and rejected: it would create customers
from a source that is not the customer screen, duplicating that surface's
validation rules in a second place, and it makes ownership ambiguous when two
patient rows carry different guardian data for the same reference. [[DEC-069]]
already refused the reverse danger (an import silently changing people); this is
the same danger with a creation instead of an update.

### Option C — One combined import of customers and patients

Two passes inside one job. Rejected as scope: one more file format, a preview
that has to explain two entities, and a summary that mixes two units of work —
for a convenience the two-import sequence already provides.

## Decision

Accepted by the maintainer on 2026-10-19.

**The patients CSV carries a guardian reference to an EXISTING customer.** An
unresolved reference is a row error. The import calls the existing
`PatientsService.create` with `primaryGuardianCustomerId`, so the patient, the
guardian link and both audit rows land in one transaction and the deferred
trigger is satisfied by the same path a manual entry uses.

## Consequences

### Product

The operator imports customers first, then patients. A patients file whose
references do not resolve produces a preview full of named errors rather than a
partial success — which is the correct outcome, since a pet without its owner is
not a usable record.

### Architecture

No new guardian path, no change to the patient contract. The import is a caller.

### Database/API

None. The deferred trigger is satisfied by the existing transaction.

### Delivery

[[IMP-004]] owns the reference resolution and its error. A test asserts that an
unresolved reference creates NOTHING, so a half-created patient is impossible.

## PRD Update

No PRD change.
