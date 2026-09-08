---
id: TD-007
type: tech-debt
title: Defer Playwright E2E coverage for Branding settings and Customer CRUD/navigation
status: open
severity: medium
related_epics:
  - EPIC-03
  - EPIC-04
related_stories:
  - BRAND-005
  - CUST-005
created: 2026-09-08
updated: 2026-09-08
---

# TD-007 — Defer Playwright E2E coverage for Branding settings and Customer CRUD/navigation

## Context

EPIC-03 Phase B (Tenant Branding) and EPIC-04 (Customers) have both completed
their code-first implementation and hardening slices. All required unit,
integration, live-PostgreSQL HTTP tenant-isolation, cold-build, lint, typecheck,
and documentation-reconciliation gates are green and recorded in their
respective task artifacts and verify reports.

Two H1 hardening tasks remain unchecked because Playwright is not installed or
configured in the repository:

- EPIC-03 Phase B task **5.3** — Playwright E2E coverage for branding settings.
- EPIC-04 task **5.4** — Playwright E2E coverage for Customer CRUD/navigation.

The maintainer explicitly accepted deferring both items rather than silently
marking them implemented or adding Playwright under the current scope. This
record formalizes that accepted deferral.

## Debt

No end-to-end browser coverage exists for:

1. The branding settings page (`/app/settings/branding`): form GET/Save/Reset,
   live preview bounds, entitlement gating, and reset-to-product-defaults flow.
2. The Customer web surface (`/app/customers`): list, detail, create, edit,
   deactivate, address/contact child management, navigation from the sidebar,
   permission UX, and loading/empty/error states.

Reliance on lower-level tests (unit, HTTP integration, live-PG isolation,
permission-inventory probe) means regressions that only surface through real
browser rendering, hydration, routing, or cross-page state are not automatically
detected.

## Why It Is Safe to Defer

- All required acceptance criteria that can be verified without a browser are
  passing, including tenant isolation, authorization, audit, validation,
  idempotency, schema/seed correctness, and cold build verification.
- The functionality shipped behind explicit staff permissions; the backend
  enforces every permission gate regardless of frontend UX state.
- No production tenants or end users exist yet; the exposed UI is staff-only and
  exercised manually during development.
- Adding Playwright requires a separate scope decision (dependency, harness,
  fixture/auth helper, CI job) that is intentionally out of bounds for the
  current closure.

## Risk

Medium likelihood over the next epic chain, moderate impact:

- Browser-specific regressions (hydration, navigation, form state, focus,
  accessibility) will not be caught automatically.
- A future change to shared shell components, navigation, or Next.js route
  handlers could break the Customer or Branding UX without failing any existing
  gate.
- Manual verification burden persists until Playwright lands.

No data-integrity or security invariant is weakened; the risk is purely
regression-detection coverage for the staff UI flows.

## Evidence Gate

Resolution requires:

1. Playwright installed and configured for the repository with a documented
   harness, fixture strategy, and CI job.
2. E2E spec for EPIC-03 Branding settings covering:
   - authenticated access with and without `branding.settings.manage`;
   - loading existing overrides into the form;
   - Save persists validated overrides and emits an audit row;
   - Reset restores product defaults and emits an audit row;
   - live preview updates without persisting before Save;
   - unknown/invalid override keys are rejected.
3. E2E spec for EPIC-04 Customer CRUD/navigation covering:
   - navigation to `/app/customers` from the sidebar;
   - create individual and company customers with validation errors;
   - list filters inactive customers by default;
   - update customer and view detail;
   - deactivate customer idempotently;
   - add/update/remove address and contact children;
   - permission UX hides actions when the user lacks the required permission;
   - cross-tenant UUIDs from the browser return `404`.
4. Both specs execute green in CI and remain green on subsequent changes.
5. This record closed with a link to the resolving commit or PR.

## Proposed Resolution

1. Create an ADR or Decision proposal for Playwright scope: dependency version,
   package placement (`apps/web` or workspace root), fixture/auth helper reuse,
   mock-server strategy for the API, and CI job placement.
2. Install Playwright and add a focused E2E test command to the workspace
   scripts.
3. Implement the Branding settings E2E spec first because its surface is smaller
   and permission-gated.
4. Implement the Customer CRUD/navigation E2E spec, reusing auth/tenant
   fixtures.
5. Wire the E2E command into `.github/workflows/ci.yml` as a required gate.
6. Close this record and check off EPIC-03 5.3 and EPIC-04 5.4 in their task
   artifacts.

## Trigger / Target

Re-entry as soon as the next staff-facing UI epic begins, or when CI coverage for
browser-critical paths is mandated — whichever comes first. Must be resolved
before the first public/staff production onboarding.

## Verification After Resolution

- [ ] Playwright installed, configured, and running in CI.
- [ ] Branding settings E2E spec green and covering the evidence-gate checklist.
- [ ] Customer CRUD/navigation E2E spec green and covering the evidence-gate
      checklist.
- [ ] EPIC-03 task 5.3 checked off in
      `openspec/changes/2026-08-26-epic-03-branding-phase-b/tasks.md`.
- [ ] EPIC-04 task 5.4 checked off in
      `openspec/changes/2026-08-26-epic-04-customers/tasks.md`.
- [ ] This record closed with a link to the resolving commit.
