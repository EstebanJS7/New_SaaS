---
id: EPIC-13
type: epic
title: Cash
status: in-progress
priority: high
depends_on:
  - EPIC-12
prd_sections:
  - "9"
  - "10"
  - "20"
  - "27"
  - "28"
  - "29"
  - "40"
  - "41"
created: 2026-09-30
updated: 2026-09-30
---

# EPIC-13 — Cash

## Objective

Complete PRD §20 Cash on top of the EPIC-12 foundation: close an `OPEN` cash
session with a server-computed expected amount, a counted amount and an audited
difference; add the remaining cash movement kinds; preserve immutable confirmed
movements through explicit compensating entries; and give staff an operational
Cash surface for registers, sessions, movements and close.

EPIC-13 depends on [[EPIC-12]] because EPIC-12 already shipped the tenant-scoped
`CashRegister`, `CashSession` and `CashMovement` foundation, one `OPEN` session
per register, the `SALE` movement kind, the CASH sale write path, the `cash`
capability gate and the initial cash permission matrix. This epic extends that
foundation additively. It must not introduce a second cash model, mutate cash
balances directly or rewrite confirmed EPIC-12 movement semantics.

## Current state before implementation (verified 2026-09-30)

This section is a pre-implementation snapshot. Nothing in it describes
implemented EPIC-13 behavior.

- `docs/01-roadmap/ROADMAP.md` lists EPIC-13 Cash as `planned`, depending on
  EPIC-12, which is already `done`.
- `docs/05-modules/Cash.md` documents the implemented EPIC-12 foundation only:
  four routes (`GET/POST /cash/registers`, `GET/POST /cash/sessions`), the
  `cash` capability gate, no `PATCH`, no `DELETE` and no close route.
- The database already has `cash_register`, `cash_session` and `cash_movement`,
  tenant composite ownership keys, the partial unique index for one `OPEN`
  session per register, movement/session immutability triggers, required
  `opening_amount` and the opener membership composite foreign key.
- `cash_movement_type` currently contains `SALE` only. The PRD §20 kinds
  `REFUND`, `INCOME`, `EXPENSE`, `WITHDRAWAL`, `DEPOSIT` and `ADJUSTMENT` are
  absent and reserved for this epic.
- `cash.session.close` is seeded but unused by any route. The seeded permission
  catalog count is 51; this epic adds only `cash.movement.create`, moving it
  to 52.
- No staff Cash workspace exists. `cash-api.ts` currently remains colocated
  under the sales route because EPIC-12 had no Cash UI.
- [[TD-018]] remains open for sale reversal and payment refund. EPIC-13 does not
  close it; this epic only gives Cash standalone movement commands.

## Progress

- **[[CASH-001]] Cash data foundation extension — `review`.** Local
  implementation and verification are complete on
  `feat/epic-13-cash-data-foundation`: the additive
  `20260930000001_cash_data_foundation` migration, Prisma schema mirror,
  `schema-cash.test.ts` coverage and live-PostgreSQL probes all landed in the
  working tree. Verification passed locally: database suite (17 files / 352
  tests), `db:deploy`, `db:live-verify`, API live-PostgreSQL suite (100 tests),
  typecheck, lint, build, `format-check` and `git diff --check`. The Story stays
  `review`, not `done`, until a CI receipt exists. Commits: `f74bce1` (scope
  docs) and `e72f38f` (CASH-001).
- **[[CASH-002]] Cash movement commands — `review`.** Local implementation and
  verification are complete on the same branch: `15633f0` adds the
  `cash_movement_direction` enum, the nullable `direction` column, the exclusive
  `cash_movement_direction_required` CHECK and the `cash.movement.create` seed
  (catalog 51 → 52); `943c301` adds `POST /cash/movements`; `456a33d` adds the
  live-PostgreSQL block and reconciles the applied-schema assertions.
  Verification passed locally: database suite (17 files / 361 tests),
  `db:deploy` (27 migrations), a live `db:seed` reporting 52 permissions, API
  suite (75 files / 1069 tests), API live-PostgreSQL suite (109 tests),
  typecheck, lint, `format-check` and `git diff --check`. The Story stays
  `review`, not `done`, until a CI receipt exists.

## Scope

- Add the remaining PRD §20 cash movement kinds additively: `REFUND`, `INCOME`,
  `EXPENSE`, `WITHDRAWAL`, `DEPOSIT` and `ADJUSTMENT`.
- Keep movement amounts positive and compute cash sign from movement type:
  `SALE`, `INCOME` and `DEPOSIT` add; `REFUND`, `EXPENSE` and `WITHDRAWAL`
  subtract; `ADJUSTMENT` carries an explicit direction ([[DEC-030]]).
- Add close-result fields to `cash_session`: `expected_amount`, `counted_amount`
  and `difference_amount`, written only by the close command, plus one audit row
  ([[DEC-031]]).
- Require a reason for `REFUND`, `EXPENSE`, `WITHDRAWAL`, `DEPOSIT` and
  `ADJUSTMENT`, enforced by a conditional database `CHECK` and mirrored by API
  validation; `SALE` remains reason-optional ([[DEC-032]]).
