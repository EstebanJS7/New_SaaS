---
id: DEC-066
type: decision
title: CSV export is synchronous and bounded, not queued
status: accepted
date: 2026-10-19
related_epics:
  - "EPIC-18"
  - "EPIC-19"
related_decisions:
  - "DEC-063"
  - "DEC-052"
related_stories:
  - "REP-007"
prd_change_required: false
---

# DEC-066 — CSV export is synchronous and bounded

## Context

PRD §31 ends with one line: "Initial export: CSV." It does not say how, and PRD
§32 separately says that **imports** run asynchronously with validation, preview
and a result summary — a contrast worth noticing, because the PRD chose async
only where it said so.

The repository has the machinery for queued work (Redis, BullMQ, the worker, the
notification delivery aggregate) and the machinery for producing files is not
there: there is no object storage client, no signed-URL route and no export
artefact table. A search for `text/csv`, `.csv`, `toCsv` across `apps/api/src`,
`apps/web/src`, `apps/worker/src` and `packages/shared/src` returns nothing.

`AGENTS.md` fixes the complexity budget: no cache/storage/queue capability
without a measured need, and "more scalable" is not a reason.

There is also a concrete pattern to follow on the web side: the twelve existing
BFF proxies were unified on text buffering, and
`docs/10-qa/RELEASE-CHECKLIST.md` records why.

## Question

Does the CSV export run inside the request, or as a worker job behind a signed
URL?

## Options

### Option A — Synchronous, bounded, streamed from the API through the BFF (accepted)

The export route is the report route with a different media type: same period
arguments, same service, same repository query, one extra projection to CSV. It
responds `text/csv; charset=utf-8` with a `Content-Disposition` filename
carrying the report name and its resolved period. A hard row cap bounds the
work; exceeding it is a stable error code, **not** a silently truncated file.

### Option B — Queued in BullMQ with an artefact and a signed URL

Realistically the better long-term shape for a large tenant, and strictly more
work: an export-request aggregate with a status machine, an artefact in storage
with a TTL, a status route the UI polls, a download route with its own
permission, data-classification work for a file that leaves the database, and
the worker's own test lane. None of it is needed by a report whose source rows
are already bounded by [[DEC-063]]'s 366-day range.

### Option C — Synchronous and unbounded

Rejected. [[TD-026]] records unbounded list endpoints as open debt and a new
surface must not worsen it; an unbounded export is also the one shape that can
turn a read-only report into an availability incident.

## Decision

Accepted by the maintainer on 2026-10-19.

**CSV export is synchronous and bounded.** It reuses the report's period
resolution and query, applies a hard row cap, and returns `text/csv` directly.
There is no queue, no artefact, no signed URL and no storage dependency in this
epic.

The web surface fetches the export through a BFF proxy that follows the
established text-buffering pattern, so the browser never receives an unbuffered
stream from the API.

Both the export and the report are guarded by permissions: `reports.read` for
the report, `reports.export` for the file ([[DEC-062]]).

## Consequences

### Product

Export is instant for every realistic MVP tenant. A tenant whose export exceeds
the cap receives an explicit error naming the cap, and can narrow the period —
which is a real answer, unlike a truncated file.

### Architecture

No new deployable capability, no new dependency, no storage. [[TD-051]] records
the asynchronous path as deferred debt with its trigger: a tenant whose export
exceeds the cap in normal use.

### Database/API

One route per report family, or one export route parameterised by report code.
The row cap is a module constant, not a request parameter.

### Delivery

[[REP-007]] implements the exporter, the BFF proxy and the cap's error path. Its
tests assert the media type, the filename, the cap refusal, the empty-range CSV
(headers only, not an empty body) and the tenant isolation of the export route.

## PRD Update

No PRD change. PRD §31's "Initial export: CSV" is satisfied exactly; the
transport is an implementation contract, recorded here.
