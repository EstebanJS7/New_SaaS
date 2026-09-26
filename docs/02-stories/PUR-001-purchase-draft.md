---
id: PUR-001
type: story
title: Purchase draft
epic: EPIC-11
status: planned
priority: high
depends_on:
  - EPIC-10
  - SUP-001
prd_sections:
  - "5"
  - "7"
  - "9"
  - "17"
  - "27"
  - "28"
  - "29"
  - "41"
permissions: []
branch:
created: 2026-09-26
updated: 2026-09-26
---

# PUR-001 — Purchase draft

## Objective

Deliver the `DRAFT` half of PRD §17's purchase lifecycle: create a tenant-scoped
draft purchase that references a supplier and one or more in-tenant catalog
items, edit it while it stays `DRAFT`, and cancel it through an explicit
command. A draft has no stock, cash, billing or fiscal effect: it is inert until
[[PUR-002 Purchase receiving]] receives it.

This Story establishes the purchase aggregate, its `DRAFT`/`RECEIVED`/
`CANCELLED` state enum and the tenant-safe read/write seam that the receiving
command reuses. It does not define numbering, line cost/tax structure or
cancellation reachability, which PRD §17 leaves open and which the accepted
Decisions now fix (see "Resolved by Decision").

## Context

- PRD §17 defines exactly three purchase states and the receiving steps; it
  defines no purchase number, no line cost, no tax total and no cancellation
  rule.
- No purchase model, route, permission or seed exists today; the schema comment
  reserves the `PURCHASE` stock movement type for this epic.
- The catalog establishes the tenant-reference precedent: a line pointing at an
  in-tenant catalog item is resolved through a tenant-safe repository and a
  cross-tenant id collapses to the same `404` as an unknown one.
- The engineering rules prefer explicit command endpoints over
  `PATCH status=...`, so `RECEIVED` and `CANCELLED` are commands rather than
  status writes.

## In Scope

- `packages/database/prisma/schema.prisma` — the `Purchase` and `PurchaseLine`
  models, a `purchase_status` enum pinned to `DRAFT`, `RECEIVED`, `CANCELLED`,
  the tenant composite ownership keys and the `RESTRICT` references to the
  supplier, tenant and catalog items.
- An additive migration under `packages/database/prisma/migrations/`, plus a
  `packages/database/src/schema-*.test.ts` gate.
- `apps/api/src/purchases/` — permission contract, allowlisted DTOs, strict Zod
  contracts, tenant-safe repository, service, controller and module; the module
  registration in `apps/api/src/app.module.ts`.
- Draft create, edit, cancel and read routes, with `DRAFT`-only mutation guards.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the new routes and their
  per-route permission pins.
- `packages/database/src/reference-seed.ts` — the new permission keys and role
  matrix, with the reconciled seed-count probe.
- Tenant isolation and validation tests over the real guard chain.
- This Story and the epic record.

## Out of Scope

- **Receiving and any stock effect** — [[PUR-002 Purchase receiving]]. This
  Story creates no `StockMovement` and touches no `StockBalance`.
- **Cash, billing, fiscal, payment settlement and POS** — [[EPIC-12]],
  [[EPIC-13]], [[EPIC-14]], [[EPIC-15]] and [[EPIC-16]]. A draft stores no
  payment, no invoice and no fiscal document.
- **Purchase reversal** — PRD §40 names it as a correction case, but no reversal
  command is added here.
- **Partial receiving, partial state or back-order state** — PRD §17 defines no
  partial state.
- **Low-stock thresholds or reports** — [[EPIC-18]].
- **Staff UI** — [[PUR-003 Staff purchases surface]].
- **Numbering, cost/tax structure and cancellation semantics as implemented
  behavior.** These are fixed by the accepted Decision records; no assumed value
  is persisted.
- **A Decision record in `docs/07-decisions/`** — a separate slice outside this
  Story's file surface.

## Acceptance Criteria

- [ ] The purchase status enum is exactly `DRAFT`, `RECEIVED`, `CANCELLED` (PRD
      §17); no other state is representable, and there is no partial or
      back-order state.
