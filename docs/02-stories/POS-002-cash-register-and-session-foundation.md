---
id: POS-002
type: story
title: Cash register and session foundation
epic: EPIC-12
status: in-progress
priority: high
depends_on:
  - EPIC-02
prd_sections:
  - "5"
  - "7"
  - "9"
  - "10"
  - "20"
  - "27"
  - "28"
  - "29"
  - "41"
permissions:
  - cash.read
  - cash.register.create
  - cash.session.open
branch: feat/epic-12-cash-foundation
created: 2026-09-27
updated: 2026-09-29
---

# POS-002 — Cash register and session foundation

## Objective

Deliver the minimum PRD §20 Cash model that makes PRD §18's `CompleteSale`
satisfiable: a tenant-scoped `CashRegister`, `CashSession` and `CashMovement`,
the one-`OPEN`-session-per-register rule enforced in the database by a partial
unique index, and the minimal register-create and session-open commands.
[[DEC-020]] fixes this boundary deliberately: EPIC-13 Cash depends on EPIC-12,
so a CASH sale cannot create its cash movement if the foundation ships only in
the later epic.

The cash movement type is extended additively with `SALE` only. The six
remaining PRD §20 kinds — `REFUND`, `INCOME`, `EXPENSE`, `WITHDRAWAL`, `DEPOSIT`
and `ADJUSTMENT` — stay reserved for EPIC-13, under the same additive discipline
the inventory enum already documents. Session close, the expected/counted
difference, cash reversals and the full cash UI are out of scope.

## Context

- PRD §20 defines the three Cash entities, the seven movement kinds, the rule
  "only one OPEN session per register", the immutability of confirmed movements
  and a close that computes the expected amount on the server and stores or
  audits the difference.
- `docs/01-roadmap/ROADMAP.md:24` lists EPIC-13 Cash as `planned` depending on
  EPIC-12, so Cash is genuinely downstream of the sale command; that dependency
  is why [[DEC-020]] pulls the minimum foundation forward.
- The `cash` feature code is one of the twelve seeded feature codes
  (`packages/database/src/reference-seed.ts:299`) and `cash.session.close` is
  already seeded (`reference-seed.ts:87`) while being consumed by no route.
- No `CashRegister`, `CashSession`, `CashMovement` model and no
  `CashMovementType` enum exists today; no cash module exists under
  `apps/api/src/`.
- [[DEC-020]] therefore decides that the register, the session, the movement,
  the `SALE` movement kind, the partial unique index and the session-open
  command belong to this Story, and everything else to EPIC-13.

## In Scope

- `packages/database/prisma/schema.prisma` — the `CashRegister`, `CashSession`
  and `CashMovement` models, a `cash_movement_type` enum carrying `SALE` only, a
  session status enum carrying `OPEN` and `CLOSED`, the tenant composite
  ownership keys, the `RESTRICT` references, the immutability guarantee for a
  confirmed movement and the partial unique index on
  `(tenant, register) WHERE status = 'OPEN'`. `CashRegister` carries the columns
  the create command needs (`name`, `is_active`) and `CashSession` carries the
  required `opening_amount` (`DECIMAL(14,2)`, `NOT NULL`, `0.00` allowed) and
  `opened_by_membership_id` with its composite `RESTRICT` foreign key to
  `tenant_membership(tenant_id, id)`.
- The additive migration
  `packages/database/prisma/migrations/20260927000002_cash_foundation/`, plus
  the `packages/database/src/schema-cash.test.ts` gate.
- `apps/api/src/cash/` — the permission contract, allowlisted DTOs, strict Zod
  contracts, the tenant-safe repository, the register-create and session-open
  commands, the read routes, the service, the controller and the module, plus
  its registration in `apps/api/src/app.module.ts` and the corresponding tables
  in the suite's shared in-memory boundary.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the new routes and their
  per-route permission pins.
- `packages/database/src/reference-seed.ts` — the `cash.read`,
  `cash.register.create` and `cash.session.open` keys and their role matrix,
  with the reconciled seed-count probe moving the catalog 47 → 50; the epic's 51
  is completed by POS-003's `sales.complete`.
- Tenant isolation, authorization, validation and concurrency tests over the
  real guard chain, plus durable live-PostgreSQL coverage proving the partial
  unique index against real PostgreSQL.
