---
id: PAT-001
type: story
title: Patient foundations
epic: EPIC-05
status: done
priority: high
depends_on:
  - EPIC-04
  - EPIC-02
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

# PAT-001 — Patient foundations

## Objective

Create the governed persistence and access foundation required for the first
Veterinary Patient slice.

## In Scope

- Tenant-scoped Patient aggregate with active/inactive lifecycle.
- Controlled Species/Breed catalogs.
- `PatientGuardian` activation between Patient and Core Customer.
- Database-enforced exactly-one active primary guardian invariant.
- `patients.*` seed permissions, role grants, `veterinary` entitlement, audit
  action contract, and synthetic demo data.

## Out of Scope

- API controllers, staff UI, Clinical, Scheduling, Weights, Portal, Files, and
  Imports.

## Acceptance Criteria

- [x] Additive schema migration preserves Customer as a Core-owned aggregate.
- [x] Patient, guardian, and catalog records are tenant-safe; patient/guardian
      relationship data is CONFIDENTIAL.
- [x] Database constraints prevent zero or multiple active primary guardians for
      an active Patient.
- [x] Patient deactivation and guardian changes preserve auditability and do not
      introduce hard deletion.
- [x] Reference and demo seeds are synthetic and include the new permissions and
      `veterinary` entitlement prerequisites.
- [x] Schema, seed, and invariant tests pass.

## Implementation Summary

WU1 (data foundation) is implemented and verified. WU2–WU4 (API, guardian
routes, staff workspace) and H1 (live-PostgreSQL hardening) are delivered on
`feature/epic-05-veterinary-patients`; this Story owns the persisted schema,
catalog, invariants, and seeds.

- **Schema** (`packages/database/prisma/schema.prisma`): added the global
  `Species` and `Breed` catalogs, the tenant-scoped `Patient` aggregate (`name`,
  `speciesId`, optional `breedId`, `sex`, optional `birthDate`, `isActive`), the
  `PatientSex` enum, and activated `PatientGuardian` (`patientId`, `isPrimary`,
  `isActive`; unique `(patientId, customerId)`). `Customer` is untouched;
  Patient → Customer is one-way.
- **Migration**
  (`packages/database/prisma/migrations/20260911000003_patients/`): additive DDL
  with `RESTRICT` FKs, the partial unique index
  `patient_guardian_primary_active_key` (`at most one` active primary), and two
  `DEFERRABLE INITIALLY DEFERRED` constraint triggers for `at least one`:
  `patient_guardian_exactly_one_primary_trigger` (guardian writes) and
  `patient_exactly_one_primary_guardian_trigger`
  (`AFTER INSERT OR UPDATE ON patient`, active Patient lifecycle), per Decision
  #2210.
