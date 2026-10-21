---
id: IMP-001A
type: story
title: The shared create contracts
epic: EPIC-19
status: planned
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

- [ ] `packages/customers` and `packages/patients` exist and export a create
      function the worker could call with no request context.
- [ ] The create functions take `tenantId` explicitly and never read it from an
      ambient context.
- [ ] `apps/api`'s two `create` methods delegate, and still resolve tenant and
      actor from the request context — never from a caller-supplied argument.
- [ ] **Every existing customer and patient test passes with no assertion
      changed.** A diff of the test files shows only import-path updates, if
      any. This is the criterion that distinguishes a move from a rewrite.
- [ ] No second copy of any validation rule exists: the import will import the
      schema from the package.
- [ ] The audit action names and metadata are byte-identical to before.
- [ ] `pnpm build`, `lint`, `typecheck` and the full test set are green.
- [ ] Tests required by the Story pass.

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

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- The packages get their own focused tests for the create function that do not
  have to boot Nest: a valid customer, a valid patient with its guardian, and
  the refusals (active patient without a guardian, unknown species).
- The existing suites are the regression net and must not change.

## Known Limitations

- To be recorded as implemented.

## Technical Debt

- None. This removes a boundary problem rather than creating one.

## Decisions / ADRs

- [[DEC-073]] — why the extraction, and why it needs no ADR.

## Files / Modules

- `packages/customers/`, `packages/patients/` (new)
- `apps/api/src/customers/`, `apps/api/src/patients/` — imports and two
  delegations
- `pnpm-workspace.yaml` if the packages need registering

## Completion Notes

_Status must remain non-done until all required gates pass._
