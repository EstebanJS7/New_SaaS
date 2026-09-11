---
id: PAT-003
type: story
title: Patient staff workspace
epic: EPIC-05
status: done
priority: high
depends_on:
  - PAT-002
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

- [x] Authorized staff can complete the bounded Patient workflow without a
      Clinical or Portal surface.
- [x] The proxy forwards the staff session securely and represents 403/404/API
      validation responses safely.
- [x] Shared UI remains brand-agnostic and uses semantic tokens only.
- [x] UI, proxy, and navigation coverage passes; no patient data is surfaced to
      the Portal.

## Implementation Summary

WU4.1 (PAT-003) staff workspace. Base: WU3.4 `a793fa2` on
`feature/epic-05-veterinary-patients`. The slice is web-only and adds no API,
schema, or dependency changes.

Web surface:

- `apps/web/src/app/api/patients/[[...path]]/route.ts` — authenticated
  `/api/patients/**` proxy (GET/POST/PUT). Forwards only the session cookie and
  `x-request-id`, declares `application/json` for body-carrying verbs, and
  streams both the mutating request body and the upstream response without
  buffering; preserves the upstream status, envelope, `content-type`, and
  `x-request-id` so the API's byte-equivalent 404 and permission codes reach the
  client unchanged.
- `apps/web/src/app/(app)/app/patients/patients-api.ts` — typed DTOs (`Patient`,
  `PatientGuardian`, `Species`/`Breed` catalog) and calls for all 12 WU3 routes,
  plus `ApiRequestError` (carries the stable `code`/`status`) and
  `userFacingPatientError` mapping `UNAUTHENTICATED`/`FORBIDDEN`/
  `FEATURE_NOT_ENTITLED`/`NOT_FOUND` to staff copy.
- `patients-list.tsx` / `page.tsx` — list with loading, empty, error, and
  client-side name search, plus per-row edit and idempotent deactivate.
- `patient-form.tsx` / `new/page.tsx` / `[id]/edit/page.tsx` — shared
  create/edit form. Species and Breed are selected from the global catalog
  (Breed scoped to the selected Species); an active create requires a primary
  guardian customer and sends `primaryGuardianCustomerId`; `isActive:false`
  omits it. Edit builds a changed-fields-only body and can clear
  `breedId`/`birthDate` with `null`; reactivation may supply a guardian to
  satisfy the 409 contract.
- `[id]/patient-detail.tsx` / `[id]/page.tsx` — patient header with edit and
  deactivate, plus guardian management (list, link an active customer, make
  primary, deactivate) with per-action error surfacing (e.g. the 409 when
  demoting the sole primary of an active Patient). Guardian names are resolved
  from the EPIC-04 customers list because the guardian DTO exposes `customerId`
  only.
- `components/shell/nav-sidebar.tsx` — real `Patients` link to `/app/patients`.

Limitations:

- Guardian selection reuses the EPIC-04 `GET /customers` surface; staff without
  `customers.read` cannot populate the customer picker (backend still enforces
  the real gates).
- The list shows active Patients only (the WU3 read surface excludes inactive),
  so reactivation is reachable only by direct navigation to a known patient id.
- Live-PostgreSQL concurrency of the exactly-one-primary invariant remains
  [[TD-006]]; H1 owns that proof.

## Verification

```text
pnpm --filter @newsaas/web exec vitest run --config vitest.config.ts \
  src/app/api/patients src/components/shell/nav-sidebar.test.tsx \
  "src/app/(app)/app/patients"
  → 6 files / 22 tests passed
    (proxy 7, patients-api 2, nav 2, list 5, detail 3, form 3)

pnpm --filter @newsaas/web test
  → 23 files / 111 tests passed (no regressions)

pnpm --filter @newsaas/web typecheck
  → clean

pnpm --filter @newsaas/web lint
  → clean (0 problems)

pnpm exec prettier --check <new/modified web files>
  → clean after formatting
```

Story closed at H1: the H1 root gates (`pnpm lint`, `pnpm format-check`,
`pnpm typecheck`, `pnpm test`, `pnpm build`) are green, and the EPIC-05
live-PostgreSQL application-path evidence that H1 added covers the API the
workspace consumes. Residual non-UI limitations ([[TD-006]] live-PG breadth,
[[TD-011]] concurrent primary-promotion error mapping) are tracked outside this
UI Story and do not affect the workspace acceptance criteria.
