---
id: EPIC-05
type: epic
title: Veterinary Patients
status: in-progress
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

- [ ] Patients, guardian links, and catalogs are tenant-scoped and classified
      CONFIDENTIAL where applicable.
- [ ] Each active Patient has exactly one active primary guardian enforced by
      the database; cross-tenant patient/customer links return `404` without
      leakage.
- [ ] Every private backend route enforces `patients.*`; the service enforces
      the `veterinary` entitlement.
- [ ] Patient and guardian mutations are transactional and audited with
      sanitized metadata; no hard-delete route exists.
- [ ] Staff can list, create, view, edit, deactivate Patients, and manage
      guardians using loading, empty, error, and success states.
- [ ] Required schema, authorization, isolation, route-contract, demo-seed,
      service, API, UI, and live-PostgreSQL tests pass before closure.

## Stories

- [[PAT-001 Patient foundations]] — persistence, catalogs, guardian invariant,
  permissions, entitlement, audit contract, and demo seed.
- [[PAT-002 Patient API and tenant safety]] — application service, private API,
  authorization, audit, and isolation coverage.
- [[PAT-003 Patient staff workspace]] — staff UI, proxy, navigation, and UX
  states.

## Dependencies

- [[EPIC-04 Customers]] supplies the Core Customer aggregate.
- [[EPIC-02 RBAC Entitlements Tenant Settings]] supplies permissions and
  entitlements.
- [[EPIC-03 Staff Shell Design System Branding]] supplies the staff shell and
  semantic design tokens.

## Lifecycle Note

This Epic is in progress for approved planning and delivery. No implementation
or verification has been performed by this proposal phase.

## Related

- [[PRD]] §§6–12, 34–35
- [[Data Classification and Retention]]
- [[ADR-001 Modular Monolith]]
