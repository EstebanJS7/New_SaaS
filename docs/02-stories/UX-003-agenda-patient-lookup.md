---
id: UX-003
type: story
title: Named patient selection and identity in staff agenda
epic: EPIC-03
related_epics: [EPIC-05, EPIC-07]
status: done
priority: high
depends_on: []
prd_sections: ["6", "12", "14", "29", "36"]
permissions: [patients.read, customers.read]
branch: main
created: 2026-10-27
updated: 2026-10-27
---

# UX-003 — Named patient selection and identity in staff agenda

## Scope

Implement accepted [[DEC-081]] following the user's approval to continue the
agenda → patient → clinical → sale review. Add a bounded Veterinary identity
read and compose it in the staff agenda. Core Scheduling DTOs, commands and
permissions stay unchanged. No persistence migration or PRD edit is required.

## Acceptance Criteria

- [x] Search active patients by patient or active primary guardian name with at
      least two characters and at most 20 results. Staff explicitly select a
      result; free text and stale results never become a patient UUID.
- [x] Existing appointment/request identities resolve in batches of at most 50
      IDs with an allowlisted DTO, including inactive patients in history.
- [x] Authentication, staff membership, both read permissions, Veterinary
      entitlement and tenant isolation apply at the backend; foreign and unknown
      explicit UUID reads both return 404 without partial results. No
      clinical/contact fields or secret payload logs.
- [x] Keyboard-usable selection, loading, empty, error and denied states are
      clear in Spanish and use semantic design tokens. The agenda remains usable
      when optional identity reads are denied or unavailable.
- [x] Required API, proxy and UI tests, lint, typecheck and applicable build
      verification pass, and the local frontend is confirmed against this
      checkout.

## Implementation / verification

Reuses the authenticated patient BFF and existing Prisma/PostgreSQL. No
migration. Patient and guardian identity remains CONFIDENTIAL and is never
persisted in browser storage. This Story supplies UX-002's missing named-patient
criterion.

- API: `apps/api/src/patients/patient-lookup.*`, registered in
  `patients.module.ts`. Read-only POST, strict selector, 20 search results / 50
  explicit IDs, both permissions and entitlement, allowlisted projection and
  identical UUID 404s.
- Frontend: `agenda/patient-selector.tsx`, `agenda/patient-lookup.ts`, named
  calendar/list/open panels and the existing BFF with private no-store
  responses.
- Review also corrected late-loading empty branch/professional selections and
  confirmation Tab/Shift+Tab containment, Escape/trigger restoration and
  duplicate error presentation. Existing concurrency/service-span assertions
  were retained.
- 25 API tests passed (18 lookup + 7 reads); 54 web tests passed (42 agenda + 4
  selector + 8 BFF). Unsupported RTL TypeScript options were subsequently
  removed without changing behavior. API/web typechecks and targeted ESLint
  passed. Web production build and verify-build-output.mjs passed; the local
  development stack was restarted afterward. See [[UX-VALIDATION-2026-10-27]].