- [ ] A purchase is tenant-scoped with a tenant composite ownership key and a
      `RESTRICT` tenant foreign key; a cross-tenant or unknown purchase UUID is
      one byte-equivalent `404`.
- [ ] A referenced supplier and every referenced catalog item are resolved in
      the caller's tenant; a foreign or unknown reference is rejected with the
      same shared `404` and persists nothing.
- [ ] Only a `DRAFT` purchase is mutable: editing or cancelling a `RECEIVED`
      purchase is `409 CONFLICT` and persists nothing.
- [ ] Receiving and cancelling are explicit transition commands, never a generic
      `PATCH status` write.
- [ ] Cancellation never deletes a purchase or a line; a cancelled purchase and
      its lines remain readable, and cancellation reachability follows the
      accepted Decision.
- [ ] All request bodies are strict allowlisted contracts that reject unknown
      keys; `tenantId` is never read from body, query or route; no Prisma model
      crosses the HTTP boundary.
- [ ] Every route enforces authentication, server-side tenant context and a
      granular permission, re-asserted by the service before data access; a
      missing permission is `403` and persists nothing.
- [ ] The draft write path performs no stock movement, balance change, cash
      movement, invoice, payment or fiscal operation.
- [x] Purchase numbering, the line cost/tax structure, supplier optionality and
      cancellation semantics are fixed by accepted and binding Decision records
      ([[DEC-012]], [[DEC-013]], [[DEC-015]], [[DEC-018]], accepted 2026-09-26)
      **before** the schema and DTO are written; the schema and DTO themselves
      are still not written, and no numbering or monetary total is invented.
- [ ] The new permission keys and role matrix are seeded, and the seed-count
      probe is reconciled.
- [ ] Tenant isolation tests exist for the new private aggregate, and
      authorization and validation tests cover every new route.
- [ ] Required lint/typecheck/test checks pass.

## Domain Invariants

- **A draft is inert.** No draft operation changes stock, cash, an invoice or a
  fiscal document.
- **Every purchase belongs to exactly one tenant.** Tenant identity comes only
  from the server-side request context; a cross-tenant UUID is a `404`.
- **Ownership is enforced twice.** The composite tenant foreign keys reject a
  cross-tenant supplier or catalog-item reference at the database, and the
  service resolves references through the tenant-safe repository, which renders
  one shared `404` for a foreign and an unknown id.
- **Confirmed state is immutable.** Once a purchase is `RECEIVED` it is no
  longer editable; a correction is a future compensating operation, not an edit.
- **History is preserved.** No purchase, line or reference is hard-deleted.
- **The status enum is the PRD's.** `DRAFT`, `RECEIVED`, `CANCELLED` only.

## API

### Added

```text
None yet. The routes and their permission keys are fixed by the accepted
Decision records and the implementation slice; no route is implemented yet.
```

### Changed

```text
None yet. The existing catalog and inventory routes are untouched.
```

## Database

### Migration

```text
None yet. An additive migration is required; no destructive statement is
accepted.
```

### Models/Tables

- Proposed `Purchase` — tenant composite ownership key, `purchase_status`
  column, `RESTRICT` supplier reference, timestamps; no numbering column exists
  per [[DEC-018]].
- Proposed `PurchaseLine` — tenant composite ownership key, `RESTRICT` purchase
  and catalog-item references, and a quantity with the same exact decimal
  discipline the inventory ledger uses (`DECIMAL(10, 3)`). The cost question is
  resolved per [[DEC-013]]: one optional informational unit cost, and no tax
  rate, computed total or purchase total.

## UI

- None. [[PUR-003 Staff purchases surface]] owns the draft pages.
- If UI is changed later, reusable components must use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

_Not implemented. All required Decision records are accepted as of 2026-09-26 —
[[DEC-012]] purchase aggregate shape and the draft-versus-receive validation
gate, [[DEC-013]] purchase line cost and tax structure, [[DEC-015]] purchase
cancellation and the correction boundary for a received purchase, [[DEC-016]]
suppliers/purchases permission keys, role matrix and entitlement gating,
[[DEC-017]] suppliers/purchases audit scope and [[DEC-018]] purchase numbering
(EPIC-11) — and the slice awaits implementation authorization._

