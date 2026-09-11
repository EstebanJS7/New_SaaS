# Design: DEC-004 Branding Expansion

## Technical Approach

Extend the existing Core Branding capability with three additive surfaces behind
the `custom_branding` entitlement: (a) tenant-owned `BrandingAsset` records with
opaque storage keys and short-lived signed URLs delivered through a narrow
StoragePort boundary, (b) a portal route group that consumes the public safe DTO
without staff cookies, and (c) the `system` appearance mode wired into the
existing pre-paint bootstrap. The layering stays
`CoreDesignDefaults → ProductBrandPreset → TenantBranding → ResolvedBrand`;
`ResolvedBrand` gains `assets?: { logoLightUrl?, logoDarkUrl?, faviconUrl? }`
only (never keys). Cache keying includes a `revision` token bumped on any tenant
row or asset mutation. No microservices, no new ORM/auth/broker — verified
against the architecture freeze.

## Architecture Decisions

| #   | Decision          | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Alternatives                                                               | Rationale                                                                                                                                                                                                  |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Asset persistence | New `BrandingAsset` Prisma model + 3 nullable FK columns on `TenantBranding` (`logoLightAssetId`, `logoDarkAssetId`, `faviconAssetId`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Inline opaque keys in the existing `overrides` JSON                        | Keeps `brandOverrideSchema` focused on theme tokens (existing v1), FK enforces referential integrity for replace/remove, atomic clear on delete.                                                           |
| D2  | Storage adapter   | New `StoragePort` interface in `apps/api/src/storage/`; in-memory fake for tests/dev, S3-compatible driver behind a runtime token; opaque random keys, signed URLs via `getSignedUrl` with 5-minute TTL                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Persist bytes in Postgres (PRD forbids), vendor SDK directly in controller | PRD §25 mandates object storage + signed URLs; a port keeps Core Branding decoupled from any specific provider and unit-testable.                                                                          |
| D3  | Upload parsing    | `@fastify/multipart` registered once in `main.ts`, consumed by a single `FileUploadPipe` that streams to `StoragePort.put` and validates MIME (PNG/WebP/ICO via magic-bytes, not just header) + size (logo ≤ 2 MB, favicon ≤ 512 KB)                                                                                                                                                                                                                                                                                                                                                                                                                          | `@nestjs/platform-express` + multer                                        | Stack is NestJS-on-Fastify; switching the platform is forbidden by architecture freeze. `@fastify/multipart` is the canonical Fastify-native path.                                                         |
| D4  | Validation        | Magic-byte sniff with `file-type` (small, no native deps) + size cap; rejects SVG/executable/scripts/mismatched MIME with `400 BAD_REQUEST`; oversized → `413 PAYLOAD_TOO_LARGE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Declared-MIME-only, server-side antivirus                                  | Antivirus deferred (TD-009 mentions but it is non-blocking); magic-byte sniff closes the "rename `.exe` to `.png`" gap the spec calls out.                                                                 |
| D5  | Cache             | In-memory `Map<string, {value, expiresAt}>` keyed on `branding:public:{tenantId}:rev:{tenantUpdatedAtMs}-{assetRevSum}`; revision recomputed on every mutation; private cache per app instance                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Redis cache                                                                | Spec mandates revision-keyed invalidation, not cross-instance consistency; introducing a Redis-backed cache is out of scope. Documented boundary in the StoragePort module for future Redis upgrade.       |
| D6  | Public DTO        | Extend `PublicBrandingDto` with `logoLightUrl?`, `logoDarkUrl?`, `faviconUrl?` (signed URLs only). Add a server-side assertion in `PublicBrandingController` that DTO never carries `assetKey`, `tenantId`, `audit*`, `membership*`, RUC, billing secrets                                                                                                                                                                                                                                                                                                                                                                                                     | Return raw asset metadata                                                  | Spec mandates the PUBLIC allowlist; the assertion prevents accidental leaks during future edits.                                                                                                           |
| D7  | Portal surface    | New `apps/web/src/app/(portal)/layout.tsx` (no staff cookie); server-fetches `GET /api/v1/public/tenants/:slug/branding` once per request, resolves brand + bootstrap + style. Tenant slug from `host`/`x-tenant-slug` header (no subdomain yet) — single route `[slug]` reads slug from path or header; `middleware.ts` owns header provenance and overwrites any client value (empty on staff/root paths)                                                                                                                                                                                                                                                   | Reuse staff layout, reuse staff `fetchResolvedBrand`                       | Staff and portal must stay separate (PRD §26, ADR-001); reusing the staff path would leak session cookies and a staff-only DTO surface.                                                                    |
| D8  | Appearance        | Extend `appearance.ts` with `appearanceBootstrapScriptWithTenantDefault(tenantDefault?)`: explicit local `light`/`dark` > tenant `defaultAppearance` > `matchMedia('(prefers-color-scheme: dark)')` > Core light. Local `"system"` defers to tenant → OS → Core. `ResolvedBrand.defaultAppearance` carries the tenant layer only (stays `undefined` when absent) so absence defers to OS; the `localStorage` read is isolated so storage failures still fall through to tenant/OS. `AppearanceToggle` defers (system) when no stored preference exists and keeps the runtime `matchMedia` listener only while local = `"system"` AND tenant default is absent | Global CSS `prefers-color-scheme` only, no local override                  | Spec pins this order verbatim; pre-paint script guarantees no FOUC.                                                                                                                                        |
| D9  | Audit             | Reuse `AuditWriter.append()` with new actions `branding.asset.created`, `branding.asset.replaced`, `branding.asset.removed`. Co-commit in the same `$transaction` that writes the `TenantBranding` row + retires the prior asset                                                                                                                                                                                                                                                                                                                                                                                                                              | Async emit                                                                 | Existing pattern in `BrandingService.update`; preserves audit-or-rollback invariant (see existing `branding atomicity` integration test). Spec pins the initial upload action as `branding.asset.created`. |
| D10 | Rollout           | Add `custom_branding` entitlement gate on upload + replace/remove; new routes ship disabled behind `BRANDING_ASSETS_ENABLED` env flag (default off); preset fallback retained everywhere                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Always-on                                                                  | DEC-004 mandates migration behind the entitlement; env flag gives a single-toggle kill switch that reverts consumers to preset identity without data loss.                                                 |

## Data Flow

```text
   staff upload (multipart)                                   portal (unauthenticated)
   ────────────────────────                                   ───────────────────────
   POST /branding/assets/{kind}                                GET /{slug}  ──▶  (portal)/layout.tsx
          │                                                            │
          ▼                                                            ▼
   AuthGuard → BrandingController  (RequirePermissions + entitlement)   │
          │                    │                                        ▼
          ▼                    ▼                                  fetch /api/v1/public/tenants/:slug/branding
   FileUploadPipe ─▶ StoragePort.put(opaqueKey, stream)                    │
   (mime + size)              │                                            ▼
                              ▼                                   PublicBrandingController
                       BrandingService.upload                       (slug → tenantId → row → URL sign)
                              │                                            │
                              ▼                                            ▼
                       prisma.$transaction                              ResolvedPublicBrand
                       ├─ BrandingAsset.create                                  │
                       ├─ TenantBranding.update (asset FK + updatedAt)         │
                       ├─ StoragePort.delete(prior asset key)                   │
                        └─ AuditWriter.append(branding.asset.created)           ▼
                              │                                          brandStyleCss + bootstrap
                              ▼                                                  │
                       invalidate cache entry                                   ▼
                       (rev bump visible to next public read)            pre-paint style tag