- This Story and the epic record.

## Out of Scope

- **Session close, the expected/counted amount and the stored or audited
  difference** — EPIC-13. The already-seeded `cash.session.close` key stays
  reserved and is consumed by no EPIC-12 route.
- **The six remaining cash movement kinds** — `REFUND`, `INCOME`, `EXPENSE`,
  `WITHDRAWAL`, `DEPOSIT` and `ADJUSTMENT` stay reserved for EPIC-13
  ([[DEC-020]]).
- **Cash reversals and compensating cash movements** — PRD §40 names "Cash
  compensating movement" as a core correction case; it is deferred with the rest
  of the correction boundary ([[DEC-023]]).
- **The full cash UI, cash reports and cash reconciliation** — EPIC-13 and
  EPIC-18.
- **The CASH payment path of `CompleteSale`** — [[POS-003]]. This Story ships
  the foundation and the open command; it writes no `SALE` movement itself.
- **The sale aggregate, its lines and its prices** — [[POS-001]].
- **Invoices, billing and fiscal documents** — EPIC-14, EPIC-15 and EPIC-16.
- **A Branch, Warehouse or location dimension.** Cash and stock stay tenant-wide
  ([[DEC-020]]).
- **Customer credit, accounts receivable or overpayment** — [[DEC-029]].
- **Automatic retention or purge of any confirmed cash record** — PRD §41.
- **Hard delete of a register, a session or a confirmed movement.**
- **A new Decision record or an ADR** — outside this Story's file surface.

## Acceptance Criteria

- [x] `CashRegister`, `CashSession` and `CashMovement` are tenant-scoped with
      tenant composite ownership keys and `RESTRICT` tenant foreign keys; a
      cross-tenant or unknown UUID is one byte-equivalent `404`. `CashSession`
      records the opener as `opened_by_membership_id`, a composite `RESTRICT`
      foreign key to `tenant_membership(tenant_id, id)`, so the database
      guarantees the opener belongs to the session's tenant rather than relying
      on a global `user_profile` reference. Evidence: the tenant-scope,
      composite-key and `RESTRICT` cases of `schema-cash.test.ts`; the seven
      applied composite ownership keys probed raw in both directions by the
      live-PostgreSQL block; and its byte-equivalent cross-tenant register
      `404`, where a foreign register UUID and an unknown one return identical
      bytes. The session half of that `404` is not exercised over HTTP — the
      surface has no session-by-id route — and is proven instead by the
      composite foreign keys and the tenant-scoped session list, which never
      exposes another tenant's session.
- [x] "Only one OPEN session per register" is enforced in the database by a
      partial unique index, not by application convention, so a concurrent
      second open is rejected by the database rather than by a service check.
      Evidence: the `cash_session_one_open_per_register_key` case of
      `schema-cash.test.ts`; the live-PostgreSQL block proves the rule three
      ways — a rolled-back raw insert naming the index, a concurrent second open
      resolving to exactly one `201` and one `409` with no second row and one
      audit row, and the applied index predicate
      `WHERE (status = 'OPEN'::cash_session_status)` alongside an admitted
      `CLOSED` sibling.
- [x] `CashMovementType` gains `SALE` additively only; the six remaining PRD §20
      kinds are absent from the applied enum and stay reserved for EPIC-13, and
      no existing enum value is reordered or removed ([[DEC-020]]). Evidence:
      the exact `'SALE'`-only enum case of `schema-cash.test.ts` over both the
      migration SQL and the Prisma model.
- [x] The session-open command and the register-create command are the only
      write routes; the cash surface exposes no `PATCH` and no `DELETE` route,
      and a confirmed movement is immutable at the database level. Evidence: the
      four-route inventory, the no-`PATCH`/no-`DELETE`/no-close case and the
      per-route permission pins of `cash.integration.test.ts` and
      `route-contract.probe.test.ts`; and the live database's three triggers — a
      session delete, a movement delete and a movement update — with their exact
      `restrict_violation` messages.
