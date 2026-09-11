# Apply Progress: EPIC-03 Phase B — Tenant Branding

## Change

`2026-08-26-epic-03-branding-phase-b` in `/mnt/c/NewSaaS`.

## Cumulative Status

Original train S1–S4 and H1 combined hardening completed. Autonomous corrective
slice 1 completed. PASS_WITH_WARNINGS: task 5.3 (Playwright E2E), task 5.4
(cross-tab appearance sync), and the remaining EPIC-03 scope items (controlled
logo/favicon uploads, portal brand consumption, `system` appearance mode) are
accepted deferrals to [[TD-007 Playwright E2E deferred]],
[[TD-008 Cross-tab appearance sync deferred]], and
[[TD-009 Branding scope deferred]] respectively; none are claimed as
implemented; zero blockers for the current closure boundary.

## Completed Work

### Phase 1: S1 — Persistence and Authorization Seed

- [x] 1.1 `TenantBranding` schema with tenant-unique row, version, JSON
      overrides, updater relation.
- [x] 1.2 Additive migration preserving no-row preset fallback.
- [x] 1.3 Reference seed grants `branding.settings.manage` to OWNER and ADMIN.

### Phase 2: S2 — Private Management Boundary

- [x] 2.1 `brand-override.zod.ts` and `dto.ts` reject unknown/invalid v1
      overrides.
- [x] 2.2 `branding.service.ts` for context-scoped get/update/reset,
      transactional audit.
- [x] 2.3 `branding.controller.ts` and `branding.module.ts` with permission +
      entitlement gates.
- [x] 2.4 `BrandingModule` registered in `app.module.ts`; tenant identity never
      from request input.

### Phase 3: S3 — Public and Server Resolution

- [x] 3.1 `public-branding.controller.ts` with `@Public()` slug lookup and
      allowlisted DTO.
- [x] 3.2 Server layout resolves
      `CoreDesignDefaults → ProductBrandPreset → TenantBranding`.
- [x] 3.3 `appearance.ts` local `light`/`dark` wins over tenant fallback.

### Phase 4: S4 — Settings UI

- [x] 4.1 Branding settings page and form with GET/Save/Reset.
- [x] 4.2 Bounded preview card; no shell reproduction before Save.

### Phase 5: H1 — Combined Hardening (with EPIC-04)

- [x] 5.1 RED/GREEN unit, Supertest two-tenant, audit co-commit, entitlement,
      reset, public-DTO/404, SSR precedence, preview-locality coverage.
- [x] 5.2 Focused quality gates, live-PG isolation/security review, module docs
      and changelog updates.
- [x] 5.3 — Playwright E2E coverage for branding settings. **ACCEPTED
      DEFERRAL**: Playwright is not installed/configured in the repository; do
      not add dependencies or pretend it exists. Deferral formalized in
      [[TD-007 Playwright E2E deferred]]; not claimed as implemented.
- [x] 5.4 — Live cross-tab appearance synchronization. **ACCEPTED DEFERRAL**:
      appearance is per-tab local state only; BroadcastChannel/storage-event
      propagation is not implemented in Phase B. Deferral formalized in
      [[TD-008 Cross-tab appearance sync deferred]]; not claimed as implemented.

### Corrective H1 Round (2026-09-01)

- [x] Audit rollback test proves mutation is rolled back (state unchanged and no
      successful audit row).
- [x] Integrated SSR layout test proves tenant resolution CSS output and local
      appearance wins.
- [x] Preview tests prove styles are bounded to preview card and tenant fallback
      radius used when override empty.
- [x] Post-build output verification script fails loudly if required artifacts
      missing.
- [x] Live PostgreSQL application-path isolation evidence
      (`apps/api/test/live-pg-isolation.e2e-spec.ts`). The CI migrations job
      runs it against a disposable PostgreSQL database and proves cross-tenant
      `404 NOT_FOUND` for Customer/Address/Contact mutations and proves that
      authorized tenant-relative TenantBranding mutations succeed for each
      tenant without affecting the other. It does **not** exercise branding
      cross-tenant or entitlement-denial paths against PostgreSQL; those remain
      covered by the in-memory Prisma boundary used by `bootTestApp` and are
      tracked under [[TD-006]].
- [x] TD-006 updated with EPIC-specific evidence and remaining scope.

### Autonomous Corrective Slice 1 (2026-09-01)

Verified backend critical finding: `BrandOverrideValidationError` escaped the
private branding API as `500 INTERNAL` instead of the specified stable
`BRAND_OVERRIDE_UNKNOWN_KEY` response.

