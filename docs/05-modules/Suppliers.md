---
type: module
module: suppliers
status: implemented
updated: 2026-09-26
---

# Module — Suppliers

## Responsibility

A tenant-scoped supplier registry for the Core Business domain (PRD §5): the
identity data a purchase references. A supplier is one row with a required
trading `name`, optional legal/contact fields, and an `isActive` flag. Removal
is deactivation; hard delete does not exist. The module is pure identity data —
it stores no balance, no owed amount and no payment state — and it owns no
purchase, receiving, stock, cash, invoice or fiscal operation.

Every supplier is anchored to one tenant and is read or written only through the
server-side request context. The module owns five unprefixed HTTP routes behind
four granular permissions, returns allowlisted INTERNAL DTOs, and re-asserts its
permission in the service before any data access. Data classification: `name` is
**INTERNAL**; `legalName`, `taxId`, `email`, `phone` and `address` are
**CONFIDENTIAL** ([[DEC-011]]).

## Does Not Own

- **Purchases and receiving** — [[PUR-001 Purchase draft]] and
  [[PUR-002 Purchase receiving]]. A supplier is referenced, never purchased
  here.
- **Payable balances, accounts payable, payments and settlement** —
  [[EPIC-12]]/[[EPIC-13]]. This module records no owed amount and no payment
  state.
- **The staff UI** — [[PUR-003 Staff purchases surface]] owns the browser
  surface. This module is API-only today.
- **Supplier or purchase imports** — [[EPIC-19]].
- **Low-stock or purchasing reports** — [[EPIC-18]].
- **A portal surface.** Portal holders have no supplier access; suppliers are a
  staff-only Core capability.
- **A tenant-scoped supplier number or catalog.** A supplier is identified by
  its UUID; no human-readable number is generated.
- **Reactivation.** There is no reactivation command; the lifecycle moves one
  way.

## Public Capabilities

- List the caller tenant's suppliers, optionally narrowed by `isActive`, ordered
  by `name` ascending with an id tiebreaker.
- Read one supplier; a foreign or unknown UUID is one shared `404`.
- Create one supplier with a required `name` and optional identity/contact
  fields.
- Partially update one supplier: an omitted key leaves the stored value
  untouched and an explicit `null` clears it.
- Deactivate one supplier idempotently, without deleting it.
- An authenticated staff HTTP surface behind allowlisted INTERNAL DTOs, with
  per-route granular permissions and defense-in-depth service re-assertion.

## Main Entities

- `Supplier` — tenant-scoped aggregate, mapped to table `supplier`. `id`,
  `tenantId`, required `name` (`VARCHAR(200)`, deliberately not unique),
  optional `legalName` (`VARCHAR(200)`), `taxId` (`VARCHAR(50)`), `email`
  (`VARCHAR(320)`), `phone` (`VARCHAR(50)`), `address` (`VARCHAR(500)`),
  `isActive` (`BOOLEAN NOT NULL DEFAULT true`), `createdAt`, `updatedAt`. The
  schema declares `@@unique([tenantId, id])`, `@@index([tenantId, name])` and
  `@@map("supplier")`. It deliberately declares **no**
  `@@unique([tenantId, taxId])` because the per-tenant tax-id uniqueness is a
  **partial** index that Prisma cannot express; that index lives only in the
  migration SQL, and the model doc comment records why.
- `AuditLog` rows — one co-committed row per accepted mutation, described under
  "Audit".

Physical guarantees (migration `20260926000001_suppliers`):

| Guarantee              | Shape                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| Tenant scope           | `supplier_tenant_id_fkey` — `RESTRICT` tenant FK on delete and update                            |
| Ownership is composite | `supplier_tenant_id_id_key` unique on `(tenant_id, id)`, the target of the purchase composite FK |
| Tax id uniqueness      | `supplier_tenant_id_tax_id_key` partial unique on `(tenant_id, tax_id) WHERE tax_id IS NOT NULL` |
| Name lookup            | `supplier_tenant_id_name_idx` on `(tenant_id, name)`                                             |
| Name bounds            | `supplier_name_length` `CHECK (char_length("name") BETWEEN 1 AND 200)`                           |
| No hard delete         | `supplier_no_delete_trigger` (`BEFORE DELETE`) raises `restrict_violation`                       |

