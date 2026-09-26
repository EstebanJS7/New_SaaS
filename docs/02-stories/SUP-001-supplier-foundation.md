---
id: SUP-001
type: story
title: Supplier foundation
epic: EPIC-11
status: done
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
permissions:
  - suppliers.read
  - suppliers.create
  - suppliers.update
  - suppliers.deactivate
branch: feat/epic-11-suppliers-purchases
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
  contact person or an email, that field needs a classification and a no-logging
  rule before it is persisted.

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
- **Supplier balances, accounts payable, payments and settlement** — [[EPIC-12]]
  and [[EPIC-13]]. A supplier here is identity data, not a ledger.
- **Supplier portal or supplier self-service** — portal access is a separate
  security boundary.
- **Supplier or purchase imports** — [[EPIC-19]].
- **Low-stock or purchasing reports** — [[EPIC-18]].
- **Staff UI** — [[PUR-003 Staff purchases surface]] owns the browser surface.
- **A Decision record for the attribute set.** The Decision must exist before
  the schema and DTO are written, but authoring `docs/07-decisions/` is a
  separate slice outside this Story's file surface.

## Acceptance Criteria

- [x] Supplier records are tenant-scoped with a tenant composite ownership key
      and a `RESTRICT` tenant foreign key; a cross-tenant or unknown supplier
      UUID is one byte-equivalent `404`, indistinguishable by shape or message.
- [x] Every route enforces authentication, server-side tenant context and a
      granular permission; the service re-asserts the permission before any data
      access, so a missing permission is `403` and persists nothing.
- [x] Request and response contracts are allowlisted and strict: unknown keys
      are rejected, `tenantId` is never read from body, query or route, and no
      Prisma model crosses the HTTP boundary.
- [x] Removal is an explicit deactivation command, never a hard delete: there is
      no `DELETE` route and no generic `PATCH isActive`.
- [x] The supplier attribute set, uniqueness rules, lifecycle and data
      classification are fixed by the accepted [[DEC-011]] record (accepted
      2026-09-26), which is binding on this slice; the schema and DTO implement
      exactly that record and persist no attribute on assumption.
- [x] Supplier changes do not cascade-delete or orphan a purchase reference: a
      deactivated supplier stays readable for historical purchases. _Note: no
      purchase table exists yet, so this holds today through the `RESTRICT`
      tenant/supplier foreign keys plus deactivation-without-delete — a supplier
      row can never be removed and its deactivated state never rewrites a
      reference. The purchase-side half of the criterion becomes testable with
      [[PUR-001 Purchase draft]]._
- [x] The new permission keys and role matrix are seeded, and the seed-count
      probe is reconciled, including whether the `purchases` entitlement gates
      the surface. _Resolved: no entitlement gate applies — suppliers are a Core
      capability, like catalog and inventory. The seed count moved 34 → 38; five
      further `purchases.*` keys arrive with PUR-001/PUR-002._
- [x] Tenant isolation tests exist for the new private aggregate (list, create,
      read, update, deactivate), including a cross-tenant reference.
- [x] Required lint/typecheck/test checks pass.

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

| Route                            | Permission             | Contract                                                     |
| -------------------------------- | ---------------------- | ------------------------------------------------------------ |
| `GET /suppliers`                 | `suppliers.read`       | Caller-tenant list; optional `isActive`; no implicit filter. |
| `GET /suppliers/:id`             | `suppliers.read`       | One supplier; foreign/unknown UUID is the same `404`.        |
| `POST /suppliers`                | `suppliers.create`     | Create one supplier (`201`).                                 |
| `PUT /suppliers/:id`             | `suppliers.update`     | Partial update (`200`); omitted keys untouched.              |
| `POST /suppliers/:id/deactivate` | `suppliers.deactivate` | Idempotent soft removal.                                     |

All five routes are unprefixed per [[DEC-002]], return allowlisted INTERNAL
DTOs, and are registered in `apps/api/src/app.module.ts`. The module imports
Context, RBAC and Audit and has no entitlement gate — suppliers are a Core
capability. `GET /suppliers` is ordered by `name` ascending with an id
tiebreaker and applies no implicit active-only default. `PUT /suppliers/:id`
ignores `isActive`: deactivation is its own command. There is no `PATCH` and no
`DELETE` route anywhere on this surface.

### Changed

```text
None. Existing routes are untouched: this Story adds no field, permission or
behavior to any pre-existing API surface.
```

## Database

### Migration

