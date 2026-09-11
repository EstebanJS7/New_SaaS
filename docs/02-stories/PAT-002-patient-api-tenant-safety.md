---
id: PAT-002
type: story
title: Patient API and tenant safety
epic: EPIC-05
status: planned
priority: high
depends_on:
  - PAT-001
permissions:
  - patients.read
  - patients.create
  - patients.update
  - patients.deactivate
  - patients.guardian.manage
branch:
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

_Not implemented._

## Verification

```text
Not run.
```