```

## File Changes

| File                                                                     | Action | Description                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/database/prisma/schema.prisma`                                 | Modify | Add `BrandingAsset` model (UUID, tenantId, kind enum `LOGO_LIGHT/LOGO_DARK/FAVICON`, assetKey, contentType, byteSize, sha256, uploadedByUserProfileId, timestamps, unique `[tenantId, kind]`). Add 3 nullable FK columns + `displayName String?` on `TenantBranding`.            |
| `packages/database/prisma/migrations/<ts>_branding_assets/`              | Create | Additive Prisma migration (no data backfill needed; existing rows keep null asset FKs).                                                                                                                                                                                          |
| `apps/api/src/storage/` (new dir)                                        | Create | `StoragePort` interface, `StorageKeys` (opaque-key factory), `S3StorageDriver`, `InMemoryStorageDriver`. Module registered in `AppModule`.                                                                                                                                       |
| `apps/api/src/storage/storage.module.ts`, `storage.constants.ts`         | Create | DI tokens for the driver; TTL constant (300s for signed URLs).                                                                                                                                                                                                                   |
| `apps/api/src/branding/branding-asset.service.ts`                        | Create | `upload/remove/getSignedUrl`; coordinates pipe + transaction + audit + cache bust.                                                                                                                                                                                               |
| `apps/api/src/branding/branding-asset.controller.ts`                     | Create | `POST /branding/assets/:kind` (multipart), `DELETE /branding/assets/:kind`. Reuses `RequirePermissions("branding.settings.manage")` + entitlement check.                                                                                                                         |
| `apps/api/src/branding/branding-asset.pipe.ts`                           | Create | Fastify multipart → stream consumer with MIME magic-byte sniff (`file-type`), size cap, hash capture. Returns `{ buffer, contentType, byteSize, sha256 }` or throws domain error.                                                                                                |
| `apps/api/src/branding/branding.service.ts`                              | Modify | `get()` resolves signed URLs via `BrandingAssetService.getSignedUrl` after loading the row. `update()` no longer touches assets (assets are owned by the asset service).                                                                                                         |
| `apps/api/src/branding/branding-resolver.ts`                             | Modify | `resolveBrand` returns `assets` URLs only (signed); staff and public surfaces share one revision-keyed cache entry and emit the canonical public API-local HMAC URL, so both render the same resolved identity. Management responses keep the protected relative URL separately. |
| `apps/api/src/branding/dto.ts`                                           | Modify | `ResolvedBrand.assets?: { logoLightUrl?, logoDarkUrl?, faviconUrl? }`; `PublicBrandingDto` adds the same 3 URL fields; private `BrandingResponse` adds `assets`.                                                                                                                 |
| `apps/api/src/branding/public-branding.controller.ts`                    | Modify | Calls signer; adds an assertion test that emitted JSON excludes private fields.                                                                                                                                                                                                  |
| `apps/api/src/branding/public-branding-asset.controller.ts`              | Create | `@Public()` anonymous `GET /api/v1/public/branding/assets/:kind/content?token=`; HMAC token only, no session/permission/tenant context; streams the bound asset without exposing storage internals.                                                                              |
| `apps/api/src/branding/branding-cache.ts`                                | Create | `BrandingCache` port + in-memory implementation; revision helper `computeRevision(tenantBranding, assets)`.                                                                                                                                                                      |
| `apps/api/src/main.ts`                                                   | Modify | Register `@fastify/multipart` with size cap = max favicon (512 KB) as global ceiling (per-route cap enforced in pipe). Add `file-type` to `apps/api/package.json`.                                                                                                               |
| `apps/api/src/branding/branding.module.ts`                               | Modify | Import `StorageModule`; export `BrandingAssetService`.                                                                                                                                                                                                                           |
| `apps/api/src/branding/branding.integration.test.ts`                     | Modify | New cases: valid PNG upload, 3 MB PNG → 413, disguised-exe PNG → 400, cross-tenant upload → 404, missing entitlement → 403, replacement revokes old URL, public DTO contains only URLs (never keys), public cache invalidation on asset replace.                                 |
| `apps/api/src/branding/branding-asset.service.test.ts`                   | Create | Unit tests with in-memory storage: replacement invalidation, idempotent remove, audit co-commit, cache revision bump.                                                                                                                                                            |
| `apps/web/src/lib/appearance.ts`                                         | Modify | New `appearanceBootstrapScriptWithTenantDefault(defaultAppearance, presetColors?)` honoring precedence; `systemValue` literal exported.                                                                                                                                          |
| `apps/web/src/components/shell/appearance-toggle.tsx`                    | Modify | 3-state selector (Light / Dark / System); persists `"system"`; attaches `matchMedia` listener only while system-mode + no tenant default override.                                                                                                                               |
| `apps/web/src/lib/appearance.test.ts`                                    | Modify | New cases: local `system` + tenant dark → dark; local `system` + no tenant + OS dark → dark; local `light` beats tenant dark; corrupt local → tenant/OS/Core fallbacks.                                                                                                          |
| `apps/web/src/app/(app)/app/settings/branding/branding-form.tsx`         | Modify | Add `Logo light / dark / favicon` upload controls (file input, size, MIME feedback) + Remove button; preview uses signed URLs from the same `ResolvedBrand`.                                                                                                                     |
| `apps/web/src/app/(app)/layout.tsx`                                      | Modify | Pass tenant defaultAppearance + signed asset URLs to `Topbar`; `Topbar` renders the logo when present.                                                                                                                                                                           |
| `apps/web/src/components/shell/topbar.tsx`                               | Modify | Add optional `productLogoUrl?` prop; render `<img>` only when set; explicit width/height attributes.                                                                                                                                                                             |
| `apps/web/src/app/(portal)/layout.tsx`                                   | Create | Reads tenant slug from path or `x-tenant-slug` header; calls `GET /api/v1/public/tenants/:slug/branding` server-side with `cache: "no-store"`; emits the same `<style>` + bootstrap pattern as staff. Renders `{children}`. No cookies forwarded.                                |
| `apps/web/src/app/(portal)/[slug]/page.tsx`                              | Create | Minimal portal landing page that proves the layout applies public branding; shows `<TenantHeader>` consuming the same DTO.                                                                                                                                                       |
| `apps/web/src/components/portal/tenant-header.tsx`                       | Create | Renders `logoLightUrl`, `logoDarkUrl` (via `<picture>` + `prefers-color-scheme`), `faviconUrl`, and the resolved primary/accent tokens. No client-side fetches.                                                                                                                  |
| `apps/web/src/app/api/branding/assets/[kind]/route.ts`                   | Create | Web proxy that forwards the multipart body to the API with the staff cookie; new endpoint mirrors the reset route pattern.                                                                                                                                                       |
| `apps/web/src/app/(portal)/layout.test.tsx`                              | Create | Snapshot: emitted `<style>` contains tenant primary; bootstrap honors tenant default.                                                                                                                                                                                            |
| `apps/web/src/app/(app)/app/settings/branding/branding-preview.test.tsx` | Modify | Assert preview renders the uploaded logo URL once assets land.                                                                                                                                                                                                                   |
| `apps/api/test/support/in-memory-database.ts`                            | Modify | Register the in-memory `StorageDriver` in `bootedTestApp`.                                                                                                                                                                                                                       |
| `openspec/changes/.../design.md`                                         | Create | This file.                                                                                                                                                                                                                                                                       |
| `docs/05-modules/Branding.md`                                            | Modify | Document new asset endpoints, revision cache, and portal consumption path (Story-finish obligation).                                                                                                                                                                             |

