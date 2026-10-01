---
id: DEC-037
type: decision
title: Cash UI scope (EPIC-13)
status: accepted
date: 2026-09-29
related_epics:
  - "EPIC-13"
related_decisions:
  - "DEC-034"
related_stories:
  - "CASH-004"
prd_change_required: false
---

# DEC-037 — Cash UI scope (EPIC-13)

## Context

EPIC-12 shipped the staff POS surface and colocated `cash-api.ts` under the
sales route because no Cash UI existed yet. EPIC-13 finishes the Cash product
surface: registers, sessions, manual movements and close.

## Question

How much Cash UI belongs to EPIC-13?

## Options

### Option A — Full operational Cash UI (recommended)

EPIC-13 includes register and session management, open and close flows with the
expected/counted comparison, the movement list with reasons, the create flow for
each movement type, relocation of the shared cash client module out of the sales
route, and a navigation entry behind the `cash` capability.

Benefits: the backend Cash epic is usable by staff, and the client module moves
to the domain that now owns it.

Costs: the epic includes a web slice in addition to the backend slices.

### Option B — Backend only

Build the close and movement APIs, leaving all UI for a later epic.

Costs: staff cannot operate the Cash module without direct API calls, and the
sales route continues to own a Cash client file.

## Recommendation

Option A. Cash close and manual movements are operational workflows, not hidden
APIs.

## Impact

### Product

Staff get a Cash workspace for registers, sessions, movements and close.

### Architecture

No new frontend framework or state library. The surface follows the existing
Next.js staff route convention and semantic design-token rules.

### Database/API

No extra data model beyond the Cash backend slices; the UI consumes the Cash API
and treats frontend checks as UX only.

### Delivery

CASH-004 owns the UI, navigation and client-module relocation.

## Decision

Accepted on 2026-09-29 by the maintainer. Option A is the decision: EPIC-13
includes the full operational Cash UI, moves `cash-api.ts` from the sales route
to its Cash-owned location and adds navigation behind the `cash` capability.

## PRD Update

No PRD change is required. PRD §20 defines the Cash behavior; this decision
records the MVP staff surface needed to operate it.
