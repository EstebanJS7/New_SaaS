---
id: CAT-003
type: story
title: Catalog write API
epic: EPIC-09
status: in-progress
priority: high
depends_on:
  - EPIC-02
  - CAT-001
  - CAT-002
prd_sections:
  - "7"
  - "15"
permissions:
  - catalog.create
  - catalog.update
  - catalog.deactivate
branch: main
created: 2026-09-25
updated: 2026-09-25
---

# CAT-003 — Catalog write API

## Objective

Complete the EPIC-09 catalog HTTP surface with the three authorized mutations —
create, update and soft-deactivate — each validated against the pinned kinds and
the three GLOBAL seeded tax rates, each co-committing exactly one audit row in
the same transaction as the item change, with a byte-equivalent cross-tenant
`404` and no delete route anywhere.

## What shipped

| Surface                        | Contract                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `POST /catalog`                | Creates one item; `taxRateId` is required and must resolve to a seeded rate.           |
| `PUT /catalog/:id`             | Partial update; omitted fields stay untouched, `null` clears the reference-price pair. |
| `POST /catalog/:id/deactivate` | Idempotent soft removal; a foreign or unknown id is the same byte-equivalent `404`.    |

`POST` returns `201` and `PUT` `200` (the repository's default command statuses,
matching `POST /customers/:id/deactivate`). Every route declares its single
granular key with `@RequirePermissions` **and** re-asserts it in
`CatalogService`; routes are unprefixed per DEC-002. Each accepted mutation
appends exactly one `catalog_item.*` audit row through `AuditWriter` inside the
same `$transaction`, carrying stable ids and field **names** only.

## Validation rules

| Rule                      | Create                                      | Update                                                               |
| ------------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| `kind`                    | Required, one of the four pinned kinds      | Optional, same pin                                                   |
| `name`                    | Required, 1..200 chars                      | Optional, same bound                                                 |
| `taxRateId`               | **Required**, must resolve to a seeded rate | Omitted ⇒ unchanged; present ⇒ must resolve; `null` ⇒ `400`          |
| reference price pair      | Both present or both absent                 | Omitted ⇒ unchanged; `null` **on both** ⇒ cleared; one alone ⇒ `400` |
| `isActive`                | Not accepted (`400`)                        | Not accepted (`400`) — deactivation is its own command               |
| `tenantId` / unknown keys | Rejected (`400`, `.strict()`)               | Rejected (`400`, `.strict()`)                                        |

Rejected input is `400 VALIDATION_FAILED` and persists nothing, including no
audit row. An unknown **or foreign-tenant** item id on update or deactivate is a
byte-equivalent `404 NOT_FOUND` (one shared message constant), verified with
`expectCrossTenant404` on the real guard chain.

## Context

- WU1 ([[CAT-001 Catalog item foundation]]) delivered the schema, migration,
  rate seed and the tenant-safe `CatalogRepository` seam — including its unused
  `create`/`updateMany`/`deactivate` write paths.
- WU2 A1 seeded the four `catalog.*` keys; A2 ([[CAT-002 Catalog read API]])
  shipped the three `catalog.read` routes, the allowlisted DTOs and the shared
  in-memory `taxRate`/`catalogItem` delegates. This slice consumes the
  `create`/`update`/`deactivate` keys and finally exercises those delegates'
  write paths.
- Precedents reused: `CustomersService`/`PatientsService` for the command shape
  and the co-committed audit append (`this.audit.append(input, tx)` inside
  `this.prisma.$transaction`); `portal-profile.dto.ts` for the documented
  "`null` clears, absent leaves untouched" convention; `ClinicalWeight.quantity`
  for the exact-decimal-as-text rule.
- The API package resolves `@newsaas/database` from its built `dist` types, so
  `pnpm --filter @newsaas/database build` runs first in this slice.

## In Scope

- `CreateCatalogItemInput` / `UpdateCatalogItemInput` zod contracts in
  `catalog.zod.ts`, including the pair refinement and the accepted-currency pin.
- `CatalogService.create/update/deactivate` with permission re-assertion, the
  seeded-rate resolution and the transactional audit append.
- `CatalogController` command routes plus `AuditModule` in `CatalogModule`.
- Route-contract probe entries and a per-route permission pin for all six
  catalog routes.
- HTTP write coverage in `catalog.integration.test.ts` for every rule above.

## Out of Scope

