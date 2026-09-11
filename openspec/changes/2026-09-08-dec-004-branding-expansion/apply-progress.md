# Apply Progress: DEC-004 Branding Expansion — Phases 1–7 (cumulative)

Merged cumulative progress. Phase 1 (PR 1 remediation), Phase 2 (PR 2), Phase 3
(PR 3), Phase 4 (closure), Phase 5 (corrective remediation after the first fresh
verify report), Phase 6 (corrective remediation after the second verify report),
and Phase 7 (corrective remediation after verify report #2060 revision 3) are
recorded below; nothing was overwritten.

## Status

Phases 1–3 implementation complete. Phase 4 docs/closure was recorded but its
closure verdict was **withdrawn** after the fresh verify report
(`sdd/2026-09-08-dec-004-branding-expansion/verify-report`): root gates are red,
so TD-009 remains open and EPIC-03 is back in `review`. Phase 5 corrected the
valid, in-scope blockers: anonymous public asset delivery,
`branding.asset.created` audit action, real appearance precedence, and
tenant-isolation coverage. Phase 6 corrects the remaining in-scope blockers from
verify report #2060 revision 2: root-level tenant-aware pre-paint appearance, a
secure staff content proxy, truthful TD-009 corrections, mechanical registry
formatting, and the change-specific tenant-isolation scenario reconciliation.
Phase 7 resolves the revision 3 blockers and warning: staff/portal
consistent-resolved-identity unification, precise TD-009 delivery/deferral
wording, and `x-tenant-slug` provenance restriction in middleware. Corrective
focused gates are green (API branding integration 32/32; web 87/87; API/Web
typecheck + lint; web production build). Phase 7.4 then executed the full root
gate chain: `pnpm lint`, `pnpm format-check`, `pnpm typecheck`, and `pnpm build`
pass at the root; root `pnpm test` is **red** on an unhandled Vitest worker
`onTaskUpdate` timeout in `@newsaas/api#test` with zero assertion failures
(diagnosed in Phase 7.4 below). The root test gate is not claimed green and
closure remains deferred.

---

## Phase 1 (PR 1) — Asset Foundation (remediation complete)

- [x] 1.1 Unit tests for `BrandingAssetService` covering audit rollback,
      idempotent remove, cache revision bump, and replacement key retirement.
- [x] 1.2 Integration tests for asset upload happy/sad paths: valid PNG 201, 3
      MiB logo 413, disguised non-image 400, Tenant B 404, missing permission
      403, missing entitlement 403.
- [x] 1.3 Prisma schema migration: `BrandingAsset` model + enum + nullable FKs
      on `TenantBranding` + `displayName`; additive migration
      `20260908000001_branding_assets`.
- [x] 1.4 Storage boundary: `StoragePort`, opaque-key factory,
      `InMemoryStorageDriver`, `S3StorageDriver`, 300 s signed URLs, test
      registration via `IsolationDatabase.storage` + `STORAGE_PORT` override in
      `bootTestApp`.
- [x] 1.5 Asset lifecycle: `@fastify/multipart` registration,
      `BrandingAssetPipe`, `BrandingAssetService`, `BrandingAssetController`,
      `BrandingCache`, module wiring, atomic audit co-commit,
      `branding.settings.manage` + `custom_branding` + `BRANDING_ASSETS_ENABLED`
      gates, cache invalidation.
- [x] R1 Fix replacement lifecycle under `@@unique([tenantId, kind])`: delete
      prior row before creating replacement inside the same transaction;
      PostgreSQL-credible coverage.
- [x] R2 Move object-storage put/delete/signedUrl outside the authoritative
      Prisma transaction; orphan cleanup on rollback and best-effort
      retired-object deletion post-commit.
- [x] R3 API-local HMAC-signed asset delivery
      (`/branding/assets/:kind/content?token=...`) so bucket names, object keys,
      and provider paths are never exposed.
- [x] R4 Audit action/spec consistency for nested `domain.subdomain.event`
      shapes (`branding.asset.uploaded` / `replaced` / `removed`).
- [x] R5 Genuine cross-tenant asset mutation integration test.
- [x] R6 Cache invalidation/read-path coverage: replacement rebinds the signed
      URL, prior URL 404s, new URL serves replacement bytes.
- [x] R7 Executable-bit audit: added TypeScript files tracked as `100644`.

## Phase 2 (PR 2) — Resolved Identity and Staff Controls

- [x] 2.1 RED: private/public DTO tests proving URLs-only output, unknown slug
      404, old URL revocation, next-read public cache refresh.
- [x] 2.2 `dto.ts`, `branding-resolver.ts`, `branding.service.ts`,
      `branding-cache.ts`, `public-branding.controller.ts`: revision-keyed
      signed asset URLs + private-field assertion.
- [x] 2.3 `apps/web/src/app/api/branding/assets/[kind]/route.ts` upload/remove
      proxy + branding form controls.
- [x] 2.4 Staff `(app)/layout.tsx`, `topbar.tsx`, `branding-preview.test.tsx`:
      render only resolved signed asset URLs.

## Phase 3 (PR 3) — Portal and System Appearance

- [x] 3.1 RED: extend `apps/web/src/lib/appearance.test.ts` for
      local/tenant/OS/Core precedence, corrupt storage, and pre-paint dark;
      matchMedia listener attach/detach covered in
      `apps/web/src/components/shell/appearance-toggle.test.tsx` (component
      owner per design testing strategy).
- [x] 3.2 `apps/web/src/lib/appearance.ts`: exported
      `appearanceBootstrapScriptWithTenantDefault(defaultAppearance)` and
      `SYSTEM_VALUE`; precedence stored light/dark > tenant default > OS
      `prefers-color-scheme` > Core light, tolerant of storage/matchMedia
      failure. `apps/web/src/components/shell/appearance-toggle.tsx`: 3-state
      Light/Dark/System selector, persists `"system"`, attaches `matchMedia`
      runtime listener only when local mode is `system` and tenant default is
      not explicit light/dark.
- [x] 3.3 RED: `apps/web/src/app/(portal)/layout.test.tsx` (6 cases) proving
      no-cookie public fetch (`cache: "no-store"`, no forwarded headers), tenant
      style bridge emission, token/logo identity parity, header-slug resolution,
      and no private DTO fields (`assetKey`, `tenantId`, `updatedBy`, `audit*`,
      `membership*`, RUC, billing secrets).
- [x] 3.4 Created `apps/web/src/app/(portal)/layout.tsx` (slug from `[slug]`
      path param or `x-tenant-slug` header; public endpoint only; preset
      fallback; emits bootstrap script + `brandStyleCss`),
      `apps/web/src/app/(portal)/[slug]/page.tsx`,
      `apps/web/src/components/portal/tenant-header.tsx` (light/dark logos via
      `<picture>`, favicon, display name, semantic tokens), plus
      `apps/web/src/lib/public-branding.ts` (allowlisted DTO -> `ResolvedBrand`,
      drops unknown/private fields).

## Phase 4 (Closure) — Docs and Quality Gates

- [x] 4.1 Updated `docs/05-modules/Branding.md` (asset endpoints, signed-URL
      delivery, revision cache, portal path, system appearance); resolved
      `docs/08-tech-debt/TD-009-branding-scope-deferred.md` with a delivery
      reference and checked its verification gates; reconciled the three
      deferred EPIC-03 criteria in
      `docs/01-roadmap/EPIC-03-Staff-Shell-Design-System-Branding.md` and set
      the epic to `done`.
- [x] 4.2 Re-ran focused slice tests, then root gates
      `pnpm lint && pnpm format-check && pnpm typecheck && pnpm test && pnpm build`.
      DEC-004-attributable fixes: pinned the four new asset routes in
      `apps/api/src/rbac/route-contract.probe.test.ts`; prettier-formatted the
      DEC-004 files flagged by `format-check`. Zero DEC-004 test failures.

## Files Changed

### Phase 1

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20260908000001_branding_assets/migration.sql`
- `packages/shared/src/errors/registry.ts`
- `packages/shared/src/errors/registry.test.ts`
- `apps/api/src/config/api-env.schema.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/common/http/fastify-adapter.factory.ts`
- `apps/api/src/common/filters/global-exception.filter.ts`
- `apps/api/src/audit/audit-writer.service.ts`
- `apps/api/src/storage/*`
- `apps/api/src/branding/branding-cache.ts`
- `apps/api/src/branding/branding-asset.pipe.ts`
- `apps/api/src/branding/branding-asset.service.ts`
- `apps/api/src/branding/branding-asset.service.test.ts`
- `apps/api/src/branding/branding-asset.controller.ts`
- `apps/api/src/branding/branding-asset-delivery.service.ts`
- `apps/api/src/branding/branding.module.ts`
- `apps/api/src/branding/branding.integration.test.ts`
- `apps/api/test/support/in-memory-database.ts`
- `apps/api/test/support/boot-test-app.ts`
- `apps/api/package.json`, `pnpm-lock.yaml`

### Phase 2

- `packages/ui/src/branding/types.ts`, `packages/ui/src/branding/index.ts`
- `apps/api/src/branding/dto.ts`, `branding-asset-delivery.service.ts`,
  `branding-resolver.ts`, `branding.service.ts`, `branding.module.ts`,
  `public-branding.controller.ts`, `branding.integration.test.ts`,
  `branding.service.test.ts`
- `apps/api/src/storage/s3-storage.driver.ts`
- `apps/web/src/app/api/branding/assets/[kind]/route.ts`
- `apps/web/src/app/(app)/app/settings/branding/branding-form.tsx`,
  `branding-preview.tsx`, `branding-preview.test.tsx`
- `apps/web/src/components/shell/topbar.tsx`, `topbar.test.tsx`
- `apps/web/src/app/(app)/layout.tsx`

### Phase 3

- `apps/web/src/lib/appearance.ts` — tenant-aware pre-paint bootstrap +
  `SYSTEM_VALUE` (modified).
- `apps/web/src/components/shell/appearance-toggle.tsx` — 3-state selector +
  conditional OS listener (modified).
- `apps/web/src/lib/appearance.test.ts` — precedence/storage/pre-paint coverage
  (modified; test-mock fix below).
- `apps/web/src/components/shell/appearance-toggle.test.tsx` — system-mode +
  listener attach/detach coverage (modified).
- `apps/web/src/lib/public-branding.ts` — public DTO type + safe mapper (new).
- `apps/web/src/app/(portal)/layout.tsx` — public portal shell layout (new).
- `apps/web/src/app/(portal)/layout.test.tsx` — portal layout RED coverage
  (new).
- `apps/web/src/app/(portal)/[slug]/page.tsx` — portal landing page (new).
- `apps/web/src/components/portal/tenant-header.tsx` — public-DTO-only header
  (new).

### Phase 4

- `apps/api/src/rbac/route-contract.probe.test.ts` — pinned the four DEC-004
  asset routes in the full-surface inventory (modified).
- `docs/05-modules/Branding.md` — Phase C asset/portal/system-appearance
  behavior, endpoints, and invariants (modified).
- `docs/08-tech-debt/TD-009-branding-scope-deferred.md` — resolved with a
  delivery reference (modified).
- `docs/01-roadmap/EPIC-03-Staff-Shell-Design-System-Branding.md` — criteria
  reconciled and epic closed (modified).
- `openspec/changes/2026-09-08-dec-004-branding-expansion/tasks.md` — 4.1/4.2
  checked (modified).
- Prettier formatting normalization across DEC-004 API branding files, web
  portal/appearance files, docs, and change/spec artifacts (formatting only).

## Verification Evidence

| Command                                                                                                                                            | Result                    | Notes                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------- |
| `pnpm test --filter @newsaas/web -- src/lib/appearance.test.ts "src/app/(portal)/layout.test.tsx" src/components/shell/appearance-toggle.test.tsx` | ✅ 30/30 passed (3 files) | appearance 15, portal layout 6, toggle 9 |
| `pnpm lint --filter @newsaas/web`                                                                                                                  | ✅ passed                 | eslint clean                             |
| `pnpm typecheck --filter @newsaas/web`                                                                                                             | ✅ passed                 | tsc strict clean                         |

Phase 1 focused evidence (previously recorded): branding API suite 44/44,
audit/auth 56/56, shared 16/16, typecheck/lint green. Phase 2 focused evidence
(previously recorded): API branding 47/47, web shell/preview 8/8, typecheck/lint
green.

### Phase 4 — focused slice tests and root quality gates (2026-09-10)

| Command                                                                    | Exit | Evidence                                                                                                                                                       |
| -------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test --filter @newsaas/api` (isolated)                               | 0    | 41 passed / 1 skipped files; 324 passed / 5 skipped tests; 0 errors                                                                                            |
| `pnpm test --filter @newsaas/web` (part of root test)                      | 0    | 14 files / 66 tests passed                                                                                                                                     |
| `pnpm test --filter @newsaas/api -- src/rbac/route-contract.probe.test.ts` | 0    | 6/6 after pinning the four DEC-004 asset routes                                                                                                                |
| `pnpm lint`                                                                | 0    | turbo 12/12 tasks                                                                                                                                              |
| `pnpm typecheck`                                                           | 0    | turbo 12/12 tasks                                                                                                                                              |
| `pnpm build`                                                               | 0    | turbo 8/8 tasks; web `verify-build-output` passed                                                                                                              |
| `pnpm test` (root)                                                         | 1    | 0 test failures; 1 unhandled `[vitest-worker]: Timeout calling "onTaskUpdate"` under cross-package parallelism (documented in `apps/api/vitest.config.ts`)     |
| `pnpm format-check`                                                        | 1    | fails only on the auto-generated, non-DEC-004 `.atl/skill-registry.md` (HEAD version is prettier-clean; the working-tree change is skill-registry tool output) |

Runtime/preflight limitations: no live PostgreSQL or Docker services were run;
`test/live-pg-isolation.e2e-spec.ts` is skipped by design and the live-PG CI
isolation gate was not exercised in this closure slice.

## Deviations from Design (Phase 3)

1. matchMedia listener attach/detach assertions live in
   `appearance-toggle.test.tsx` rather than `appearance.test.ts`; the design
   testing strategy assigns that coverage to the `AppearanceToggle` unit.
2. `(portal)/[slug]/page.tsx` independently fetches the public DTO to pass
   explicit header props instead of threading brand state from the layout; both
   surfaces consume only the allowlisted public DTO.

## Issues Found (Phase 3)

- Test-only defect: the "OS prefers light / Core fallback" case in
  `appearance.test.ts` stubbed `matchMedia` to report `matches: true` for the
  dark query, contradicting the scenario. Fixed the stub to `matches: false`. No
  production defect — the bootstrap already resolves OS-light correctly.

## Risks / Follow-up (Phase 3)

- The portal page and layout each fetch the public branding endpoint once per
  request (double fetch). Public resolution is server-cached via
  `BrandingCache`, so impact is bounded; a shared loader is a future
  optimization.
- Cross-origin portal image loads still depend on the API-local signed URL
  delivery introduced in PR 2; not changed in this slice.

## Scope Boundaries

- Phase 4 (docs/closure) complete. No PRD, ADR, or approved scope changes.
- Only the EPIC-02 route-contract guard test was modified, and solely to pin the
  four new DEC-004 routes (no guard semantics changed).
- No commit, stage, push, or rewrite of PR 1–3 work; only a DEC-004 test-mock
  correction (Phase 3) and DEC-004 format/route-pin fixes (Phase 4).

## Risks / Follow-up (Phase 4)

- The root `pnpm test` exit is a documented vitest worker IPC timeout under
  cross-package parallelism; the API suite is green in isolation (exit 0). A
  future harness change (serialize root test packages or raise the worker RPC
  timeout) would make the root exit deterministic.
- `pnpm format-check` fails only on the auto-generated `.atl/skill-registry.md`.
  Adding `.atl/` to `.prettierignore` or regenerating the registry formatted
  would clear it; left untouched as unrelated work.
- Portal and branding asset browser-level E2E remains deferred ([[TD-007]]).

## Next Recommended

- Re-run `sdd-verify` for the change on the corrected worktree, then
  create/commit the feature-branch-chain PRs.
- Root gate hygiene (out of this slice): the Vitest `onTaskUpdate` timeout and
  the generated `.atl/skill-registry.md` format warning.

---

## Phase 5 (Corrective Remediation) — post-verify fixes

Findings corrected from `verify-report` #2060 (evidence_revision
`sha256:2fae68738ad5d341b66e8d2c81c085fd089987bd1d39881d1167861e3404a3cf`).

- [x] 5.1 **Anonymous public asset delivery.** Added
      `apps/api/src/branding/public-branding-asset.controller.ts` (`@Public()`
      `GET /api/v1/public/branding/assets/:kind/content`).
      `BrandingAssetDeliveryService` now signs audience-aware URLs (`staff` =
      protected relative route; `public` = absolute
      `BRANDING_ASSET_PUBLIC_BASE_URL` + anonymous route) over the same
      API-local HMAC token, and `streamPublic` resolves the asset by signed
      `assetId` without request-context tenant or staff auth. `BrandingResolver`
      passes the audience through and keys the cache per audience. New routes
      pinned in `route-contract.probe.test.ts`.
- [x] 5.2 **Audit action corrected to `branding.asset.created`** in
      `branding-asset.service.ts` (+ unit/integration assertions), `design.md`
      D9/data-flow, `docs/05-modules/Branding.md`, and `audit-writer.service.ts`
      comments.
- [x] 5.3 **Appearance precedence.** `ResolvedBrand.defaultAppearance` is now
      the tenant layer only (`resolve-brand.ts` no longer collapses absence to
      Core `light`); the tenant-aware bootstrap accepts an optional default,
      isolates the `localStorage` read so storage failures keep the tenant/OS
      fallback, and defers to `matchMedia` when the tenant default is
      absent/`system`; `AppearanceToggle` defers (system) when no stored
      preference exists.
- [x] 5.4 **Tenant isolation.** Documented the API invariant that no client
      tenant id exists (tenant is request-context authoritative) and added
      cross-tenant content-access/removal integration tests proving the
      equivalent behavior (`404`, `removed: false`).
- [ ] 5.5 **Inactive-slug gap.** `Tenant` has no active state; proposed
      `docs/07-decisions/DEC-005-inactive-tenant-slug-branding.md`; criterion
      unresolved.
- [ ] 5.6 **Root gates red.** `pnpm test` and `pnpm format-check` remain red; no
      infra workaround added.

### Files Changed (Phase 5)

- `apps/api/src/branding/branding-asset-delivery.service.ts` — audience-aware
  signing, `streamPublic`, config `publicBaseUrl`.
- `apps/api/src/branding/public-branding-asset.controller.ts` (new).
- `apps/api/src/branding/branding.module.ts` — register public asset controller.
- `apps/api/src/branding/branding-resolver.ts` — audience param + cache key.
- `apps/api/src/branding/branding-asset.service.ts` — audit action.
- `apps/api/src/branding/branding-asset.service.test.ts`,
  `apps/api/src/branding/branding.integration.test.ts`,
  `apps/api/src/rbac/route-contract.probe.test.ts` — corrected/added coverage.
- `apps/api/src/branding/dto.ts`, `apps/api/src/audit/audit-writer.service.ts`.
- `packages/ui/src/branding/types.ts`, `resolve-brand.ts`,
  `resolve-brand.test.ts`.
- `apps/web/src/lib/appearance.ts`, `appearance.test.ts`,
  `components/shell/appearance-toggle.tsx`, `appearance-toggle.test.tsx`,
  `app/(app)/layout.test.tsx`, `app/(portal)/layout.test.tsx`,
  `app/(app)/app/settings/branding/branding-form.tsx`.
- Docs: `docs/05-modules/Branding.md`, `docs/08-tech-debt/TD-009-...md`,
  `docs/01-roadmap/EPIC-03-...md`, `docs/07-decisions/DEC-005-...md` (new).

### Verification Evidence (Phase 5, 2026-09-10)

| Command                                                                                                                                       | Exit | Evidence                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------- |
| `pnpm --filter @newsaas/api exec vitest run ... branding.integration.test.ts branding-asset.service.test.ts branding.service.test.ts`         | 0    | 3 files, 52/52                                                                                        |
| `pnpm --filter @newsaas/api exec vitest run ... route-contract.probe.test.ts`                                                                 | 0    | 6/6                                                                                                   |
| `pnpm --filter @newsaas/web exec vitest run ... appearance.test.ts appearance-toggle.test.tsx (portal)/layout.test.tsx (app)/layout.test.tsx` | 0    | 4 files, 42/42                                                                                        |
| `pnpm --filter @newsaas/ui test -- src/branding/resolve-brand.test.ts`                                                                        | 0    | 6 files, 36/36                                                                                        |
| `pnpm --filter @newsaas/{api,web,ui} typecheck`                                                                                               | 0    | tsc clean                                                                                             |
| `pnpm --filter @newsaas/{api,web,ui} lint`                                                                                                    | 0    | eslint clean                                                                                          |
| `pnpm test` (root)                                                                                                                            | 1    | Not rerun in this slice; previously documented Vitest `onTaskUpdate` timeout, zero assertion failures |
| `pnpm format-check` (root)                                                                                                                    | 1    | Not rerun in this slice; `.atl/skill-registry.md` only                                                |

Runtime/preflight limitations: no live PostgreSQL or Docker services were run;
cross-tenant branding isolation is proven on the in-memory Prisma boundary.

## Scope Boundaries (Phase 5)

- No PRD, ADR, or approved-scope change. DEC-005 is a proposal only.
- No commit, stage, push, or rewrite of the protected PR 1–3 working-tree
  changes.
- Reviewable slice only; inactive-slug enforcement and root-gate hygiene are
  explicitly left unresolved and reported.

---

## Phase 6 (Corrective Remediation) — post verify report #2060 rev 2 (2026-09-10)

- [x] 6.1 **Root-level tenant-aware pre-paint appearance.**
      `apps/web/src/app/layout.tsx` now resolves the tenant `defaultAppearance`
      server-side (portal via the `x-tenant-slug` header, staff via the session
      cookie to the private branding endpoint) and renders
      `appearanceBootstrapScriptWithTenantDefault(defaultAppearance)` as the
      first body child, before the preset `<style>` and `QueryProvider`. New
      `apps/web/src/middleware.ts` tags portal path requests with
      `x-tenant-slug`. `apps/web/src/app/layout.test.tsx` was rewritten as a
      root-order test that asserts the tenant-aware script precedes the preset
      `<style>` and all paint-affecting content in the actual root document.
      Nested layouts keep their tenant `<style>`; appearance application is
      idempotent.
- [x] 6.2 **Secure staff GET content proxy.** New
      `apps/web/src/app/branding/assets/[kind]/content/route.ts` forwards the
      staff cookie to the protected API content route
      (`/branding/assets/:kind/content?token=...`), validates kind and token,
      and streams bytes without exposing storage internals. Focused tests in
      `route.test.ts` cover forward+stream, request-id, invalid kind, missing
      token, and upstream error propagation.
- [x] 6.3 **Truthful TD-009 corrections while remaining open.**
      `docs/08-tech-debt/TD-009-branding-scope-deferred.md` Context/Debt/User
      Impact/Risk/Affected Behavior sections no longer claim the three
      capabilities are unimplemented; they now describe the implemented state
      and the real closure blockers. `status: open` unchanged.
- [x] 6.4 **Mechanical registry formatting.** `.atl/skill-registry.md`
      reformatted with Prettier (generated file; formatting only).
- [x] 6.5 **Tenant-isolation scenario reconciliation without accepting client
      tenant IDs.** `specs/tenant-branding-assets/spec.md` now states that asset
      routes derive the tenant only from the authenticated request context and
      must not accept a client-supplied tenant identifier; the foreign-target
      scenario was replaced by "client-supplied tenant id is not authority" and
      "cross-tenant asset is not observable". A focused API test proves a
      foreign `tenantId` in query/header is ignored and the mutation stays
      Tenant A-scoped.
- [x] 6.6 **Build-gate correction (scope expansion).** The tenant-aware root
      makes `/_not-found` dynamic, so Next no longer emits the Pages-router
      `404.html` fallback. `apps/web/scripts/verify-build-output.mjs` now
      accepts either the static `404.html` or the App Router
      `_not-found/page.js`; the web production build passes end to end.
- [ ] 6.7 **Root gates.** `pnpm test` (Vitest `onTaskUpdate` timeout) and
      `pnpm format-check` were not re-run at the root in this slice; not claimed
      green. No infra workaround added.

### Files Changed (Phase 6)

- `apps/web/src/app/layout.tsx` — tenant-aware resolution + root bootstrap.
- `apps/web/src/app/layout.test.tsx` — root-document order test.
- `apps/web/src/middleware.ts` (new) — portal `x-tenant-slug` tagging.
- `apps/web/src/app/branding/assets/[kind]/content/route.ts` (new) — staff GET
  content proxy.
- `apps/web/src/app/branding/assets/[kind]/content/route.test.ts` (new).
- `apps/web/scripts/verify-build-output.mjs` — dynamic not-found acceptance.
- `apps/api/src/branding/branding.integration.test.ts` — client tenant-id guard.
- `openspec/changes/2026-09-08-dec-004-branding-expansion/specs/tenant-branding-assets/spec.md`
  — tenant-isolation scenario reconciliation.
- `docs/08-tech-debt/TD-009-branding-scope-deferred.md` — truthful corrections.
- `.atl/skill-registry.md` — Prettier formatting.

### Verification Evidence (Phase 6, 2026-09-10)

| Command                                                                                                   | Exit | Evidence                                           |
| --------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------- |
| `pnpm --filter @newsaas/web exec vitest run ... layout.test.tsx content/route.test.ts appearance.test.ts` | 0    | 3 files, 27/27                                     |
| `pnpm --filter @newsaas/web test`                                                                         | 0    | 15 files, 79/79                                    |
| `pnpm --filter @newsaas/api exec vitest run ... branding.integration.test.ts`                             | 0    | 1 file, 31/31                                      |
| `pnpm --filter @newsaas/web typecheck` / `lint`                                                           | 0    | tsc + eslint clean                                 |
| `pnpm --filter @newsaas/api typecheck` / `lint`                                                           | 0    | tsc + eslint clean                                 |
| `pnpm --filter @newsaas/web build`                                                                        | 0    | Next build + postbuild artifact check pass         |
| `prettier --check` on all touched files                                                                   | 0    | clean                                              |
| `pnpm test` (root)                                                                                        | —    | not re-run; not claimed green                      |
| `pnpm format-check` (root)                                                                                | —    | not re-run; `.atl/skill-registry.md` fixed locally |

Runtime limitations: no live PostgreSQL/Docker; tenant isolation proven on the
in-memory Prisma boundary. Browser-level verification remains deferred (TD-007);
the root-order test is a DOM-order proof, not a browser paint trace.

## Scope Boundaries (Phase 6)

- No PRD, ADR, or approved-scope change. DEC-005 stays a proposal; inactive-slug
  enforcement is not implemented.
- No change to the Tenant model or authorization model.
- No commit, stage, push, reset, or rewrite of protected working-tree changes.
- Scope expansion: `apps/web/scripts/verify-build-output.mjs` was updated only
  because the tenant-aware root legitimately makes `/_not-found` dynamic.

## Next Recommended

- Re-run `sdd-verify` on the corrected worktree, then create/commit the
  feature-branch-chain PRs.

---

## Phase 7 (Corrective Remediation 3) — post verify report #2060 rev 3 (2026-09-10)

- [x] 7.1 **Consistent resolved identity.** `BrandingResolver` no longer signs
      audience-specific URL forms: staff (`GET /branding/current`) and the
      public portal DTO both resolve the canonical public API-local HMAC URL and
      share one revision-keyed cache entry (the `:audience` cache-key segment
      was removed). The comparative API integration test asserts identical
      `logoLightUrl` and primary token, and
      `apps/web/src/app/branding-identity-parity.test.tsx` compares the staff
      and portal rendered logo URL and style bridge. Protected staff management
      and the staff content proxy routes are retained.
- [x] 7.2 **TD-009 corrected precisely.** Virus scanning is now explicitly
      `_Not delivered; still deferred._`; the blanket "Delivered by DEC-004"
      claim was replaced with a delivered-vs-deferred split; and stale
      generated-registry formatting-failure language was removed from Debt,
      Risk, Verification, and the closure checkbox. The record stays
      `status: open`.
- [x] 7.3 **Tenant-slug provenance.** `middleware.ts` always overwrites
      `x-tenant-slug` (empty on staff/root/reserved/dotted paths, the portal
      first segment otherwise) so a client-supplied header cannot influence
      staff/root first paint. Root and portal layouts treat an empty forwarded
      value as absent. `apps/web/src/middleware.test.ts` plus a root-layout
      regression test cover provenance.
- [ ] 7.4 Root `pnpm test` and `pnpm format-check` were not re-run at the root
      in this slice; not claimed green.

### Files Changed (Phase 7)

- `apps/api/src/branding/branding-resolver.ts` — canonical public audience and
  audience-free cache revision.
- `apps/api/src/branding/branding.integration.test.ts` — staff URL form updated
  to the public route plus a comparative identity test.
- `apps/web/src/app/branding-identity-parity.test.tsx` (new) — cross-audience
  render comparison.
- `apps/web/src/middleware.ts` — always overwrite `x-tenant-slug`;
  `resolveTrustedTenantSlug` helper.
- `apps/web/src/middleware.test.ts` (new) — provenance regression tests.
- `apps/web/src/app/layout.tsx` — trim and ignore an empty forwarded slug.
- `apps/web/src/app/(portal)/layout.tsx` — treat an empty forwarded slug as
  absent.
- `apps/web/src/app/layout.test.tsx` — empty-slug regression test.
- `docs/08-tech-debt/TD-009-branding-scope-deferred.md` — precise delivered vs
  deferred wording.
- `docs/05-modules/Branding.md` — canonical-identity and middleware-provenance
  documentation.
- `openspec/changes/2026-09-08-dec-004-branding-expansion/design.md` and
  `tasks.md` — design row and Phase 7 tasks.

### Verification Evidence (Phase 7, 2026-09-10)

| Command                                                                                                 | Exit | Evidence                                         |
| ------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------ |
| `pnpm --filter @newsaas/api exec vitest run ... branding.integration + service + route-contract suites` | 0    | 4 files, 60/60                                   |
| `pnpm --filter @newsaas/web exec vitest run`                                                            | 0    | 17 files, 87/87                                  |
| `pnpm --filter @newsaas/api typecheck` / `lint`                                                         | 0    | tsc + eslint clean                               |
| `pnpm --filter @newsaas/web typecheck` / `lint`                                                         | 0    | tsc + eslint clean                               |
| `prettier --check` on all Phase 7 touched files                                                         | 0    | clean                                            |
| `pnpm test` (root, Phase 7.4)                                                                           | 1    | API `onTaskUpdate` timeout; 0 assertion failures |
| `pnpm format-check` (root, Phase 7.4)                                                                   | 0    | All matched files use Prettier code style        |

Runtime limitations: no live PostgreSQL/Docker; tenant isolation proven on the
in-memory Prisma boundary; browser paint remains deferred (TD-007). The
staff/portal parity proof is a resolver + render comparison, not a browser
trace.

### Scope Boundaries (Phase 7)

- No PRD, ADR, or approved-scope change. DEC-005 stays a proposal; inactive-slug
  enforcement is not implemented.
- No change to the Tenant model, authorization model, or protected staff
  management/content routes.
- No new dependency; the audience parameter remains in the delivery service for
  protected management responses only.
- No commit, stage, push, reset, or rewrite of protected working-tree changes.
- `size:exception` (#2070) applies to this corrective slice.

## Phase 7.4 — Root Gate Execution (closure evidence, 2026-09-10)

Root-level gate chain commanded by Phase 7.4 was executed **at the root**
(`/mnt/c/NewSaaS`) on 2026-09-10. Commands were run individually so every
command's result is captured (the `&&` chain would otherwise hide downstream
results after the first failure); each invocation is the exact root script.

| Command             | Exit | Result                                                                                              | Log                                  |
| ------------------- | ---: | --------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `pnpm lint`         |    0 | turbo: 12 successful, 12 total; 8 cached; 1m53s                                                     | `/tmp/opencode/p74/lint.log`         |
| `pnpm format-check` |    0 | Prettier: "All matched files use Prettier code style!" — registry formatting blocker resolved       | `/tmp/opencode/p74/format-check.log` |
| `pnpm typecheck`    |    0 | turbo: 12 successful, 12 total; 9 cached; 50s                                                       | `/tmp/opencode/p74/typecheck.log`    |
| `pnpm test`         |    1 | **FAIL** — `@newsaas/api#test` unhandled Vitest worker `onTaskUpdate` timeout; 0 assertion failures | `/tmp/opencode/p74/test.log`         |
| `pnpm build`        |    0 | turbo: 8 successful, 8 total; 6 cached; 3m58s (Next build + postbuild artifact verifier pass)       | `/tmp/opencode/p74/build.log`        |

**Chained result:**
`pnpm lint && pnpm format-check && pnpm typecheck && pnpm test && pnpm build`
exits **non-zero at `pnpm test`**; `pnpm build` is independently green when run
after the chain stops.

### `pnpm test` Blocker (exact)

- Failing task: `@newsaas/api#test` (`vitest run --config vitest.config.ts`),
  exit 1.
- Symptom: `Vitest caught 1 unhandled error` →
  `Error: [vitest-worker]: Timeout calling "onTaskUpdate"` (vitest 3.2.7,
  `dist/chunks/rpc.-pEldfrD.js:53`).
- Assertions: **zero failures.** API `Test Files 41 passed | 1 skipped (42)`,
  `Tests 331 passed | 5 skipped (336)`, `Errors 1 error`. Every other package
  was green: web 17 files / 87 tests, UI 6/36, database 7/80, worker 2/12,
  shared 3/16, typescript-config 1/1, preflight 2/6.
- Duration: API run 905.53s (collect 584.37s, tests 135.26s, prepare 120.08s) —
  the collect phase is wall-clock starved while turbo runs the other 12 tasks in
  parallel.
- Diagnosis: infrastructure flake, not a product/assertion regression.
  `apps/api/vitest.config.ts` already sets `fileParallelism: false` to mitigate
  exactly this tinypool RPC drop, but the root run still saturates the main
  thread across packages until the worker's `onTaskUpdate` RPC exceeds Vitest's
  internal timeout. No branding code path is implicated; the branding suites
  themselves pass (API `branding.integration.test.ts` 32/32,
  `branding-asset.service.test.ts` 10/10, `branding.service.test.ts` 12/12).
- Disposition: **not papered over.** No tooling/config/dependency was changed,
  and no root gate is claimed green. `pnpm test` remains the sole red root gate;
  closure of TD-009/EPIC-03 stays deferred. A fix (runner/timeout/parallelism
  policy change) is out of scope for this closure-evidence slice and must be an
  explicit, separately-reviewed change.

### Scope Boundaries (Phase 7.4)

- Documentation/evidence only: `tasks.md`, this `apply-progress.md`, `TD-009`,
  and the EPIC-03 closure note were updated to record the root-run facts.
- No source, test, config, or dependency change; no commit, stage, push, reset,
  or discard.
- TD-009 stays `status: open`; EPIC-03 stays `status: review`; the
  "Lint/typecheck/tests/build are green" criterion stays unchecked.

## Next Recommended

- Resolve the root `pnpm test` runner flake (Vitest worker `onTaskUpdate` RPC
  timeout under cross-package turbo parallelism) as an explicit, separately
  reviewed infra change; then re-run the root gates before re-running
  `sdd-verify` and creating/committing the feature-branch-chain PRs.

---

## Documentation Correction Addendum (2026-09-11)

This addendum supersedes the stale root-gate/closure claims above (the Status
block, Phase 5.6, Phase 6.7, and Phase 7.4) without rewriting them; those dated
per-slice entries remain as history.

A fresh root verification was executed on 2026-09-11 (Engram verify-report
#2144, `evidence_revision sha256:9eb9ef6e…`): all five root gates exited 0 on
candidate `2a637cfd…` — `pnpm lint`, `pnpm format-check`, `pnpm typecheck`,
`pnpm test` (API 359 passed / 5 skipped; web 91; worker 27; database 85; shared
16), and `pnpm build` — with verdict `pass_with_warnings`, 0 blockers, 10/10
requirements, and 16/16 scenarios. The pre-correction failing gate was
`pnpm format-check` (six files), now formatted.

Staff-preview delivery is documented truthfully: the staff settings preview and
staff shell render the canonical anonymous public asset URL from
`GET /branding/current`; management `GET /branding/assets/:kind` and the upload
response return the relative staff-audience URL, which the protected same-origin
proxy can serve, but no current settings UI renders it.

This documentation correction's own root-gate verification completed on
2026-09-11 (Engram verify-report #2170, verdict `pass`): all five root gates
exited 0 on candidate
`sha256:d7aaf517b471b7ca527d35a00051bcc3bbcf43039ee9df1965524facdaad015e`.
TD-009 remains `status: open` and EPIC-03 remains `status: review`.
