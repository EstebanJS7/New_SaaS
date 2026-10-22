---
id: IMP-001A
type: story
title: The shared create contracts
epic: EPIC-19
status: done
priority: high
depends_on:
  - IMP-001
prd_sections:
  - "32"
permissions: []
branch: feat/epic-19-imports
created: 2026-10-19
updated: 2026-10-19
---

# IMP-001A — The shared create contracts

## Objective

Make the customer and patient create path callable from the worker without
copying a single validation rule, so the import validates with exactly the rules
the API enforces.

## Context

Discovered while starting [[IMP-002]], and recorded as [[DEC-073]]. The three
requirements cannot hold at once with the code as it stands: [[DEC-072]] puts
the pipeline in the worker, [[IMP-002]] forbids a second copy of any rule, and
the rules live in `apps/api/src/customers/customer.zod.ts` and
`apps/api/src/patients/patient.zod.ts`, which the worker cannot import.

This Story is **A**, in the middle of the epic's sequence, because it was found
late rather than planned. It moves code; it changes no behaviour.

## In Scope

- `packages/customers`: the create schema (`createCustomerBody` and its types),
  the contact and address create schemas if the create path needs them, the
  response mapper, and a `createCustomer(...)` function taking
  `{ db, audit, tenantId, actorUserProfileId, input }`.
- `packages/patients`: the same for `createPatientBody` and
  `createPatient(...)`, including the primary-guardian link and the
  global-catalog check, which takes the catalog resolver as a parameter for the
  same reason it takes the tenant.
- `apps/api`'s `CustomersService.create` and `PatientsService.create` become
  delegations: they still resolve tenant and actor from `RequestContextService`
  and pass them in.
- The audit appender as an interface, so the API passes its `AuditWriter` and
  the worker can pass the database package's own append primitive.

## Out of Scope

- Any other operation on those modules: reads, updates, deactivation, addresses,
  contacts, guardian management all stay where they are.
- Any route, permission, DTO shape or database change.
- The worker consuming it. That is [[IMP-002]] and [[IMP-003]].

## Acceptance Criteria

- [x] `packages/customers` and `packages/patients` exist and export a create
      function the worker could call with no request context.
- [x] The create functions take `tenantId` explicitly and never read it from an
      ambient context.
- [x] `apps/api`'s two `create` methods delegate, and still resolve tenant and
      actor from the request context — never from a caller-supplied argument.
- [x] **Every existing customer and patient test passes with no assertion
      changed.** A diff of the test files shows only import-path updates, if
      any. This is the criterion that distinguishes a move from a rewrite.
- [x] No second copy of any validation rule exists: the import will import the
      schema from the package.
- [x] The audit action names and metadata are byte-identical to before.
- [x] `pnpm build`, `lint`, `typecheck` and the full test set are green.
- [x] Tests required by the Story pass.

## Domain Invariants

- Tenant resolution stays a request-context concern in the API.
- The create transaction shape is unchanged: customer + audit, or patient +
  guardian + both audit rows, in one transaction.
- The package functions are pure of framework concerns: no Nest decorators, no
  request objects.

## API

### Added

```text
None.
```

### Changed

```text
None — the routes and DTOs are identical.
```

## Database

### Migration

```text
None.
```

### Models/Tables

- None changed.

## UI

- None.

## Implementation Summary

Implemented on `feat/epic-19-imports`. It is a **move**:
`git diff --stat -- '*customers*.test.ts' '*patients*.test.ts'` is empty, and
the api suite is **1723 passed before and after** with 266 skipped.

- `packages/customers` and `packages/patients` mirror `packages/notifications`
  exactly (`"type": "module"`, dist-based `main`/`types`, the same four scripts
  and tooling). They depend on `@newsaas/database` and `@newsaas/shared`, which
  is the `packages/fiscal-persistence` precedent.
- The create schemas moved **whole**, so `createCustomerBody` and
  `createPatientBody` have one home. The response DTOs, the create-row builders,
  the audit field lists, the guardian requirement, the global-catalog check and
  the primary-guardian link moved with them.
- The extracted functions take
  `{ db, audit, tenantId, actorUserProfileId, input }` (plus `catalog` for
  patients) as PARAMETERS and open the transaction themselves. Nothing in them
  reads an ambient request context, which is what makes them callable from the
  worker.
- `apps/api`'s two `create` methods delegate, still resolving tenant and actor
  from `RequestContextService` and never from a caller-supplied argument.
- Old API paths keep working through documented re-export shims, which is what
  makes the change a move rather than a churn of every import in two modules.
- 15 focused tests in the packages run without Nest, over stubbed narrow
  interfaces.

## Verification

```text
pnpm format-check   PASS
pnpm lint           PASS  (27/27 turbo tasks)
pnpm typecheck      PASS  (27/27)
pnpm build          PASS  (15/15)
pnpm test           PASS  (27/27)
  api           116 files          1723 passed | 266 skipped   UNCHANGED
  customers       1 file              7 passed   (new)
  patients        1 file              8 passed   (new)
  web           118 files           1282 passed
  database · worker · fiscal · notifications · ui · shared   unchanged
live PostgreSQL                      266/266
```

**THE criterion, verified rather than reported**:

```text
$ git diff --stat -- '*customers*.test.ts' '*patients*.test.ts'
(no output)

api tests BEFORE: 1723 passed | 266 skipped
api tests AFTER:  1723 passed | 266 skipped
```

Turbo went from 23 to **27 tasks**: two new packages, each with
build/lint/typecheck/test.

## Tests Added

- The packages get their own focused tests for the create function that do not
  have to boot Nest: a valid customer, a valid patient with its guardian, and
  the refusals (active patient without a guardian, unknown species).
- The existing suites are the regression net and must not change.

## Known Limitations

- **The shims are deliberate and can be collapsed later.** `customer.zod.ts` and
  `patient.zod.ts` in the API are now `export * from "@newsaas/<pkg>"`, which
  keeps the API's import graph still and the test diff empty. A knock-on worth
  naming: an `export *` also forwards the create function and the mappers, so
  the API's zod module surface is wider than the name suggests. Tightening the
  shims to exact symbol lists, or deleting them, is a separate cleanup —
  deliberately not part of a move that must change no behaviour.
- **The extraction reached slightly further than `create`, and it had to.**
  `PatientsService.update` also calls `assertGlobalCatalog`,
  `linkPrimaryGuardian` and `appendGuardianAudit`, and `createGuardian` calls
  `assertTenantCustomer`. Leaving those private in the API would have kept a
  second copy of the same refusals, which is exactly what [[DEC-073]] forbids.
  They are exported from the package and the API calls them with its own `tx`
  and actor; action names, metadata and refusal order are unchanged, and the
  untouched patients suites are the proof.
- The API passes `catalog: this.prisma` because its client already exposes
  `species`/`breed`. The parameters stay separate from `db` because the worker
  has no module that owns the taxonomy — merging them would have been tidier
  here and wrong there.

## Technical Debt

- None created. The shims are named in Known Limitations as the follow-up they
  are.

## Decisions / ADRs

- [[DEC-073]] — why the extraction, and why it needs no ADR.

## Files / Modules

- `packages/customers/`, `packages/patients/` (new)
- `apps/api/src/customers/`, `apps/api/src/patients/` — imports and two
  delegations
- `pnpm-workspace.yaml` if the packages need registering

## Completion Notes

All required gates passed on 2026-10-19, including the live-PostgreSQL lane.
