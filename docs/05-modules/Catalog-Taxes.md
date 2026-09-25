---
type: module
module: catalog-taxes
status: implemented
updated: 2026-09-25
---

# Module — Catalog and Taxes

## Responsibility

A tenant-scoped staff catalog of `PRODUCT`, `SERVICE`, `MEDICATION` and `SUPPLY`
items (PRD §15), each carrying exactly one selection from a GLOBAL,
platform-seeded and tenant read-only Paraguay tax-rate list (`EXEMPT 0%`,
`IVA_5 5%`, `IVA_10 10%`), plus an optional informational reference price stored
as an amount and an ISO 4217 currency pair. Removal is deactivation; hard delete
does not exist. The module performs NO tax arithmetic, rounding, conversion or
tax-included/excluded interpretation, and owns no stock, POS, invoice or fiscal
state.

Every catalog item is anchored to one tenant and is read or written only through
the server-side request context. The reference price is a convenience value on
the item, never a sale, invoice, cash or fiscal total ([[DEC-010]]).

## Does Not Own

- **Stock.** No stock movement, balance, flag or `tracksStock` column exists
  here; the maintainer deferred that dimension to [[EPIC-10]] Inventory.
- **POS, sales, payments, cash, invoices and fiscal documents** ([[EPIC-12]]
  onward). The module stores a rate reference and projects it; it never computes
  a percentage, applies a rate, rounds, converts or splits tax.
- **Tenant-configurable rates, per-item rate overrides or rate copy fields.**
  The rate list is global and tenant read-only ([[DEC-010]] Option C, rejected).
- **Categories, SKUs, barcodes, images, units and branch-specific pricing.** No
  such field exists.
- **Appointment scheduling.** `Appointment.serviceId` lives on the Scheduling
  aggregate; Catalog owns the referenced item, Scheduling owns the appointment,
  its lifecycle and the agenda filter (see "Appointment service linkage").
- **A portal surface.** Portal holders have no catalog or service selection.

## Public Capabilities

- Create, read, list, update and soft-deactivate tenant catalog items.
- List the GLOBAL seeded tax-rate list; every entitled tenant reads the same
  three rows and no mutation route exists.
- Filter the item list by `kind` and by `isActive`.
- An authenticated staff web surface at `/app/catalog` (list, read-only detail,
  create/edit, explicit deactivate) behind the allowlisted `/api/catalog` proxy.

## Main Entities

- `TaxRate` — **GLOBAL** reference row (no `tenant_id`): `id`, `code` unique,
  `name`, `rate` `DECIMAL(5,2)` with a non-negative `CHECK`, timestamps. The
  three rows are seed-owned, not migration rows.
- `CatalogItemKind` — database enum `PRODUCT | SERVICE | MEDICATION | SUPPLY`.
- `CatalogItem` — tenant-scoped aggregate: `id`, `tenantId`, `kind`, `name`,
  non-null `taxRateId` (`RESTRICT` FK to `TaxRate`), nullable
  `referencePriceAmount` `DECIMAL(14,2)`, nullable `referencePriceCurrency`
  `VARCHAR(3)`, `isActive` (`true` by default), timestamps. Physical guarantees:
  `@@unique([tenantId, id])`, a `RESTRICT` tenant FK, three `CHECK`s (pair,
  non-negative amount, ISO 4217 shape) and a `BEFORE DELETE` trigger that raises
  `restrict_violation`.
- `AuditLog` rows — one co-committed row per accepted mutation, described under
  "Audit".

## State Transitions

```text
isActive = true  --deactivate-->  isActive = false
```

`POST /catalog/:id/deactivate` is the only state change and is **idempotent**: a
repeat succeeds, returns the same inactive item and still appends exactly one
audit row whose `changedFields` is empty. There is no reactivation command and
no delete command; the database trigger rejects `DELETE` regardless of caller.

## Permissions

Four granular keys, seeded and granted with the decided role matrix
(2026-09-25):

| Role                | read | create | update | deactivate |
| ------------------- | :--: | :----: | :----: | :--------: |
| `OWNER`             |  ✓   |   ✓    |   ✓    |     ✓      |
| `ADMIN`             |  ✓   |   ✓    |   ✓    |     ✓      |
| `INVENTORY_MANAGER` |  ✓   |   ✓    |   ✓    |     ✓      |
| `VETERINARIAN`      |  ✓   |        |        |            |
| `RECEPTIONIST`      |  ✓   |        |        |            |
| `CASHIER`           |  ✓   |        |        |            |

