---
id: TD-051
type: tech-debt
title: Asynchronous CSV export above the row cap
status: open
severity: low
owner: backend
related_epics:
  - EPIC-18
  - EPIC-19
related_stories:
  - REP-007
related_decisions:
  - "DEC-066"
created: 2026-10-19
updated: 2026-10-19
---

# TD-051 — Asynchronous CSV export above the row cap

## What was deferred

[[DEC-066]] made CSV export synchronous and bounded: the export route reuses the
report's period resolution and query, applies a hard row cap, and returns
`text/csv` directly. There is no queue, no artefact and no object storage in
[[EPIC-18]].

A tenant whose export exceeds the cap receives `REPORTS_EXPORT_TOO_LARGE` and
must narrow its period. That is an honest answer rather than a truncated file,
but it is not a complete one.

## Why it was deferred

`AGENTS.md` fixes the complexity budget: no queue, storage or cache capability
without a measured need, and "more scalable" is not a reason. No tenant exists
with a data volume that reaches the cap, and the queued alternative is strictly
more surface:

```text
an export-request aggregate with a status machine
an artefact in object storage with a TTL
a status route the UI polls
a download route with its own permission
a data-classification record for a file that leaves the database
the worker's own test lane
```

None of that is required by a report whose source rows are already bounded by
[[DEC-063]]'s 366-day range.

## The trigger that would reopen it

A real tenant hitting `REPORTS_EXPORT_TOO_LARGE` in normal use, for a period it
cannot reasonably narrow. At that point the measurement exists and the deferred
design becomes justified rather than speculative.

## What a fix would touch

- A new aggregate and its migration, in the shape `notification_delivery`
  already established.
- A worker job in `apps/worker` and its failure/retry semantics.
- Object storage, which the MVP deployable list already names but no code uses.
- `apps/web`: a polling status route and a download action replacing the direct
  fetch.

## Pointers

- [[DEC-066]] — the accepted transport decision and its rejected alternative.
- [[DEC-063]] — the range bound that keeps the current export small.
- `apps/api/src/reporting/export/` — the serializer and the cap.
- [[EPIC-19]] — imports are the other path that legitimately needs the same
  machinery, and building it once for both would be the right moment.