- Add standalone Cash commands for the six non-sale movement kinds, behind
  `cash.movement.create`, without linking them to sale or payment rows
  ([[DEC-033]], [[DEC-034]]).
- Implement `POST /cash/sessions/:id/close` behind the already-seeded
  `cash.session.close` permission. Close locks the session, gates on `OPEN`,
  computes expected server-side, stores expected/counted/difference, marks the
  session `CLOSED` and audits ([[DEC-031]], [[DEC-035]], [[DEC-036]]).
- Add a database trigger that rejects inserting a movement into a `CLOSED`
  session, making the closed-session rule a database property ([[DEC-035]]).
- Permit close with zero movements, and keep `CLOSED` terminal: no reopen route
  or state transition ([[DEC-036]]).
- Build the staff Cash UI: register and session management, open/close flows,
  movement list, movement creation, expected/counted comparison, navigation
  entry and relocation of the Cash client module out of the sales route
  ([[DEC-037]]).
- Cover tenant isolation, authorization, capability gates, state transitions,
  audit, concurrency and applied-schema invariants with unit/integration and
  durable live-PostgreSQL tests.

## Out of Scope

- Sale reversal, stock compensation and `POST /payments/:id/refund` — still
  [[TD-018]]. EPIC-13 emits standalone cash movements only.
- Billing, invoices, fiscal documents, fiscal cancellation or fiscal provider
  calls — EPIC-14 through EPIC-16.
- Cash reports, analytics dashboards and reconciliation dashboards — EPIC-18.
- Branch, warehouse, location or multi-drawer hierarchy beyond the existing
  tenant-scoped register.
- Direct mutation of cash balances or a cached balance table. The cash ledger is
  still the source of truth.
- Editing or deleting confirmed cash movements, sessions or close results.
- Automatic destructive retention or purge of confirmed financial records before
  an approved retention policy exists.
- A PRD edit. The accepted Decision records clarify implementation choices
  inside PRD §20.

## Acceptance Criteria

Nothing below is implemented; every box is unchecked. Each criterion names the
planned evidence that will close it.

### CASH-001 — Cash data foundation extension

- [x] The cash movement enum is extended additively with `REFUND`, `INCOME`,
      `EXPENSE`, `WITHDRAWAL`, `DEPOSIT` and `ADJUSTMENT`, without reordering or
      changing the existing `SALE` value. Evidence: `schema-cash.test.ts` and
      the live-PostgreSQL `pg_enum` probe.
- [x] `cash_session` stores `expected_amount`, `counted_amount` and
      `difference_amount`, nullable until close and immutable after close.
      Evidence: `schema-cash.test.ts` and the live-PostgreSQL
      `information_schema.columns` probe.
- [x] The conditional reason requirement is enforced by the database for the
      required movement kinds and mirrored in API validation. Evidence: the
      transaction-safe migration `CHECK` plus live-PostgreSQL rejection probes;
      API validation follows in [[CASH-002]].
- [x] A database trigger rejects any movement insert into a `CLOSED` session.
      Evidence: `schema-cash.test.ts` and the live-PostgreSQL trigger probe.

### CASH-002 — Cash movement commands

- [x] The six non-sale movement kinds can be created through explicit cash
      commands against an `OPEN` in-tenant session, behind
      `cash.movement.create` and the `cash` capability. Evidence: the six-kind
      API integration and live-PostgreSQL cases plus the route permission pin.
- [x] The API never accepts tenant authority from body, query or route; foreign
      session/register ids are byte-equivalent `404`s. Evidence: the
      tenant-isolation integration and live-PostgreSQL cases.
- [x] Movement amounts stay positive, `ADJUSTMENT` carries an explicit
      direction, and the expected-amount sign map follows [[DEC-030]]. Evidence:
      the exclusive `cash_movement_direction_required` CHECK, the request
      contract and the rolled-back live probes.
- [x] Accepted movements are immutable and audited; rejected validation,
      permission, capability and closed-session attempts persist nothing.
      Evidence: the audit and no-residue cases of both suites.

### CASH-003 — Cash session close

- [ ] `POST /cash/sessions/:id/close` computes expected server-side from
      `opening_amount` and movements, accepts the counted amount, stores
      expected/counted/difference and writes exactly one audit row. Evidence to
      produce: integration and live-PostgreSQL close cases.
- [ ] Close serializes with sale completion and manual movement writers through
      a session row lock, an `OPEN` state gate and a conditional close update.
      Evidence to produce: durable live-PostgreSQL race coverage.
- [ ] A session can close with zero movements, and `CLOSED` sessions cannot be
      closed again, reopened or receive later movements. Evidence to produce:
      state-transition and trigger tests.
- [ ] Close enforces authentication, tenant context, `cash.session.close`, the
      `cash` capability and byte-equivalent cross-tenant `404`s. Evidence to
      produce: authorization and tenant-isolation suites.

### CASH-004 — Staff Cash surface

- [ ] Staff can list and create registers, list and open sessions, create manual
      movements and close a session with the expected/counted comparison.
      Evidence to produce: web component and route tests.
