---
type: module
module: purchases
status: implemented
updated: 2026-09-26
---

# Module — Purchases

## Responsibility

The `DRAFT` half of the PRD §17 purchase lifecycle for the Core Business domain:
a tenant-scoped purchase aggregate that names one in-tenant supplier and carries
at least one line referencing in-tenant catalog items. A purchase is created,
edited and cancelled while it stays `DRAFT`; it has no stock, cash, billing,
fiscal or payment effect and is **inert** until [[PUR-002 Purchase receiving]]
receives it ([[DEC-012]], [[DEC-014]]).

Every purchase is anchored to one tenant and is read or written only through the
server-side request context. The module owns five unprefixed HTTP routes behind
four granular permissions, returns allowlisted INTERNAL DTOs, and re-asserts its
permission in the service before any data access. It deliberately ships **no**
human-readable number ([[DEC-018]]) and **no** monetary total: a line carries
one optional informational unit cost and nothing derives an amount from it
([[DEC-013]]). Data classification: the supplier reference, the status, the line
quantities and the optional unit cost are all **INTERNAL**.

## Does Not Own

- **Receiving and every stock effect** — [[PUR-002 Purchase receiving]]. No
  route creates a `StockMovement`, touches a `StockBalance` or acquires the
  ledger's serialization lock. `stock_movement_type` still ships `ADJUSTMENT`
  only.
- **Cash movements and cash sessions** — [[EPIC-13]]. A purchase stores no cash
  state.
- **Invoices and billing** — [[EPIC-14]]. A purchase creates no invoice.
- **Fiscal documents and provider calls** — [[EPIC-15]] and [[EPIC-16]]. A
  purchase makes no external call and emits no fiscal document.
- **Payments, settlement and accounts payable** — [[EPIC-12]] and [[EPIC-13]]. A
  purchase records no owed amount, no payment term and no paid/unpaid state.
- **Purchase reversal** — PRD §40 names it as a correction case, but this module
  ships no reversal command; a `RECEIVED` purchase is corrected only by the
  future compensating operation ([[DEC-015]]).
- **Purchase numbering** — [[DEC-018]] settles that the aggregate carries no
  human-readable number; the purchase is identified by its UUID plus supplier
  and date.
- **Low-stock thresholds, ordering suggestions and purchasing reports** —
  [[EPIC-18]].
- **The staff UI** — [[PUR-003 Staff purchases surface]] owns the browser
  surface. This module is API-only today.
- **Purchase imports** — [[EPIC-19]].
- **A portal surface.** Portal holders have no purchase access; purchases are a
  staff-only Core capability.

## Public Capabilities

- List the caller tenant's purchases with their lines, newest first with an id
  tiebreaker, optionally narrowed by `status`.
- Read one purchase; a foreign or unknown UUID is one shared `404`.
- Create one `DRAFT` purchase with a required supplier and at least one line.
- Update a `DRAFT` purchase: `supplierId` may change and `lines` is the
  authoritative line set, reconciled by `catalogItemId` (retain, update in
  place, insert, remove).
- Cancel a `DRAFT` purchase through an explicit command; `CANCELLED` is
  reachable only from `DRAFT` and never deletes the purchase or its lines.
- An authenticated staff HTTP surface behind allowlisted INTERNAL DTOs, with
  per-route granular permissions and defense-in-depth service re-assertion.

## Main Entities

- `Purchase` — tenant-scoped aggregate, mapped to table `purchase`. `id` (`UUID`
  PK, `gen_random_uuid()`), `tenantId`, required `supplierId`, `status`
  (`purchase_status NOT NULL DEFAULT 'DRAFT'`), `createdAt`, `updatedAt`
  (`TIMESTAMPTZ(3)`). The schema declares `@@unique([tenantId, id])`,
  `@@index([tenantId, status])` and `@@map("purchase")`. There is deliberately
  **no** number, code, total, tax or valuation column ([[DEC-018]],
  [[DEC-013]]).
