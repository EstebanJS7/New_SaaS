---
id: PAT-002
type: story
title: Patient API and tenant safety
epic: EPIC-05
status: done
priority: high
depends_on:
  - PAT-001
permissions:
  - patients.read
  - patients.create
  - patients.update
  - patients.deactivate
  - patients.guardian.manage
branch: feat/epic-05-veterinary-patients
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

- [x] All private routes declare and enforce the appropriate `patients.*`
      permission; frontend checks are not treated as authorization.
- [x] Tenant identity is server-derived; foreign Patient, guardian, or Customer
      UUIDs return byte-equivalent `404 NOT_FOUND` responses.
- [x] Mutations co-commit sanitized audit records and preserve the primary
      guardian invariant under concurrent-safe database constraints.
- [x] DTOs do not expose Prisma models or confidential values in logs/audit
      metadata.
- [x] Unit, integration, route-contract, and live-PostgreSQL isolation coverage
      pass.

## Implementation Summary

Status: `done` — delivered on branch `feat/epic-05-veterinary-patients` as a
`feature-branch-chain`. H1 closed the implementation and verify report #2257
revision 2 passed with warnings (`pass_with_warnings`, 0 blockers, 10/10
requirements, 28/28 scenarios, all root gates green). The remediation added
independent HTTP coverage for a valid-but-unknown global Species/Breed UUID
(`400 VALIDATION_FAILED`, zero persistence) and for a create missing `name`
(`400 VALIDATION_FAILED`, zero persistence); the canonical Engram spec was
synchronized to the accepted database-boundary wording. No production behavior
changed. The governed commit/archive settlement is complete — the change is
archived at `c62b12c`
(`openspec/changes/archive/2026-09-11-epic-05-veterinary-patients/`) — so this
Story is `done`.

### WU3 delivery slices

| Slice | Scope                                                                                  | Status                   |
| ----- | -------------------------------------------------------------------------------------- | ------------------------ |
| WU3.1 | Patient HTTP test harness (test-only)                                                  | applied (size:exception) |
| WU3.2 | Patient reads + global catalog (`GET /patients`, `/patients/catalog`, `/patients/:id`) | applied                  |
| WU3.3 | Patient commands (`POST` / `PUT` / `deactivate`)                                       | applied                  |
| WU3.4 | Guardian routes and commands                                                           | applied (size:exception) |

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

### WU3.3 — Patient commands

- `apps/api/src/patients/patients.controller.ts` — adds the three Patient
  commands to the same controller: `POST /patients` (`patients.create`),
  `PUT /patients/:id` (`patients.update`), and `POST /patients/:id/deactivate`
  (`patients.deactivate`). Each Zod-validates its input and delegates to the
  existing `PatientsService`, which re-applies the `veterinary` entitlement gate
  and runs the transactional invariants.
- `apps/api/src/patients/patients.commands.integration.test.ts` — independent
  HTTP suite over the WU3.1 fixture: anonymous/per-key denial, allowlisted DTO,
  atomic `patient.created`+`patient_guardian.created` audit pair sharing one
  request id, active-create-without-guardian 400 with zero persistence,
  guardian-less inactive create, update audit, activation-with/without-guardian
  (200/409), idempotent deactivate, byte-equivalent foreign Patient PUT and
  deactivate 404s, and a byte-equivalent foreign Customer create 404 that
  persists nothing.
- `apps/api/src/rbac/route-contract.probe.test.ts` — route inventory +3
  (`POST /patients`, `PUT /patients/:id`, `POST /patients/:id/deactivate`).
- `apps/api/test/support/expect-cross-tenant-404.ts` — adds an optional
  `foreignBody` so the foreign-Customer create pair (same URL, differing
  `primaryGuardianCustomerId`) stays byte-equivalent through one shared helper.

### WU3.4 — Guardian routes and commands

