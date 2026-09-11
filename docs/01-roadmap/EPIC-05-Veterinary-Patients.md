---
id: EPIC-05
type: epic
title: Veterinary Patients
status: done
priority: high
depends_on:
  - EPIC-04
prd_sections:
  - "6"
  - "7"
  - "9"
  - "10"
  - "11"
  - "12"
  - "34"
  - "35"
created: 2026-09-11
updated: 2026-09-11
---

# EPIC-05 — Veterinary Patients

## Objective

Establish the first Veterinary aggregate: a tenant-scoped Patient with a
Customer guardian bridge, controlled Species/Breed catalogs, staff-only access,
and a minimal staff workspace.

## Scope

- Patient identity, active/inactive lifecycle, and no hard-delete path.
- `PatientGuardian` activation with one database-enforced active primary
  guardian.
- `patients.*` permissions and the `veterinary` entitlement gate.
- Controlled Species/Breed catalogs, audit, tenant isolation, synthetic demo
  data, and minimal staff UI.

## Out of Scope

- Clinical, Scheduling, Weights, Portal, Files, Imports, and Patient 360 tabs.
- PRD scope expansion, new runtime dependencies, or a new ADR.

## Acceptance Criteria

- [x] Patients, guardian links, and catalogs are tenant-scoped and classified
      CONFIDENTIAL where applicable.
- [x] Each active Patient has exactly one active primary guardian enforced by
      the database; cross-tenant patient/customer links return `404` without
      leakage.
- [x] Every private backend route enforces `patients.*`; the service enforces
      the `veterinary` entitlement.
- [x] Patient and guardian mutations are transactional and audited with
      sanitized metadata; no hard-delete route exists.
- [x] Staff can list, create, view, edit, deactivate Patients, and manage
      guardians using loading, empty, error, and success states.
- [x] Required schema, authorization, isolation, route-contract, demo-seed,
      service, API, UI, and live-PostgreSQL tests pass before closure.

## Stories

- [[PAT-001 Patient foundations]] — persistence, catalogs, guardian invariant,
  permissions, entitlement, audit contract, and demo seed. `done`.
- [[PAT-002 Patient API and tenant safety]] — application service, private API,
  authorization, audit, and isolation coverage. `done`.
- [[PAT-003 Patient staff workspace]] — staff UI, proxy, navigation, and UX
  states. `done`.

## Dependencies

- [[EPIC-04 Customers]] supplies the Core Customer aggregate.
- [[EPIC-02 RBAC Entitlements Tenant Settings]] supplies permissions and
  entitlements.
- [[EPIC-03 Staff Shell Design System Branding]] supplies the staff shell and
  semantic design tokens.

## Lifecycle Note

Delivered on `feat/epic-05-veterinary-patients` across WU1–WU4 and closed by
H1 (task 5.1–5.2). H1 added live-PostgreSQL application-path evidence in
`apps/api/test/live-pg-isolation.e2e-spec.ts` (16/16, including atomic
create/activate, global catalog parity, byte-equivalent cross-tenant masking,
and a deterministic-barrier primary-promotion concurrency probe) and ran the
root gates (`pnpm lint`, `pnpm format-check`, `pnpm typecheck`, `pnpm test`,
`pnpm build`) green.

Live-PostgreSQL evidence was executed locally against a disposable PostgreSQL 16
cluster; the branch was not pushed, so CI has not yet observed it — the CI
migrations job already runs the same `pnpm --filter @newsaas/api test:live-pg`
target. Residual limitations are tracked in [[TD-006]] (broader isolation/RBAC
live-PG gates) and [[TD-011]] (mapping the losing concurrent primary-promotion
write from `500` to `409`); neither violates the exactly-one invariant, and
sequential promotion is a demote-then-promote swap, not a conflict.

Verify report #2257 revision 2 passed with warnings (`pass_with_warnings`,
`evidence_revision`
`sha256:c64cbd4a7094b5f6b6f1c1d38d6124c3c72cbe118bd752c822e9b98e21261c29`): 0
blockers, 10/10 requirements, and 28/28 scenarios, with `pnpm lint`,
`pnpm format-check`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all green.
Revision 1's four blockers were the canonical Engram spec wording, missing
unknown-catalog and missing-`name` HTTP coverage, and missing guardian workflow
plus loading/empty/error/success UI runtime coverage; the remediation resolved
all four. The implementation behavior is unchanged. The governed commit/archive
settlement is complete: the change is archived at `c62b12c`
(`openspec/changes/archive/2026-09-11-epic-05-veterinary-patients/`), so this
Epic is `done`; technical verification had already passed.

## Related

- [[PRD]] §§6–12, 34–35
- [[Data Classification and Retention]]
- [[ADR-001 Modular Monolith]]