- [x] A tenant can create an in-tenant `CashRegister`; the name is a validated,
      non-empty bounded value, and a cross-tenant or unknown id is the shared
      `404` rather than a distinct error. The create command resolves the
      caller's tenant server-side and never reads `tenantId` from body, query or
      route. Evidence: the create, name-bound and validation sweeps of
      `cash.integration.test.ts`; and the live-PostgreSQL register create with
      its `cash.register.created` audit row, the name unique proven against the
      real index (including the same name admitted in another tenant) and the
      byte-equivalent cross-tenant `404`.
- [x] `POST /cash/sessions` requires an opening float: `opening_amount` is money
      at `Decimal(14, 2)`, `NOT NULL`, and `0.00` is allowed because a register
      may open with an empty drawer; a negative value is rejected as a
      validation error that persists nothing. The float is the baseline PRD
      §20's server-computed expected amount at close is compared against.
      Evidence: the `cash_session_opening_amount_non_negative` and
      `cash_movement_amount_non_zero` `CHECK`s of `schema-cash.test.ts`; the
      `0.00` and non-zero opening cases and the negative-float rejection of
      `cash.integration.test.ts`; and the live-PostgreSQL block, which opens
      both a `0.00` and a non-zero session and probes both `CHECK`s raw.
- [x] The session-open command resolves the caller's tenant server-side and
      never reads `tenantId` from body, query or route; the register is resolved
      in-tenant and a foreign or unknown register id is the shared `404`.
      Evidence: the strict session-open contract of
      `apps/api/src/cash/cash.zod.ts`, the register-resolution and masking cases
      of `cash.integration.test.ts`, and the live-PostgreSQL byte-equivalent
      `404` for a foreign register against the unknown-UUID response.
- [x] Every cash route enforces authentication, server-side tenant context and a
      granular permission re-asserted by the service before data access, plus
      the `cash` capability through `EntitlementsService.has(tenantId, "cash")`;
      a missing permission or a tenant without the capability is a stable `403`
      that persists nothing, and the frontend gate is UX only ([[DEC-026]]).
      `cash` is its own seeded feature code (PRD §10), exactly as `sales` gates
      the sale surface. Evidence: the entitlement-first `cash` gate of
      `apps/api/src/cash/cash.service.ts`; the read, write and capability `403`
      sweeps of `cash.integration.test.ts`; and the per-route permission pins of
      `route-contract.probe.test.ts`.
- [x] All request bodies are strict allowlisted contracts that reject unknown
      keys; `tenantId` is never read from body, query or route; no Prisma model
      crosses the HTTP boundary. Evidence: the `.strict()` contracts of
      `apps/api/src/cash/cash.zod.ts`; the invalid body and query sweeps of
      `cash.integration.test.ts`, which send `tenantId`, `status`, `currency`,
      `openedByMembershipId` and `branchId` and get a `400` that persists
      nothing; and its allowlisted-DTO case.
- [x] Money uses `Decimal(14, 2)`, a movement amount is non-zero and the sign is
      owned by the movement kind rather than by the caller, and no cash balance
      is ever mutated directly: every amount change is a new immutable movement
      (PRD §20). Evidence: the money-scale and `CHECK` cases of
      `schema-cash.test.ts`, the live-PostgreSQL non-zero-amount and
      non-negative-float probes, and the INERT case of both suites, which proves
      this slice writes no balance and no movement.
- [x] The session-open command co-commits exactly one audit row carrying the
      actor, the session id, stable field names and
      `{ schemaVersion, changedFields }` with no stored value; reads are not
      audited (PRD §27). Evidence: the co-committed-audit case of
      `cash.integration.test.ts` and the live-PostgreSQL session open, which
      asserts exactly one `cash.session.opened` row per open carrying the
      caller's own membership.
- [x] This Story writes no stock movement, touches no `StockBalance`, creates no
      sale and creates no payment, and the already-seeded `cash.session.close`
      key is consumed by no route. Evidence: the INERT case of
      `cash.integration.test.ts` and the live-PostgreSQL block, which counts
      sale, sale-line, stock-movement and stock-balance rows across the whole
      surface; and the four-route inventory, which admits no close route.