The trigger raises `suppliers are deactivated and cannot be hard-deleted`. The
partial index is declared as raw SQL because Prisma cannot express partial
indexes: the `WHERE tax_id IS NOT NULL` predicate leaves absent identifiers
outside the index entirely, so any number of suppliers may omit the identifier
while a repeated present value inside one tenant is rejected, and the same value
in another tenant is a different key because `tenant_id` leads the index. The
migration is strictly additive: it creates one table, alters no existing table
and inserts no rows.

## State Transitions

The only state is `isActive`, and the only transition is one-way deactivation.

```text
isActive = true  --deactivate-->  isActive = false
```

`POST /suppliers/:id/deactivate` is the only state change and is **idempotent**:
a repeat succeeds, returns the same inactive supplier and still appends exactly
one audit row whose `changedFields` is empty. There is no reactivation command
and no delete command; the database trigger rejects `DELETE` regardless of
caller. `isActive` is deliberately not an update field, so `suppliers.update`
can never perform a deactivation.

## Permissions

Four granular keys, seeded by `PERMISSION_SEEDS` with the decided role matrix
([[DEC-016]], 2026-09-26):

| Role                | `suppliers.read` | `suppliers.create` | `suppliers.update` | `suppliers.deactivate` |
| ------------------- | :--------------: | :----------------: | :----------------: | :--------------------: |
| `OWNER`             |        ✓         |         ✓          |         ✓          |           ✓            |
| `ADMIN`             |        ✓         |         ✓          |         ✓          |           ✓            |
| `INVENTORY_MANAGER` |        ✓         |         ✓          |         ✓          |           ✓            |
| `VETERINARIAN`      |        ✓         |                    |                    |                        |
| `RECEPTIONIST`      |        ✓         |                    |                    |                        |
| `CASHIER`           |        ✓         |                    |                    |                        |

- `suppliers.read` — `GET /suppliers`, `GET /suppliers/:id`.
- `suppliers.create` — `POST /suppliers`.
- `suppliers.update` — `PUT /suppliers/:id`.
- `suppliers.deactivate` — `POST /suppliers/:id/deactivate`.

Each route declares its single key with `@RequirePermissions` **and**
`SuppliersService` re-asserts it before any data access, so a missing permission
is `403 FORBIDDEN` and persists nothing. Route-by-route pins live in
`apps/api/src/rbac/route-contract.probe.test.ts`
(`SUPPLIERS_PERMISSION_BY_ROUTE`). There is **no entitlement gate**: suppliers
are a Core capability, like catalog and inventory, so no `purchases` or other
feature code gates this surface.

## API

All five routes are unprefixed per [[DEC-002]] and return allowlisted INTERNAL
DTOs; no Prisma model crosses the HTTP boundary. The module is registered in
`apps/api/src/app.module.ts` and imports Context, RBAC and Audit.

