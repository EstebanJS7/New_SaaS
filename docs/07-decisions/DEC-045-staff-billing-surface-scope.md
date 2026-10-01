---
id: DEC-045
type: decision
title: Staff billing surface scope (EPIC-14)
status: proposed
date: 2026-10-01
related_epics:
  - "EPIC-14"
related_decisions:
  - "DEC-037"
  - "DEC-040"
  - "DEC-042"
  - "DEC-044"
related_stories:
  - "BILL-004"
prd_change_required: false
---

# DEC-045 — Staff billing surface scope (EPIC-14)

## Context

Every epic in this repository ships its own staff surface in the same epic as
the behaviour it exposes, with documented UX states and semantic design tokens
only. [[DEC-037]] is the EPIC-13 precedent: the operational UI is part of the
epic, not a follow-up.

Verified current state in this repository (2026-10-01):

- `apps/web/src/components/shell/nav-sidebar.tsx` has entries for `POS`
  (`requiredFeature: "sales"`) and `Cash` (`requiredFeature: "cash"`) and no
  Billing entry.
- `apps/web/src/app/api/cash/` and `apps/web/src/app/api/sales/` are the shipped
  proxy precedents: a Next.js route handler that forwards staff cookie context
  to the API and allowlists the forwarded routes, with the client module
  colocated in the surface's own route directory (EPIC-13 moved the Cash client
  out of the sales route for exactly this reason).
- The web suite is 81 files / 940 tests and the API route-contract probe pins
  routes and permissions, so a new surface moves real pinned expectations.
- The `billing` feature code is seeded, so the navigation entry can use
  `requiredFeature: "billing"`, following the `sales`/`cash` pattern including
  the dormant-gate limitation EPIC-13 recorded.
- No fiscal UI exists and [[DEC-042]] keeps the `fiscal-ui` namespace in
  [[EPIC-15]].

## Question

What exactly does the EPIC-14 staff surface include, and what does it
deliberately not include?

## Options

### Option A — One operational Billing workspace (recommended)

A `/app/billing` workspace with: a status-filtered invoice list; an invoice
detail view showing the immutable snapshot lines, the money totals and the audit
metadata (status, number, confirmation/cancellation timestamps); create-from-a-
completed-sale; confirm; and cancel with a reason. It covers loading, empty,
error, success, permission-denied and entitlement-denied states, uses semantic
design tokens only, and gates the navigation entry behind
`requiredFeature: "billing"`. The client module lives in a Billing-owned route
directory with a `/api/billing` proxy that allowlists only the Billing routes.

Benefits: it follows [[DEC-037]] and the shipped sales/cash precedent exactly,
so reviewers can verify it against an existing surface rather than a new
pattern.

Costs: it moves the web suite's pinned counts and adds another gated navigation
entry with the same dormant-gate limitation EPIC-13 already recorded.

### Option B — No UI in EPIC-14 (API only)

Ship the Billing API and leave the surface to a later epic or to [[EPIC-18]].

Costs: it breaks the repository's Definition of Done ("a feature requiring
persistence/API/UI is not done until ... frontend; loading/empty/error/success
states"), and it would leave an epic with a non-operable domain.

### Option C — Workspace plus a printable invoice document

Also render a printable invoice (PDF or print view) with a formatted number.

Rejected for this epic: [[DEC-018]], [[DEC-039]] and [[DEC-044]] keep printed
document rendering with the epic that owns a printed or fiscal document, and
number formatting is not yet decided.

## Recommendation

Option A. The rule to hold while implementing: the surface performs no money
arithmetic, displays the server-computed snapshot values as returned, and shows
no fiscal state because none exists in this epic.

## Impact

### Product

Staff can list, inspect, create, confirm and cancel invoices with the full set
of UX states; a tenant without the `billing` capability sees no Billing entry.

### Architecture

No new runtime or dependency. The proxy pattern and the client-module placement
follow the shipped EPIC-13 precedent; the UI gate stays UX only and backend
authorization remains the authority.

### Database/API

No new API surface beyond the Billing routes the earlier stories own; the proxy
allowlists exactly those routes and forwards staff cookie context only, never
portal context.

### Delivery

BILL-004 owns the pages, the proxy, the client module, the state coverage and
the navigation entry. The closing story records the dormant-gate limitation and
the absence of a print/export feature as explicit limitations.

## Decision

_Pending. Proposed to the maintainer on 2026-10-01; Option A is recommended._

## PRD Update

No PRD change is required. This record applies the existing Definition of Done
and [[DEC-037]]'s precedent to a new surface; it adds no product scope.