```text
packages/database/prisma/migrations/20260926000001_suppliers/
```

The migration is strictly additive and creates the `supplier` table: a
`RESTRICT` tenant foreign key, the composite ownership unique index
`supplier_tenant_id_id_key` on `(tenant_id, id)`, the partial unique index
`supplier_tenant_id_tax_id_key` on
`(tenant_id, tax_id) WHERE tax_id IS NOT NULL` declared as raw SQL because
Prisma cannot express partial indexes, the lookup index
`supplier_tenant_id_name_idx` on `(tenant_id, name)`, the `supplier_name_length`
CHECK bounding the name to 1..200 characters, and the `BEFORE DELETE` trigger
`supplier_no_delete_trigger` raising `restrict_violation` with the message
`suppliers are deactivated and cannot be hard-deleted`. It alters no existing
table and inserts no rows.

### Models/Tables

`Supplier` (`@@map("supplier")`):

| Column       | Shape                                                               |
| ------------ | ------------------------------------------------------------------- |
| `id`         | `UUID` primary key, `gen_random_uuid()` default                     |
| `tenant_id`  | `UUID NOT NULL`, `RESTRICT` FK to `tenant(id)` on delete and update |
| `name`       | `VARCHAR(200) NOT NULL` — deliberately not unique                   |
| `legal_name` | `VARCHAR(200)` nullable                                             |
| `tax_id`     | `VARCHAR(50)` nullable                                              |
| `email`      | `VARCHAR(320)` nullable                                             |
| `phone`      | `VARCHAR(50)` nullable                                              |
| `address`    | `VARCHAR(500)` nullable                                             |
| `is_active`  | `BOOLEAN NOT NULL DEFAULT true`                                     |
| `created_at` | `TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`                 |
| `updated_at` | `TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`                 |

Physical guarantees:

| Guarantee              | Shape                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Tenant scope           | `supplier_tenant_id_fkey` — `RESTRICT` on delete and update                                        |
| Ownership is composite | `supplier_tenant_id_id_key` unique on `(tenant_id, id)`, the target of the purchase composite FK   |
| Tax id when present    | `supplier_tenant_id_tax_id_key` unique on `(tenant_id, tax_id) WHERE tax_id IS NOT NULL` (raw SQL) |
| Lookup                 | `supplier_tenant_id_name_idx` on `(tenant_id, name)`                                               |
| Name bounds            | `supplier_name_length` `CHECK (char_length("name") BETWEEN 1 AND 200)`                             |
| No hard delete         | `supplier_no_delete_trigger` (`BEFORE DELETE`) raises `restrict_violation`                         |

The schema deliberately declares `@@unique([tenantId, id])` and
`@@index([tenantId, name])` and **no** `@@unique([tenantId, taxId])`, because
the partial index lives only in the migration SQL; the model doc comment
documents that. `name` is not unique on purpose — two suppliers may share a
trading name while `taxId` is unique per tenant when present.

## UI

- None. [[PUR-003 Staff purchases surface]] owns the supplier pages.
- If UI is changed later, reusable components must use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

Implemented on branch `feat/epic-11-suppliers-purchases`. Three work units plus
a correction commit:

- `ed3b056` — data foundation: the `Supplier` model, the additive
  `20260926000001_suppliers` migration and the schema gate.
- `d39d90d` — correction: the partial unique index on `(tenant_id, tax_id)`.
- `826e7ac` — API surface: the module, its five routes, the permission keys and
  their role matrix, and the route-contract pins.

What shipped:

- **Model and migration.** A `supplier` table with the tenant composite
  ownership key, the `RESTRICT` tenant foreign key, the partial per-tenant
  tax-id unique index, the name lookup index, the 1..200 name CHECK and the
  delete-rejecting trigger. The migration is strictly additive.
- **Permissions.** Exactly four keys — `suppliers.read`, `suppliers.create`,
  `suppliers.update`, `suppliers.deactivate` — seeded with the [[DEC-016]] role
  matrix: all six roles hold `suppliers.read`, and only `OWNER`, `ADMIN` and
  `INVENTORY_MANAGER` hold the three write keys. No entitlement gate applies.
  The seed count moved 34 → 38.
- **Module and routes.** `apps/api/src/suppliers/` with the permission contract,
  allowlisted INTERNAL DTOs, strict Zod contracts, tenant-safe repository,
  service, controller and module, registered in `apps/api/src/app.module.ts`.
  The five routes are list, detail, create, partial update and idempotent
  deactivation; there is no `PATCH` and no `DELETE`.