- Staff UI and the web proxy (WU3); the `SERVICE`↔`Appointment` association
  (WU4); live-PostgreSQL evidence and closure gates (WU5).
- Any tax, price, rounding or conversion arithmetic — the reference price is
  stored and projected, never computed from.
- Tenant-configurable rates or per-item rate overrides; a stock flag; a hard
  delete route; optimistic concurrency.

## Acceptance Criteria

- [x] Every catalog route declares exactly one granular permission and the
      service re-asserts it; a missing permission is `403` and persists nothing,
      for each of the three writes.
- [x] `taxRateId` is required on create and must resolve to one of the three
      globally seeded rates; an unknown or foreign rate id is
      `400 VALIDATION_FAILED` and persists nothing.
- [x] An omitted `taxRateId` on update leaves the selected rate unchanged; a
      present one must resolve; an explicit clear is `400` and persists nothing.
- [x] The reference price is an amount + ISO 4217 currency pair: both present or
      both absent, `null` clears and absent leaves untouched, with a lone key, a
      malformed or unsupported code and a negative amount all `400` and
      persisting nothing.
- [x] An unknown or foreign-tenant item id on update or deactivate is a
      byte-equivalent `404 NOT_FOUND` identical to any other unknown id, and
      persists nothing.
- [x] Every accepted mutation appends exactly one audit row in the same
      transaction, with stable ids and field NAMES only.
- [x] Deactivation is idempotent and is the only removal; no delete route
      exists.
- [x] `pnpm --filter @newsaas/api test`, `typecheck`, `lint`,
      `pnpm --filter @newsaas/database test`, package build and targeted
      Prettier / `git diff --check` are reported with exact commands and
      results.
- [x] Live-PostgreSQL verification of these writes is green in this environment
      (`pnpm --filter @newsaas/api test:live-pg` — 1 file / 47 tests), including
      the concurrent-deactivation attribution below. The DURABLE CI and closure
      gate stays with WU5; this run is the on-demand proof, not the epic gate.

## Domain Invariants

- No stored item exists in a rate-less state: the column is `NOT NULL` with a
  `RESTRICT` foreign key, the create requires a rate, and an update cannot clear
  it. The rate is a selection, never a calculation.
- Every decimal this boundary projects is an exact STRING at the stored
  two-decimal scale (see "Decided"): padding to the column's own scale is
  lossless, and no projection rounds, trims or reformats a stored digit.
- The rate list stays GLOBAL and tenant read-only; this slice adds no rate
  mutation route and no per-item override field.
- Catalog configuration is INTERNAL: only allowlisted DTO keys cross the HTTP
  boundary, and no audit row, response or log carries an amount or a name value.
- Removal is deactivation. The database trigger rejects `DELETE` and no API
  route offers one.

## Decided

- **Audit action names are `catalog_item.created` / `catalog_item.updated` /
  `catalog_item.deactivated`.** The brief suggested `catalog.item_created` et
  al.; the repository's own convention is `<singular_entity_snake>.<past_verb>`
  (`customer_address.updated`, `clinical_weight.created`,
  `patient_guardian.created`, `appointment.no_show`), so a two-segment domain
  with a combined verb would have been the only exception in the codebase.
  `targetType` is `catalog_item` to match the entity name.
- **The accepted ISO 4217 code list is exactly `PYG` and `USD`.** PRD §1 fixes
  PYG as the product currency with USD as the only secondary currency, and the
  catalog migration comment is explicit that the database enforces ISO 4217
  _shape_ while "the accepted code list is validated by the API". DEC-010
  boundary 2 requires unknown or unsupported codes to be rejected server-side,
  so a well-formed `ZZZ` is refused exactly like a malformed `pyg`. Widening the
  set is a product decision, not a silent client option.
- **`isActive` is not an update field.** Deactivation has its own route and its
  own `catalog.deactivate` key; accepting the flag on `PUT` would let
  `catalog.update` bypass that key. A supplied `isActive` is an unknown key and
  a `400`.
- **A repeat deactivation still appends one audit row, with
  `changedFields: []`.** The customer/patient deactivation convention is that
  the command always writes its trail row; the empty diff is what distinguishes
  a repeat from the transition that actually flipped `isActive`. This is
  deliberate and pinned by a test rather than left undefined.
- **The reference-price pair rule is one shared `superRefine`.** `undefined`
  means absent and `null` means clear, so a lone key is rejected on create and
  on update alike; only "both absent" and "both carrying a value" are valid
  states.
