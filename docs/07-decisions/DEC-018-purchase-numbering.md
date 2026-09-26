---
id: DEC-018
type: decision
title: Purchase numbering (EPIC-11)
status: accepted
date: 2026-09-26
related_epics:
  - "EPIC-11"
related_decisions:
  - "DEC-012"
related_stories:
  - "PUR-001"
  - "PUR-002"
prd_change_required: false
---

# DEC-018 — Purchase numbering (EPIC-11)

## Context

PRD §17 defines no human-readable purchase number, and PRD §17's states and
receiving steps do not depend on one: a purchase is created as `DRAFT`, received
or cancelled by an explicit command, and no state transition, validation step or
receiving step reads or produces a number. The engineering rules forbid
`MAX(sequence) + 1` for fiscal or business sequences
(`docs/99-governance/ENGINEERING-RULES.md:150`), so any numbering scheme would
need real design work rather than an ad-hoc increment.

Verified current state in this repository (2026-09-26):

- **No numbering infrastructure exists.** A search across `packages/database`
  and `apps/api` finds no sequence, counter, `nextNumber` helper or
  number-allocation service of any kind, and the schema defines no sequence
  table or model.
- The only "number" column in the schema is the user-supplied
  `Customer.documentNumber` (`packages/database/prisma/schema.prisma:647`),
  which is external identity data the user types in, not a system-generated
  sequence.
- [[DEC-012]] fixes the purchase aggregate shape and the draft-versus-receive
  validation gate and **deliberately decides no numbering, cost or tax column**,
  so the aggregate has no number field today.
- A human-readable purchase number is typically a printed or fiscal artifact,
  and PRD §40 and Billing/Fiscal ([[EPIC-14]], [[EPIC-15]]) own printed and
  fiscal documents.
- [[PUR-001 Purchase draft]] and [[PUR-002 Purchase receiving]] previously
  recorded the numbering question as open and forbade inventing a number; this
  record resolves it.
- The gap was surfaced by the EPIC-11 documentation review as former Open
  Question 2, and no other accepted record in [[EPIC-11]] answered it.

## Question

Does the purchase aggregate carry a human-readable business number, and if so
who generates it, under what uniqueness scope and with what gap-free guarantee?

## Options

### Option A — No human-readable number in EPIC-11 (recommended)

The purchase is identified by its UUID plus supplier and creation date; there is
no number column, no sequence, no allocation step and no formatted identifier. A
printed or fiscal number is introduced later, by the epic that owns a printed or
fiscal document, with its own Decision.

Benefits: zero new infrastructure, no gap-free sequence to get wrong, no fiscal
implication taken on before a fiscal document exists, and nothing to migrate
because a number column can be added additively when its consumer appears.

Costs: staff cannot quote a short human reference for a purchase in
conversation, and the staff surface must show supplier plus date plus a short id
fragment instead of a friendlier number.

### Option B — Per-tenant gap-free sequential number allocated at creation

A per-tenant counter allocated under a transaction-scoped advisory lock in the
style of the inventory ledger's `pg_advisory_xact_lock`, with no gaps.

Benefits: staff get a short, sortable, quotable reference from day one.

Costs: it introduces business-sequence infrastructure that does not exist today,
and a gap-free guarantee is exactly the constraint that makes such sequences
operationally brittle (a rolled-back transaction, a retry or a failed allocation
must not burn a number); it also risks pre-empting a numbering scheme that a
printed or fiscal document will impose later. The engineering rules forbid
`MAX(sequence) + 1`, so it would require real design work.

### Option C — Per-tenant non-gap-free sequence

A plain incrementing number with gaps allowed.

Rejected: a non-gap-free business number invites the exact ambiguity a gap-free
sequence exists to prevent, while still paying the cost of the infrastructure of
Option B.

## Recommendation

Option A, on the evidence that no PRD requirement, no printed document and no
fiscal requirement consumes a number yet, that the repository has no numbering
infrastructure to reuse, and that adding a number column later is additive.
Option B is not wrong, only premature: it takes on a business-sequence guarantee
before a consumer exists.

## Impact

### Product

Staff refer to a purchase by supplier and date rather than by a short number, so
the staff surface and any conversation about a purchase carry the supplier name,
the creation date and a short id fragment instead of a formatted reference. No
product capability is lost, because PRD §17 defines no number and no workflow
depends on one.

### Architecture

No new runtime, datastore, queue, dependency or API protocol is introduced, and
no numbering abstraction, counter service or allocation seam is added anywhere.
The epic's complexity budget stays untouched, and a numbering capability can be
introduced later by the epic that owns its consumer without disturbing this
aggregate.

### Database/API

No `number` column, no sequence table and no allocation route are added, so the
purchase aggregate keeps exactly the shape [[DEC-012]] fixes. Any future number
is an additive migration plus its own Decision, which means there is nothing to
migrate or unwind if a printed or fiscal scheme later imposes a different format
or scope.

### Delivery

[[PUR-001 Purchase draft]] owns the aggregate without a number, and its
`## Database > Models/Tables` must state that no numbering column exists;
[[PUR-002 Purchase receiving]] is unaffected because no receiving step reads or
produces a number, and [[EPIC-14]] / [[EPIC-15]] own any printed or fiscal
identifier later.

## Decision

Accepted on 2026-09-26 by the maintainer. Option A is the decision: EPIC-11
introduces **no** human-readable purchase number — the purchase is identified by
its UUID plus supplier and creation date, with no number column, no sequence, no
allocation step and no formatted identifier — and a printed or fiscal number
belongs to the epic that owns a printed or fiscal document, introduced later
with its own Decision.

The other options stay recorded above as what was considered; acceptance selects
Option A only.

[[PUR-001 Purchase draft]] owns the implementation slice for the numberless
aggregate, and [[PUR-002 Purchase receiving]] carries no numbering obligation;
[[EPIC-14]] and [[EPIC-15]] own any printed or fiscal identifier later.

## PRD Update

No PRD change is required. PRD §17 defines no purchase number and this record
only fills a gap PRD §17 leaves open, so applying it neither extends nor alters
approved scope. None of the options edits approved product intent, and the
engineering rules forbid editing the PRD to normalize an implementation
deviation, so no PRD edit is proposed here.
