---
id: UX-004
type: story
title: Patient overview and clinical navigation
epic: EPIC-06
related_epics: [EPIC-03, EPIC-05]
status: done
priority: high
depends_on: [PAT-003, VET-004]
prd_sections: ["12", "13", "29"]
permissions: []
branch: main
created: 2026-10-28
updated: 2026-10-28
---

# UX-004 — Patient overview

The maintainer approved prioritizing the patient workspace after UX-002. Use
Investor's clear identity card, grouped information and section hierarchy as a
reference, while retaining this product's semantic tokens and existing commands.

## Scope and boundaries

Frontend composition of existing patient, guardian/customer, encounter and
vaccination reads. No API, migration, dependency, permission, business transition,
portal change or new persisted field. Reuse compatible query keys/projections;
do not use different cached data shapes under the same key. Preserve mounted
clinical editors while navigating so unsaved content is not lost.

Only staff-entered nextDueAt dates may surface vaccine reminders; no inferred
schedule, dosage or diagnosis. Empty, failed and denied reads remain distinct.
No claim of complete medical alerts, weight/photo support or complete history
beyond the existing API read. Existing CONFIDENTIAL data stays staff-only and is
not logged, persisted in browser storage or copied into Portal.

## Acceptance criteria

- [x] Readable patient identity/status and responsive primary actions.
- [x] Summary shows primary guardian, most recent consultation and next recorded
      vaccination date with explicit loading/empty/error feedback.
- [x] Attention notices are limited to recorded inactive status, absent primary
      guardian and passed vaccination dates in the clinic calendar.
- [x] Accessible section links reach guardians, clinical editor and prevention
      without remounting editors or issuing commands.
- [x] Existing guardian and clinical commands/confirmation behavior is retained.
- [x] Targeted tests, lint, typecheck, build and browser review are recorded.

## Verification

- Web TypeScript and targeted ESLint: passed.
- Vitest: 47/47 across overview (6), detail/guardian commands (10) and clinical
  workspace (31); overview 6/6 repeated after the test URL helper lint fix.
- Browser: authenticated demo Michi detail at desktop and 390 x 844 mobile;
  primary guardian, closed consultation, empty recorded vaccine date, responsive
  actions and native clinical section focus checked. Body scrollWidth equaled
  clientWidth (375 px excluding scrollbar) at the mobile viewport. Reset viewport.
- After build, restarted `pnpm dev` outside the sandbox: frontend/API health
  routes returned 200; worker connected to Redis; Docker services healthy.
  The original IAB tab retained a connection-timeout error after the restart;
  the successful visual review/screenshots above were captured before build.
- Evidence: `ux004-patient-overview.png` and `ux004-patient-mobile.png` in the
  session visualization directory. Only synthetic demo data was viewed.
- Production build and `verify-build-output.mjs`: passed. Sandbox build first
  failed creating a `.next` directory with EPERM; the authorized retry outside
  the sandbox passed. Existing Next.js ESLint-plugin/project-reference warnings
  remain informational.

## Implementation summary

Patient identity card, semantic status badge, section navigation, three summary
cards, explicit asynchronous states and recorded-data notices. Shared vaccination
projection preserves the existing editor cache contract. Guardian and clinical
editors remain mounted and existing command flows remain in place. Updated
Spanish assertions and accessible confirmation tests in the existing detail suite.

No new endpoint, migration, dependency, private aggregate or persisted sensitive
field. Backend authorization and tenant resolution are unchanged; no new backend
isolation scenario applies to this frontend-only composition.

## Limitations

This is not a full screen-reader/WCAG audit or a new clinical mutation E2E run.
Clinical command regression coverage comes from the scoped workspace suite.
No inferred vaccination schedule, weight/photo, medical alert engine or full
Patient360 history was added. Taxonomy names remain the existing catalog data.
No commit/push requested.