- `catalog.read` — `GET /catalog`, `GET /catalog/:id`, `GET /catalog/tax-rates`.
- `catalog.create` — `POST /catalog`.
- `catalog.update` — `PUT /catalog/:id`.
- `catalog.deactivate` — `POST /catalog/:id/deactivate`.

Each route declares its single key with `@RequirePermissions` **and**
`CatalogService` re-asserts it before any data access, so a missing permission
is `403 FORBIDDEN` and persists nothing. Route-by-route pins live in
`apps/api/src/rbac/route-contract.probe.test.ts`
(`CATALOG_PERMISSION_BY_ROUTE`). `isActive` is deliberately not an update field,
so `catalog.update` can never perform a deactivation.

## API

All six routes are unprefixed per [[DEC-002]] and return allowlisted INTERNAL
DTOs; routes are listed with `/catalog/tax-rates` registered before
`/catalog/:id` so the static segment can never be captured as an item id.

| Route                          | Permission           | Contract                                                   |
| ------------------------------ | -------------------- | ---------------------------------------------------------- |
| `GET /catalog/tax-rates`       | `catalog.read`       | The GLOBAL seeded rate list, identical for every tenant.   |
| `GET /catalog`                 | `catalog.read`       | Caller-tenant items; optional `kind` / `isActive` filters. |
| `GET /catalog/:id`             | `catalog.read`       | One item; a foreign or unknown UUID is the same `404`.     |
| `POST /catalog`                | `catalog.create`     | Create one item (`201`).                                   |
| `PUT /catalog/:id`             | `catalog.update`     | Partial update (`200`); omitted fields stay untouched.     |
| `POST /catalog/:id/deactivate` | `catalog.deactivate` | Idempotent soft removal (`201`).                           |

Web proxy (staff browser transport, no authorization authority of its own):

- `GET|POST|PUT /api/catalog/[...path]` — a strict `(method, path-shape)`
  allowlist over exactly the six pairs above, forwarding only the staff session
  cookie. A known path with a disallowed method is `405`, an unknown path `404`,
  a malformed path `400` and a request without a staff session `401`, each in
  the API's own `{ error: { code, message } }` envelope. The request-side detail
  and its divergences from the sibling proxies are recorded in [[TD-013]].

Two contract details worth stating because clients depend on them:

- `GET /catalog` applies **no implicit active filter**: an omitted `isActive`
  returns active and inactive items alike, so `isActive=false` stays meaningful.
  The staff list defaults to active items by asking for `isActive=true`, which
  is a presentation choice, not an API rule.
- `GET /catalog/tax-rates` is ordered by `code` ascending, which is
  lexicographic (`EXEMPT`, `IVA_10`, `IVA_5`). The web selector re-orders the
  list for display only (`EXEMPT`, `IVA_5`, `IVA_10`); the API response, the
  seed and the stored rows keep the `code` order.

## Validation rules

| Field                     | Create                                              | Update                                                                   |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| `kind`                    | Required, one of the four pinned kinds              | Optional, same pin                                                       |
| `name`                    | Required, 1..200 characters                         | Optional, same bound                                                     |
| `taxRateId`               | Required UUID, must resolve to a GLOBAL seeded rate | Omitted ⇒ unchanged; present ⇒ must resolve; explicit `null` ⇒ `400`     |
| Reference price pair      | Both keys present with values, or both absent       | Omitted ⇒ unchanged; `null` **on both** ⇒ cleared; one key alone ⇒ `400` |
| `isActive`                | Not accepted (`400`)                                | Not accepted (`400`) — deactivation is its own command                   |
| `tenantId` / unknown keys | Rejected (`400`, `.strict()`)                       | Rejected (`400`, `.strict()`)                                            |

- **A rate is mandatory and no rate-less state exists.** `taxRateId` is required
  on create and the column is `NOT NULL` with a `RESTRICT` foreign key, so an
  item cannot be stored without a rate and a referenced rate row cannot be
  deleted. An unknown rate id is `400 VALIDATION_FAILED` and persists nothing,
  including no audit row; a raw insert that bypasses the service is rejected by
  the foreign key.
- **The amount/currency pair uses absent-versus-null semantics.** `undefined`
  means _absent_ (leave untouched on update) and `null` means _clear_; the pair
  is valid only as "both absent" or "both carrying a value". A lone amount, a
  lone currency, or a mismatch between a set and a cleared key is `400`.
- **The accepted currency list is exactly `PYG` and `USD`.** PRD §1 fixes PYG as
  the product currency with USD as the only secondary currency; the database
  `CHECK` enforces ISO 4217 _shape_ (`^[A-Z]{3}$`) while the API validates the
  accepted _code list_, so a well-formed but unsupported code (`ZZZ`) is refused
  exactly like a malformed one (`pyg`). Widening the set is a product decision.
