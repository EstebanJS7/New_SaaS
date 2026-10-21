---
id: DEC-071
type: decision
title: A commit is partial by design, with a per-row result summary
status: accepted
date: 2026-10-19
related_epics:
  - "EPIC-19"
related_decisions:
  - "DEC-069"
  - "DEC-070"
related_stories:
  - "IMP-003"
  - "IMP-004"
prd_change_required: false
---

# DEC-071 — Partial success, with a per-row summary

## Context

PRD §32 requires "validation, preview and result summary". It does not say
whether a single bad row stops the file.

Real migration files always contain dirty rows. A veterinary's customer list
exported from another system will have a blank name, a phone in a format nothing
accepts, and a patient whose owner is not in the export.

## Question

Does one invalid row block the whole import?

## Options

### Option A — Partial success, with a per-row summary (accepted)

Valid rows commit; invalid rows do not; the summary reports the count of each
and lists every failed row with its row number and its stable reason. The file
is refused **entirely** only when no row is valid at all, because committing
nothing is not a partial success.

### Option B — All or nothing

One invalid row refuses the file. The state is simple and the guarantee is
strong. Rejected on operator cost: with a real file, the operator enters a loop
of fix one row, re-upload, find the next, and the import becomes a worse text
editor. It also has no better safety story — a row that fails validation is a
row that would not have been created anyway.

## Decision

Accepted by the maintainer on 2026-10-19.

**A commit is partial.** The summary is the epic's deliverable, not a
diagnostic: it states how many rows were created, how many failed, how many were
suspected duplicates, and for each failed row its number and its reason.

**The commit is per-row transactional.** Each row commits in its own
transaction, so a late failure cannot roll back earlier successes, and the
deferred guardian trigger is satisfied per row.

## Consequences

### Product

The summary is the artefact the operator keeps. It must survive a page reload
and be readable later, so the import aggregate stores the per-row outcome rather
than returning it once.

### Architecture

The row outcome is persisted, which is what makes an import auditable after the
fact and what the staff surface polls.

### Database/API

One aggregate with its per-row outcome. The row payloads are **not** stored — a
row's outcome is a number, a verdict and a reason, never the customer's personal
data.

### Delivery

[[IMP-003]] and [[IMP-004]] implement it. Tests assert the three counts against
a file that mixes valid, invalid and duplicate rows, and assert that a mid-file
failure leaves the earlier rows committed.

## PRD Update

No PRD change. PRD §32's "result summary" is implemented as described here.
