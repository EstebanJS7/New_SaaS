---
id: PAT-003
type: story
title: Patient staff workspace
epic: EPIC-05
status: planned
priority: high
depends_on:
  - PAT-002
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

# PAT-003 — Patient staff workspace

## Objective

Give authorized staff a focused Patient identity and guardian-management
workflow inside the existing staff shell.

## In Scope

- `/app/patients` list, create, detail, edit, deactivate, and guardian
  management flows.
- Authenticated `/api/patients/**` proxy and Patients navigation entry.
- Loading, empty, error, success, and permission-denied states using semantic
  design tokens.

## Out of Scope

- Full Patient 360 tabs; Clinical, Scheduling, Weights, Portal, Files, and
  Imports.

## Acceptance Criteria

- [ ] Authorized staff can complete the bounded Patient workflow without a
      Clinical or Portal surface.
- [ ] The proxy forwards the staff session securely and represents 403/404/API
      validation responses safely.
- [ ] Shared UI remains brand-agnostic and uses semantic tokens only.
- [ ] UI, proxy, and navigation coverage passes; no patient data is surfaced to
      the Portal.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```