- **Amounts are exact decimals, not floats.** `referencePriceAmount` is an exact
  decimal string matching `^\d{1,12}(\.\d{1,2})?$` (the `Decimal(14, 2)`
  column), so a JavaScript float or a negative amount cannot enter the boundary.
- Rejected input is `400 VALIDATION_FAILED` and persists nothing. An unknown
  **or foreign-tenant** item id on read, update or deactivate is a
  byte-equivalent `404 NOT_FOUND` behind one shared message constant.

## Canonical decimal representation

Every decimal this boundary projects is an exact **fixed-scale two-decimal
string**, produced by the single `decimalToFixedScaleString` helper
(`apps/api/src/catalog/catalog.service.ts`) used by the item DTO, the nested
rate projection and the rate list.

- Both columns store two decimals (`tax_rate.rate` is `DECIMAL(5,2)`;
  `catalog_item.reference_price_amount` is `DECIMAL(14,2)`, the scale EPIC-09
  fixed for every currency) and the write contract caps a submitted amount at
  two decimals, so the projection **pads but never rounds** a stored digit.
- The scale is pinned rather than taken from each value's own text because the
  two persistence paths disagree about padding for the same stored value: a real
  `DECIMAL` read arrives through Prisma's `Decimal`, which trims trailing zeros
  (`"10.00"` → `"10"`), while the in-memory test boundary returns the seeded
  literal verbatim. Pinning gives clients ONE canonical spelling in both
  environments.
- No catalog value is summed, converted, tax-applied or otherwise computed.

## Data classification

- Catalog configuration — kind, name, active flag, the global rate reference and
  the informational reference price — is **INTERNAL**. DTOs are explicit
  allowlists; Prisma models never cross the HTTP boundary, no catalog response
  or log carries a CONFIDENTIAL payload, and audit metadata carries field
  **names** only (never a name, an amount or a currency value).
- The `TaxRate` rows are global platform data: no tenant column exists and the
  same three rows are served to every entitled tenant.
- `tenantId` appears in the item DTO as the **caller's own** tenant, matching
  the Customer/Patient DTOs; a foreign tenant id is asserted absent from every
  response.

## Audit

Every accepted mutation (`create`, `update`, `deactivate`) appends **exactly
one** audit row through `AuditWriter` **inside the same transaction** as the
item change, carrying stable ids and field names only:

| Action                     | `targetType`   | Metadata `changedFields`                                                  |
| -------------------------- | -------------- | ------------------------------------------------------------------------- |
| `catalog_item.created`     | `catalog_item` | The supplied field names, in payload order.                               |
| `catalog_item.updated`     | `catalog_item` | The supplied keys only; a clear names its fields too.                     |
| `catalog_item.deactivated` | `catalog_item` | `["isActive"]` on the transition that flipped the flag, `[]` on a repeat. |

- The deactivation diff comes from the conditional write's own affected-row
  count, never from a pre-state read, so exactly one of two racing deactivations
  reports the flip and the other reports `[]`. This is proven live (see
  "Verification").
- Metadata is `{ schemaVersion, changedFields }` with `schemaVersion` `1`; no
  value, name, amount or currency is recorded.
- **No catalog event is emitted.** Nothing reacts post-commit, and the audit row
  is the mutation's only side effect besides the item row.

## Seed-before-insert precondition

The three rates are **seed-owned reference data**, not migration rows:
`TAX_RATE_SEEDS` in `packages/database/src/reference-seed.ts` holds
`EXEMPT 0.00`, `IVA_5 5.00` and `IVA_10 10.00` in fixed order and upserts each
by its stable `code` after the species/breed block, exported from the package.

Because `catalog_item.tax_rate_id` is `NOT NULL` with a `RESTRICT` foreign key,
**the seed must run before any item can be inserted**: a database that has only
been migrated cannot create a catalog item. This is a real precondition of the
non-null rate reference, not an accident, and it is why `pnpm db:seed` precedes
item creation in every environment. The upserts are identity-stable
(`update: {}`), so re-running the seed appends the same three calls and the row
count stays at three — a corrected rate literal would require an explicit
decision rather than an implicit seed overwrite.

## Appointment service linkage (EPIC-09 WU4)

`Appointment.serviceId` is an OPTIONAL, nullable reference to a tenant-scoped
`CatalogItem` of kind `SERVICE`, enforced at the database by the composite
`(tenant_id, service_id) -> catalog_item(tenant_id, id)` foreign key with
`RESTRICT`. Catalog owns the referenced data and its write path; Scheduling owns
the appointment, the anchor validation and the agenda filter — see
[[Scheduling]] for the implemented behavior.