- `PurchaseLine` — tenant-scoped child, mapped to table `purchase_line`. `id`
  (`UUID` PK), `tenantId`, `purchaseId`, `catalogItemId`, `quantity`
  (`DECIMAL(10,3)`), `unitCost` (`DECIMAL(14,2)`, nullable), `createdAt`,
  `updatedAt`. The schema declares
  `@@unique([tenantId, purchaseId, catalogItemId])`, `@@unique([tenantId, id])`
  and `@@map("purchase_line")`.
- `AuditLog` rows — one co-committed row per accepted mutation, described under
  "Audit".

Physical guarantees (migration `20260926000002_purchases`):

| Guarantee                   | Shape                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Status enum                 | `purchase_status` pinned to `DRAFT`, `RECEIVED`, `CANCELLED`                                                                                   |
| Tenant scope                | `purchase_tenant_id_fkey` and `purchase_line_tenant_id_fkey` — `RESTRICT` tenant FKs on delete and update                                      |
| Ownership is composite      | `purchase_tenant_id_id_key` and `purchase_line_tenant_id_id_key` unique on `(tenant_id, id)`                                                   |
| Same-tenant supplier        | `purchase_tenant_id_supplier_id_fkey` on `(tenant_id, supplier_id)` → `supplier(tenant_id, id)`, `RESTRICT`                                    |
| Same-tenant purchase        | `purchase_line_tenant_id_purchase_id_fkey` on `(tenant_id, purchase_id)` → `purchase(tenant_id, id)`, `RESTRICT`                               |
| Same-tenant catalog item    | `purchase_line_tenant_id_catalog_item_id_fkey` on `(tenant_id, catalog_item_id)` → `catalog_item(tenant_id, id)`, `RESTRICT`                   |
| One line per item per draft | `purchase_line_tenant_id_purchase_id_catalog_item_id_key` unique on `(tenant_id, purchase_id, catalog_item_id)`                                |
| List lookup                 | `purchase_tenant_id_status_idx` on `(tenant_id, status)`                                                                                       |
| Positive quantity           | `purchase_line_quantity_positive` `CHECK (quantity > 0)`                                                                                       |
| Non-negative cost           | `purchase_line_unit_cost_non_negative` `CHECK (unit_cost >= 0)`                                                                                |
| Conditional immutability    | `purchase_no_delete_when_received_or_cancelled_trigger` and `purchase_line_no_delete_when_received_or_cancelled_trigger` (`BEFORE DELETE ROW`) |

The migration is strictly additive: it creates one enum, two tables and their
indexes/constraints/triggers, alters no existing table and inserts no rows. The
composite foreign keys mean a purchase can only reference a supplier of the SAME
tenant and a line can only reference a purchase and a catalog item of the SAME
tenant; the tenant-leading unique key means one line per catalog item inside one
purchase, which is what keeps receiving deterministic ([[DEC-012]]).

## State Transitions

`status` is server-owned; no request contract accepts a caller-supplied status.
A new purchase is always `DRAFT`, and `CANCELLED` is reachable **only** from
`DRAFT`.

```text
                POST /purchases           (PUR-002 receive command, not shipped)
   (new)  --------------->  DRAFT  ----------------->  RECEIVED
                            |
                            | POST /purchases/:id/cancel
                            v
                        CANCELLED
```

`POST /purchases/:id/cancel` is the only state change this module ships and is a
status transition, **never** a delete: the purchase and its lines stay readable.
A repeat cancel, an edit of a `RECEIVED` purchase or an edit of a `CANCELLED`
purchase is a stable `409 CONFLICT` and persists nothing ([[DEC-015]]). The
migration's conditional `BEFORE DELETE` triggers refuse a raw delete exactly
when the owning purchase is `RECEIVED` or `CANCELLED`, so a `DRAFT` remains
fully editable while a confirmed or cancelled purchase is immutable
([[DEC-019]]).

## Permissions

Four granular keys, seeded by `PERMISSION_SEEDS` with the decided role matrix
([[DEC-016]], 2026-09-26). The seeded count moved 38 → 42; `purchases.receive`
arrives with [[PUR-002 Purchase receiving]] to reach 43.