- [x] 6.1 Registered `BRAND_OVERRIDE_UNKNOWN_KEY`,
      `BRAND_OVERRIDE_UNSUPPORTED_SCHEMA_VERSION`, and
      `BRAND_OVERRIDE_INVALID_VALUE` in the shared `ERROR_CODES` registry
      (status 400 each) so `DomainError` can carry them.
- [x] 6.2 Caught `BrandOverrideValidationError` in `BrandingService.update()`
      and rethrew as a stable `DomainError` preserving the original code and
      message.
- [x] 6.3 Added focused HTTP-level integration test proving
      `PUT /branding/current` with an unknown key returns `400` and code
      `BRAND_OVERRIDE_UNKNOWN_KEY`.
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

### H1 hardening and corrective work

- `apps/api/src/customers/customers.service.ts`
- `apps/api/src/customers/customers.controller.ts`
- `apps/api/src/customers/customer-addresses.controller.ts`
- `apps/api/src/customers/customer-contacts.controller.ts`
- `apps/api/src/customers/customer.zod.ts`
- `apps/api/src/customers/customer-address.zod.ts`
- `apps/api/src/customers/customer-contact.zod.ts`
- `apps/web/src/app/(app)/app/customers/customers-api.ts`
- `apps/web/src/app/(app)/app/customers/customers-list.tsx`
- `apps/web/src/app/(app)/app/customers/customer-detail.tsx`
- `apps/api/test/support/in-memory-database.ts`
- `apps/api/test/live-pg-isolation.e2e-spec.ts`
- `apps/api/test/support/seed-two-tenants.ts`
- `docs/08-tech-debt/TD-006-live-pg-isolation-run.md`

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

None for the current EPIC-03 closure boundary. The following scope is formally
accepted-deferred rather than implemented:

- Playwright E2E for branding settings — [[TD-007 Playwright E2E deferred]].
- Live cross-tab appearance synchronization —
  [[TD-008 Cross-tab appearance sync deferred]].
- Controlled logo/favicon uploads, portal brand consumption, and `system`
  appearance mode — [[TD-009 Branding scope deferred]].

## Baseline Slice 1 Re-evaluation (2026-09-01)

Requested: construct the first minimal, clean-checkout-safe baseline slice that
establishes only the foundational branding API module/dependencies needed by the
later error-handling corrective delta, staying under 400 changed lines.

**Status: BLOCKED — no viable self-contained slice under 400 changed lines.**

The corrective delta imports `BrandOverrideValidationError` from
`apps/api/src/branding/brand-override.zod.ts` and modifies
`apps/api/src/branding/branding.service.ts` and
`apps/api/src/branding/branding.integration.test.ts`. Those files depend on the
rest of the private branding API module:

```text
corrective delta
├── packages/shared/src/errors/registry.ts
├── packages/shared/src/errors/registry.test.ts
├── apps/api/src/common/filters/global-exception.filter.ts
├── apps/api/src/branding/branding.service.ts
│   ├── apps/api/src/branding/brand-override.zod.ts
│   ├── apps/api/src/branding/dto.ts
│   ├── apps/api/src/branding/brand-resolver.ts
│   ├── apps/api/src/context/request-context.service.ts
│   ├── apps/api/src/entitlements/entitlements.service.ts
│   ├── apps/api/src/rbac/permission-resolver.service.ts
│   └── apps/api/src/audit/audit-writer.service.ts
└── apps/api/src/branding/branding.integration.test.ts
    ├── apps/api/src/branding/branding.module.ts
    ├── apps/api/src/branding/branding.controller.ts
    ├── apps/api/src/branding/public-branding.controller.ts
    └── test support fixtures
```

### Line-count estimate for candidate boundaries

| Candidate boundary                                                             | Changed lines | Under 400? | Notes                                                                           |
| ------------------------------------------------------------------------------ | ------------- | ---------- | ------------------------------------------------------------------------------- |
| S1 only (schema + migration + seed)                                            | ~72           | Yes        | No API module; does not satisfy corrective delta imports.                       |
| S2 private API module without tests or public controller                       | ~626          | No         | Minimum set that compiles after corrective delta applies.                       |
| S2 private API module with tests, no public controller                         | ~1,219        | No         | Includes service + integration tests needed for error-handling coverage.        |
| Core types + resolver (`brand-override.zod.ts`, `dto.ts`, `brand-resolver.ts`) | ~323          | Yes        | Still leaves `branding.service.ts` untracked, so corrective delta cannot apply. |

### Recommended split to stay under 400 lines

1. **Slice 1a — Persistence and permission seed (S1)**:
   `packages/database/prisma/schema.prisma` (TenantBranding only, excluding
   EPIC-04 Customer lines),
   `packages/database/prisma/migrations/20260826000002_tenant_branding/migration.sql`,
   `packages/database/src/reference-seed.ts` (branding permission only). ~72
   changed lines.
