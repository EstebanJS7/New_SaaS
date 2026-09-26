---
id: DEC-019
type: decision
title: Purchase draft editability and status-conditional immutability (EPIC-11)
status: accepted
date: 2026-09-26
related_epics:
  - "EPIC-11"
related_decisions:
  - "DEC-012"
  - "DEC-015"
related_stories:
  - "PUR-001"
  - "PUR-002"
prd_change_required: false
---

# DEC-019 — Purchase draft editability and status-conditional immutability (EPIC-11)

## Context

[[DEC-015]] accepts that a `RECEIVED` purchase is immutable and states that "no
purchase, line or movement is hard-deleted". That sentence was written about a
confirmed inventory fact, and it reads absolutely. [[DEC-012]] then requires
that a saved draft carries at least one line, that each line quantity is
strictly positive and that a duplicate `catalogItemId` within one purchase is
rejected.

Those two accepted requirements collide at the schema. A draft is edited by
changing its line set: adding a line, correcting a quantity, and removing a line
that was entered by mistake. If no `purchase_line` row may ever be hard-deleted,
a draft can never lose a line, so a mis-entered line is permanent for the life
of the draft and the only available correction is to change its item and
quantity in place. That is not what a draft is for, and it is a worse outcome
than the immutability rule DEC-015 was protecting.

The repository already has both patterns available as precedent: the catalog,
supplier and inventory tables carry an unconditional `BEFORE DELETE` trigger
that raises `restrict_violation`, while the patients migration uses a
conditional trigger that checks row state before enforcing an invariant.

## Question

Is the immutability of `purchase` and `purchase_line` absolute, or is it
conditional on the purchase's status?

## Options

### Option A — Conditional on status (recommended)

A `BEFORE DELETE` trigger on `purchase` and on `purchase_line` rejects the
delete only when the owning purchase is `RECEIVED` or `CANCELLED`. A `DRAFT`
stays fully editable, including removing a line. A confirmed or cancelled
purchase and its lines remain immutable and readable, exactly as DEC-015
requires for the case it was written about.

Benefits: it preserves the immutability DEC-015 protects — nothing about a
confirmed inventory fact can be deleted — while keeping a draft usable for the
work it exists to do; it needs no new concept, and the conditional-trigger shape
already exists in the patients migration.

Costs: the guarantee is one step weaker than a blanket ban, so a reader must
know that "not hard-deleted" applies to confirmed rows; the trigger has to join
the owning purchase to read its status, which is slightly more complex DDL than
the unconditional sibling triggers.

### Option B — Absolute immutability

No `purchase` or `purchase_line` row is ever hard-deleted, taking DEC-015's
sentence literally. Editing a draft means updating existing lines only.

Benefits: the strongest possible guarantee, and the simplest trigger to reason
about — the same unconditional shape the catalog, supplier and inventory tables
use.

Costs: a draft can never drop a line entered by mistake, so [[PUR-001]]'s own
"at least one line" rule becomes a trap rather than a guard; correcting a wrong
line means overwriting its item and quantity, which silently destroys what the
user originally entered.

### Option C — Lines deletable in `DRAFT`, purchase never deletable

Block every `purchase` delete unconditionally, but allow a `purchase_line`
delete while the parent is `DRAFT`.

Benefits: it keeps the draft editable and makes the purchase header strictly
undeletable, which some readers may find easier to state.

Costs: it splits one lifecycle rule into two different policies for parent and
child, so the same status means "editable" for lines and "permanent" for the
header; that asymmetry has no product reason behind it and has to be re-learned
by every reader.

## Recommendation

Option A. It resolves the collision in favour of the case DEC-015 was actually
protecting — a confirmed inventory fact stays immutable — without making a draft
unusable, and it reuses a trigger shape the repository already ships. Option B
is rejected because it turns [[DEC-012]]'s minimum-line rule into a permanent
record of user error, and Option C because its parent/child asymmetry has no
product justification.

## Impact

### Product

Staff can fix a draft, including removing a line they did not mean to add, and
can never delete or rewrite a purchase that has been received. A cancelled
purchase stays readable.

### Architecture

No new runtime, datastore, dependency or abstraction. The rule lives in the
database as a conditional trigger, matching the patients precedent, and the
application adds no delete route for a confirmed purchase.

### Database/API

`purchase` and `purchase_line` gain a `BEFORE DELETE` trigger that raises
`restrict_violation` when the owning purchase's status is `RECEIVED` or
`CANCELLED`, and permits the delete while it is `DRAFT`. The API exposes no
`DELETE` route for a purchase: draft line removal is expressed inside the draft
update command, and a confirmed purchase is corrected only by the future
reversal [[DEC-015]] records. The schema gate must assert the conditional
predicate, not a blanket ban.

### Delivery

[[PUR-001]] owns the draft lifecycle, the line-set edit path and the schema
gate; [[PUR-002]] consumes the immutability outcome when it receives a draft.
[[DEC-015]] stays accepted and unchanged: this record refines the scope of its
"not hard-deleted" sentence to confirmed rows rather than weakening the
immutability it protects.

## Decision

Accepted on 2026-09-26 by the maintainer. Option A is the decision: the
immutability of `purchase` and `purchase_line` is **conditional on the
purchase's status** rather than absolute. A `BEFORE DELETE` trigger on each of
the two tables rejects the delete only when the owning purchase is `RECEIVED` or
`CANCELLED`, raising `restrict_violation`; a purchase in `DRAFT` is fully
editable, including the removal of a line, so a draft can correct a line entered
by mistake. A confirmed or cancelled purchase and its lines remain immutable and
readable, so nothing about a confirmed inventory fact can be deleted, and a
`RECEIVED` purchase is still corrected only by the future explicit reversal that
[[DEC-015]] records. The API exposes no `DELETE` route for a purchase: draft
line removal happens inside the draft update command, and the schema gate
asserts the conditional predicate rather than a blanket ban.
[[PUR-001 Purchase draft]] owns the draft lifecycle, the line-set edit path and
the schema gate, and [[PUR-002 Purchase receiving]] consumes this immutability
outcome.

## PRD Update

No PRD change is required. PRD §17 defines the purchase states and the receiving
steps and says nothing about draft editability or hard deletion, so this record
fills a gap that PRD §17 leaves open rather than extending approved scope. The
engineering rules forbid editing the PRD to normalize an implementation
deviation, and [[DEC-015]] remains accepted as written.
