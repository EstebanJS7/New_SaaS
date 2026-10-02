---
id: DEC-052
type: decision
title: Fiscal staff surface and fiscal-ui settings scope
status: accepted
date: 2026-10-02
related_epics:
  - "EPIC-15"
related_decisions:
  - "DEC-040"
  - "DEC-042"
  - "DEC-044"
related_stories:
  - "FISC-005"
prd_change_required: false
---

# DEC-052 — Fiscal staff surface and fiscal-ui settings scope

## Context

[[DEC-042]] assigns the `fiscal-ui` surface to EPIC-15. PRD §38 lists a
`fiscal-ui` tenant-settings namespace, but no schema exists. [[DEC-040]]
reserves `fiscal.invoice.issue` for Fiscal behind the `fiscal` feature code.
[[TD-022]] keeps customer portal invoices/documents deferred until
EPIC-15/EPIC-16.

## Question

What staff surface and typed settings does EPIC-15 ship?

## Options

### Option A — Minimal staff fiscal status/actions; no portal surface (recommended)

Add a staff-only Fiscal surface reachable through the app shell when the
`fiscal` feature is entitled. It shows fiscal document status for invoices,
submission results/errors and the accepted issue/retry/cancel actions. Add only
the `fiscal-ui` settings keys required by the fake-provider workflow, with a
closed schema and no secrets. Portal document/KuDE access remains in [[TD-022]].

Benefits: closes EPIC-15 operational needs without designing customer document
exposure before the real provider.

Costs: portal journey remains deferred until provider/document shape is real.

### Option B — Backend-only Fiscal abstraction, no staff UI

Benefits: smaller. Costs: contradicts [[DEC-042]]'s surface hand-off and leaves
operators without visibility into queued fiscal work.

### Option C — Add portal document access now

Rejected unless explicitly accepted: customer-visible fiscal documents require
privacy/product decisions and likely real provider KuDE shape.

## Recommendation

Option A.

## Impact

### Product

Staff can operate the fake Fiscal flow; customers still do not see fiscal
documents in the portal.

### Architecture

The UI consumes Fiscal APIs and semantic design tokens; backend authorization
remains authoritative.

### Database/API

Settings registry gains only closed, non-secret `fiscal-ui` fields selected by
implementation.

### Delivery

FISC-005 owns the surface, settings and closure evidence.

## Decision

Accepted: EPIC-15 will provide a minimal staff-only Fiscal surface, gated by the
`fiscal` entitlement, for document status, submission results/errors, and the
accepted issue/retry/cancel actions. The `fiscal-ui` settings namespace will
include only the closed, non-secret keys required by the fake-provider workflow.
Customer portal fiscal-document access remains deferred under [[TD-022]].

## PRD Update

No PRD change is required.
