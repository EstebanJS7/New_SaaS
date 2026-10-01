---
id: TD-026
type: tech-debt
title: List endpoints return unbounded result sets
status: open
severity: medium
related_epics:
  - EPIC-14
related_stories:
  - BILL-002
  - CASH-004
  - POS-004
created: 2026-10-01
updated: 2026-10-01
---

# TD-026 — List endpoints return unbounded result sets

## Context

Every staff list read shipped so far returns the whole tenant-scoped set: no
`take`, no offset, no cursor and no page envelope. The RDD native review of
[[BILL-002]] flagged this on the newest of them as `R4-UNBOUNDED-LIST` (WARNING,
`billing.controller.ts:36-41`) from the resilience lens.

Verified current state in this repository (2026-10-01):

- `GET /invoices` returns every invoice of the tenant with its snapshot lines,
  ordered `createdAt desc, id asc`, with only an optional `status` filter
  (`apps/api/src/billing/billing.repository.ts`).
- The same shape already exists on `GET /sales`, `GET /cash/sessions`,
  `GET /cash/movements` and the other staff lists: each is tenant-predicated,
  ordered, filtered, and bounded by nothing.
- No response DTO carries a page, a total or a cursor, so adding pagination
  later is a **response-shape change** on a public surface rather than an
  additive query parameter.
- `docs/01-roadmap/EPIC-18-Dashboards-Reports.md` and [[EPIC-20]] Production
  Hardening own reporting and hardening; neither has a pagination contract
  today.
- The list includes its child rows (`lines`), so the payload per header grows
  with the document, not just with the row count.

## Debt

The API has no answer for "what happens at ten thousand invoices", and it has no
shared pagination contract to converge on. A tenant that has been invoicing for
a year pays the full cost of the list on every page load, and no consumer can
ask for less.

## Why It Is Safe to Defer

- The slices that shipped it are consistent with each other and with the shipped
  sales and cash lists, so nothing is inconsistent today: the surface behaves
  the way every other staff list behaves.
- Billing's list is bounded in practice by the tenant's own invoice count, and
  the `(tenant_id, status)` index plus the `createdAt desc, id asc` order means
  the database returns them in a stable, index-backed sequence whenever a limit
  is later applied.
- No consumer depends on an exhaustive list yet: [[BILL-004]] owns the staff
  surface and no reporting epic has shipped.
- Every current acceptance criterion holds: the criteria require the list to be
  tenant-scoped and filtered, not bounded.

## Risk

- A single tenant with a long history makes one page render pull every invoice
  and every line: latency and memory grow with the tenant's age, which is the
  classic shape of a slow-motion outage.
- Deferring makes it a breaking change. Once a client depends on the array
  response, pagination needs either an envelope (breaking) or a second endpoint.
- Adding a silent default cap later would be worse than either: it would
  truncate results with no way for a caller to page past the cut, which is why
  this record recommends a contract instead of a limit.

## Proposed Resolution

Decide one pagination contract and apply it to every staff list in the same
slice rather than per surface:

1. Choose the shape (cursor on `(createdAt, id)` suits the existing order,
   offset is simpler to consume) and a default plus maximum page size.
2. Return a stable envelope with the items and the cursor, and keep the filter
   parameters additive.
3. Apply it to `GET /invoices`, `GET /sales`, `GET /cash/sessions` and
   `GET /cash/movements` together, updating each route's contract probe pin and
   integration cases.
4. Record the response-shape change as a Decision, since it is visible to every
   client.

## Trigger / Target

Address it in the slice that first needs a bounded list — a report, an export or
a tenant whose list stops being usable — or in [[EPIC-20]] Production Hardening,
which owns hardening of the shipped surfaces. Owner: whichever slice takes it,
with a Decision because the response shape is public.

## Verification After Resolution

- [ ] A Decision records the chosen contract, the default and maximum page size
      and the response shape.
- [ ] Every staff list endpoint implements it, and each route-contract pin is
      updated in the same work unit.
- [ ] Integration and live-PostgreSQL cases prove the first page, the next page,
      the last page and that a request above the maximum is rejected or clamped
      as decided.
- [ ] The unbounded-list limitation is removed from the [[BILL-002]] record.
- [ ] This record is `resolved` or superseded by the change that closed it.