| Role                | `purchases.read` | `purchases.create` | `purchases.update` | `purchases.cancel` |
| ------------------- | :--------------: | :----------------: | :----------------: | :----------------: |
| `OWNER`             |        ✓         |         ✓          |         ✓          |         ✓          |
| `ADMIN`             |        ✓         |         ✓          |         ✓          |         ✓          |
| `INVENTORY_MANAGER` |        ✓         |         ✓          |         ✓          |         ✓          |
| `VETERINARIAN`      |        ✓         |                    |                    |                    |
| `RECEPTIONIST`      |        ✓         |                    |                    |                    |
| `CASHIER`           |        ✓         |                    |                    |                    |

- `purchases.read` — `GET /purchases`, `GET /purchases/:id`.
- `purchases.create` — `POST /purchases`.
- `purchases.update` — `PUT /purchases/:id`.
- `purchases.cancel` — `POST /purchases/:id/cancel`.

Each route declares its single key with `@RequirePermissions` **and**
`PurchasesService` re-asserts it before any data access, so a missing permission
is `403 FORBIDDEN` and persists nothing. Route-by-route pins live in
`apps/api/src/rbac/route-contract.probe.test.ts`
(`PURCHASES_PERMISSION_BY_ROUTE`). There is **no entitlement gate**: purchases
are a Core capability, like catalog, inventory and suppliers, so no feature code
gates this surface. `purchases.receive` is deliberately absent from this
module's contract because it belongs to [[PUR-002 Purchase receiving]].

## API

All five routes are unprefixed per [[DEC-002]] and return allowlisted INTERNAL
DTOs; no Prisma model crosses the HTTP boundary. The module is registered in
`apps/api/src/app.module.ts` and imports Context, RBAC and Audit.

