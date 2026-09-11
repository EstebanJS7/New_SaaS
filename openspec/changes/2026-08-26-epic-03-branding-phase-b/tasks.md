# Tasks: EPIC-03 Phase B — Tenant Branding

**Train**: Code-first phase one; EPIC-04 is phase two. Run combined hardening
only after both land; this defers no Definition-of-Done obligation.

## Review Workload Forecast

| Field                   | Value                                 |
| ----------------------- | ------------------------------------- |
| Estimated changed lines | 650–900 total; each S1–S4 target ≤400 |
| 400-line budget risk    | High                                  |
| Chained PRs recommended | Yes                                   |
| Suggested split         | S1 → S2 → S3 → S4                     |
| Delivery strategy       | ask-always                            |
| Chain strategy          | pending                               |

Decision needed before apply: Yes Chained PRs recommended: Yes Chain strategy:
pending 400-line budget risk: High

### Suggested Work Units

| Unit | Goal                               | Likely PR | Focused test command        | Runtime harness      | Rollback boundary                   |
| ---- | ---------------------------------- | --------- | --------------------------- | -------------------- | ----------------------------------- |
| S1   | Model, migration, permission seed  | PR 1      | Deferred to H1 (code-first) | N/A—no runtime slice | Schema/migration/seed only          |
| S2   | Private branding API and audit     | PR 2      | Deferred to H1 (code-first) | N/A—no runtime slice | `apps/api/src/branding/**`          |
| S3   | Public resolution and staff layout | PR 3      | Deferred to H1 (code-first) | N/A—no runtime slice | Public controller/layout/appearance |
| S4   | Settings UI bounded preview        | PR 4      | Deferred to H1 (code-first) | N/A—no runtime slice | Branding settings route/components  |

## Phase 1: S1 — Persistence and Authorization Seed

- [x] 1.1 Modify `packages/database/prisma/schema.prisma` with tenant-unique
      `TenantBranding`, version, JSON overrides, and updater relation.
- [x] 1.2 Create additive
      `packages/database/prisma/migrations/<ts>_tenant_branding/migration.sql`;
      preserve no-row preset fallback.
- [x] 1.3 Update `packages/database/src/reference-seed.ts` to grant
      `branding.settings.manage` to OWNER and ADMIN.

## Phase 2: S2 — Private Management Boundary

- [x] 2.1 Create `apps/api/src/branding/brand-override.zod.ts` and `dto.ts` to
      reject unknown/invalid v1 override data on input and stored reads.
- [x] 2.2 Create `apps/api/src/branding/branding.service.ts` for context-scoped
      get/update/idempotent reset, resolved fallback, and transactional audit
      writes.
- [x] 2.3 Create `apps/api/src/branding/branding.controller.ts` and
      `branding.module.ts`; require membership/read permission and write
      `branding.settings.manage` plus `custom_branding`.
- [x] 2.4 Register `BrandingModule` in `apps/api/src/app.module.ts`; never
      accept tenant identity from request input.

## Phase 3: S3 — Public and Server Resolution

- [x] 3.1 Create `apps/api/src/branding/public-branding.controller.ts` with
      `@Public()` slug lookup, 404 miss, and allowlisted PUBLIC v1 DTO only.
- [x] 3.2 Modify `apps/web/src/app/(app)/layout.tsx` to resolve
      `CoreDesignDefaults → ProductBrandPreset → TenantBranding` server-side via
      `brandStyleCss`.
- [x] 3.3 Modify `apps/web/src/lib/appearance.ts` so valid local `light`/`dark`
      wins; tenant default remains fallback bootstrap input.

## Phase 4: S4 — Settings UI

- [x] 4.1 Create `apps/web/src/app/(app)/app/settings/branding/page.tsx` and
      `branding-form.tsx` for explicit GET, Save (PUT), and Reset (POST).
- [x] 4.2 Create
      `apps/web/src/app/(app)/app/settings/branding/branding-preview.tsx` as a
      form-state-only sample card; do not alter the shell before Save or
      reproduce it.

## Phase 5: H1 — Combined Hardening After EPIC-04

- [x] 5.1 After EPIC-04, add RED/GREEN unit, Supertest two-tenant, audit
      co-commit, entitlement, reset, public-DTO/404, SSR precedence, and
      preview-locality coverage in the design-listed test files.