- **Reference seed** (`packages/database/src/reference-seed.ts`): global
  Species/Breed catalog (Decision #2211, no tenant scoping) plus
  `patients.read`, `patients.create`, `patients.update`, `patients.deactivate`,
  `patients.guardian.manage` and the baseline role matrix.
- **Demo seed** (`packages/database/src/demo-seed.ts`): two synthetic demo
  Patients (`Bobby`, `Michi`), each with its own active primary guardian,
  created with the global catalog reference inside one `$transaction` so the
  deferred Patient trigger observes the guardians at COMMIT.
- **Docs/spec**: `docs/05-modules/Patients.md`,
  `openspec/specs/patient-management/spec.md`.
- **Inertness re-scope**: `schema-branding-customers.test.ts` now allows only
  the Patients module to reference `PatientGuardian`;
  `scripts/live-migration-verify.ts` now requires the activated `patient_id` FK
  and the partial index.

### Primary-swap ordering constraint (discovery)

The spec's "promoting the replacement before demoting the current primary"
ordering is incompatible with the immediate partial unique index that enforces
"at most one active primary". PostgreSQL partial unique indexes cannot be
deferred, so the service (WU2) MUST demote the current primary before promoting
the replacement; the deferred trigger then observes exactly one at commit.
Promoting first raises `23505` on `patient_guardian_primary_active_key`.

### Patient-side trigger coverage (corrective, task 1.5)

The initial WU1 migration only attached the deferred constraint trigger to
`patient_guardian` writes, so a lone active Patient `INSERT` (or an `UPDATE`
that activated a Patient with zero primaries) committed with the invariant
broken; the demo seed reproduced it with `Michi`. The uncommitted migration is
amended with a second deferred trigger,
`patient_exactly_one_primary_guardian_trigger`
(`AFTER INSERT OR UPDATE ON patient`), whose function re-reads the Patient's
final `is_active` state and counts active primaries. The demo seed now creates
each active Patient and its active primary guardian in one `$transaction`, so
Patient and guardian commit together. The guardian-side trigger semantics are
unchanged.

### Guardian-reparent OLD/NEW coverage (corrective, PAT-001 invariant fix)

Reparenting a guardian changes `patient_guardian.patient_id`, so the deferred
guardian trigger must validate BOTH the OLD and the NEW Patient. The original
function checked only `NEW.patient_id`, so moving an active Patient's sole
active primary to another Patient committed the OLD Patient with zero active
primaries. The function now collects the affected Patient IDs for the event
(`OLD` for `DELETE`, `NEW` for `INSERT`, both for `UPDATE`), de-duplicates them
so an unchanged `patient_id` is validated once, and re-checks each active
Patient. Static coverage lives in `schema-patients.test.ts`; the live matrix
adds a rejected reparent with rollback proof plus committed unchanged and
non-primary reparent cases.

## Verification

```text
packages/database (focused):
  pnpm --filter @newsaas/database test ...... 9 files / 103 tests passed
  pnpm --filter @newsaas/database typecheck . clean
  pnpm --filter @newsaas/database lint ...... clean
  pnpm format-check ......................... all matched files use Prettier

Live PostgreSQL (disposable cluster, PostgreSQL 16, fresh database
`newsaas_wu1_fix`; the amended migration was applied to a new disposable
database, so no existing database was reset):
  prisma migrate deploy ............. all migrations applied incl. _patients
  db:seed x3 ........................ counts identical (species 6, breeds 9,
                                      permissions 19, rolePermissions 56)
  demo seed x2 ...................... run 1: 2 patients, 2 guardian links;
                                      run 2: 0 created (idempotent)
  per-Patient invariant query ....... Bobby 1, Michi 1 active primary guardians
  constraint triggers ............... both present, deferrable + initially
                                      deferred
  db:live-verify .................... PASSED (9-case lifecycle matrix + 3
                                      reparent regression cases):
    active Patient alone ........... rejected at COMMIT (check_violation)
    active Patient + guardian ...... committed, exactly 1
    second active primary .......... rejected (23505 partial index)
    non-primary guardian added ..... committed
    demote-only then commit ........ rejected at COMMIT (check_violation)
    demote-then-promote swap ....... committed, exactly 1 replacement
    deactivate active Patient ...... committed
    inactive Patient alone ......... committed
    activate inactive, 0 primaries . rejected at COMMIT, stays inactive
    reparent sole active primary ... rejected at COMMIT (check_violation);
                                     guardian stays on OLD Patient with 1
    unchanged patient_id update .... committed (validated once, no false fail)
    reparent non-primary guardian .. committed; both Patients keep exactly 1

H1 application-path live PostgreSQL (disposable PostgreSQL 16 cluster,
`apps/api/test/live-pg-isolation.e2e-spec.ts`, 16/16 passed):
    atomic active create + primary guardian + co-committed audit ... committed
    active create without primary .................................. 400, zero rows
    inactive create → activate with primary ........................ exactly 1
    activation without primary ..................................... 409, stays inactive
    global Species/Breed catalog ................................... byte-identical for 2 tenants
    cross-tenant Patient/guardian/Customer ......................... byte-equivalent 404
    concurrent primary promotion (deterministic barrier) ........... 1x201, 1x500, exactly 1 primary

The at-most-one side is now proven live under a deterministic overlap: both
promotions are forced to block at the same demote boundary before either
commits, and the losing promotion fails the partial unique index. The
at-least-one side remains guaranteed at commit by the deferred trigger for the
single-transaction and swap cases exercised; a broader concurrency matrix and
mapping the losing race write from `500` to `409` remain open under [[TD-006]]
and [[TD-011]], so this is not production-proven concurrency safety.
```

## Decisions / ADRs

- No new ADR. The Veterinary module may depend on Customer; Core must not depend
  on Veterinary implementation details.
- Decision #2210 (deferred constraint trigger) and Decision #2211 (global seeded
  Species/Breed catalog) shape this slice.