- **Audit.** One co-committed audit row per accepted mutation inside the
  mutating transaction, actions `supplier.created`, `supplier.updated` and
  `supplier.deactivated`, target type `supplier`, metadata
  `{ schemaVersion, changedFields }` carrying field names only. Reads are never
  audited and a repeated deactivation still appends exactly one row.
- **Error contract.** A foreign or unknown supplier UUID is one shared
  byte-equivalent `404 NOT_FOUND` (`Supplier was not found.`); a duplicate
  **present** `taxId` inside one tenant is `409 CONFLICT` with the value-free
  message `A supplier with this tax identifier already exists in this tenant.`,
  scoped to the `supplier_tenant_id_tax_id_key` index, while every unrelated
  Prisma `P2002` is rethrown; unknown keys, a supplied `tenantId` and a supplied
  `isActive` are `400 VALIDATION_FAILED` and persist nothing.

## Verification

Observed results on `feat/epic-11-suppliers-purchases`:

| Command                                     | Result                                                        |
| ------------------------------------------- | ------------------------------------------------------------- |
| `pnpm --filter @newsaas/database test`      | 14 files / 245 tests passed                                   |
| `pnpm --filter @newsaas/api test`           | 71 files passed, 1 skipped (72); 869 tests passed, 58 skipped |
| `pnpm --filter @newsaas/database typecheck` | clean                                                         |
| `pnpm --filter @newsaas/api typecheck`      | clean                                                         |
| `pnpm --filter @newsaas/api lint`           | clean                                                         |
| `git diff --check`                          | clean                                                         |

**Live-PostgreSQL evidence — previously unverified, now closed.** The original
limitation (kept below as history) recorded that the live-PostgreSQL suite could
not run, so the partial index's runtime enforcement and the real
PostgreSQL-rejection path behind the `409` were unproven. That gap is now closed
by the `EPIC-11 suppliers application-path isolation` block in
`apps/api/test/live-pg-isolation.e2e-spec.ts`. The exact command that was run
and its observed result:

```text
set -a && . ./.env && set +a
export DATABASE_URL_TEST="$(sed -n 's/^DATABASE_URL=//p' .env | cut -d'?' -f1)"
pnpm --filter @newsaas/api test:live-pg
→ 1 file / 58 tests passed   (was 52 before this work; +6 supplier cases)
```

The new block exercises the REAL partial index `supplier_tenant_id_tax_id_key`
through Prisma — never a synthetic `P2002` — and observes the stable
`409 CONFLICT` with the exact value-free message on create and update, two
absent identifiers coexisting in one tenant, the same identifier allowed in
another tenant, exactly one of two concurrent duplicates admitted, a
byte-equivalent cross-tenant `404` on read/update/deactivation, and the applied
schema's partial unique index, `RESTRICT` tenant FK and delete-rejecting
trigger. `docker compose up -d` reported `newsaas-postgres` `healthy` and
`pg_isready` accepted connections on `5433`. The migration was also applied to
the local development database by hand. A drift-free `migrate status` against a
persistent database remains the only outstanding database-level check.

## Tests Added

- `packages/database/src/schema-suppliers.test.ts` — **15 tests**: the additive
  migration's table/columns/constraints, the `RESTRICT` tenant FK, the composite
  ownership key, the partial tax-id index, the name CHECK, the delete-rejecting
  trigger, migration additivity, and the model mapping plus the DEC-011
  classification.
- `apps/api/src/suppliers/suppliers.integration.test.ts` — **15 tests** over the
  real guard chain: the read and write permission sweeps that persist nothing on
  denial, the create with its co-committed audit row and allowlisted DTO, the
  invalid create/update sweeps, the absent-versus-null update matrix, the
  byte-equivalent cross-tenant `404` on read/update/deactivation, idempotent
  deactivation, the audit-diff co-commit, the duplicate-`taxId` `409` on create
  and update, the rethrow of an unrelated `P2002`, the absence of any delete or
  patch route, and the list ordering and `isActive` filter.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the five supplier routes
  and their per-route permission pins (`SUPPLIERS_PERMISSION_BY_ROUTE`).

## Known Limitations

- ~~**The migration is unapplied and its runtime enforcement is unverified.**~~
  **Superseded.** The migration is applied in the live suite's disposable
  database and was applied to the local development database by hand; the
  partial index's runtime enforcement and the real PostgreSQL-rejection path
  behind the `409` are now observed (see "Verification"). A drift-free
  `migrate status` against a persistent database has not been run here and
  remains owed.