- **The rate is resolved before the transaction opens.** The `tax_rate` rows are
  immutable seed data protected by a `RESTRICT` foreign key and are never
  tenant-scoped, so the check needs no transaction of its own; an unresolvable
  id throws before any write is attempted.
- **No catalog event is emitted.** The API has no event dispatcher and this
  boundary adds none — there is nothing to react to post-commit, so the audit
  row is the only side effect.
- **Decimal projections are FIXED-SCALE two-decimal strings.** Settled
  2026-09-25 while closing the WU2 correctness findings. The epic fixed the
  reference-price scale at `Decimal(14, 2)` and the seeded rate column is
  `DECIMAL(5, 2)`, so BOTH are projected at exactly two decimals instead of each
  environment's own spelling. Prisma's `Decimal` trims trailing zeros on read,
  so the live DTO reported `"10"` and `"150000"` where the stored column text is
  `"10.00"` and `"150000.00"`, while the in-memory boundary returned the seeded
  text verbatim. A fixed scale is the consistent choice because these values are
  EXACT and no arithmetic is performed on them: padding to the column's declared
  scale adds no digit, rounds nothing and is therefore lossless, whereas
  accepting two spellings would have made the API contract environment-dependent
  and pushed the ambiguity onto every client. The projection has ONE
  implementation (`decimalToFixedScaleString` in `catalog.service.ts`, used by
  the item DTO, the nested rate projection and the rate list), so the two
  persistence paths cannot diverge; the in-memory assertions and the live
  assertions both pin the padded form, and the live suite now compares the DTO
  to the raw `::text` column value exactly instead of tolerating two
  representations.
- **The deactivation audit diff comes from the conditional write's affected-row
  count, never from a pre-state read.** Settled 2026-09-25 while closing the WU2
  correctness findings. A read taken before the row lock cannot distinguish a
  transition from a concurrent repeat: two racing deactivations can BOTH still
  observe `isActive = true`, so each would record `changedFields: ["isActive"]`
  although only one guarded `isActive = true` UPDATE ever matched a row.
  `CatalogRepository.deactivate` therefore returns the after-state row plus
  `flipped`, derived from that UPDATE's own count — the signal
  `CustomersService`/`PatientsService` already use for the same diff — so
  exactly ONE accepted call reports the change and every repeat reports `[]`.
  The live race test is the evidence and fails without it.

## API

### Added

```text
POST /catalog                  catalog.create      create an item (201)
PUT  /catalog/:id               catalog.update      partial update (200)
POST /catalog/:id/deactivate    catalog.deactivate  idempotent soft removal (201)
```

### Changed

```text
GET /catalog, GET /catalog/:id, GET /catalog/tax-rates   unchanged contract;
                                                          service permission
                                                          re-assertion refactored
```

There is deliberately no `DELETE` route and no generic `PATCH status=...`.

## Database

No schema, migration or seed change. The slice writes `catalog_item` through the
WU1 repository and reads `tax_rate` for rate resolution;
`packages/database/dist` was rebuilt so API consumers see current model types.

## Tests Added

- `apps/api/src/catalog/catalog.integration.test.ts` — 12 new HTTP cases (18
  total in the file): the `403`-persists-nothing sweep across all three writes
  for a read-only and a permission-less member; create success with the exact
  allowlisted key set, one co-committed audit row and no value in the metadata;
  a create with no reference price; a 17-case create rejection sweep; an update
  that leaves the rate unchanged; an update that changes the rate; the
  `null`-clears / absent-untouched pair matrix, whose reset step submits an
  UNPADDED `"250.5"` and pins the canonical `"250.50"` response; a 14-case
  update rejection sweep that also asserts the stored row is untouched; the
  byte-equivalent cross-tenant `404` for update and for deactivate; idempotent
  deactivation with one audit row per accepted call; and the absence of a delete
  route.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — one new EPIC-09 case,
  "attributes the isActive flip to exactly ONE of two concurrent deactivations
  of the same item": a dedicated transaction holds the item's row lock while
  both racers read the pre-state and park on their own conditional
  `isActive = true` UPDATE (the shared resource-scoped tuple barrier proves both
  waiters), and the trail must then contain exactly one `["isActive"]` and one
  `[]`. It failed against the pre-fix code with `[['isActive'], ['isActive']]`.
  The catalog decimal assertions in that file were tightened from a canonical
  two-spelling comparison to exact equality with the stored two-decimal text.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the three command routes
  added to the exact inventory plus a `CATALOG_PERMISSION_BY_ROUTE` pin
  asserting the single expected `catalog.*` key on each of the six catalog
  routes.