- `apps/api/src/patients/patient-guardians.controller.ts` — new
  `PatientGuardiansController` under `patients/:patientId/guardians` with the
  six guardian routes: `GET` list + `GET :id` (`patients.read`), and `POST`
  create + `PUT :id` + `POST :id/primary` + `POST :id/deactivate`
  (`patients.guardian.manage`). Each Zod-validates `patientGuardiansParam` /
  `patientGuardianParam` and the create/update bodies, then delegates to the
  existing `PatientsService`, which re-applies the `veterinary` entitlement gate
  and the transactional invariants.
- `apps/api/src/patients/patients.module.ts` — registers
  `PatientGuardiansController` alongside the existing Patient controller.
- `apps/api/src/patients/patient-guardians.integration.test.ts` — independent
  HTTP suite over the WU3.1 fixture: anonymous/per-key denial, read-vs-manage
  permission split, allowlisted DTO, active-only tenant-scoped listing,
  transactionally audited link, primary swap preserving exactly one primary,
  position-only update audit, 409 on demoting/deactivating the sole primary of
  an active Patient, idempotent set-primary (no audit) and deactivate, byte-
  equivalent random-vs-foreign Patient list, foreign Guardian GET/set-primary,
  foreign Customer link 404 with zero persistence, and `FEATURE_NOT_ENTITLED`.
- `apps/api/src/rbac/route-contract.probe.test.ts` — route inventory +6
  (guardian routes; total EPIC-05 routes = 12).

## Verification

```text
pnpm --filter @newsaas/api typecheck
pnpm --filter @newsaas/api lint
pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts \
  test/support test/cross-tenant-isolation.e2e-spec.ts src/patients src/customers \
  src/rbac/route-contract.probe.test.ts

→ typecheck clean · lint clean · 9 files / 84 tests passed (WU3.2)
→ WU3.3: adds src/patients/patients.commands.integration.test.ts (10 tests)
→ WU3.4: adds src/patients/patient-guardians.integration.test.ts and probes
  the six guardian routes (12-route EPIC-05 inventory)
```

### H1 (task 5.1) live-PostgreSQL application-path hardening

`apps/api/test/live-pg-isolation.e2e-spec.ts` gained an EPIC-05 block (10 tests;
suite now 16/16) that boots the real `AppModule` against a disposable PostgreSQL
16 database and proves over real HTTP:

- atomic active create with a primary guardian, allowlisted DTO, and the
  co-committed `patient.created` + `patient_guardian.created` audit pair;
- active-create-without-guardian `400` with zero persistence, and
  activation-without-guardian `409` that keeps the Patient inactive;
- byte-identical global `GET /patients/catalog` for two entitled tenants;
- byte-equivalent cross-tenant `404` for foreign Patient commands, guardian
  reads/promotion, and a foreign `primaryGuardianCustomerId`, with no
  persistence and no identifier leak;
- a deterministic-barrier concurrency probe: both promotions are forced to block
  at the same demote boundary before either commits; exactly one returns `201`,
  the loser fails the partial unique index, and exactly one active primary
  remains.

Root gates run for the H1 closeout: `pnpm lint` · `pnpm format-check` ·
`pnpm typecheck` · `pnpm test` (api 429 passed / 16 live-PG skipped without a
database) · `pnpm build` — all green.

### Limitations

- Live-PostgreSQL evidence was executed locally against a disposable PG16
  cluster; CI has not observed the branch because H1 does not push. The CI
  migrations job already runs this same `test:live-pg` target.
- The broader cross-tenant isolation and RBAC concurrency/rollback gates remain
  with [[TD-006]].
- The losing concurrent primary-promotion write currently surfaces as an
  unmapped `500 INTERNAL`; mapping that race to `409 CONFLICT` is the debt in
  [[TD-011]]. Sequential promotion is a demote-then-promote `2xx` swap, and
  `409` applies to sole-primary-removal/deactivation and
  activation-without-primary cases. The database invariant still holds.