- [x] The three new permission keys and role matrix are seeded, and the
      seed-count probe is reconciled: `cash.read` is held by all six roles and
      `cash.register.create` and `cash.session.open` by `OWNER`, `ADMIN` and
      `CASHIER`. Evidence: the three keys and their matrix in
      `packages/database/src/reference-seed.ts` and the reconciled probe in
      `reference-seed.test.ts`, which now pins **50**. Slice arithmetic: POS-001
      took the seeded count 43 → 47 with its four `sales.*` keys, this Story
      takes it 47 → 50 with `cash.read`, `cash.register.create` and
      `cash.session.open`, and [[POS-003]] takes it 50 → 51 with
      `sales.complete`, within the epic's **43 → 51** total ([[DEC-026]]).
- [x] Tenant isolation tests exist for the three new private aggregates,
      authorization and validation tests cover every new route, and durable
      live-PostgreSQL evidence proves the partial unique index, the
      byte-equivalent cross-tenant `404` and the immutability of a confirmed
      movement. Evidence: `schema-cash.test.ts` (30 tests),
      `cash.integration.test.ts` (17 tests), the route-contract pins, and the
      10-case EPIC-12 cash-foundation block of
      `apps/api/test/live-pg-isolation.e2e-spec.ts` inside a 90-test live spec.
- [x] Required lint, typecheck, test, integration and build checks pass.
      Evidence: `pnpm lint` and `pnpm typecheck` clean for every touched
      package, `pnpm build` clean, `pnpm format-check` green repository-wide,
      the database suite (17 files / 324 tests) and the API suite (75 files /
      1026 tests with a schema-less `DATABASE_URL_TEST`), plus `test:live-pg`
      (90 tests, 0 skipped). **The CI receipt for this branch is still
      pending**, and root `pnpm test` without `DATABASE_URL_TEST` fails for the
      pre-existing [[TD-021]] reason.

## Domain Invariants

- **Only one OPEN session per register.** The rule is a database property
  enforced by a partial unique index, not an application convention a second
  writer could forget.
- **Confirmed cash movements are immutable.** An incorrect movement is corrected
  by a compensating movement, never by an edit or a delete; the compensating
  kinds belong to EPIC-13.
- **No cash balance is mutated directly.** The ledger is the source of truth and
  the register's expected amount is derived from it.
- **Every cash record belongs to exactly one tenant.** Tenant identity comes
  only from the server-side request context; a cross-tenant UUID is a `404`.
- **The movement enum is additive.** `SALE` is appended; the reserved kinds are
  added by the epic that owns their commands, never reordered or removed.
- **Money uses `Decimal`.** Never a float.

## API

### Added

Implemented routes behind the three granular permissions. The surface is four
routes: two reads, the register create and the session open. There is
deliberately **no** `PATCH` and **no** `DELETE`, and no close route.