## Interfaces / Contracts

```ts
// packages/database — additive Prisma model (TS shape)
type BrandingAssetKind = "LOGO_LIGHT" | "LOGO_DARK" | "FAVICON";

interface BrandingAssetRow {
  id: string; // UUID
  tenantId: string; // UUID, FK tenant.id
  kind: BrandingAssetKind;
  assetKey: string; // opaque, random 128-bit base64url
  contentType:
    "image/png" | "image/webp" | "image/x-icon" | "image/vnd.microsoft.icon";
  byteSize: number; // 1..2_097_152 (logo) / 1..524_288 (favicon)
  sha256: string; // hex; integrity + idempotency
  uploadedByUserProfileId: string;
  createdAt: Date; // timestamptz UTC
}

// apps/api/src/storage/storage.port.ts
export interface StoragePort {
  put(args: {
    key: string;
    body: Buffer;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<{ key: string; byteSize: number }>;
  delete(args: { key: string }): Promise<void>;
  signedUrl(args: { key: string; expiresInSeconds: number }): Promise<string>; // throws if key retired
}

// apps/api/src/branding/dto.ts — delta
export interface ResolvedAssets {
  readonly logoLightUrl?: string;
  readonly logoDarkUrl?: string;
  readonly faviconUrl?: string;
}
export interface ResolvedBrand {
  /* existing */
  defaultAppearance?: DefaultAppearance; // tenant layer only; absent defers to OS
  readonly assets?: ResolvedAssets;
}
export interface PublicBrandingDto {
  /* existing fields */ readonly assets?: ResolvedAssets;
}

// apps/api/src/branding/branding-cache.ts
export interface BrandingCache {
  getOrLoad<T>(args: {
    tenantId: string;
    revision: string;
    loader: () => Promise<T>;
  }): Promise<T>;
  invalidate(args: { tenantId: string }): void;
}

// apps/web/src/lib/appearance.ts — new function
export function appearanceBootstrapScriptWithTenantDefault(
  defaultAppearance: DefaultAppearance
): string;
// precedence: stored "light"|"dark" > tenantDefault > matchMedia dark > light
```