| Concern        | Behavior                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Validation     | A present value must resolve to an in-tenant, ACTIVE `SERVICE` item: unknown/foreign is `404 NOT_FOUND`, inactive/wrong kind is `400`. |
| Cross-boundary | Only the item's identity (`id`, `name`, `kind`) is read and projected; no price, tax, rate or currency value crosses into scheduling.  |
| Duration       | `durationMinutes` remains the explicit caller-supplied parameter ([[DEC-007]]); nothing derives it from the service.                   |
| Portal         | The portal booking-request body stays strict and gains no service field; no portal surface exposes service selection.                  |

Deactivating a catalog item does not rewrite existing links: an appointment that
already references a deactivated item keeps rendering its identity, and only a
new or changed link is validated against `isActive`.

## Events / Jobs

- None. No catalog event, job or queue message is emitted, and the public schema
  carries no event/outbox/queue/job table — the live evidence asserts this.

## Invariants

- **Exactly one global rate per item, never zero.** `tax_rate_id` is `NOT NULL`
  with `RESTRICT`; the create requires a rate and an update cannot clear it.
- **Rates are global and tenant read-only.** No tenant-scoped rate row, no rate
  column on the item, no mutation route and no per-item override or rate copy.
- **The reference price is one pair or nothing.** Both columns present or both
  absent, enforced in the database (`catalog_item_reference_price_pair_check`)
  and in the API contract; the amount is non-negative and the currency is an
  accepted ISO 4217 code.
- **Removal is deactivation.** The `BEFORE DELETE` trigger raises on `DELETE`
  and no API route offers one.
- **Every query carries the tenant predicate implicitly** through
  `RequestContextService`, so a foreign record is indistinguishable from a
  missing one and nothing is persisted on rejection.
- **The item change and its audit row are one atomic unit**: no reader may
  observe a mutation without its co-committed trail row.
- **The reference price is informational.** Nothing in this module computes,
  sums, converts or rounds it, and no sale, invoice, cash or fiscal value is
  derived from it.

## Security / tenant rules

- Tenant identity comes only from the server-side request context; a route-,
  query- or body-supplied `tenantId` is never trusted and is rejected as an
  unknown key.
- The repository resolves the tenant via `requireTenantId()` (which fails closed
  with `FORBIDDEN` when no tenant authority was resolved) and rebuilds every
  write from an explicit allowlist, so a rogue runtime property cannot re-scope
  a row. Updates use a compound `{ id, tenantId }` predicate rather than a
  unique-key update.
- The web proxy is not an authorization authority: it decides only whether a
  request is on the allowlist and whether a credential is present, forwards only
  the staff session cookie, and never derives a tenant or a permission.
- Permission checks in the browser are UX only; the API remains the authority
  for every read and write.

## Known Limitations / Residual Risks

- **Last write wins.** There is no `version`/optimistic-lock column, so a
  concurrent `PUT` on one item silently overwrites the earlier write;
  `updatedAt` is a timestamp, not a concurrency token. Recorded as [[TD-014]].
- **The three sibling staff proxies reject differently.** The catalog proxy
  answers `405` for a known path with a disallowed method where the older
  scheduling proxy answers `404`, and it refuses a cookie-less request locally
  with `401` where the scheduling and portal proxies forward it. Recorded as
  [[TD-013]].
- **`packages/database/scripts/*` sits outside the package's lint and typecheck
  scope**, although CI executes those scripts in the migrations job. Recorded as
  [[TD-015]].
- **The rate list order is lexicographic.** The API orders by `code` (`EXEMPT`,
  `IVA_10`, `IVA_5`); the human order `EXEMPT`, `IVA_5`, `IVA_10` is a web
  display rule. Properly fixing it needs a display-order decision on the API
  side, which no change has made.
- **`tax_rate` has no delete trigger.** A rate row is protected by the
  `RESTRICT` foreign key from `catalog_item` and by the absence of any mutation
  route, but an unreferenced rate row is still deletable by direct SQL.
- **The seed cannot correct an existing rate literal.** The rate upserts use
  `update: {}` (the global-catalog convention), so a corrected value reaches an
  existing database only after that row is removed or the seed is changed.
- **Accepted currencies are `PYG` and `USD` only.** Any other ISO 4217 code
  requires a product decision plus a test.
- **The reference price has one fixed scale for every currency**, per EPIC-09
  "Decided". Per-currency exponent handling, if POS later requires it, belongs
  to its own decision and migration.