2. **Slice 1b — Core brand contracts and resolver**:
   `apps/api/src/branding/brand-override.zod.ts`,
   `apps/api/src/branding/dto.ts`, `apps/api/src/branding/brand-resolver.ts`.
   ~323 changed lines.
3. **Slice 1c — Private service boundary**:
   `apps/api/src/branding/branding.service.ts`,
   `apps/api/src/branding/branding.controller.ts`,
   `apps/api/src/branding/branding.module.ts`, `apps/api/src/app.module.ts`
   (BrandingModule only, excluding CustomersModule). ~303 changed lines.
4. **Slice 1d — Public surface and tests**:
   `apps/api/src/branding/public-branding.controller.ts`,
   `apps/api/src/branding/branding.service.test.ts`,
   `apps/api/src/branding/branding.integration.test.ts` (baseline form),
   `apps/api/src/rbac/route-contract.probe.test.ts`. Remaining lines.

The error-handling corrective delta should land after **Slice 1c** (once
`branding.service.ts` exists) or after **Slice 1d** (if it also updates the
integration test). It must remain a separate slice and not be absorbed into the
baseline.

### Scope exclusions applied

Excluded from the first baseline slice per instructions:

- EPIC-04 Customer schema/code (`Customer`, `CustomerAddress`,
  `CustomerContact`, `PatientGuardian`, `CustomersModule`).
- C2/live-PostgreSQL isolation tests.
- Web appearance UI, settings pages, and shell layout changes.
- CI workflow, `.atl`, `.codegraph`, archive artifacts, and unrelated docs.
- Error-mapping corrective delta (`registry.ts`, `registry.test.ts`,
  `global-exception.filter.ts`, and the try/catch + test additions in branding
  files) — it is separable and must remain its own slice.

## Decisions / Deviations

- Added all three brand-override validation codes to the shared registry rather
  than only `BRAND_OVERRIDE_UNKNOWN_KEY`, because `validateBrandOverride` can
  also throw `UNSUPPORTED_SCHEMA_VERSION` and `INVALID_VALUE`; registering all
  three keeps `DomainError(error.code, ...)` type-safe and consistent.
- Preserved the generic `BadRequestException → VALIDATION_FAILED` mapping by
  making the reverse status→code table first-wins, matching the existing comment
  and tests.
- Stored (corrupt) overrides continue to map to `VALIDATION_FAILED` via
  `parseStoredOverrides`; the corrective slice is scoped to user input escaping
  as 500.
- **New (baseline slice 1)**: Did not expand scope to absorb the corrective
  delta or unrelated EPIC-04 changes; stopped when the minimal self-contained
  API-module boundary exceeded the 400-line review budget.

## Closure Prep (2026-09-08)

Final reconciliation before archive:

- Marked H1 task 5.3 (Playwright E2E) as an accepted deferral to
  [[TD-007 Playwright E2E deferred]]; no Playwright dependency was added.
- Marked H1 task 5.4 (cross-tab appearance sync) as an accepted deferral to
  [[TD-008 Cross-tab appearance sync deferred]]; no cross-tab broadcast code was
  added.
- Corrected the live-PG evidence description: the CI suite proves cross-tenant
  byte-equivalent `404` for Customer/Address/Contact mutations and proves that
  authorized tenant-relative TenantBranding mutations do not leak between
  tenants. It does **not** claim cross-tenant or entitlement-denial paths for
  branding; those remain covered by the in-memory suite and are tracked in
  [[TD-006]].
- Updated `docs/05-modules/Branding.md` to match the same truthful boundary.
- Reverted the uncommitted `apps/api/vitest.config.ts` pool workaround; the
  verified CI evidence (run `34183380781` at `853f1309`) passed without it, so
  it is not a published-required closure fix.
- Formatted `docs/08-tech-debt/TD-007-playwright-e2e-deferred.md` and updated
  its frontmatter status to `accepted`.
- Created `docs/08-tech-debt/TD-008-cross-tab-appearance-sync-deferred.md` with
  user-visible risk, affected Phase B behavior, and no data/security impact.
- Created `docs/08-tech-debt/TD-009-branding-scope-deferred.md` for the
  remaining unimplemented EPIC-03 scope: controlled logo/favicon uploads, portal
  brand consumption, and `system` appearance mode. Includes user impact,
  non-goals, acceptance conditions, and explicit confirmation that no security
  or tenancy invariant is weakened.
- Updated `docs/01-roadmap/EPIC-03-Staff-Shell-Design-System-Branding.md` to
  reconcile all 14 acceptance criteria: evidenced criteria are checked; deferred
  criteria are unchecked and linked to TD-007/008/009; the epic status is set to
  `done` with a closure-reconciliation note.