Limits: logo `≤ 2 MB` (2_097_152 B); favicon `≤ 512 KB` (524_288 B). Signed URL
TTL: `300s`. Cache TTL: `300s` (matches signed URL — no longer than the URL is
useful).

## Testing Strategy

| Layer             | What                                                                                                                                                                | Approach                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Unit (api)        | `BrandingAssetService` upload/replace/remove; cache revision bump; audit co-commit                                                                                  | Vitest with in-memory `StorageDriver`; assert transaction rollback when audit throws (mirrors `branding atomicity` test). |
| Unit (api)        | `FileUploadPipe` magic-byte sniff; size cap; SVG/exe rejection                                                                                                      | Vitest with synthetic buffers.                                                                                            |
| Unit (web)        | `appearanceBootstrapScriptWithTenantDefault` precedence matrix                                                                                                      | Vitest + jsdom; run via `new Function(script)()`.                                                                         |
| Unit (web)        | `AppearanceToggle` system mode + `matchMedia` listener attach/detach                                                                                                | Vitest + jsdom; mock `matchMedia`.                                                                                        |
| Integration (api) | Upload happy/sad paths, cross-tenant 404, missing-entitlement 403, replacement revokes prior URL, public DTO never leaks keys, public cache invalidation on replace | Supertest on `bootedTestApp` (existing harness); add `BrandingAsset` rows + multipart helpers.                            |
| Integration (web) | Portal `(portal)/layout.tsx` emits tenant style + bootstrap without staff cookie; staff and portal render identical brand tokens for the same tenant                | Vitest with `msw` mocking the public endpoint.                                                                            |
| E2E               | Deferred — no Playwright target in MVP; covered by integration + portal layout snapshot.                                                                            |

## Migration / Rollout

Additive Prisma migration. No data backfill — existing `TenantBranding` rows
keep NULL asset FKs and the preset fallback remains. Rollout: (1) merge schema +
storage port behind `BRANDING_ASSETS_ENABLED=false`; (2) enable for one pilot
tenant via entitlement + flag; (3) verify signed-URL latency + cache hit ratio;
(4) flip flag for all entitled tenants. Rollback: disable flag + remove
entitlement grants; rows + assets retained; consumers re-read preset identity.
TD-009 closes only after verification with a delivery reference, per DEC-004.

## Open Questions

- [ ] Does the MVP object-storage target ship in this slice (LocalStack/MinIO
      container) or do we land with the in-memory driver and treat S3 as a
      follow-up? Recommended: in-memory driver + LocalStack in `docker-compose`
      for local only; production driver as a separate Story.
- [ ] Confirm signed-URL TTL of 5 minutes with design/security before merge.
- [ ] Portal tenant-slug resolution: path `/[slug]` for MVP, subdomain as
      follow-up — confirm acceptable for the first portal surface.
- [ ] Antivirus scanning is in TD-009 but not in DEC-004 scope; flag for a
      future Story rather than expanding this slice.
