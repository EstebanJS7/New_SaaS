# Changelog

All notable product changes will be documented here.

## Unreleased

### Added

- EPIC-09 — Catalog and taxes:
  - Tenant-scoped `CatalogItem` aggregate over `PRODUCT`, `SERVICE`,
    `MEDICATION` and `SUPPLY`, with deactivation as the only removal (a
    `BEFORE DELETE` trigger rejects hard deletes) and an optional informational
    reference price as an amount plus ISO 4217 currency pair (`Decimal(14, 2)`,
    PYG default).
  - Global, platform-seeded and tenant read-only tax-rate list (`EXEMPT 0%`,
    `IVA_5 5%`, `IVA_10 10%`) that every item must reference through a non-null
    `Restrict` foreign key; no tenant-created rates, no rate mutation route and
    no per-item override. The seed must run before any item can be inserted.
  - `catalog.read` / `catalog.create` / `catalog.update` / `catalog.deactivate`
    with the decided role matrix, six allowlisted INTERNAL routes (rate list,
    list, detail, create, update, deactivate), Zod validation, transactional
    `catalog_item.*` audit rows and byte-equivalent cross-tenant `404`.
  - Staff catalog surface at `/app/catalog` (kind/status filters, read-only
    detail, create/edit with a required rate selector, explicit deactivate)
    behind an allowlisted `/api/catalog` proxy that forwards only the staff
    session cookie.
  - An OPTIONAL `SERVICE` catalog reference on `Appointment` and the PRD §14
    agenda service filter, preserving the caller-supplied `durationMinutes` and
    adding no portal service selection.
  - Two additive migrations, seed idempotency coverage, and local
    live-PostgreSQL evidence for the catalog aggregate (47/47, including its
    isolation, audit-co-commit and concurrent-deactivation cases).
  - `EPIC-09`, `CAT-001`–`CAT-005`, the `Catalog-Taxes` module documentation,
    and the `TD-013`/`TD-014`/`TD-015` debt records.

  The epic is `review`, not `done`: every gate this environment can run is green
  and the live-PostgreSQL evidence exists locally, but the work units are not
  committed, pushed or merged, so the merged-work-units exit criterion is still
  open. `review` means implementation closure pending delivery — it is **not** a
  production-readiness statement. [[EPIC-20]] Production Hardening and the open
  Tech Debt items remain.

- EPIC-06 — Clinical records:
  - Six tenant-scoped, Patient-anchored clinical models (encounter + treatments,
    vaccinations, deworming, studies, weights) with a RESTRICT-FK additive
    migration and a DB-enforced CLOSED immutability/no-delete trigger.
  - Version-guarded DRAFT autosave (`409 CONFLICT` on drift), explicit close,
    and linked, audited, idempotent amendments.
  - `vet.clinical.read|create|update|close|amend` permissions plus the
    `veterinary` entitlement gate and allowlisted CONFIDENTIAL DTOs.
  - Clinical HTTP surface and a Patient-detail staff workspace via the
    authenticated `/api/clinical` proxy.
  - Live-PostgreSQL application-path evidence for byte-equivalent cross-tenant
    `404`, negative cross-tenant amendment assertions, and a deterministic
    parallel-autosave race yielding one success + one `409 CONFLICT`.
  - `EPIC-06`, `VET-004`, and `Clinical` module documentation.
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
    [`34605178149`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34605178149)
    for commit `c9cff6131b6036849d0899a5735e6a2a6a3be5fd`: migrations/seed
    applied, `pnpm db:live-verify` passed, and
    `apps/api/test/live-pg-isolation.e2e-spec.ts` reported 6/6 passed with
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

- EPIC-06 Clinical closure reconciliation (docs-only): the epic and story
  records moved to `done`, and roadmap, module index, changelog, and
  OpenSpec-context references were reconciled against canonical post-merge CI
  run
  [`34793644348`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34793644348)
  at `ff786138`, paired with the archived EPIC-06 verification report. `done`
  means epic implementation closure only — it is **not** production readiness.
  [[EPIC-20]] Production Hardening and the open Tech Debt items remain;
  [[TD-006]] stays open for its broader gates and [[TD-011]] stays separate.
- EPIC-02, EPIC-03, and EPIC-04 closure reconciliation (docs-only): epic records
  moved to `done`, the missing `docs/01-roadmap/EPIC-04-Customers.md` record
  created, and roadmap, changelog, module, and OpenSpec-context references
  reconciled against canonical CI run
  [`34605178149`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34605178149)
  at `c9cff613`. `done` means epic implementation closure only — it is **not**
  production readiness. [[EPIC-20]] Production Hardening and the open Tech Debt
  items (TD-001, TD-006, TD-009, TD-010) remain; TD-007 and TD-008 stay
  accepted.

### Fixed

### Security
