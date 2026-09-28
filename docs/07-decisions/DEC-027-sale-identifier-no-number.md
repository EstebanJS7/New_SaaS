---
id: DEC-027
type: decision
title: "Sale identifier: no human-readable number (EPIC-12)"
status: accepted
date: 2026-09-27
related_epics:
  - "EPIC-12"
related_decisions:
  - "DEC-018"
related_stories:
  - "POS-001"
prd_change_required: false
---

# DEC-027 — Sale identifier: no human-readable number (EPIC-12)

## Context

PRD §18 defines the sale states and the complete-sale steps but defines no
human-readable sale number, and no sale state or step reads or produces one. PRD
§21 assigns numbering to the **Invoice**, which "uses a transactional sequence,
never `MAX()+1`", and EPIC-12 neither prints a ticket nor emits a fiscal
document. The engineering rules forbid `MAX(sequence) + 1` for fiscal or
business sequences (`docs/99-governance/ENGINEERING-RULES.md`), so any numbering
scheme would need real design work rather than an ad-hoc increment. [[DEC-018]]
is the EPIC-11 precedent: a purchase has no number and is identified by its UUID
plus supplier and date. POS-001 records the numbering question as open.

Verified current state in this repository (2026-09-27):

- PRD §18 defines no sale number, and PRD §21 gives the transactional sequence
  to the Invoice, which is EPIC-14 scope.
- [[DEC-018]] decided on 2026-09-26 that a purchase carries no number, sequence,
  allocation step or formatted identifier and that a printed or fiscal number
  belongs to the epic owning a printed or fiscal document.
- No numbering infrastructure exists: a search across `packages/database` and
  `apps/api` finds no sequence, counter, `nextNumber` helper or allocation
  service, and the schema defines no sequence table.
- No sale model or sale surface exists yet, and EPIC-12 emits no fiscal
  document.

## Question

Does the sale aggregate carry a human-readable business number, and if so who
generates it, under what uniqueness scope and with what guarantee?

## Options

### Option A — No human-readable sale number (recommended)

A sale is identified by its UUID only: no numbering column, no sequence, no
allocation step and no formatted identifier. EPIC-12 prints no ticket and emits
no fiscal document, and PRD §21 gives numbering to the Invoice, which owns a
transactional sequence. Adding a number later is additive.

Benefits: zero new infrastructure, no gap-free sequence to get wrong, no fiscal
implication taken on before a fiscal document exists, and nothing to migrate
because a number column can be added additively when its consumer appears.

Costs: staff cannot quote a short human reference for a sale in conversation,
and the POS surface must show a date plus a short id fragment instead of a
friendlier number.

### Option B — Per-tenant gap-free sequential number allocated at completion

A per-tenant counter allocated under a transaction-scoped advisory lock, with no
gaps.

Benefits: staff get a short, sortable, quotable reference from day one.

Costs: it introduces business-sequence infrastructure that does not exist today,
and a gap-free guarantee is exactly the constraint that makes such sequences
operationally brittle: a rolled-back transaction, a retry or a failed allocation
must not burn a number. It also risks pre-empting the numbering scheme the
Invoice's transactional sequence will impose later.

### Option C — Per-tenant non-gap-free sequence

A plain incrementing sale number with gaps allowed.

Rejected: a non-gap-free business number invites the exact ambiguity a gap-free
sequence exists to prevent, while still paying the infrastructure cost of Option
B.

## Recommendation

Option A, on the same evidence the EPIC-11 numbering decision used: no PRD
requirement, no printed document and no fiscal requirement consumes a sale
number yet, the repository has no numbering infrastructure to reuse, and adding
a number column later is additive. Option B is not wrong, only premature, and
Option C is rejected on ambiguity.

## Impact

### Product

Staff refer to a sale by date and a short id fragment rather than a short
number, so the POS surface and any conversation about a sale carry the date and
the id in place of a formatted reference. No product capability is lost, because
PRD §18 defines no number and no workflow depends on one.

### Architecture

No new runtime, datastore, queue, dependency or API protocol, and no numbering
abstraction, counter service or allocation seam. The epic's complexity budget
stays untouched, and a numbering capability can be introduced later by the epic
that owns its consumer without disturbing this aggregate.

### Database/API

No `number` column, no sequence table and no allocation route are added, so the
sale aggregate carries only its UUID, its currency, its status and its lines. A
future number is an additive migration plus its own Decision, so there is
nothing to unwind if a printed or fiscal scheme later imposes a different format
or scope.

### Delivery

POS-001 owns the numberless sale aggregate and must state that no numbering
column exists. EPIC-14's Invoice owns any transactional sequence, and EPIC-12
prints no ticket and emits no fiscal document.

## Decision

Accepted on 2026-09-27 by the maintainer. Option A is the decision: a sale is
identified by its UUID only; no numbering column, no sequence and no allocation
step, following [[DEC-018]]; EPIC-12 prints no ticket and emits no fiscal
document; PRD §21 gives numbering to the Invoice, which owns a transactional
sequence; and adding one later is additive.

The other options stay recorded above as what was considered; acceptance selects
Option A only.

POS-001 owns the numberless sale aggregate, and EPIC-14's Invoice owns any
transactional sequence later.

## PRD Update

No PRD change is required. PRD §18 defines no sale number and PRD §21 already
assigns numbering to the Invoice, so this record only fills a gap the PRD leaves
open and applies the [[DEC-018]] precedent. It neither extends nor alters
approved product intent, and the engineering rules forbid editing the PRD to
normalize an implementation detail, so no PRD edit is proposed here.
