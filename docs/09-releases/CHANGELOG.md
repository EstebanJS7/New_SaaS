# Changelog

All notable product changes will be documented here.

## Unreleased

### Added

- EPIC-03 Phase B — tenant branding overrides and admin surface:
  - `tenant_branding` table with one row per tenant, versioned JSON overrides,
    and additive migration.
  - Private `GET /branding/current`, `PUT /branding/current`,
    `POST /branding/reset` endpoints gated by `branding.settings.manage` and the
    `custom_branding` entitlement, with audit co-commit.
  - Public `GET /api/v1/public/tenants/:slug/branding` allowlisted DTO.
  - Server-side brand resolution in the staff layout and bounded preview UI at
    `/app/settings/branding`.
- EPIC-04 — reusable Customer Core:
  - Tenant-scoped `Customer`, `CustomerAddress`, `CustomerContact`, and inert
    `PatientGuardian` scaffold.
  - Six `customers.*` permissions and role matrix.
  - REST surface for customer CRUD/deactivate and nested address/contact
    management.
  - Staff web UI at `/app/customers` with Next.js API proxy.
- Corrective H1 round for EPIC-04:
  - Customer/Address/Contact lookups now filter by `id` + server-derived
    `tenantId` in the database query itself (`findFirst`); byte-equivalent 404
    behavior preserved.
  - Removed free-text deactivation `reason` from Customer/Address/Contact audit
    metadata; API, spec, and design aligned to ID/schema-version/field-name-only
    audit payloads.
  - Added Customer coverage for company validation, individual/taxId rejection,
    exact DTO allowlist, update audit, all six permission gates, address/contact
    tenant isolation, demo seed, proxy cookie/session forwarding, UI 403 UX, and
    PatientGuardian application-level inertness.
  - Playwright E2E remains blocked because Playwright is not installed or
    configured; tasks updated to show explicit blocker instead of false ticks.
  - Fresh PostgreSQL migration and live application-path HTTP tenant-isolation
    evidence executed in CI run
    [`34183380781`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34183380781)
    for commit `853f13099cedcedf51b9e4c76126ed5f841efcca`: migrations/seed
    applied, `pnpm db:live-verify` passed, and
    `apps/api/test/live-pg-isolation.e2e-spec.ts` reported 5/5 passed with
    byte-equivalent `404 NOT_FOUND` for cross-tenant Customer/Address/Contact
    mutations.
- PRD v1.3 architecture freeze and Complexity Budget.
- Typed Tenant Settings architecture.
- Minimal internal post-commit application events.
- Explicit reversal/correction policy.
- Data classification and retention baseline.
- Reproducible synthetic demo tenant/seed policy.
- EPIC-00 Foundation baseline:
  - pnpm/Turborepo workspace with `apps/web`, `apps/api`, `apps/worker`.
  - Shared strict TypeScript, ESLint, Prettier, and Vitest configurations.
  - Docker Compose PostgreSQL 16 and Redis 7 with named volumes and configurable
    ports/credentials.
  - `infra/scripts/preflight.{sh,ps1}` reachability checks with named non-zero
    failures.
  - API `/health/live` endpoint with Zod environment validation and named
    missing-variable exit.
  - Web `HealthIndicator` polling `NEXT_PUBLIC_API_URL/health/live` via TanStack
    Query.
  - Worker Redis ping bootstrap, shared typed event envelope/dispatcher, and
    guarded demo-seed CLI.
  - GitHub Actions CI running lint, format-check, typecheck, test, and build on
    every PR.
  - Neutral `CoreDesignDefaults` branding stub and documentation of the deferred
    `Clinical Precision` Veterinary preset.
  - Authorized no-push Git baseline; `docs/_templates` remains the Obsidian
    template folder.

### Changed

### Fixed

### Security