## Verification

```text
Not run.
```

## Tests Added

- None yet. Planned: `schema-*.test.ts` gates for the two tables, the status
  enum literal and the composite ownership keys; an HTTP integration suite over
  the real guard chain (draft create/edit/cancel/read, cross-tenant `404` on the
  purchase and on each reference, `DRAFT`-only mutation guards, strict DTO
  rejects, permission sweep with nothing persisted); and a route-contract pin.

## Known Limitations

- None recorded; the Story is unimplemented.

## Technical Debt

- None.

## Decisions / ADRs

- Accepted Decision records govern this Story (accepted 2026-09-26):
  - [[DEC-012]] — purchase aggregate shape and the draft-versus-receive
    validation gate, which fixes what a purchase aggregate must contain to be
    saved as a draft and to be received, including required `supplierId`, at
    least one line, strictly positive quantities, and the moment catalog-item
    state is checked.
  - [[DEC-013]] — purchase line cost and tax structure, which fixes the line's
    single optional informational unit cost and the absence of a tax rate, a
    computed line total or a purchase total.
  - [[DEC-015]] — purchase cancellation and the correction boundary for a
    received purchase, which fixes that `CANCELLED` is reachable only from
    `DRAFT` and that a `RECEIVED` purchase is corrected only by a future
    reversal.
  - [[DEC-016]] — suppliers/purchases permission keys, role matrix and
    entitlement gating, which fixes the `purchases.*` keys, the role matrix that
    holds them and the absence of an entitlement gate.
  - [[DEC-017]] — suppliers/purchases audit scope, which fixes purchase
    create/update/cancel audit as exactly one co-committed row per accepted
    mutation.
  - [[DEC-018]] — purchase numbering (EPIC-11), which fixes that the aggregate
    carries no human-readable number.
- An ADR is not expected: the draft aggregate introduces no architecture change
  that the complexity budget gates.

## Resolved by Decision

- **Purchase numbering** — answered by [[DEC-018]]: the aggregate carries no
  human-readable number, so there is no number column, no sequence and no
  allocation step.
- **Required shape and optionality** — answered by [[DEC-012]]: `supplierId` is
  required, a saved draft has at least one line, and a line quantity is strictly
  positive.
- **Cost and tax** — answered by [[DEC-013]]: a line carries one optional
  informational unit cost and no tax rate, computed line total or purchase
  total.
- **Cancellation reachability** — answered by [[DEC-015]]: `CANCELLED` is
  reachable only from `DRAFT`, and a `RECEIVED` purchase is immutable and is
  corrected only by a future reversal.
- **Permission keys and role matrix** — answered by [[DEC-016]]: the
  `purchases.*` keys exist with a fixed role matrix, and no entitlement gate
  applies.
- **Audit scope for draft changes** — answered by [[DEC-017]]: purchase create,
  update and cancel each write exactly one co-committed audit row per accepted
  mutation.

## Open implementation details (inside approved scope)

The single item below is an implementation choice inside approved scope, decided
during this Story's implementation using the sibling modules as precedent. It is
an implementation choice inside approved scope rather than an open product
decision, and no Decision record is required for it.

1. **Concurrency and immutability guard.** Should draft edits take a row lock,
   or is an optimistic last-write-wins update acceptable for a draft?

## Files / Modules

- `packages/database/prisma/schema.prisma` — the proposed purchase models.
- `packages/database/prisma/migrations/<timestamp>_purchases/` — the additive
  migration.
- `packages/database/src/schema-purchases.test.ts` — the schema gates.
- `apps/api/src/purchases/` — permissions, DTOs, Zod contracts, repository,
  service, controller and module.
- `apps/api/src/app.module.ts` — the module registration.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the route and permission
  pins.
- `packages/database/src/reference-seed.ts` — the permission seeds and matrix.
- `docs/01-roadmap/EPIC-11-Suppliers-Purchases.md` — the epic record.

## Completion Notes

_Status must remain non-done until all required gates pass; the required
Decisions are accepted as of 2026-09-26._