| Route                        | Permission         | Contract                                                                                                                    |
| ---------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /purchases`             | `purchases.read`   | The caller tenant's purchases with their lines, newest first with an id tiebreaker; optional `status`; no implicit default. |
| `GET /purchases/:id`         | `purchases.read`   | One purchase; a foreign or unknown UUID is the same byte-equivalent `404`.                                                  |
| `POST /purchases`            | `purchases.create` | Create one `DRAFT` purchase with at least one line (`201`).                                                                 |
| `PUT /purchases/:id`         | `purchases.update` | Update a `DRAFT` (`200`); `supplierId` optional, `lines` is the authoritative line set; any other status is a stable `409`. |
| `POST /purchases/:id/cancel` | `purchases.cancel` | Cancel a `DRAFT` (`201`); `CANCELLED` is reachable only from `DRAFT` and never deletes.                                     |

There is **no** `PATCH` route (the status is server-owned and a transition is
its own command) and **no** `DELETE` route anywhere on this surface. The
route-contract probe fences their absence, and the integration and live suites
assert it.

### Response projection

`PurchaseResponse` (exactly these keys): `id`, `tenantId`, `supplierId`,
`status`, `lines`, `createdAt`, `updatedAt`. `tenantId` is always the caller's
own tenant, matching the sibling DTOs. Each entry of `lines` is
`PurchaseLineResponse` with exactly `id`, `catalogItemId`, `quantity`,
`unitCost`. There is deliberately no `number`, `code`, `total` or `tax` key
([[DEC-018]], [[DEC-013]]). Decimal fields are projected as **fixed-scale exact
strings** at their column scale — `quantity` at `Decimal(10,3)`, `unitCost` at
`Decimal(14,2)` — never as JavaScript floats; an omitted cost projects as
`null`, never `"0.00"`.

### Read ordering and filters

`GET /purchases` orders newest first by `createdAt` with `id` ascending as the
tiebreaker, because there is no numbering column to sort on ([[DEC-018]]). An
omitted `status` applies **no** implicit filter, so `?status=DRAFT`,
`?status=RECEIVED` and `?status=CANCELLED` are all meaningful. An unknown query
key or a malformed status is `400 VALIDATION_FAILED`, rejected rather than
ignored.

## Validation rules

| Field                                 | Rule                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `supplierId`                          | Required UUID on create; optional UUID on update                                                                 |
| `lines`                               | Required array, at least one entry, on both create and update                                                    |
| `lines[].catalogItemId`               | Required UUID; a repeated value inside one purchase is rejected (`400`)                                          |
| `lines[].quantity`                    | Required exact decimal string, strictly positive, up to 7 integer digits and 3 decimals (`Decimal(10,3)`)        |
| `lines[].unitCost`                    | Optional exact non-negative decimal string, up to 12 integer digits and 2 decimals (`Decimal(14,2)`)             |
| `status`, `tenantId`, any unknown key | Rejected (`400 VALIDATION_FAILED`) — the lifecycle is server-owned and tenant identity is never caller authority |

- **Absent versus null.** `unitCost` is omitted to mean _no informational cost_;
  because the submitted line set is authoritative, an omitted `unitCost` on a
  matched line **clears** the stored value rather than leaving it untouched.
- **A zero quantity is rejected before the column CHECK.** The quantity pattern
  already rejects a sign, and the API rejects an arithmetically zero value with
  `400 VALIDATION_FAILED` so the database `CHECK` is not the first line of
  defence.
- **Duplicate catalog items are rejected in the payload.** The
  `(tenantId, purchaseId, catalogItemId)` unique is the database's backstop; the
  request contract makes the HTTP duplicate a `400` so a duplicate in the
  payload never reaches the key.
- **Rejected input is `400 VALIDATION_FAILED` and persists nothing** — no
  purchase, no line and no audit row.

## Error contract

Stable, value-free message constants:

| Constant                                  | Message                                       | When                                                                            |
| ----------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| `PURCHASE_NOT_FOUND_MESSAGE`              | `Purchase was not found.`                     | Unknown **or** foreign-tenant purchase id — one byte-equivalent `404`.          |
| `PURCHASE_SUPPLIER_NOT_FOUND_MESSAGE`     | `The purchase supplier was not found.`        | Unknown or foreign supplier reference — `404`.                                  |
| `PURCHASE_CATALOG_ITEM_NOT_FOUND_MESSAGE` | `A purchase line catalog item was not found.` | Unknown or foreign catalog-item reference — `404`.                              |
| `PURCHASE_NOT_EDITABLE_MESSAGE`           | `Only a draft purchase can be changed.`       | Edit or cancel of a `RECEIVED` or `CANCELLED` purchase — stable `409 CONFLICT`. |

The three `404` messages are each backed by one shared constant, so the read,
the update and the cancel verbs of a resource are byte-equivalent by
construction rather than by coincidence. The `409` is scoped to the `DRAFT`-only
mutability rule and never echoes a stored value. Malformed bodies, rejected keys
and a malformed path id are `400 VALIDATION_FAILED`.

## Audit

Every accepted mutation (`create`, `update`, `cancel`) appends **exactly one**
audit row through `AuditWriter` **inside the same transaction** as the purchase
change, carrying stable ids and field **names** only ([[DEC-017]]):

| Action               | `targetType` | Metadata                                                                                                      |
| -------------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| `purchase.created`   | `purchase`   | `{ schemaVersion, changedFields }` — always `["supplierId", "lines"]`.                                        |
| `purchase.updated`   | `purchase`   | `{ schemaVersion, changedFields }` — the supplied keys only; `lines` always, `supplierId` only when supplied. |
| `purchase.cancelled` | `purchase`   | `{ schemaVersion, changedFields }` — `["status"]`.                                                            |

Metadata is `{ schemaVersion, changedFields }` with `schemaVersion` `1`; no
field **value** is ever recorded, so no quantity, unit cost, catalog-item id or
supplier id reaches the trail. Reads are never audited. No purchase event is
emitted: nothing reacts post-commit, and the module owns no user-facing domain
event (`PurchaseDrafted` and similar are not defined).

## Draft inertness guarantee

A purchase is inert until it is received. Create, update and cancel touch only
the `purchase` aggregate, its `purchase_line` children and the co-committed
`audit_log` row. No draft operation creates a `StockMovement`, changes a
`StockBalance`, writes a cash movement, creates an invoice, calls a fiscal
provider or allocates a number. The integration suite proves this by diffing
every table in the boundary fake across a full create → update → cancel cycle:
the only tables that change are `purchases`, `purchaseLines` and `audits`, with
zero stock movements and zero stock balances. [[PUR-002 Purchase receiving]]
owns the first operation that is allowed to touch the ledger.

## Data classification

Per [[DEC-012]] and [[DEC-013]]:

- **INTERNAL** — the supplier reference, the `status`, the line quantities, the
  optional informational unit cost, the tenant id and the timestamps.
- **CONFIDENTIAL** — none. A purchase stores only the supplier _reference_ id;
  the supplier's own identity fields keep their CONFIDENTIAL classification in
  the supplier registry ([[DEC-011]]).

DTOs are explicit allowlists; Prisma models never cross the HTTP boundary, and
no response, log or audit row carries a stored value. `tenantId` appears in the
response as the **caller's own** tenant; a foreign tenant id is never returned.

## Events / Jobs

- **None.** No purchase event, job or queue message is emitted, and the public
  schema carries no purchase event/outbox/queue/job table.

## Invariants

- **A draft is inert.** No draft operation changes stock, cash, an invoice or a
  fiscal document.
- **Every purchase belongs to exactly one tenant.** Tenant identity comes only
  from the server-side request context; a foreign record is indistinguishable
  from a missing one.
- **Ownership is enforced twice.** The composite `(tenant_id, id)` ownership
  keys and the `RESTRICT` tenant FKs keep a purchase in-tenant at the database;
  the service resolves references through the tenant-safe repository, which
  renders one shared `404` for a foreign and an unknown id.
- **A saved draft has at least one positive line.** The request contract
  requires one line and the `purchase_line_quantity_positive` CHECK rejects a
  zero or negative quantity.
- **One line per catalog item inside one purchase.** The
  `(tenant_id, purchase_id, catalog_item_id)` unique makes receiving
  deterministic.
- **Only a `DRAFT` is mutable.** A `RECEIVED` or `CANCELLED` purchase rejects an
  edit and a cancel with the stable `409`, and cancellation is reachable only
  from `DRAFT`.
- **A confirmed or cancelled purchase is never deleted.** The conditional
  `BEFORE DELETE` triggers raise `restrict_violation` for a `RECEIVED` or
  `CANCELLED` purchase and for its lines, and no API route offers a delete.
- **The purchase change and its audit row are one atomic unit**: no reader may
  observe a mutation without its co-committed trail row.

## Security / tenant rules

- Tenant identity comes only from the server-side request context; a route-,
  query- or body-supplied `tenantId` is never trusted and is rejected as an
  unknown key (`400`).
- The repository resolves the tenant via `requireTenantId()` (which fails closed
  with `FORBIDDEN` when no tenant authority was resolved) and rebuilds every
  write from an explicit allowlist, so a rogue runtime property cannot re-scope
  a row.
- A foreign **or** unknown purchase UUID is one shared message behind a
  byte-equivalent `404`, on read, update and cancel alike, with nothing
  persisted.
- Supplier and catalog-item references are resolved IN-TENANT inside the same
  transaction before any write, so a foreign reference collapses to the shared
  `404` for its resource.
- Permission checks are enforced by the route guard and re-asserted by the
  service; a missing permission is `403` and reaches no data access. Frontend
  permission checks are UX only; the API is the authority.
- No stored value is logged, projected into audit metadata or returned in an
  error message.

## Known Limitations / Residual Risks

- **A lines-only update does not bump the header `updatedAt`.** Prisma's
  `@updatedAt` fires on a header-row write, so when an update changes only the
  line set the response's `updatedAt` still reflects the last header write.
- **The live suite is the evidence for the schema-level guarantees.** The
  in-memory boundary fake cannot enforce the composite ownership foreign keys or
  the `(tenantId, purchaseId, catalogItemId)` unique. The live-PostgreSQL block
  proves both against real DDL: the duplicate unique by catalog introspection
  plus a raw duplicate insert, and the composite foreign keys by a raw
  cross-tenant supplier and catalog-item reference the database rejects.
- **What the live block does not prove.** It does not exercise the receive
  command (that is [[PUR-002 Purchase receiving]]), it does not race two
  concurrent duplicate-line inserts, and it does not run a `migrate status`
  drift check. The migration is applied to a disposable database by `db:deploy`
  in the suite's setup, so application is proven, but a drift-free
  `migrate status` against a persistent database is still owed by the epic.
- **Carried, pre-existing drift.** The migration writes `updated_at` with a
  `DEFAULT CURRENT_TIMESTAMP`, following the closest sibling migrations, so
  `prisma migrate diff` lists a `DROP DEFAULT` for two more columns. That drift
  is repo-wide and pre-existing (22 tables before this module, 24 now);
  `migrate status` is green and CI applies migrations rather than diffing.
- **No staff UI and no web proxy.** The module is API-only in this slice;
  [[PUR-003 Staff purchases surface]] owns the browser surface.
- **No purchase delete by design.** The absence of a `DELETE` route is not a
  missing feature: a draft drops a line through the update command, and a
  confirmed or cancelled purchase is corrected only by the future reversal.

## Verification

- `packages/database/src/schema-purchases.test.ts` — **22 tests**: the additive
  migration's enum literal, the two tables and columns, the composite ownership
  keys, the `RESTRICT` foreign keys, the duplicate-line unique, the two CHECKs,
  the two conditional delete triggers, and the model mappings.
- `apps/api/src/purchases/purchases.integration.test.ts` — **16 tests** over the
  real guard chain: the permission sweeps that persist nothing on denial; the
  draft create/update/cancel/list; the DRAFT-only `409`; the invalid
  create/update sweeps; the line-set reconciliation; the co-committed audit
  rows; the cross-tenant and foreign-reference `404`; and the draft inertness
  probe.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the five purchase routes in
  the survival inventory and `PURCHASES_PERMISSION_BY_ROUTE`.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the
  `EPIC-11 purchases application-path isolation` block (**7 tests**) against the
  booted AppModule and a disposable real PostgreSQL: the draft create that
  persists its lines and leaves the ledger untouched; the duplicate-line unique;
  [[DEC-019]]'s conditional immutability with the exact trigger messages; the
  line-set reconciliation over HTTP; the DRAFT-only `409`; the composite foreign
  keys and the byte-equivalent cross-tenant `404`; and the quantity/cost CHECKs.
- Observed package runs: `pnpm --filter @newsaas/database test` → 15 files / 268
  tests passed; `pnpm --filter @newsaas/api test` → 72 files passed, 1 skipped
  (73), 886 tests passed, 65 skipped; the API typecheck, the API lint,
  `pnpm format-check` and `git diff --check` all clean.
- Observed live-PostgreSQL run: `pnpm --filter @newsaas/api test:live-pg` → 1
  file / **65 tests passed**, including the 7 new purchase cases. The suite
  applies the migration and the reference seed to a fresh disposable database
  itself.

## Related Stories

- [[PUR-001 Purchase draft]] — the `DRAFT` lifecycle, its additive migration,
  the four permission keys with their role matrix, the five routes, the line-set
  reconciliation, the conditional immutability, the audit rows and the tests.
- [[PUR-002 Purchase receiving]] — the explicit receive command and the ledger
  integration this module deliberately does not own.

## Related ADRs

- [[ADR-001 Modular Monolith]]

## Related Decisions

- [[DEC-012]] — purchase aggregate shape and the draft-versus-receive gate.
- [[DEC-013]] — the single optional informational unit cost and no tax or total.
- [[DEC-014]] — receiving semantics (all owned by
  [[PUR-002 Purchase receiving]]).
- [[DEC-015]] — cancellation reachability and the correction boundary.
- [[DEC-016]] — the `purchases.*` keys, the role matrix and the absence of an
  entitlement gate.
- [[DEC-017]] — one co-committed audit row per accepted purchase mutation, field
  names only.
- [[DEC-018]] — no human-readable purchase number.
- [[DEC-019]] — conditional draft editability and status-conditional
  immutability.
- [[DEC-002]] — unprefixed route paths.
