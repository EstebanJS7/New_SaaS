---
id: TD-057
type: tech-debt
title: XLSX import, deferred by decision
status: open
severity: low
owner: backend
related_epics:
  - "EPIC-19"
related_stories:
  - "IMP-002"
related_decisions:
  - "DEC-068"
created: 2026-10-19
updated: 2026-10-19
---

# TD-057 — XLSX import

## What was deferred

PRD §32 says "Customers CSV/XLSX; Patients CSV/XLSX". [[DEC-068]] ships CSV only
and records the deviation here.

## Why it was deferred

The PRD's format line is one sentence, while a spreadsheet parser is a large
dependency: a ZIP container, shared strings, cell types, merged cells, formulas,
and a decompression-bomb surface that has to be bounded before the feature can
honestly claim robustness.

The expensive half of [[EPIC-19]] is the validation, preview, asynchronous
summary and partial-commit machinery. None of it changes between formats, and
every spreadsheet application exports CSV, so the operator's real workflow is
covered.

## The trigger that would reopen it

A tenant whose export cannot be expressed as CSV, or a support load that shows
operators repeatedly converting by hand.

## What a fix would touch

- A parser dependency — an `AGENTS.md` dependency justification, and the bomb
  surface bounded before anything else.
- `apps/api/src/imports/` — a second reader behind the same row-validator, so
  the column map and the validation rules stay single-sourced.
- The upload surface in `apps/web`, to accept the second content type.
- A `contentType` allowlist on the stored artefact, which [[DEC-072]] already
  requires it to record.
