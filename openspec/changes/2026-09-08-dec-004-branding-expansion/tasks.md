# Tasks: DEC-004 Branding Expansion

## Review Workload Forecast

| Field                   | Value                |
| ----------------------- | -------------------- |
| Estimated changed lines | 1,000–1,350          |
| 400-line budget risk    | High                 |
| Chained PRs recommended | Yes                  |
| Suggested split         | PR 1 → PR 2 → PR 3   |
| Delivery strategy       | force-chained        |
| Chain strategy          | feature-branch-chain |

Decision needed before apply: No Chained PRs recommended: Yes Chain strategy:
feature-branch-chain 400-line budget risk: High

### Suggested Work Units

| Unit | Goal                                         | Likely PR                           | Focused test command                                                 | Runtime harness                      | Rollback boundary             |
| ---- | -------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------- | ------------------------------------ | ----------------------------- |
| 1    | Tenant asset storage and private lifecycle   | PR 1, base = feature/tracker branch | `pnpm test --filter @newsaas/api`                                    | `pnpm services:up && pnpm preflight` | migration, storage, asset API |
| 2    | Safe resolved DTO and staff asset controls   | PR 2, base = PR 1 branch            | `pnpm test --filter @newsaas/api && pnpm test --filter @newsaas/web` | upload/replace via staff proxy       | DTO, staff settings, shell    |
| 3    | Portal rendering, system appearance, closure | PR 3, base = PR 2 branch            | `pnpm test --filter @newsaas/web`                                    | public slug route without cookie     | portal, appearance, docs      |

## Phase 1: Asset Foundation (PR 1)

- [x] 1.1 RED: add `apps/api/src/branding/branding-asset.service.test.ts` cases
      for audit rollback, idempotent remove, cache revision, and retired signed
      URLs.
- [x] 1.2 RED: extend `apps/api/src/branding/branding.integration.test.ts` for
      valid PNG 201, 3 MB logo 413, disguised executable 400, Tenant B 404, and
      missing entitlement 403.
- [x] 1.3 Add `BrandingAsset` and nullable asset FKs in
      `packages/database/prisma/schema.prisma`; create additive
      `packages/database/prisma/migrations/<ts>_branding_assets/`.
- [x] 1.4 Create `apps/api/src/storage/` port, opaque-key factory, in-memory/S3
      drivers, 300-second signer, and test registration in
      `apps/api/test/support/in-memory-database.ts`.
- [x] 1.5 Implement multipart registration in `apps/api/src/main.ts`,
      `apps/api/src/branding/branding-asset.pipe.ts`, service/controller/module
      lifecycle, atomic audit, entitlement/permission gate, and cache
      invalidation.

## Phase 2: Resolved Identity and Staff Controls (PR 2)

- [x] 2.1 RED: add private/public DTO tests in
      `apps/api/src/branding/branding.integration.test.ts` proving URLs-only
      output, unknown slug 404, old URL revocation, and next-read public cache
      refresh.
- [x] 2.2 Extend `apps/api/src/branding/dto.ts`, `branding-resolver.ts`,
      `branding.service.ts`, `branding-cache.ts`, and
      `public-branding.controller.ts` with revision-keyed signed asset URLs and
      private-field assertion.
- [x] 2.3 Add `apps/web/src/app/api/branding/assets/[kind]/route.ts` and
      upload/remove/preview controls in
      `apps/web/src/app/(app)/app/settings/branding/branding-form.tsx`.
- [x] 2.4 Update `apps/web/src/app/(app)/layout.tsx`,
      `apps/web/src/components/shell/topbar.tsx`, and
      `branding-preview.test.tsx` to render only resolved signed asset URLs.

## Phase 3: Portal and System Appearance (PR 3)

- [x] 3.1 RED: extend `apps/web/src/lib/appearance.test.ts` for
      local/tenant/OS/Core precedence, corrupt storage, pre-paint dark, and
      matchMedia listener cleanup.
