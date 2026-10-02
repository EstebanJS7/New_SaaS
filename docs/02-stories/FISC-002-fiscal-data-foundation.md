---
id: FISC-002
type: story
title: Fiscal data foundation
epic: EPIC-15
status: planned
priority: high
depends_on:
  - FISC-001
prd_sections:
  - "22"
  - "40"
  - "41"
permissions:
  - fiscal.invoice.issue
branch:
created: 2026-10-02
updated: 2026-10-02
---

# FISC-002 — Fiscal data foundation

## Objective

Add the tenant-scoped FiscalDocument persistence foundation and additive invoice
linkage required by the Fiscal abstraction.

## Context

PRD §22 requires `FiscalDocument` to store provider, external id, state, CDC,
XML/KuDE storage refs, sanitized snapshots, attempts/errors and timestamps.
[[DEC-042]] requires additive invoice linkage and forbids fiscal state on the
Billing aggregate.

## In Scope

- Fiscal provider/state enums and `FiscalDocument` schema.
- Tenant ownership keys and source invoice ownership constraints.
- Storage-reference fields for XML/KuDE, CDC/external identifiers and sanitized
  snapshot/error fields.
- Seed/probe updates required by accepted decisions.
- Schema and live-PostgreSQL evidence.

## Out of Scope

- Provider execution, BullMQ worker and API submission flow.
- Concrete third-party/SIFEN provider fields beyond safe references.
- Portal documents and printed/PDF rendering.

## Acceptance Criteria

- [ ] `FiscalDocument` exists as a tenant-scoped table with
      `@@unique([tenantId,     id])` ownership and tenant-safe invoice linkage.
- [ ] Fiscal states and provider enum values match the accepted decision and are
      represented without duplicating state onto `Invoice`.
- [ ] Database constraints prevent duplicate live issuance for the same source
      invoice according to the accepted multiplicity/idempotency rule.
- [ ] Request/response snapshots and provider errors are stored only in
      sanitized fields; secret material is not persisted.
- [ ] Schema tests and live-PostgreSQL probes cover constraints, tenant
      isolation and rejected cross-tenant references.
- [ ] Seed-count and route-contract probes are reconciled if new fiscal keys or
      settings are added.

## Domain Invariants

- A private fiscal record is tenant-scoped and never cross-tenant addressable.
- A FiscalDocument references its source invoice through tenant ownership, not a
  bare UUID trust path.
- Fiscal state is immutable except through explicit Fiscal operations.

## API

### Added

```text
None yet, unless accepted decisions require read endpoints in this slice.
```

### Changed

```text
None.
```

## Database

### Migration

```text
Additive EPIC-15 fiscal data foundation migration.
```

### Models/Tables

- `FiscalDocument`
- Fiscal provider/state enums
- Any accepted helper table for attempts if the decision selects a normalized
  shape.

## UI

- None.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- Planned database schema tests.
- Planned live-PostgreSQL constraint/isolation probes.

## Known Limitations

- No provider execution until FISC-003/FISC-004.

## Technical Debt

- None planned.

## Decisions / ADRs

- Depends on accepted [[DEC-046]], [[DEC-049]] and [[DEC-050]].

## Files / Modules

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/*_fiscal_data_foundation/`
- `packages/database/src/*fiscal*.test.ts`
- `apps/api/test/live-pg-isolation.e2e-spec.ts`

## Completion Notes

_Status must remain non-done until all required gates pass._
