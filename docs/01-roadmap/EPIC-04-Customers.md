---
id: EPIC-04
type: epic
title: Customers
status: done
priority: high
depends_on:
  - EPIC-02
  - EPIC-03
prd_sections:
  - "11"
created: 2026-08-26
updated: 2026-09-11
---

# EPIC-04 — Customers

## Objective

Deliver the reusable, tenant-scoped Customer Core required before Patients:
individual/company records, addresses, contacts, and an inert `PatientGuardian`
persistence scaffold. Customer data is CONFIDENTIAL, auditable, backend
authorized, and soft-deactivated only.

## Scope

- Tenant-scoped `Customer` with `INDIVIDUAL`/`COMPANY` kind, required
  `displayName`, and conditional personal/company validation.
- Tenant-scoped `CustomerAddress` and `CustomerContact` child entities.
- Inert `PatientGuardian` persistence scaffold (`customerId` only; no Patient FK
  activation).
- Six `customers.*` permissions and the approved baseline role matrix.
- Staff REST surface for customer CRUD/deactivate and nested address/contact
  management.
- Staff web UI at `/app/customers` with an authenticated Next.js API proxy.
- Additive migration, transactional audit, and synthetic demo seed data.

## Out of Scope

- Portal, `CustomerPortalAccess` linkage, and self-registration.
- Patients, clinical, scheduling, sales, billing, fiscal, import, file upload,
  and CRM.
- A `customers` entitlement or feature code (access is permission-based).
- PRD edits.

## Acceptance Criteria

- [x] Customer kind is `INDIVIDUAL` or `COMPANY`; `displayName` is required;
      `COMPANY` requires `legalName` and `taxId`; `INDIVIDUAL` may carry
      `firstName`, `lastName`, and one national document. — Evidence:
      `openspec/specs/customer-management/spec.md`;
      `apps/api/src/customers/customer.zod.ts`.
- [x] Kind-mismatched fields are rejected with `400 VALIDATION_FAILED`. —
      Evidence: `apps/api/src/customers/customers.integration.test.ts`.
- [x] Deactivation is a soft, idempotent, audited command; default lists return
      active rows only; no hard-delete route exists. — Evidence: customer
      service/integration tests.
- [x] Address management is tenant-scoped and gated by
      `customers.address.manage`. — Evidence:
      `apps/api/src/customers/customer-addresses.controller.ts` + integration
      tests.
- [x] Contact management is tenant-scoped and gated by
      `customers.contact.manage`. — Evidence:
      `apps/api/src/customers/customer-contacts.controller.ts` + integration
      tests.
- [x] `PatientGuardian` is schema-only: no application code path consumes it. —
      Evidence: `packages/database/src/schema-branding-customers.test.ts`.
- [x] All mutations enforce the six `customers.*` permissions; frontend gates
      are UX-only. — Evidence: customer integration tests +
      `packages/database/src/reference-seed.test.ts`.
- [x] Responses use allowlisted CONFIDENTIAL DTOs; logs and audit metadata carry
      IDs and field names only. — Evidence: customer service/integration tests;
      `docs/05-modules/Customers.md`.
- [x] Every Customer/Address/Contact mutation co-commits one audit row inside
      the transaction. — Evidence: customer integration tests.
- [x] Database lookups filter by `id` and server-derived `tenantId`;
      cross-tenant UUID access returns a byte-equivalent `404 NOT_FOUND`. —
      Evidence: `apps/api/test/cross-tenant-isolation.e2e-spec.ts`; live-PG
      suite 6/6.
- [x] Demo seed creates synthetic individuals/companies and linked children. —
      Evidence: `packages/database/src/demo-seed.test.ts`.
- [x] Live PostgreSQL application-path HTTP isolation executes in CI against a
      real PostgreSQL database. — Evidence: `Database migrations` job in CI run
      `34605178149`; `apps/api/test/live-pg-isolation.e2e-spec.ts` 6/6 passed.
- [x] Root quality gates are green. — Evidence: CI run `34605178149` (lint
      14/14, format-check, typecheck 14/14, test 15/15 → 640 passed / 6 skipped,
      build 9/9).
- [x] The change archives with zero blockers after verification. — Evidence:
      `openspec/changes/archive/2026-09-08-epic-04-customers/verify-report.md`
      (`pass_with_warnings`, 0 blockers, 13/13 requirements, 19/19 scenarios).

## Stories

- S1 — Persistence, authorization, demo seed.
- S2 — Customer API and audit.
- S3 — Address/Contact API and route surface.
- S4 — Web, navigation, proxies.
- H1 — Consolidated hardening after EPIC-02/EPIC-03 (root gates, live-PG
  evidence, TD-006 coverage).
- C1–C4 — Corrective delivery-evidence slices (root gates, live-PG HTTP proof,
  cold build, documentation reconciliation).

## Dependencies

- [[EPIC-02]] RBAC permission enforcement and DEC-003 tenant-effective
  permissions.
- [[EPIC-03]] design-system and shell conventions.
- No new runtime dependency; no `customers` entitlement.

## Exit Criteria

- [x] Lint/typecheck/tests/build required for the Epic are green. — CI run
      `34605178149` at `c9cff613`: lint 14/14, format-check, typecheck 14/14,
      test 15/15 (640 passed / 6 skipped), build 9/9.
- [x] Cross-tenant isolation suite executes in a CI run. — CI run `34605178149`,
      `Database migrations` job: live-PG suite 6/6 passed (Customer/Address/
      Contact mutation paths plus tenant-relative branding).
- [x] Documentation is current. — `docs/05-modules/Customers.md`, this Epic,
      `docs/01-roadmap/ROADMAP.md`, and `docs/09-releases/CHANGELOG.md`
      reconciled 2026-09-11.

## Known Limitations

- [[TD-007]] — Playwright Customer CRUD/navigation E2E is accepted-deferred
  (Playwright is not installed or configured); it is the sole warning in the
  archived verification report and is not claimed as implemented.
- [[TD-006]] — the broader Batch 5 cross-tenant isolation suite and RBAC
  concurrency/audit-rollback proofs still run only over the in-memory Prisma
  boundary; the EPIC-04 Customer/Address/Contact application-path suite is the
  live-PostgreSQL evidence.
- Closure is epic implementation closure only, not production readiness:
  [[EPIC-20]] Production Hardening and the open debt above remain.

## Decisions / ADRs

- No `customers` entitlement or feature code; access is permission-based.
- Permissions: `customers.read`, `customers.create`, `customers.update`,
  `customers.deactivate`, `customers.address.manage`,
  `customers.contact.manage`.
- Confirmed baseline matrix: OWNER/ADMIN all six; RECEPTIONIST
  read/create/update plus address/contact management; VETERINARIAN read only;
  CASHIER and INVENTORY_MANAGER none. Tenant overrides remain available via
  accepted [[DEC-003]].
- No new ADR: no architectural change beyond the frozen stack.

## Technical Debt

Tracked in the Known Limitations section above: [[TD-006]], [[TD-007]].

## Related

- [[ENGINEERING RULES]]
- [[PRD]] — section §11.
- [[Customers]] — implemented module behavior.
- [[RBAC]] — permission catalog and role matrix.