- [x] 5.2 Run required focused and root quality gates, live-PG
      isolation/security review; then update `docs/05-modules/Branding.md` and
      `docs/09-releases/CHANGELOG.md` without weakening Definition of Done.
- [x] 5.3 — Playwright E2E coverage for branding settings. **ACCEPTED
      DEFERRAL**: Playwright is not installed/configured in the repository; do
      not add dependencies or pretend it exists. Deferral formalized in
      [[TD-007 Playwright E2E deferred]]; not claimed as implemented.
- [x] 5.4 — Live cross-tab appearance synchronization. **ACCEPTED DEFERRAL**:
      appearance is per-tab local state only; BroadcastChannel/storage-event
      propagation is not implemented in Phase B. Deferral formalized in
      [[TD-008 Cross-tab appearance sync deferred]]; not claimed as implemented.

## Corrective H1 Round (2026-09-01)

Re-verification reports #1734/#1733 required the following hardening fixes:

- [x] Audit rollback test now proves mutation is rolled back (state unchanged
      and no successful audit row) via a transaction-aware in-memory boundary.
- [x] Added genuinely integrated SSR layout test proving tenant resolution
      produces the CSS bridge output and that valid local `light`/`dark`
      preference wins over tenant fallback.
- [x] Added preview tests proving styles are bounded to the preview card and
      tenant fallback radius is used when a local override is empty.
- [x] Stabilized fresh web build with a post-build output verification script
      that fails loudly if `pages-manifest.json` or other required artifacts are
      missing.
- [x] Implemented live PostgreSQL application-path isolation evidence
      (`apps/api/test/live-pg-isolation.e2e-spec.ts`) and wired it into the CI
      migrations job; runs against a disposable database and proves cross-tenant
      `404 NOT_FOUND` for Customer/Address/Contact mutations and proves that
      authorized tenant-relative TenantBranding mutations succeed for each
      tenant without affecting the other. It does **not** exercise branding
      cross-tenant or entitlement-denial paths against PostgreSQL; those remain
      covered by the in-memory Prisma boundary used by `bootTestApp` and are
      tracked under [[TD-006]].
- [x] Updated TD-006 to record the EPIC-specific evidence and remaining scope.

**Remaining deferrals:**

- Playwright E2E for branding settings is accepted-deferred in
  [[TD-007 Playwright E2E deferred]].
- Live cross-tab appearance synchronization is accepted-deferred in
  [[TD-008 Cross-tab appearance sync deferred]].
- Controlled logo/favicon uploads, portal brand consumption, and `system`
  appearance mode are accepted-deferred in [[TD-009 Branding scope deferred]].

None of the deferred items are claimed as implemented; all are blockers for
broad production onboarding but not for the current EPIC-03 closure.

## Autonomous Corrective Slice 1 (2026-09-01)

Verified backend critical finding: `BrandOverrideValidationError` escaped the
private branding API as `500 INTERNAL` instead of the specified stable
`BRAND_OVERRIDE_UNKNOWN_KEY` response.

- [x] 6.1 Register `BRAND_OVERRIDE_UNKNOWN_KEY`,
      `BRAND_OVERRIDE_UNSUPPORTED_SCHEMA_VERSION`, and
      `BRAND_OVERRIDE_INVALID_VALUE` in the shared `ERROR_CODES` registry
      (status 400 each) so `DomainError` can carry them.
- [x] 6.2 Catch `BrandOverrideValidationError` in `BrandingService.update()` and
      rethrow as a stable `DomainError` preserving the original code and
      message.
- [x] 6.3 Add focused HTTP-level integration test proving
      `PUT /branding/current` with an unknown key returns `400` and code
      `BRAND_OVERRIDE_UNKNOWN_KEY`.
- [x] 6.4 Update registry snapshot test and global-exception filter default
      messages; preserve first-wins status→code mapping so generic
      `BadRequestException` still resolves to `VALIDATION_FAILED`.

**Focused verification:**

- `pnpm vitest run --config vitest.config.ts src/branding/branding.integration.test.ts src/branding/branding.service.test.ts src/common/filters/global-exception.filter.test.ts`
  → 32/32 passed
- `pnpm lint` (api) → clean
- `pnpm typecheck` (api, shared) → clean
- `pnpm --filter @newsaas/shared build` → regenerated dist