## Verification

```text
pnpm --filter @newsaas/database build ...... Prisma Client 6.19.3 generated;
                                             tsc clean
pnpm --filter @newsaas/api test ............ 69 files passed, 1 skipped (the
                                             live-PG suite); 838 tests passed,
                                             47 skipped (the live-PG cases are
                                             the skipped ones)
pnpm --filter @newsaas/api typecheck ....... clean
pnpm --filter @newsaas/api lint ............ clean
pnpm --filter @newsaas/database test ....... 13 files passed; 204 tests passed
pnpm exec prettier --check <touched files, no .prisma path>
                                           All matched files use Prettier code
                                           style
git diff --check ........................... clean
DATABASE_URL_TEST=... DATABASE_URL=... pnpm --filter @newsaas/api test:live-pg
                                           pre-fix (RED): 1 file, 46 passed +
                                           1 FAILED — the new race case got
                                           [['isActive'], ['isActive']]
                                           post-fix: 1 file passed; 47 tests
                                           passed (was 46)
```

Focused pre-run:
`pnpm exec vitest run --config vitest.config.ts src/catalog src/rbac/route-contract.probe.test.ts`
reported 3 files / 44 tests passed. The package suite grew by the 12 new
integration cases (route pins are an extended map, not a new count).

Unexecuted here: `pnpm preflight`, `pnpm db:seed` against the developer database
and `pnpm db:live-verify`; the live suite provisions its own disposable database
and applies `pnpm db:deploy` + `pnpm db:seed` to it.

## Known Limitations

- **Last write wins.** The catalog schema has no `version`/optimistic-lock
  column, so a concurrent `PUT` on the same item overwrites the earlier one
  silently; `updatedAt` is a timestamp, not a concurrency token. Adding
  optimistic concurrency is a schema change and belongs to its own decision, not
  to this slice.
- The in-memory boundary snapshots and restores its tables on a thrown
  transaction, which makes the "persists nothing" assertions honest, but only
  the live suite exercises real transactional and concurrent behavior. The
  deactivation attribution is now covered there by the row-lock race; the
  remaining write rules are still proven at the HTTP level against the shared
  in-memory boundary, and the durable CI/closure gate remains WU5.
- The shared in-memory `catalogItem` delegate hands back the **stored row
  object**, not a copy, so `updateMany` mutates a row a caller may still hold.
  `CatalogRepository.deactivate` now returns `{ ...row, flipped }`, a copy, so
  its caller no longer reads a live row across a write; a future caller holding
  a row across a write must copy it the same way, or the boundary fake must
  start cloning on read.
- The accepted-currency set is `PYG`/`USD`. Supporting any other ISO 4217 code
  requires a product decision plus a new test, not a client-supplied value.
- No catalog event is emitted because no dispatcher exists; "no event" is a
  property of the current architecture rather than a test assertion.
- The `~400` authored-line review heuristic is exceeded: the write surface, its
  two rejection sweeps and the shared-file integration coverage are one coherent
  unit and were not trimmed to fit.

## Next Step

WU2 A4 — the focused and root checks over the whole unit are reported in
"Verification". WU3 (staff UI and web proxy) consumes these three commands. WU5
still owns the DURABLE live-PostgreSQL CI/closure evidence: the on-demand run
recorded here is not a substitute for it.

## Files / Modules

- `apps/api/src/catalog/catalog.zod.ts` — create/update contracts, the pair
  refinement, the accepted-currency pin and `CATALOG_DTO_SCHEMA_VERSION`.
- `apps/api/src/catalog/catalog.service.ts` — permission re-assertion,
  seeded-rate resolution, the three audited mutations and the rate map.
- `apps/api/src/catalog/catalog.controller.ts` — the three command routes.
- `apps/api/src/catalog/catalog.module.ts` — `AuditModule` wired in.
- `apps/api/src/catalog/catalog.integration.test.ts` — read + write coverage.
- `apps/api/src/rbac/route-contract.probe.test.ts` — route inventory and the
  per-route `catalog.*` pin.
- `apps/api/test/support/in-memory-database.ts` — unchanged: the `catalogItem`
  write paths and `taxRate.findFirst` already existed and are exercised as-is.
