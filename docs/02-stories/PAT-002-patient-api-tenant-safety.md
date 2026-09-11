---
id: PAT-002
type: story
title: Patient API and tenant safety
epic: EPIC-05
status: in-progress
priority: high
depends_on:
  - PAT-001
permissions:
  - patients.read
  - patients.create
  - patients.update
  - patients.deactivate
  - patients.guardian.manage
branch: feature/epic-05-veterinary-patients
created: 2026-09-11
updated: 2026-09-11
---

# PAT-002 — Patient API and tenant safety

## Objective

Provide the private, staff-authorized Patient and guardian API without exposing
Patient data across tenants.

## In Scope

- Patient create, list, read, update, and deactivate commands.
- Guardian list, link, update, primary-change, and deactivate commands.
- Zod validation, allowlisted DTOs, transactional audit, and explicit route
  permissions.
- Service-level `veterinary` entitlement enforcement and tenant-isolation tests.

## Out of Scope

- Staff UI, Portal API, Clinical, Scheduling, Weights, Files, and Imports.

## Acceptance Criteria

- [ ] All private routes declare and enforce the appropriate `patients.*`
      permission; frontend checks are not treated as authorization.
- [ ] Tenant identity is server-derived; foreign Patient, guardian, or Customer
      UUIDs return byte-equivalent `404 NOT_FOUND` responses.
- [ ] Mutations co-commit sanitized audit records and preserve the primary
      guardian invariant under concurrent-safe database constraints.
- [ ] DTOs do not expose Prisma models or confidential values in logs/audit
      metadata.
- [ ] Unit, integration, route-contract, and live-PostgreSQL isolation coverage
      pass.

## Implementation Summary

Status: `in-progress` — delivered on branch
`feature/epic-05-veterinary-patients` as a `feature-branch-chain`; the story
stays `in-progress` until H1.

### WU3 delivery slices

| Slice | Scope                                                                  | Status                |
| ----- | ---------------------------------------------------------------------- | --------------------- |
| WU3.1 | Patient HTTP test harness (test-only)                                  | applied (size:exception) |
| WU3.2 | Patient reads + global catalog (`GET /patients`, `/patients/catalog`, `/patients/:id`) | applied |
| WU3.3 | Patient commands (`POST` / `PUT` / `deactivate`)                       | pending               |
| WU3.4 | Guardian routes and commands                                           | pending               |

### WU3.2 — Patient reads and global catalog

- `apps/api/src/patients/patients.catalog.service.ts` — read-only GLOBAL
  Species/Breed catalog (Decision #2211): server-derived tenant context plus the
  `veterinary` entitlement gate, then a taxonomy read with **no** tenant
  predicate.
- `apps/api/src/patients/patients.controller.ts` — read-only controller:
  `GET /patients`, `GET /patients/catalog` (declared before `:id`),
  `GET /patients/:id`, each with `@RequirePermissions(patients.read)`.
- `apps/api/src/patients/patients.module.ts` + `apps/api/src/app.module.ts` —
  module registration (read controller + `PatientsService` +
  `PatientsCatalogService`).
- `apps/api/src/patients/patient.dto.ts` — allowlisted `SpeciesCatalogEntry` /
  `BreedCatalogEntry` (no tenant identifier).
- `apps/api/src/patients/patients.reads.integration.test.ts` — independent HTTP
  suite over the WU3.1 fixture: `patients.read` enforcement, allowlisted DTOs,
  active-only listing, global (tenant-independent) catalog, byte-equivalent
  random-vs-foreign Patient 404, malformed-id 400, and `FEATURE_NOT_ENTITLED`.
- `apps/api/src/rbac/route-contract.probe.test.ts` — route inventory +3.

## Verification

```text
pnpm --filter @newsaas/api typecheck
pnpm --filter @newsaas/api lint
pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts \
  test/support test/cross-tenant-isolation.e2e-spec.ts src/patients src/customers \
  src/rbac/route-contract.probe.test.ts

→ typecheck clean · lint clean · 9 files / 84 tests passed (WU3.2)
```