- [x] 3.2 Implement `system` persistence, bootstrap, and conditional runtime
      listener in `apps/web/src/lib/appearance.ts` and
      `apps/web/src/components/shell/appearance-toggle.tsx`.
- [x] 3.3 RED: create `apps/web/src/app/(portal)/layout.test.tsx` proving
      no-cookie public fetch, token/logo identity parity, and no private DTO
      fields.
- [x] 3.4 Create `apps/web/src/app/(portal)/layout.tsx`, `[slug]/page.tsx`, and
      `apps/web/src/components/portal/tenant-header.tsx` using only the public
      DTO.

## Phase 4: Verification and Closure

- [x] 4.1 Update `docs/05-modules/Branding.md`, resolve
      `docs/08-tech-debt/TD-009-branding-scope-deferred.md` with delivery
      reference, and reconcile all three deferred EPIC criteria in
      `docs/01-roadmap/EPIC-03-Staff-Shell-Design-System-Branding.md` after
      verification.
- [x] 4.2 Run focused slice tests, then
      `pnpm lint && pnpm format-check && pnpm typecheck && pnpm test && pnpm build`;
      record runtime/preflight evidence before closing EPIC-03. **Not
      complete:** the root gates were not re-run at the root; the generated
      `.atl/skill-registry.md` formatting is corrected and focused-verified (see
      Phase 5). **2026-09-11 addendum (supersedes the "Not complete" note):**
      the root gate chain was executed at the root as fresh verification (Engram
      verify-report #2144); `pnpm lint`, `pnpm format-check`, `pnpm typecheck`,
      `pnpm test`, and `pnpm build` all exited 0 on candidate `2a637cfd…`
      (`evidence_revision sha256:9eb9ef6e…`; 0 blockers, 10/10 requirements,
      16/16 scenarios).

## Phase 5: Corrective Slice (post-verify remediation)

- [x] 5.1 Anonymous public asset delivery: public DTO emits absolute API-origin
      URLs to `GET /api/v1/public/branding/assets/:kind/content` verified by the
      API-local HMAC token only; staff routes stay protected. Integration
      coverage proves anonymous delivery plus expired/tampered rejection.
- [x] 5.2 Correct the audit action to `branding.asset.created` across service,
      tests, design, module docs, and audit-writer comments.
- [x] 5.3 Appearance precedence: `ResolvedBrand.defaultAppearance` is the tenant
      layer only (absent → OS → Core light); the `localStorage` read is isolated
      so storage failures retain the tenant/OS fallback; `AppearanceToggle`
      defers when no stored preference exists. Focused tests added.
- [x] 5.4 Tenant-isolation invariant documented (no client-supplied tenant id;
      tenant is request-context authoritative) and cross-tenant
      access/replacement/removal tests added.
- [x] 5.5 Inactive-slug enforcement is now representable and delivered:
      [[DEC-005]] (accepted) and [[ADR-004]] (accepted) add the additive Core
      `TenantStatus` enum (`ACTIVE` default / `SUSPENDED`) with migration
      `20260911000001_tenant_lifecycle`, and restrict the public branding lookup
      to `ACTIVE`, so a SUSPENDED slug returns the identical `404 NOT_FOUND`
      envelope as an unknown slug. See
      `docs/04-adrs/ADR-004-tenant-lifecycle-status.md` and
      `docs/07-decisions/DEC-005-inactive-tenant-slug-branding.md`.
- [ ] 5.6 Root gates were not re-run at the root in this slice; the generated
      `.atl/skill-registry.md` formatting failure is corrected and
      focused-verified, and no false pass is claimed.

## Phase 6: Corrective Slice 2 (post verify report #2060 rev 2)

- [x] 6.1 Root-level tenant-aware pre-paint appearance: the root layout resolves
      the tenant `defaultAppearance` (portal `x-tenant-slug` header / staff
      session cookie) and renders the tenant-aware bootstrap before the preset
      `<style>` and every paint-affecting node; `middleware.ts` tags portal
      paths; a root-document order test was added.
- [x] 6.2 Secure staff GET content proxy at
      `apps/web/src/app/branding/assets/[kind]/content/route.ts` with focused
      tests.
- [x] 6.3 TD-009 stale Context/Debt/User-Impact/Risk/Behavior sections corrected
      to the implemented reality; the record remains `open`.
- [x] 6.4 `.atl/skill-registry.md` mechanically formatted with Prettier.
- [x] 6.5 Tenant-isolation scenario reconciled in the change spec without
      accepting client tenant IDs; a focused API guard test proves a
      client-supplied `tenantId` is ignored.
- [x] 6.6 Build-gate correction: `verify-build-output.mjs` accepts the dynamic
      App Router `_not-found` handler that the tenant-aware root produces; the
      web build passes end to end.
- [ ] 6.7 Root `pnpm test` and `pnpm format-check` were not re-run at the root
      in this slice; not claimed green.

## Phase 7: Corrective Slice 3 (post verify report #2060 rev 3)

- [x] 7.1 Consistent resolved identity: staff (`GET /branding/current`) and the
      public portal DTO share one revision-keyed cache entry and emit the
      canonical public API-local HMAC URL. A comparative API integration test
      proves identical logo URL and primary token across audiences, and a web
      test compares the staff and portal rendered logo URL and style bridge.
      Protected staff management and content routes are retained.
- [x] 7.2 TD-009 corrected precisely: virus scanning marked not delivered /
      deferred, and stale generated-registry formatting-failure language removed
      while the record stays `open` and distinguishes delivered from
      deferred/unresolved scope.
- [x] 7.3 Tenant-slug provenance: `middleware.ts` overwrites `x-tenant-slug` on
      every matched request (empty on staff/root/reserved paths) so a
      client-supplied header can never influence staff/root first paint; root
      and portal layouts treat an empty value as absent. Regression tests added.
- [ ] 7.4 Root gates executed at the root on 2026-09-10: `pnpm lint`,
      `pnpm format-check`, `pnpm typecheck`, and `pnpm build` exit 0;
      `pnpm test` exits 1 on an unhandled Vitest worker `onTaskUpdate` timeout
      in `@newsaas/api#test` with **zero assertion failures** (API 41 files /
      331 passed / 5 skipped; web 87/87; UI 36/36; database 80/80; worker 12/12;
      shared 16/16; typescript-config 1/1; preflight 6/6). Root `pnpm test`
      remains red and closure is not claimed. Exact blocker recorded in
      `apply-progress.md` Phase 7.4.

---

## 2026-09-11 Documentation Correction Addendum

Fresh root verification (Engram verify-report #2144) passed all five root gates
on candidate `2a637cfd…` (`evidence_revision sha256:9eb9ef6e…`; verdict
`pass_with_warnings`, 0 blockers, 10/10 requirements, 16/16 scenarios). The
stale root-gate claims retained above in Phase 5.6, Phase 6.7, and Phase 7.4 are
superseded by this addendum; they remain as dated per-slice history. Task 4.2 is
complete.

Two documentation contradictions were corrected in the canonical docs
(`EPIC-03`, `docs/05-modules/Branding.md`, `TD-009`):

- **C1:** root verification is no longer pending; the pre-correction failing
  gate was `pnpm format-check` (six files), now formatted.
- **C2:** the staff settings preview and staff shell render the canonical
  anonymous public asset URL from `GET /branding/current`; the relative
  staff-audience URL is returned by management `GET /branding/assets/:kind` and
  the upload response, and can be served by the protected same-origin proxy, but
  no current settings UI renders it.

This documentation correction's own root-gate verification completed on
2026-09-11 (Engram verify-report #2170, verdict `pass`): all five root gates
exited 0 on candidate
`sha256:d7aaf517b471b7ca527d35a00051bcc3bbcf43039ee9df1965524facdaad015e`.
TD-009 remains `open`; EPIC-03 remains `review`.