- [ ] The UI covers loading, empty, error, success, permission-denied and
      entitlement-denied states, and backend authorization remains the
      authority. Evidence to produce: state-coverage tests.
- [ ] The Cash client module is moved out of the sales route into the Cash-owned
      surface, and the sales POS imports the new location without changing sale
      behavior. Evidence to produce: client tests and POS regression coverage.
- [ ] The navigation entry is gated behind the `cash` capability as far as the
      existing shell can support, with documented limitations if browser-side
      entitlement data is still unavailable. Evidence to produce: navigation and
      limitation notes.
- [ ] Reusable UI uses semantic design tokens only, with no Veterinary-specific
      brand literal. Evidence to produce: component review and tests where
      applicable.

### CASH-005 — Epic closure and evidence

- [ ] Module documentation for Cash is updated after implementation to describe
      close, movement kinds, commands and UI behavior. Evidence to produce:
      `docs/05-modules/Cash.md` update merged with the implementation closure.
- [ ] `docs/10-qa/CI-EVIDENCE.md`, the changelog and roadmap status are updated
      only after the implementation stories merge with CI receipts. Evidence to
      produce: closure branch receipt.
- [ ] Every story records migrations, endpoints, tests, limitations and any new
      technical debt before moving to `done`. Evidence to produce: story files.
- [ ] The epic exits with lint, typecheck, unit, integration, live-PostgreSQL,
      build and docs checks green, or with explicit non-green/pending evidence
      recorded. Evidence to produce: CI and local command receipts.

## Stories

- [[CASH-001]] Cash data foundation extension — additive enum values, close
  columns, reason constraint, closed-session insert trigger and schema gates.
- [[CASH-002]] Cash movement commands — standalone movement creation for the six
  non-sale kinds, `cash.movement.create`, audit and tenant isolation.
- [[CASH-003]] Cash session close — the explicit close command, expected/count
  calculation, row-lock serialization, terminal `CLOSED` state and audit.
- [[CASH-004]] Staff Cash surface — the Cash workspace, client-module move,
  movement and close flows, states and navigation.
- [[CASH-005]] Epic closure and evidence — module docs, QA evidence, changelog,
  roadmap update and final status reconciliation.

## Dependencies

- [[EPIC-12]] POS/Payments (**done**) — provides the cash tables, `SALE`
  movement writer, one-open-session invariant, minimal Cash API and `cash`
  entitlement gate.
- [[EPIC-02]] RBAC/Entitlements/Tenant Settings (**done**) — permission seeds,
  role matrix and the `cash` feature code.
- [[DEC-020]] — narrows the EPIC-12/EPIC-13 cash boundary.
- [[DEC-030]] through [[DEC-037]] — accepted EPIC-13 scope decisions.
- [[TD-018]] — remains open for sale reversal and payment refund; EPIC-13 must
  not silently absorb that scope.

## Exit Criteria

- [ ] Every Story — [[CASH-001]], [[CASH-002]], [[CASH-003]], [[CASH-004]] and
      [[CASH-005]] — is `done` with acceptance criteria checked and evidence
      recorded.
- [ ] The Cash API exposes explicit commands for movement creation and close,
      with no generic status patch and no delete/edit of confirmed records.
- [ ] Tenant isolation, authorization, capability gates, audit and immutable
      ledger invariants are covered at the API and live-PostgreSQL levels.
- [ ] The staff Cash surface covers the operational flow with documented UX
      states and semantic design-token usage.
- [ ] Module documentation, QA evidence, changelog and roadmap are current.
- [ ] Required checks are green for the merged work units.

## Decisions / ADRs

The eight EPIC-13 Decisions were accepted on 2026-09-29 by the maintainer and
are binding on the dependent stories:

- [[DEC-030]] — cash movement sign convention: type-owned sign with positive
  amounts and explicit `ADJUSTMENT` direction.
- [[DEC-031]] — close stores expected, counted and difference amounts and also
  audits.
- [[DEC-032]] — mandatory reasons for non-sale manual/corrective movement kinds,
  enforced by a conditional database `CHECK`.
- [[DEC-033]] — cash correction boundary: EPIC-13 does not take sale reversal or
  payment refund; [[TD-018]] stays open.
- [[DEC-034]] — permission keys and role matrix: consume `cash.session.close`,
  add `cash.movement.create`, OWNER/ADMIN/CASHIER write.
- [[DEC-035]] — close serialization and session state enforcement with row lock,
  state gate, conditional update and closed-session insert trigger.
- [[DEC-036]] — zero-movement sessions may close and `CLOSED` is terminal.
- [[DEC-037]] — EPIC-13 includes the full operational Cash UI.

No ADR is required: EPIC-13 preserves the modular monolith, existing tenancy,
ledger, authorization and approved stack.

## Technical Debt

- [[TD-018]] remains open. EPIC-13 deliberately does not implement sale
  reversal, stock compensation or payment refund.
- [[TD-021]] may still affect local root test execution without the required
  live-PostgreSQL environment variables; implementation slices must record exact
  verification behavior.
- No new debt is planned. If a slice ships a shortcut it must create a debt
  record rather than hide it.
