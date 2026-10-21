---
id: DEC-068
type: decision
title: CSV only in the MVP, with XLSX deferred and named
status: accepted
date: 2026-10-19
related_epics:
  - "EPIC-19"
related_decisions:
  - "DEC-062"
related_stories:
  - "IMP-002"
prd_change_required: false
---

# DEC-068 — CSV only, XLSX deferred

## Context

PRD §32's whole text on format is one line: "Customers CSV/XLSX; Patients
CSV/XLSX".

`AGENTS.md` requires a concrete requirement for a new dependency, and a
spreadsheet parser is a large one (a ZIP container, shared strings, cell types,
merged cells, formulas, plus the decompression-bomb surface). PRD §32 is a
concrete requirement, so the dependency would be defensible — the question is
whether it is where this epic's cost should go.

## Question

Does the MVP ship XLSX, and if not, what does it ship and what is recorded?

## Options

### Option A — CSV only; XLSX deferred with a named tech debt (accepted)

Every spreadsheet application exports CSV, so the real operator workflow is
covered by one format. The expensive half of this epic is the validation,
preview, asynchronous summary and partial-commit machinery — none of which
changes between formats. Deferring the parser keeps the dependency count flat
and keeps the review focused on the machinery.

### Option B — CSV and XLSX with a parser dependency

Faithful to PRD §32 with no deviation to record. Costs a heavy dependency, a
second input path through the same validator, and a new class of adversarial
input (a 40-byte file that expands to gigabytes) that has to be bounded before
the epic is honest about robustness.

### Option C — Convert XLSX to CSV in the browser

The backend sees one format and the dependency lives in `apps/web`. Rejected:
the conversion is client-side, so the API can never honestly claim XLSX support,
and the validation ends up split across two runtimes.

## Decision

Accepted by the maintainer on 2026-10-19.

**The MVP imports CSV only, for both entities.** XLSX is recorded as [[TD-057]]
with its own trigger, and this Decision is the record of the deviation from PRD
§32.

The PRD is **not** edited. `DOCUMENTATION-RULES.md` forbids normalizing a scope
difference by rewriting approved scope, so the PRD keeps saying CSV/XLSX and
this document says what shipped.

## Consequences

### Product

A tenant uploads a `.csv`. A `.xlsx` is refused with a message naming the
accepted format, not a generic parse error — an operator who exported the wrong
thing should be told what to export instead.

### Architecture

No new dependency. The parser is a small hand-written RFC 4180 reader, which the
export path already has the quoting rules for ([[REP-007]]).

### Database/API

None.

### Delivery

[[IMP-002]] owns the parser and the format refusal. [[TD-057]] owns XLSX.

## PRD Update

No PRD change. PRD §32 still reads "CSV/XLSX"; this Decision records that the
MVP ships the first half and why, which is the mechanism
`DOCUMENTATION-RULES.md` prescribes for a scope difference.