- **No browser-to-API round trip has been proven.** The staff surface is covered
  by component tests against a mocked `fetch` and the proxy by its route handler
  in-process; Playwright/E2E remains deferred ([[TD-007]]).
- **No live-PostgreSQL case exercises the appointment service link.** The
  migration was applied locally and its DDL is pinned textually, but the live
  suite covers the catalog aggregate, not the `SERVICE` association.
- **A `catalog.read`-only role can open the read-only detail page** but is not
  blocked from reaching the edit form: the API refuses the write and the form
  surfaces that `403` honestly, because the client is deliberately not an
  authorization authority.

## Verification

- `packages/database/src/schema-catalog.test.ts` — 15 textual gates over the
  schema and the migration DDL: kind pinning, global vs tenant scope, `Restrict`
  FKs, the composite ownership key, the pair/ISO 4217/non-negative `CHECK`s, the
  delete-rejecting trigger, migration additivity and forbidden dimensions.
- `packages/database/src/reference-seed.test.ts` — the three global rates and
  their `Decimal(5,2)` literals, the natural-key upserts with the `taxRates`
  count, and the identity-stable rerun.
- `apps/api/src/catalog/catalog.repository.test.ts` — 11 tenant-isolation cases
  for the persistence seam (context-only tenant resolution, byte-equivalent
  foreign/unknown not-found, no implicit active predicate, soft idempotent
  deactivation, no delete path).
- `apps/api/src/catalog/catalog.integration.test.ts` — 18 HTTP cases over the
  real guard chain: the `403`-persists-nothing sweep, the exact allowlisted key
  sets, both list filters, the unknown/malformed id `400`, the create and update
  rejection sweeps, the pair `null`-clears/absent-untouched matrix, one
  co-committed audit row per accepted mutation, idempotent deactivation, the
  byte-equivalent cross-tenant `404` and the absence of a delete route.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the pinned catalog route
  inventory and `CATALOG_PERMISSION_BY_ROUTE`.
- `apps/api/src/scheduling/{appointment.dto,appointment.service,appointments.integration}.test.ts`
  and `packages/database/src/scheduling.test.ts` — the optional `SERVICE`
  association, its anchor rules and the additive migration.
- `apps/web/src/app/api/catalog/[[...path]]/route.test.ts` — the proxy
  allowlist, the uniform rejections and the staff-cookie-only forwarding.
- `apps/web/src/app/(app)/app/catalog/{catalog-api,catalog-list,catalog-form}.test.ts(x)`
  and `[id]/catalog-item-detail.test.tsx` — the client contract, the states, the
  required rate selector, the price pair and the explicit deactivate command.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — "EPIC-09 catalog
  application-path isolation": real HTTP against real PostgreSQL for the
  create/read/update/deactivate path with the allowlisted INTERNAL DTO and one
  co-committed audit row per mutation, the byte-equivalent cross-tenant `404` on
  read/update/deactivate, the GLOBAL seed served to two tenants, the
  unknown-rate rejection plus the service-bypassing `RESTRICT` FK rejection, the
  raw-SQL delete-trigger and pair-`CHECK` probes, the co-commit atomicity
  barrier and the concurrent-deactivation attribution race (exactly one
  `["isActive"]`, one `[]`).
- Local closure run (2026-09-25, **local**, not CI): `pnpm preflight` reachable;
  `db:deploy` applied all migrations including the two catalog ones; the seed
  idempotency probe returned identical counts with `taxRates: 3`;
  `db:live-verify` passed; the live-PG suite reported **47/47 passed**. See
  `docs/10-qa/CI-EVIDENCE.md`.

## Related Stories

- [[CAT-001 Catalog item foundation]] — WU1: schema, migration, rate seed and
  the tenant-safe repository seam.
- [[CAT-002 Catalog read API]] — WU2 A2: the read surface and the allowlisted
  DTOs.
- [[CAT-003 Catalog write API]] — WU2 A3: the write surface, pair validation,
  mandatory rate and transactional audit.
- [[CAT-004 Staff catalog surface]] — WU3: the `/api/catalog` proxy and the
  `/app/catalog` staff pages.
- [[CAT-005 Appointment service link]] — WU4: the optional `SERVICE` association
  and the agenda filter.

## Related ADRs

- [[ADR-001 Modular Monolith]]

## Related Decisions

- [[DEC-010]] — optional catalog reference price with per-item ISO currency and
  global read-only tax rates; the source of the price-pair, currency and
  read-only-rate boundaries.
- [[DEC-007]] — agenda v2; fixes `durationMinutes` as an explicit parameter that
  the WU4 service link must not derive.
- [[DEC-002]] — unprefixed route paths.