| Route                            | Permission             | Contract                                                                                       |
| -------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /suppliers`                 | `suppliers.read`       | The caller tenant's suppliers; optional `isActive`; no implicit active-only default.           |
| `GET /suppliers/:id`             | `suppliers.read`       | One supplier; a foreign or unknown UUID is the same byte-equivalent `404`.                     |
| `POST /suppliers`                | `suppliers.create`     | Create one supplier (`201`).                                                                   |
| `PUT /suppliers/:id`             | `suppliers.update`     | Partial update (`200`); an omitted optional key is untouched and an explicit `null` clears it. |
| `POST /suppliers/:id/deactivate` | `suppliers.deactivate` | Idempotent soft removal; the supplier stays readable and no row is deleted.                    |

There is **no** `PATCH` and no `DELETE` route anywhere on this surface. The
route-contract probe fences their absence, and the integration suite asserts it.

### Response projection

`SupplierResponse` (exactly these keys): `id`, `tenantId`, `name`, `legalName`,
`taxId`, `email`, `phone`, `address`, `isActive`, `createdAt`, `updatedAt`.
`tenantId` is always the caller's own tenant, matching the sibling DTOs. No
Prisma model and no internal column is projected.

### Read ordering and filters

`GET /suppliers` applies **no implicit active filter**: an omitted `isActive`
returns active and inactive suppliers alike, so `isActive=false` stays
meaningful. The list is ordered by `name` ascending with an id tiebreaker.

## Validation rules

| Field                                             | Create                                       | Update                                                 |
| ------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| `name`                                            | Required string, 1..200 characters           | Optional, same bound; an explicit `null` is `400`      |
| `legalName`, `taxId`, `email`, `phone`, `address` | Optional strings; omitted ⇒ stored as absent | Omitted ⇒ unchanged; explicit `null` ⇒ cleared         |
| `isActive`                                        | Not accepted (`400`)                         | Not accepted (`400`) — deactivation is its own command |
| `tenantId` / unknown keys                         | Rejected (`400`, `.strict()`)                | Rejected (`400`, `.strict()`)                          |

- **Absent versus null.** `undefined` means _absent_ (leave untouched on update)
  and `null` means _clear_. On create an omitted optional field is written as an
  explicit `NULL`.
- **`name` is never nullable.** The column is `NOT NULL` and the request
  contract rejects `null`, so a supplier always has a bounded trading name.
- **Rejected input is `400 VALIDATION_FAILED` and persists nothing** — no row
  and no audit row. A supplied `tenantId` is rejected as an unknown key rather
  than being trusted.

## Error contract

Two stable, value-free message constants:

| Constant                           | Message                                                              | When                                                                   |
| ---------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `SUPPLIER_NOT_FOUND_MESSAGE`       | `Supplier was not found.`                                            | Unknown **or** foreign-tenant supplier id — one byte-equivalent `404`. |
| `SUPPLIER_TAX_ID_CONFLICT_MESSAGE` | `A supplier with this tax identifier already exists in this tenant.` | Duplicate **present** `taxId` inside one tenant — `409 CONFLICT`.      |

The `409` is scoped to the `supplier_tenant_id_tax_id_key` partial index and
never echoes the submitted identifier, which is CONFIDENTIAL. Every unrelated
Prisma `P2002` — including a violation of the `(tenant_id, id)` ownership key —
is rethrown rather than converted, so the rejection shape stays byte-equivalent.
Malformed bodies and rejected keys are `400 VALIDATION_FAILED`.

## Audit

Every accepted mutation (`create`, `update`, `deactivate`) appends **exactly
one** audit row through `AuditWriter` **inside the same transaction** as the
supplier change, carrying stable ids and field **names** only ([[DEC-017]]):

| Action                 | `targetType` | Metadata                                                                           |
| ---------------------- | ------------ | ---------------------------------------------------------------------------------- |
| `supplier.created`     | `supplier`   | `{ schemaVersion, changedFields }` — the supplied field names.                     |
| `supplier.updated`     | `supplier`   | `{ schemaVersion, changedFields }` — the supplied keys only.                       |
| `supplier.deactivated` | `supplier`   | `{ schemaVersion, changedFields }` — `["isActive"]` on the flip, `[]` on a repeat. |

Metadata is `{ schemaVersion, changedFields }` with `schemaVersion` `1`; no
field **value** is ever recorded, because `legalName`, `taxId`, `email`, `phone`
and `address` are CONFIDENTIAL. The deactivation diff comes from the conditional
write's own affected-row count, never from a pre-state read, so a repeated
deactivation appends exactly one row with an empty diff and exactly one accepted
call ever reports `["isActive"]`. **Reads are never audited.** No supplier event
is emitted: nothing reacts post-commit.

## Data classification

Per [[DEC-011]]:

- **CONFIDENTIAL** — `legalName`, `taxId`, `email`, `phone`, `address`. These
  are never logged and never copied into the audit trail; the `409` conflict
  message is value-free, and audit metadata carries field **names** only.
- **INTERNAL** — `name`, `isActive`, the tenant id and timestamps.

DTOs are explicit allowlists; Prisma models never cross the HTTP boundary, and
no response or log carries a CONFIDENTIAL payload. `tenantId` appears in the
response as the **caller's own** tenant; a foreign tenant id is never returned.

## Events / Jobs

- **None.** No supplier event, job or queue message is emitted, and the public
  schema carries no supplier event/outbox/queue/job table.

## Invariants

- **Every supplier belongs to exactly one tenant.** Tenant identity comes only
  from the server-side request context; a foreign record is indistinguishable
  from a missing one.
- **Ownership is enforced twice.** The composite `(tenant_id, id)` ownership key
  and the `RESTRICT` tenant FK keep a supplier in-tenant at the database; the
  service resolves the record through the tenant-safe repository, which renders
  one shared `404` for a foreign and an unknown id.
- **`taxId` is unique per tenant when present, and only then.** The partial
  index admits any number of absent identifiers and rejects a repeated present
  value inside one tenant; the same value in another tenant is a different key.
- **Removal is deactivation.** The `BEFORE DELETE` trigger raises on `DELETE`,
  the table is never hard-deleted, and no API route offers one. A deactivated
  supplier stays readable.
- **A supplier is identity data, not a ledger.** No balance, owed amount or
  payment state is stored, and nothing in this module computes one.
- **The supplier change and its audit row are one atomic unit**: no reader may
  observe a mutation without its co-committed trail row.

## Security / tenant rules

- Tenant identity comes only from the server-side request context; a route-,
  query- or body-supplied `tenantId` is never trusted and is rejected as an
  unknown key (`400`).
- The repository resolves the tenant via `requireTenantId()` (which fails closed
  with `FORBIDDEN` when no tenant authority was resolved) and rebuilds every
  write from an explicit allowlist, so a rogue runtime property cannot re-scope
  a row.
- A foreign **or** unknown supplier UUID is one shared message behind a
  byte-equivalent `404`, on read, update and deactivation alike, with nothing
  persisted.
- Permission checks are enforced by the route guard and re-asserted by the
  service; a missing permission is `403` and reaches no data access. Frontend
  permission checks are UX only; the API is the authority.
- No CONFIDENTIAL payload is logged, projected into audit metadata or returned
  in an error message.

## Known Limitations / Residual Risks

- **The migration is unapplied and its runtime enforcement is unverified.** No
  database can run in this environment (the Docker daemon is unavailable, so
  PostgreSQL on `localhost:5433` cannot start), so the partial index's
  enforcement, the real PostgreSQL-rejection path behind the `409` and a
  drift-free `migrate status` have not been observed. The durable
  live-PostgreSQL evidence is owed before [[EPIC-11]] closes.
- **The duplicate-conflict tests inject a synthetic `P2002`.** The in-memory
  test boundary does not enforce partial indexes, so the duplicate-`taxId` tests
  raise a synthetic Prisma `P2002` shaped like the index violation. They do
  assert in-memory supplier state, audit counts and unchanged stored fields, so
  they are not status-only; but the real PostgreSQL-rejection path is unproven,
  and the matcher accepts both plausible `meta.target` shapes defensively.
- **The schema gate inspects DDL text rather than executing the index.** The
  gate asserts the migration SQL; it does not run against a live database.
- **The partial index lives only in the migration SQL.** Prisma cannot model it,
  so the schema has no `@@unique([tenantId, taxId])` and a live
  `migrate status`/drift check is still owed.
- **No staff UI and no web proxy.** The module is API-only in this slice;
  [[PUR-003 Staff purchases surface]] owns the browser surface.
- **The purchase side of a reference is not testable yet.** No purchase table
  exists, so only the supplier half of the no-orphan guarantee can be asserted
  today; the purchase-side half becomes testable with
  [[PUR-001 Purchase draft]].

## Verification

- `packages/database/src/schema-suppliers.test.ts` — **15 tests**: the additive
  migration's table, columns, the `RESTRICT` tenant FK, the composite ownership
  key, the partial tax-id index, the name lookup and CHECK, the delete-rejecting
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
- `apps/api/src/rbac/route-contract.probe.test.ts` — the five supplier routes in
  the survival inventory and `SUPPLIERS_PERMISSION_BY_ROUTE`.
- Observed package runs: `pnpm --filter @newsaas/database test` → 14 files / 245
  tests passed; `pnpm --filter @newsaas/api test` → 71 files passed, 1 skipped
  (72), 869 tests passed, 52 skipped; the database and API typechecks, the API
  lint and `git diff --check` all clean.
- `db:deploy`, `db:seed` and the live-PostgreSQL suite are **unrunnable here**
  (see "Known Limitations"): the migration is not applied anywhere, so the live
  partial-index and `migrate status` evidence remains owed.

## Related Stories

- [[SUP-001 Supplier foundation]] — the supplier registry, its additive
  migration, the four permission keys with their role matrix, the five routes,
  the audit rows and the tests.

## Related ADRs

- [[ADR-001 Modular Monolith]]

## Related Decisions

- [[DEC-011]] — supplier identity, per-tenant `taxId` uniqueness and per-field
  data classification.
- [[DEC-016]] — the `suppliers.*` keys, the role matrix and the absence of an
  entitlement gate.
- [[DEC-017]] — one co-committed audit row per accepted supplier mutation, field
  names only.
- [[DEC-002]] — unprefixed route paths.