- ~~**The duplicate-conflict tests inject a synthetic `P2002`.**~~ **Superseded
  as the runtime evidence.** The in-memory `suppliers.integration.test.ts`
  duplicate cases still inject a synthetic Prisma `P2002` shaped like the index
  violation; they remain valid unit-level coverage (they assert in-memory
  supplier state, audit counts and unchanged stored fields, and the matcher
  accepts both plausible `meta.target` shapes defensively), but they are no
  longer the evidence for runtime behaviour — the real PostgreSQL-rejection path
  is now proven by the live suite.
- **The schema gate inspects DDL text, not execution.** The gate asserts the
  migration SQL rather than executing the index; the live suite's introspection
  case now proves the applied index, predicate, `RESTRICT` FK and delete trigger
  at runtime.
- **The partial index lives only in the migration SQL.** Prisma cannot model it,
  so a live-database `migrate status`/drift check is still owed for an index the
  schema cannot represent; the applied index itself is now asserted live.
- **No staff UI.** The module is API-only in this slice;
  [[PUR-003 Staff purchases surface]] owns the browser surface.

## Technical Debt

No debt record is created by this Story. The live-PostgreSQL follow-up is not a
new debt item: it is folded into [[EPIC-11]]'s durable closure criterion ("The
durable live-PostgreSQL evidence for receiving … passes and is recorded in
`docs/10-qa/CI-EVIDENCE.md`"). The evidence owed there, named explicitly, is now
split as follows:

- **Closed** by the `EPIC-11 suppliers application-path isolation` block in
  `apps/api/test/live-pg-isolation.e2e-spec.ts`:
  - a duplicate **present** `taxId` rejected through the partial index and
    surfaced as the stable `409 CONFLICT` (on create and on update);
  - multiple **absent** `taxId` values coexisting inside one tenant;
  - the same `taxId` allowed in another tenant.
- **Still owed** — a drift-free `migrate status` for the index Prisma cannot
  model.

## Decisions / ADRs

- Accepted Decision records govern this Story (accepted 2026-09-26):
  - [[DEC-011 Supplier identity, uniqueness and classification]] — fixes the
    required and optional supplier attributes, the per-tenant `taxId` uniqueness
    rule and its mechanism, the lifecycle and the per-field data classification.
  - [[DEC-016]] _Suppliers/purchases permission keys, role matrix and
    entitlement gating_ — fixes the `suppliers.*` keys, the role matrix that
    holds them and the absence of an entitlement gate.
  - [[DEC-017 Suppliers/purchases audit scope]] — fixes supplier
    create/update/deactivate audit as exactly one co-committed row per accepted
    mutation.
- An ADR is not expected: the supplier aggregate introduces no architecture
  change that the complexity budget gates.

## Resolved by Decision

- **Required attributes and uniqueness** — answered by [[DEC-011]]: `name` is
  required (1..200 characters, not unique) and `legalName`, `taxId` (RUC),
  `email`, `phone` and `address` are optional, with `taxId` unique per tenant
  when present through a partial unique index over
  `(tenant_id, tax_id) WHERE tax_id IS NOT NULL`.
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

- `packages/database/prisma/schema.prisma` — the `Supplier` model.
- `packages/database/prisma/migrations/20260926000001_suppliers/migration.sql` —
  the additive migration.
- `packages/database/src/schema-suppliers.test.ts` — the schema gates.
- `apps/api/src/suppliers/` — permissions, DTOs, Zod contracts, repository,
  service, controller and module.
- `apps/api/src/app.module.ts` — the module registration.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the route and permission
  pins.
- `packages/database/src/reference-seed.ts` — the permission seeds and matrix.
- `docs/01-roadmap/EPIC-11-Suppliers-Purchases.md` — the epic record.

## Completion Notes

Done for implementation and verification scope: the supplier registry, its
additive migration, its four permission keys with the seeded role matrix, its
five routes, its audit rows and its tests are implemented and the runnable
checks are green. This is **not** a production-readiness statement. The durable
live-PostgreSQL evidence for the partial index and the migration application is
now recorded (see "Verification"); a drift-free `migrate status` for the index
Prisma cannot model remains the only outstanding database-level check.
[[EPIC-11]] as a whole remains open for [[PUR-001 Purchase draft]],
[[PUR-002 Purchase receiving]] and [[PUR-003 Staff purchases surface]].
