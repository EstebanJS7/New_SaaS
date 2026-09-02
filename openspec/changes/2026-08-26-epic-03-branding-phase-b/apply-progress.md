# Apply Progress: EPIC-03 Phase B — Tenant Branding

## Change

`2026-08-26-epic-03-branding-phase-b` in `/mnt/c/NewSaaS`.

## Cumulative Status

Original train S1–S4 and H1 combined hardening completed. Autonomous corrective
slice 1 completed. Remaining blocker: Playwright E2E not installed/configured.

## Completed Work

### Phase 1: S1 — Persistence and Authorization Seed

- [x] 1.1 `TenantBranding` schema with tenant-unique row, version, JSON overrides, updater relation.
- [x] 1.2 Additive migration preserving no-row preset fallback.
- [x] 1.3 Reference seed grants `branding.settings.manage` to OWNER and ADMIN.

### Phase 2: S2 — Private Management Boundary

- [x] 2.1 `brand-override.zod.ts` and `dto.ts` reject unknown/invalid v1 overrides.
- [x] 2.2 `branding.service.ts` for context-scoped get/update/reset, transactional audit.
- [x] 2.3 `branding.controller.ts` and `branding.module.ts` with permission + entitlement gates.
- [x] 2.4 `BrandingModule` registered in `app.module.ts`; tenant identity never from request input.

### Phase 3: S3 — Public and Server Resolution

- [x] 3.1 `public-branding.controller.ts` with `@Public()` slug lookup and allowlisted DTO.
- [x] 3.2 Server layout resolves `CoreDesignDefaults → ProductBrandPreset → TenantBranding`.
- [x] 3.3 `appearance.ts` local `light`/`dark` wins over tenant fallback.

### Phase 4: S4 — Settings UI

- [x] 4.1 Branding settings page and form with GET/Save/Reset.
- [x] 4.2 Bounded preview card; no shell reproduction before Save.

### Phase 5: H1 — Combined Hardening (with EPIC-04)

- [x] 5.1 RED/GREEN unit, Supertest two-tenant, audit co-commit, entitlement, reset, public-DTO/404, SSR precedence, preview-locality coverage.
- [x] 5.2 Focused quality gates, live-PG isolation/security review, module docs and changelog updates.
- [ ] 5.3 Playwright E2E coverage. **BLOCKED**: Playwright not installed/configured.

### Corrective H1 Round (2026-09-01)

- [x] Audit rollback test proves mutation is rolled back (state unchanged and no successful audit row).
- [x] Integrated SSR layout test proves tenant resolution CSS output and local appearance wins.
- [x] Preview tests prove styles are bounded to preview card and tenant fallback radius used when override empty.
- [x] Post-build output verification script fails loudly if required artifacts missing.
- [x] TD-006 updated with EPIC-specific evidence and remaining scope.

### Autonomous Corrective Slice 1 (2026-09-01)

Verified backend critical finding: `BrandOverrideValidationError` escaped the
private branding API as `500 INTERNAL` instead of the specified stable
`BRAND_OVERRIDE_UNKNOWN_KEY` response.

- [x] 6.1 Registered `BRAND_OVERRIDE_UNKNOWN_KEY`,
      `BRAND_OVERRIDE_UNSUPPORTED_SCHEMA_VERSION`, and
      `BRAND_OVERRIDE_INVALID_VALUE` in the shared `ERROR_CODES` registry
      (status 400 each) so `DomainError` can carry them.
- [x] 6.2 Caught `BrandOverrideValidationError` in `BrandingService.update()` and
      rethrew as a stable `DomainError` preserving the original code and message.
- [x] 6.3 Added focused HTTP-level integration test proving `PUT /branding/current`
      with an unknown key returns `400` and code `BRAND_OVERRIDE_UNKNOWN_KEY`.
- [x] 6.4 Updated registry snapshot test and global-exception filter default
      messages; preserved first-wins status→code mapping so generic
      `BadRequestException` still resolves to `VALIDATION_FAILED`.

## Files Changed (Cumulative)

### Original implementation

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/<ts>_tenant_branding/migration.sql`
- `packages/database/src/reference-seed.ts`
- `apps/api/src/branding/branding.module.ts`
- `apps/api/src/branding/branding.service.ts`
- `apps/api/src/branding/branding.controller.ts`
- `apps/api/src/branding/public-branding.controller.ts`
- `apps/api/src/branding/brand-override.zod.ts`
- `apps/api/src/branding/dto.ts`
- `apps/api/src/branding/brand-resolver.ts`
- `apps/api/src/branding/branding.service.test.ts`
- `apps/api/src/branding/branding.integration.test.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/rbac/route-contract.probe.test.ts`
- `apps/web/src/app/(app)/app/settings/branding/page.tsx`
- `apps/web/src/app/(app)/app/settings/branding/branding-form.tsx`
- `apps/web/src/app/(app)/app/settings/branding/branding-preview.tsx`
- `apps/web/src/app/(app)/layout.tsx`
- `apps/web/src/lib/appearance.ts`
- `apps/web/src/lib/appearance.test.ts`
- `docs/05-modules/Branding.md`
- `docs/09-releases/CHANGELOG.md`

### Corrective Slice 1

- `packages/shared/src/errors/registry.ts`
- `packages/shared/src/errors/registry.test.ts`
- `packages/shared/dist/errors/registry.js` (rebuilt)
- `packages/shared/dist/errors/registry.d.ts` (rebuilt)
- `apps/api/src/branding/branding.service.ts`
- `apps/api/src/branding/branding.integration.test.ts`
- `apps/api/src/common/filters/global-exception.filter.ts`

## Verification Evidence

### Corrective Slice 1 Focused Gate

```text
pnpm vitest run --config vitest.config.ts \
  src/branding/branding.integration.test.ts \
  src/branding/branding.service.test.ts \
  src/common/filters/global-exception.filter.test.ts
→ Test Files 3 passed (3)
→ Tests 32 passed (32)
```

```text
pnpm lint                (apps/api)          → clean
pnpm typecheck           (apps/api)          → clean
pnpm typecheck           (packages/shared)   → clean
pnpm --filter @newsaas/shared build           → clean
```

## Blockers

- Playwright E2E is not installed/configured (unchanged; recorded as explicit blocker).

## Decisions / Deviations

- Added all three brand-override validation codes to the shared registry rather
  than only `BRAND_OVERRIDE_UNKNOWN_KEY`, because `validateBrandOverride` can
  also throw `UNSUPPORTED_SCHEMA_VERSION` and `INVALID_VALUE`; registering all
  three keeps `DomainError(error.code, ...)` type-safe and consistent.
- Preserved the generic `BadRequestException → VALIDATION_FAILED` mapping by
  making the reverse status→code table first-wins, matching the existing
  comment and tests.
- Stored (corrupt) overrides continue to map to `VALIDATION_FAILED` via
  `parseStoredOverrides`; the corrective slice is scoped to user input escaping
  as 500.
- **New (baseline slice 1)**: Did not expand scope to absorb the corrective
  delta or unrelated EPIC-04 changes; stopped when the minimal self-contained
  API-module boundary exceeded the 400-line review budget.