| Route                  | Permission             | Contract                                                                                                                               |
| ---------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /cash/registers`  | `cash.read`            | The caller tenant's registers, newest first with an id tiebreaker.                                                                     |
| `GET /cash/sessions`   | `cash.read`            | The caller tenant's sessions with their register and status; optional `status` filter, no default.                                     |
| `POST /cash/registers` | `cash.register.create` | Create an in-tenant register (`201`); the name is validated non-empty and bounded.                                                     |
| `POST /cash/sessions`  | `cash.session.open`    | Open one session for an in-tenant register with the required opening float (`201`); a second open for that register is a stable `409`. |

The reserved `cash.session.close` command belongs to EPIC-13 and is not
implemented by this Story.

### Changed

```text
None yet
```

No existing route is touched; this Story's migration only adds the new
`cash_movement_type` enum value.

## Database

### Migration

Additive migration `20260927000002_cash_foundation`, applied to the live
database (24 migrations): the `cash_movement_type` enum carrying `SALE`, the
session status enum, three tables, their indexes, constraints and the partial
unique index on `(tenant_id, register_id) WHERE status = 'OPEN'`. It alters no
existing table and inserts no rows, and this Story created it as its first work
unit.

### Models/Tables

- `CashRegister` (table `cash_register`) — tenant-scoped register. Columns: `id`
  (`UUID` PK, `gen_random_uuid()`), `tenant_id` (`UUID NOT NULL`), `name`
  (`VARCHAR(200) NOT NULL`, non-empty and bounded by the
  `cash_register_name_length` `CHECK`), `is_active`
  (`BOOLEAN NOT NULL DEFAULT true`) and timestamps, with the per-tenant unique
  `cash_register_tenant_id_name_key` on `(tenant_id, name)`. There is
  deliberately no `branch_id` ([[DEC-020]]).
- `CashSession` (table `cash_session`) — tenant-scoped session. Columns: `id`,
  `tenant_id`, `register_id`, `status`
  (`cash_session_status NOT NULL DEFAULT 'OPEN'`), `opened_at`, `opening_amount`
  (`DECIMAL(14,2) NOT NULL`, `0.00` allowed, the required opening float, bounded
  non-negative by the `cash_session_opening_amount_non_negative` `CHECK`),
  `opened_by_membership_id` (composite `RESTRICT` to
  `tenant_membership(tenant_id, id)`), timestamps and the
  `cash_session_tenant_id_status_idx` on `(tenant_id, status)`. The partial
  unique index enforces at most one `OPEN` row per `(tenant, register)`.
- `CashMovement` (table `cash_movement`) — immutable movement. Columns: `id`,
  `tenant_id`, `register_id`, `session_id`, `type` (`cash_movement_type`, `SALE`
  only), `amount` (`DECIMAL(14,2) NOT NULL`, non-zero by the
  `cash_movement_amount_non_zero` `CHECK`), `reason` (`VARCHAR(500) NULL`) and
  `created_at`. There is no `updated_at`: a movement is written once and then
  immutable.

| Guarantee                | Applied shape                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| Movement enum            | `cash_movement_type` with `SALE` only; the six others reserved for EPIC-13                            |
| Session status           | `cash_session_status` pinned to `OPEN`, `CLOSED`                                                      |
| Tenant scope             | Seven `RESTRICT` foreign keys, a tenant FK on each of the three tables                                |
| Ownership is composite   | `(tenant_id, id)` unique on each table                                                                |
| Same-tenant references   | Composite FKs to `cash_register(tenant_id, id)` and `cash_session(tenant_id, id)`                     |
| Same-tenant opener       | Composite `RESTRICT` FK `opened_by_membership_id` → `tenant_membership(tenant_id, id)`                |
| One OPEN session         | Partial unique index on `(tenant_id, register_id) WHERE status = 'OPEN'`                              |
| One name per tenant      | `cash_register_tenant_id_name_key` unique on `(tenant_id, name)`                                      |
| Immutable confirmed rows | A `BEFORE DELETE` trigger on a session and a movement, plus a `BEFORE UPDATE` trigger on the movement |
| Non-zero money           | `CHECK (amount <> 0)` on the movement and `CHECK (opening_amount >= 0)` on the session                |

The exact index and constraint list is a slice-level implementation choice
inside approved scope and follows the sibling migration shapes.

## UI

- None. EPIC-13 owns the cash UI; [[POS-004]] consumes the cash read and
  session-open routes as UX gates only.
- If UI is changed later, reusable components must use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

Implemented and committed on `feat/epic-12-cash-foundation` as three work units.

**C1 — data foundation (`9892fc1`).** The `CashMovementType` enum pinned to
`SALE` only and the `CashSessionStatus` enum pinned to `OPEN`/`CLOSED`, the
`CashRegister`, `CashSession` and `CashMovement` models, and the additive
migration `20260927000002_cash_foundation`: two enums, three tables, the
composite tenant-ownership keys, seven `RESTRICT` foreign keys (the tenant on
each table, the session's register and opener, and the movement's register and
session), the partial unique index `cash_session_one_open_per_register_key` with
the predicate `WHERE (status = 'OPEN'::cash_session_status)`, the per-tenant
register-name unique, the session status list index, the
`cash_movement_amount_non_zero` and `cash_session_opening_amount_non_negative`
`CHECK`s and three triggers. The schema gate
`packages/database/src/schema-cash.test.ts` pins all of it, and
`reference-seed.ts` gains `cash.read`, `cash.register.create` and
`cash.session.open` with their role matrix, moving the seeded catalog 47 → 50.

Two slice-level strengthenings beyond the Story's original text are worth
naming. The Story described a plain list index on `(tenant_id, name)` and only a
delete-rejection trigger; the migration instead adds the per-tenant unique
`cash_register_tenant_id_name_key` and a `BEFORE UPDATE` trigger on
`cash_movement`, so a confirmed movement is immutable rather than merely
undeletable. The delete triggers stay unconditional (`restrict_violation`), not
status-conditional, because cash has no draft state.

**C2 — API surface (`fda5b92`).** `apps/api/src/cash/` holds the permission
contract, the allowlisted DTOs, the strict Zod contracts, the tenant-safe
repository with its in-tenant register resolution and caller-membership
resolution, the entitlement-first service with its two `P2002` mappings, the
controller's four routes (`GET /cash/registers`, `POST /cash/registers`,
`GET /cash/sessions`, `POST /cash/sessions`) and the module. `CashModule` is
registered in `apps/api/src/app.module.ts`, and the shared in-memory boundary
models the three new tables. The `cash` entitlement is asserted first
(`403 FEATURE_NOT_ENTITLED`), the granular permission second (`403 FORBIDDEN`)
and the session opener is resolved server-side as the caller's own ACTIVE
membership. There is deliberately no `PATCH`, no `DELETE` and no close route.

**C3 — live coverage (`ade5a1a`).** The
`EPIC-12 cash foundation application-path isolation` block of
`apps/api/test/live-pg-isolation.e2e-spec.ts` proves the surface against the
booted `AppModule` and a disposable real PostgreSQL: the register create with
its audit row and the validation sweeps, the register-name unique against the
real index (including the same name admitted in another tenant), the session
open with its audit row and both a `0.00` and a non-zero opening amount, the
one-`OPEN`-session rule three ways, the seven composite ownership foreign keys
probed raw in both directions, the immutability triggers with their exact
messages, the two money `CHECK`s, the byte-equivalent cross-tenant `404`, the
proof that the surface writes no movement, sale or stock row, and zero residue
after every probe.

## Verification

Run on 2026-09-29 on `feat/epic-12-cash-foundation`, with the root `.env`
exported (Prisma-style `DATABASE_URL`) plus a schema-less `DATABASE_URL_TEST`.
The test URL must be schema-less: with the Prisma-style `DATABASE_URL` and no
`DATABASE_URL_TEST`, the API suite falls back to the Prisma URL and fails for
the pre-existing [[TD-021]] reason instead.

```text
pnpm --filter @newsaas/database test                                   -> 17 files / 324 tests passed; 30 are the new schema-cash.test.ts
pnpm --filter @newsaas/api test (schema-less DATABASE_URL_TEST)         -> 75 files / 1026 tests passed; 17 are the new cash.integration.test.ts
pnpm --filter @newsaas/api test:live-pg                                 -> 90 tests passed, 0 skipped; 10 are the EPIC-12 cash-foundation cases
pnpm lint                                                               -> clean for every touched package
pnpm typecheck                                                          -> clean for every touched package
pnpm build                                                              -> clean
pnpm format-check                                                       -> green repository-wide
pnpm --filter @newsaas/api test (no DATABASE_URL_TEST)                  -> fails for the pre-existing [[TD-021]] reason
```

Live database after `db:deploy` plus `db:seed`: 24 migrations applied; the
`permission` count **50**; the partial unique index
`cash_session_one_open_per_register_key` with predicate
`WHERE (status = 'OPEN'::cash_session_status)`; seven `RESTRICT` foreign keys;
three triggers; and the live role matrix — `cash.read` on all six roles,
`cash.register.create` and `cash.session.open` on `OWNER`, `ADMIN` and
`CASHIER`, and `cash.session.close` untouched for EPIC-13.

## Tests Added

Real coverage, all of it committed on this branch.

- `packages/database/src/schema-cash.test.ts` — **30 tests** over the migration
  artifact and the Prisma models: the `SALE`-only enum with the six reserved
  kinds absent, the `OPEN`/`CLOSED` status enum, the three tables with their
  columns and scales, the composite ownership keys, the seven `RESTRICT` foreign
  keys, the composite opener membership FK, the partial unique predicate, the
  per-tenant register-name unique, the session status index, the two money
  `CHECK`s, the three triggers, and the absences (`branchId`, `Float`, a
  movement `updated_at`, `CASCADE`, `INSERT`, `DROP` and `UPDATE ... SET`).
- `apps/api/src/cash/cash.integration.test.ts` — **17 tests**: the read, write
  and capability `403` sweeps that persist nothing on denial, the register
  create with its co-committed audit row and allowlisted DTO, the name bounds
  and trim, the duplicate-name `409`, the unrelated-`P2002` rethrow, the
  register list ordering, the session open with its audit row, the `0.00`
  drawer, the required and non-negative opening amount, the masked register
  `404`, the second-open `409`, the filtered and unfiltered session list, the
  invalid body and query sweeps, the no-`PATCH`/no-`DELETE`/no-close inventory
  and the INERT proof.
- `apps/api/src/rbac/route-contract.probe.test.ts` — **20 tests**; this slice
  adds the four cash routes to the deny-by-default survival inventory and the
  `CASH_PERMISSION_BY_ROUTE` pins, including an `UNDECLARED CASH ROUTE` guard.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — **10 new cases** inside the
  `EPIC-12 cash foundation application-path isolation` block, against the booted
  `AppModule` and a disposable real PostgreSQL; the file now holds **90 tests**.

### The two `409`s: which suite proves which

The in-memory boundary cannot enforce a unique index or a composite foreign key,
so both `409`s — the duplicate register name and the second open session — are
proven in `cash.integration.test.ts` with an injected `P2002` shaped exactly
like the real index. That proves the service's mapping and that an unrelated
`P2002` is rethrown, not the index. The real enforcement is the live block's:
`cash_register_tenant_id_name_key` rejects a duplicate name while admitting the
same name in another tenant, and `cash_session_one_open_per_register_key`
rejects a raw duplicate insert and a concurrent second open.

## Known Limitations

- There is no route that addresses a single session by id: the surface is two
  reads, the register create and the session open. The cross-tenant `404` for a
  **session** therefore cannot be exercised over HTTP the way the register's
  can; the session half of that guarantee is proven by the composite foreign
  keys and by the tenant-scoped list, which never exposes another tenant's
  session.
- The shared in-memory boundary cannot enforce a partial unique index or a
  composite foreign key, so an in-memory pass alone is not evidence for those
  guarantees; the live-PostgreSQL block is what proves them against real
  PostgreSQL.
- Both `409`s in the unit suite are injected `P2002`s shaped like the real
  indexes. That is what proves the mapping; the live block is what proves the
  constraints behind them.
- With no close command in EPIC-12, an `OPEN` session stays open until EPIC-13
  ships close, so a register can only be reused if its session is closed by that
  later slice. The seeded `cash.session.close` key stays reserved and is
  consumed by no route.

## Technical Debt

- `cash_movement.reason` is nullable. Only `SALE` exists in EPIC-12 and nothing
  in this slice writes a movement, so a non-null `reason` would force
  [[POS-003]] to invent a value for every completion movement; POS-003 can
  tighten it when it owns the movement writer.
- [[TD-021]] records the pre-existing live-PostgreSQL environment defect: root
  `pnpm test` fails without `DATABASE_URL_TEST` because Turbo 2's strict env
  mode plus `turbo.json`'s `globalEnv` omit the variable, so the live spec falls
  back to the Prisma-style `DATABASE_URL`. It is outside this Story's scope and
  no fix was applied here.
- [[TD-018]] records the deferred sale reversal and payment refund
  ([[DEC-023]]); cash reversals are part of the same deferred boundary.
- [[TD-016]] binds only the stock writers; this Story writes no stock and is not
  a call site.
- No other debt is recorded: the one-session rule is a database invariant from
  the first slice rather than an application convention, and the deferred close
  and remaining movement kinds are owned by EPIC-13 and recorded in [[DEC-020]].

## Decisions / ADRs

- Accepted Decision records govern this Story (accepted 2026-09-27):
  - [[DEC-020]] — the `CompleteSale` cash boundary and the minimal Cash
    foundation: which cash entities, movement kinds, invariants and commands
    belong to EPIC-12 and which stay with EPIC-13. A dated subsequent-scope note
    of 2026-09-29 records the required opening float, the membership reference
    and the minimal register creation.
  - [[DEC-026]] — sales permission keys, role matrix and the entitlement gate;
    this Story owns `cash.read`, `cash.register.create` and `cash.session.open`
    and leaves the seeded `cash.session.close` reserved. A dated
    subsequent-scope note of 2026-09-29 records the eighth key and the `cash`
    capability gate.
  - [[DEC-023]] — the deferred correction boundary; cash reversals wait with
    sale reversal and payment refund.
- An ADR is not expected: the cash foundation introduces no architecture change
  that the complexity budget gates.

## Resolved by Decision

- **The cash boundary** — [[DEC-020]]: EPIC-12 owns the register, the session,
  the movement, the `SALE` movement kind, the partial unique index and the
  session-open command; EPIC-13 owns close, the difference, the other six
  movement kinds, reversals and the UI.
- **The one-OPEN-session rule** — [[DEC-020]]: enforced in the database by a
  partial unique index rather than by application convention.
- **The Branch dimension** — [[DEC-020]]: no Branch, consistent with the
  tenant-wide stock decision.
- **Permission keys and entitlement gate** — [[DEC-026]]: `cash.read`,
  `cash.register.create` and `cash.session.open` with their role matrix, and the
  `cash` capability gate through `EntitlementsService.has(tenantId, "cash")`.
- **The exact index and constraint list** — an implementation choice inside
  approved scope, decided during the slice using the sibling migrations as
  precedent.

### Subsequent-scope resolutions (2026-09-29)

The maintainer answered four questions this Story left open on 2026-09-29, after
[[DEC-020]] and [[DEC-026]] were accepted. They extend the accepted records
through dated subsequent-scope notes rather than rewriting them, and the
sections above are aligned with them:

1. **Register creation stays in the slice.** The Story had defined only the two
   reads and the session open, so no route could create a `CashRegister` and the
   chain "OPEN session → CASH sale" that [[DEC-020]] requires was broken for
   every tenant. A minimal `POST /cash/registers` behind the new
   `cash.register.create` key is added. Consequence for [[DEC-026]]: its key set
   moves from seven keys / seeded count 50 to eight keys / 51.
2. **The cash surface is gated on the `cash` capability, not on `sales`.**
   `cash` is its own seeded feature code (PRD §10), exactly as `sales` gates the
   sale surface. This replaces the story's earlier `sales` gate wording and does
   not change [[DEC-020]]'s cash boundary.
3. **The session records a required opening float.** `opening_amount` is
   `DECIMAL(14,2) NOT NULL` and `0.00` is allowed, because PRD §20 defines close
   as the server-computed expected amount compared against the counted amount
   and without a baseline that expectation cannot represent the cash already in
   the drawer.
4. **`opened_by` references the tenant membership.** `opened_by_membership_id`
   with a composite `RESTRICT` foreign key to `tenant_membership(tenant_id, id)`
   (that unique key already exists at
   `packages/database/prisma/schema.prisma:211`), so the database guarantees the
   opener belongs to the session's tenant; a global `user_profile` reference
   could not.

## Files / Modules

- `packages/database/prisma/schema.prisma` — the `CashMovementType` and
  `CashSessionStatus` enums and the three cash models.
- `packages/database/prisma/migrations/20260927000002_cash_foundation/` — the
  additive migration.
- `packages/database/src/schema-cash.test.ts` — the schema gate.
- `apps/api/src/cash/` — permissions, DTOs, Zod contracts, repository, service,
  controller and module.
- `apps/api/src/app.module.ts` — the `CashModule` registration.
- `apps/api/test/support/in-memory-database.ts` — the cash tables in the shared
  in-memory boundary.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the route and permission
  pins.
- `packages/database/src/reference-seed.ts` — the three `cash.*` permission keys
  and the role matrix.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the live-PostgreSQL block.
- `docs/01-roadmap/EPIC-12-POS-Payments.md` — the epic record.

## Completion Notes

Implemented and committed on `feat/epic-12-cash-foundation`. The local gates
pass — lint, typecheck, the database suite, the API suite with a schema-less
`DATABASE_URL_TEST`, the live-PostgreSQL block, build and `format-check` — and
every acceptance criterion is closed by local evidence. The only remaining gate
is this branch's CI receipt, which has not run yet, so `status` is `in-progress`
and not `done`. Root `pnpm test` currently fails in a local environment without
`DATABASE_URL_TEST` for the pre-existing [[TD-021]] reason; CI sets schema-less
URLs for both variables and is unaffected.
