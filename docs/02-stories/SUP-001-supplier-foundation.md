---
id: SUP-001
type: story
title: Supplier foundation
epic: EPIC-11
status: planned
priority: high
depends_on:
  - EPIC-10
prd_sections:
  - "5"
  - "7"
  - "9"
  - "28"
  - "29"
  - "41"
permissions: []
branch:
created: 2026-09-26
updated: 2026-09-26
---

# SUP-001 — Supplier foundation

## Objective

Deliver the tenant-scoped supplier registry that purchases reference: the
persistence foundation for the `suppliers` Core domain named by PRD §5, a
tenant-safe repository/service seam, a read/write API behind granular
permissions, and the isolation tests a private aggregate requires.

PRD §17 requires purchases to exist but does not define supplier attributes,
uniqueness or lifecycle. This Story therefore fixes the structural contract that
governance already mandates — tenant scoping, ownership keys, authorization,
strict DTO validation, deactivation instead of delete, isolation tests — and
leaves the attribute set to an accepted Decision record (see "Resolved by
Decision") rather than inventing fields.

## Context

- PRD §5 lists `suppliers` as a Core domain; the roadmap places it in
  [[EPIC-11]] after [[EPIC-10]] Inventory.
- No supplier model, route, permission or seed exists today: a repository-wide
  search for `supplier` returns only reserved comments and unrelated matches.
- Precedents this Story reuses: the catalog's tenant-safe repository and
  allowlisted INTERNAL DTO (`apps/api/src/catalog/`), the tenant composite
  ownership key (`@@unique([tenantId, id])`) that `CatalogItem` and
  `Appointment` already expose, the additive-migration plus `schema-*.test.ts`
  gate convention, and the seeded permission and role-matrix shape added by
  [[EPIC-09]] and [[EPIC-10]].
- PRD §41 requires every new field carrying personal, fiscal or secret material
  to be classified. If the attribute Decision includes a tax identifier, a
  contact person or an email, that field needs a classification and a
  no-logging rule before it is persisted.

## In Scope

- `packages/database/prisma/schema.prisma` — the supplier model with a tenant
  composite ownership key and a `RESTRICT` tenant foreign key.
- An additive migration under `packages/database/prisma/migrations/`, plus a
  `packages/database/src/schema-*.test.ts` gate mirroring the catalog and
  inventory schema tests.
- `apps/api/src/suppliers/` — permission contract, allowlisted DTOs, strict Zod
  contracts, tenant-safe repository, service, controller and module; the module
  registration in `apps/api/src/app.module.ts`.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the new routes and their
  per-route permission pins.
- `packages/database/src/reference-seed.ts` — the new permission keys and their
  role matrix, with the reconciled seed-count probe.
- Tenant isolation and validation tests over the real guard chain.
- This Story and the epic record.

## Out of Scope

- **Purchases and receiving** — [[PUR-001 Purchase draft]] and
  [[PUR-002 Purchase receiving]].
- **Supplier balances, accounts payable, payments and settlement** —
  [[EPIC-12]] and [[EPIC-13]]. A supplier here is identity data, not a ledger.
- **Supplier portal or supplier self-service** — portal access is a separate
  security boundary.
- **Supplier or purchase imports** — [[EPIC-19]].
- **Low-stock or purchasing reports** — [[EPIC-18]].
- **Staff UI** — [[PUR-003 Staff purchases surface]] owns the browser surface.
- **A Decision record for the attribute set.** The Decision must exist before
  the schema and DTO are written, but authoring `docs/07-decisions/` is a
  separate slice outside this Story's file surface.

## Acceptance Criteria

- [ ] Supplier records are tenant-scoped with a tenant composite ownership key
      and a `RESTRICT` tenant foreign key; a cross-tenant or unknown supplier
      UUID is one byte-equivalent `404`, indistinguishable by shape or message.
- [ ] Every route enforces authentication, server-side tenant context and a
      granular permission; the service re-asserts the permission before any data
      access, so a missing permission is `403` and persists nothing.
- [ ] Request and response contracts are allowlisted and strict: unknown keys
      are rejected, `tenantId` is never read from body, query or route, and no
      Prisma model crosses the HTTP boundary.
- [ ] Removal is an explicit deactivation command, never a hard delete: there is
      no `DELETE` route and no generic `PATCH isActive`.
- [x] The supplier attribute set, uniqueness rules, lifecycle and data
      classification are fixed by the accepted [[DEC-011]] record (accepted
      2026-09-26), which is binding on this slice; the schema and DTO themselves
      are still not written, and no attribute is persisted on assumption.
- [ ] Supplier changes do not cascade-delete or orphan a purchase reference: a
      deactivated supplier stays readable for historical purchases.
- [ ] The new permission keys and role matrix are seeded, and the seed-count
      probe is reconciled, including whether the `purchases` entitlement gates
      the surface.
- [ ] Tenant isolation tests exist for the new private aggregate (list, create,
      read, update, deactivate), including a cross-tenant reference.
- [ ] Required lint/typecheck/test checks pass.

## Domain Invariants

- **Every supplier belongs to exactly one tenant.** Tenant identity comes only
  from the server-side request context; a cross-tenant UUID is a `404`.
- **Ownership is enforced twice.** The composite tenant foreign key rejects a
  cross-tenant reference at the database, and the service resolves the record
  through the tenant-safe repository, which renders one shared `404` for a
  foreign and an unknown id.
- **Deactivation is not deletion.** Existing purchases keep their supplier
  reference; history is preserved.
- **No supplier is a financial record.** This Story persists identity data only;
  it stores no balance, no owed amount and no payment state.

## API

### Added

```text
None yet. The routes and their permission keys are fixed by the accepted
Decision records and the implementation slice; no route is implemented yet.
```

### Changed

```text
None yet.
```

## Database

### Migration

```text
None yet. An additive migration is required; no destructive statement is
accepted.
```

### Models/Tables

- Proposed `Supplier` with a tenant composite ownership key and a `RESTRICT`
  tenant foreign key. The attribute columns, indexes and uniqueness constraints
  are fixed by the accepted [[DEC-011]] record.

## UI

- None. [[PUR-003 Staff purchases surface]] owns the supplier pages.
- If UI is changed later, reusable components must use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

_Not implemented. All required Decision records are accepted as of 2026-09-26 —
[[DEC-011 Supplier identity, uniqueness and classification]], [[DEC-016
Suppliers/purchases permission keys, role matrix and entitlement gating]] and
[[DEC-017 Suppliers/purchases audit scope]] — and the slice awaits
implementation authorization._

## Verification

```text
Not run.
```

## Tests Added

- None yet. Planned: `schema-*.test.ts` gates for the new table and its tenant
  ownership key, an HTTP integration suite over the real guard chain
  (permissions, cross-tenant `404`, strict DTO rejects, deactivation without
  delete), and a route-contract pin for the new permissions.

## Known Limitations

- None recorded; the Story is unimplemented.

## Technical Debt

- None.

## Decisions / ADRs

- Accepted Decision records govern this Story (accepted 2026-09-26):
  - [[DEC-011 Supplier identity, uniqueness and classification]] — fixes the
    required and optional supplier attributes, the per-tenant `taxId` uniqueness
    rule and its mechanism, the lifecycle and the per-field data classification.
  - [[DEC-016 Suppliers/purchases permission keys, role matrix and entitlement
    gating]] — fixes the `suppliers.*` keys, the role matrix that holds them and
    the absence of an entitlement gate.
  - [[DEC-017 Suppliers/purchases audit scope]] — fixes supplier
    create/update/deactivate audit as exactly one co-committed row per accepted
    mutation.
- An ADR is not expected: the supplier aggregate introduces no architecture
  change that the complexity budget gates.

## Resolved by Decision

- **Required attributes and uniqueness** — answered by [[DEC-011]]: `name` is
  required (1..200 characters, not unique) and `legalName`, `taxId` (RUC),
  `email`, `phone` and `address` are optional, with `taxId` unique per tenant
  when present through a partial unique index over `(tenant_id, tax_id) WHERE
  tax_id IS NOT NULL`.
- **Lifecycle** — answered by [[DEC-011]]: the lifecycle is the catalog's, an
  `isActive` flag with an explicit deactivate command and no delete route.
- **Data classification** — answered by [[DEC-011]]: `taxId`, `legalName`,
  `email`, `phone` and `address` are CONFIDENTIAL, `name` is INTERNAL, and
  application logs carry IDs only.
- **Permission keys and role matrix** — answered by [[DEC-016]]: all six roles
  hold `suppliers.read`, `OWNER`, `ADMIN` and `INVENTORY_MANAGER` hold
  `suppliers.create`, `suppliers.update` and `suppliers.deactivate`, and no
  entitlement gate applies.
- **Audit scope** — answered by [[DEC-017]]: supplier create, update and
  deactivate each write exactly one audit row co-committed in the mutation's
  transaction, and reads are never audited.

## Files / Modules

- `packages/database/prisma/schema.prisma` — the proposed supplier model.
- `packages/database/prisma/migrations/<timestamp>_suppliers/` — the additive
  migration.
- `packages/database/src/schema-suppliers.test.ts` — the schema gates.
- `apps/api/src/suppliers/` — permissions, DTOs, Zod contracts, repository,
  service, controller and module.
- `apps/api/src/app.module.ts` — the module registration.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the route and permission
  pins.
- `packages/database/src/reference-seed.ts` — the permission seeds and matrix.
- `docs/01-roadmap/EPIC-11-Suppliers-Purchases.md` — the epic record.

## Completion Notes

_Status must remain non-done until all required gates pass; the attribute
Decision is accepted as of 2026-09-26._
