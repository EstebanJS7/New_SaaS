---
type: module
module: branding
status: active
updated: 2026-09-11
---

# Module — Branding

## Responsibility

Resolve the visual identity used by staff UI and customer portal from Core
defaults, product preset and tenant overrides.

## Does Not Own

- Veterinary domain behavior.
- Authentication itself.
- Tenant subscriptions, except querying Entitlements.
- Private clinical files.
- Custom-domain provisioning.

## Main Concepts

```text
CoreDesignDefaults
ProductBrandPreset
TenantBranding
ResolvedBrand
BrandingAsset
```

## Permissions

```text
branding.settings.manage
```

Granted to `OWNER` and `ADMIN` by the reference seed.

## Entitlement

```text
custom_branding
```

## API

Private (staff, authenticated):

```text
GET   /branding/current               — resolved brand for the active tenant (includes signed asset URLs)
PUT   /branding/current               — update tenant overrides (manage + entitlement)
POST  /branding/reset                 — remove tenant overrides (manage + entitlement)
POST  /branding/assets/:kind          — upload/replace :kind (logoLight|logoDark|favicon) (manage + entitlement + flag)
GET   /branding/assets/:kind          — current signed content URL for :kind (manage)
GET   /branding/assets/:kind/content  — stream asset bytes by signed token (manage; never exposes keys/buckets/paths)
DELETE /branding/assets/:kind         — remove :kind (manage + entitlement + flag)
```

Public (unauthenticated, allowlisted DTO only):

```text
GET   /api/v1/public/tenants/:slug/branding
```

Web proxy routes (staff session cookie forwarded):

```text
GET    /api/branding/current
POST   /api/branding/reset
POST   /api/branding/assets/[kind]
DELETE /api/branding/assets/[kind]
```

Asset routes are additionally gated by the `BRANDING_ASSETS_ENABLED` runtime
flag (default `false`). Signed asset URLs are HMAC-signed with
`BRANDING_ASSET_URL_SECRET` and expire after 300 seconds.

## Invariants

- Tenant overrides are schema validated.
- No arbitrary CSS/JS.
- Shared components consume semantic tokens.
- Public DTO is allowlisted and fails closed if a private field is emitted.
- Tenant isolation applies to admin configuration and asset mutations.
- Reset removes tenant overrides and deletes every linked `BrandingAsset` row in
  the same transaction; the product preset is never mutated. The cleanup
  co-commits a `branding.reset` audit recording `hadAssets`, the prior asset
  ids, and the prior storage keys, plus one `PENDING` cleanup intent when
  objects were disconnected, so a same-kind re-upload after reset succeeds
  without a `P2002` conflict. Storage objects are retired asynchronously and
  durably, never in-request.
- Branding assets are tenant-owned; only opaque storage keys persist
  server-side.
- Clients receive short-lived signed URLs, never bucket names, object keys, or
  provider paths.
- Asset mutations require `branding.settings.manage` + `custom_branding` +
  `BRANDING_ASSETS_ENABLED`, and co-commit an audit row.
- `STORAGE_S3_BUCKET` is mandatory in production when branding assets are
  enabled; the API and worker fail fast at boot instead of silently using
  process-local in-memory storage.

## Foundation baseline (EPIC-00)

EPIC-00 establishes the brand-resolution layers but does **not** implement
product presets or tenant overrides. The shipped foundation is:

- `packages/ui/src/branding/core-defaults.ts` — neutral `CoreDesignDefaults`
  using semantic tokens (`background`, `foreground`, `primary`, `border`,
  `ring`, etc.).
- `packages/ui/src/branding/brand-theme.schema.ts` — Zod schema that rejects
  arbitrary CSS/JS and constrains colors to `hsl()` or hex, radius to rem, and
  fonts to approved stacks.
- `packages/ui/src/branding/types.ts` — forward-declared `BrandTheme` type.

No tenant resolution, no asset upload, and no Veterinary-specific colors are
present in EPIC-00.

## Implemented public behavior

### EPIC-03 Phase A — token layer and preset

- **Token layer**: complete semantic set in `apps/web/src/app/globals.css`
  including the `--popover` pair and a full `.dark` block with light/dark parity
  enforced by scan tests. Shared components consume tokens only; source scans
  reject literal hex/HSL colors and palette utilities.
- **Veterinary preset**: `Clinical Precision`
  (`packages/ui/src/branding/presets/veterinary-default.ts`) is a complete,
  schema-valid `ProductBrandPreset`.
- **Resolver chain**: `resolveBrand` deep-merges core defaults ← preset ← tenant
  patch into a `ResolvedBrand`.
- **Override schema v1**: `brandOverrideSchema`
  (`BRAND_OVERRIDE_SCHEMA_VERSION = 1`) accepts strict camelCase subsets
  (`primary`, `accent`, `radius`, `defaultAppearance`) with stable error codes.
- **Appearance persistence (client-local)**:
  `localStorage["newsaas.appearance"]` stores `"light" | "dark"`. A
  parser-blocking bootstrap script applies a stored `dark` before first paint;
  the shell toggle flips `<html>.dark` without reload. Valid local appearance
  always wins; tenant `defaultAppearance` is only the fallback bootstrap input.
  A `"system"` option that follows the OS `prefers-color-scheme` preference is
  deferred to [[TD-009 Branding scope deferred]]. Live cross-tab synchronization
  is **not** implemented in Phase B; the accepted deferral is recorded in
  [[TD-008 Cross-tab appearance sync deferred]].
- **Staff shell skeleton**: chrome-only `/app` route group (sidebar, topbar,
  bounded `<main data-shell-content>` region) composed from shadcn Button/Card
  primitives.

### EPIC-03 Phase B — tenant overrides and admin surface

- **Persistence**: one `tenant_branding` row per tenant (`tenant_id` UNIQUE),
  versioned JSON overrides, `updated_by` relation, additive migration.
- **Private API**: `GET /branding/current`, `PUT /branding/current`,
  `POST /branding/reset`. Reads require authentication + active membership;
  writes require `branding.settings.manage` plus the `custom_branding`
  entitlement.
- **Audit**: every successful write/reset co-commits an `audit_log` row in the
  same transaction (`branding.updated` / `branding.reset`).
- **Public API**: `GET /api/v1/public/tenants/:slug/branding` returns only the
  PUBLIC allowlist (`productDisplayName`, `primary`, `accent`, `radius`,
  `defaultAppearance`; extended in Phase C with `displayName` and signed asset
  URLs); 404 on unknown slug.
- **Server resolution**: staff layout resolves the full brand server-side and
  injects `brandStyleCss` as a parser-blocking `<style>` tag.
- **Settings UI**: `/app/settings/branding` with bounded sample-card preview,
  Save, and Reset. Preview is form-state only and never reproduces the shell.

### EPIC-03 Phase C — DEC-004 branding assets, portal, and system appearance

- **Asset aggregate**: `BrandingAsset` is tenant-owned (kind
  `LOGO_LIGHT`/`LOGO_DARK`/`FAVICON`), stores an opaque `assetKey`,
  `contentType`, `byteSize`, `sha256`, and `uploadedBy`, with
  `@@unique([tenantId, kind])`. `tenant_branding` gains three nullable asset
  FKs. Additive migration `20260908000001_branding_assets`; existing rows keep
  NULL FKs and the preset fallback.
- **Storage boundary**: `StoragePort` with in-memory and S3-compatible drivers.
  Management responses (upload/replace) return the relative protected
  `/branding/assets/:kind/content?token=` URL; the current settings preview does
  not render it. Resolved-brand rendering unifies on the canonical public
  API-local HMAC URL `/api/v1/public/branding/assets/:kind/content?token=`
  (`BRANDING_ASSET_URL_SECRET`, 300-second TTL); storage keys, buckets, and
  provider paths never reach clients.
- **Production storage gate**: the API and worker env schemas fail startup when
  `NODE_ENV=production` and `BRANDING_ASSETS_ENABLED=true` without a non-empty
  `STORAGE_S3_BUCKET`, naming the variable in the validation error. The gate is
  inert outside production and when branding assets are disabled, where
  `StorageModule` keeps selecting the in-memory driver; `STORAGE_S3_ENDPOINT`,
  `STORAGE_S3_REGION`, `STORAGE_S3_KEY_PREFIX`, and AWS credentials remain
  optional. Driver selection and the storage module contract are unchanged.
- **Consistent resolved identity**: because branding assets are intentionally
  public, both the staff resolved-brand endpoint and the public portal DTO emit
  the same absolute API-origin URL (`BRANDING_ASSET_PUBLIC_BASE_URL`, default
  `http://localhost:3001`) targeting the anonymous token-verified route. Staff
  and portal therefore render the same resolved logo URL and primary token, and
  share one revision-keyed resolved-brand cache entry. Staff management and
  private content routes stay protected.
- **Validation**: magic-byte sniffing (`file-type`) accepts only PNG/WebP/ICO. A
  declared-vs-content MIME mismatch, SVG, executable, or unknown type returns
  `400`; logo > 2 MiB or favicon > 512 KiB returns `413`. SHA-256 is captured
  for integrity/idempotency.
- **Private lifecycle**: upload/replace/remove require
  `branding.settings.manage`, `custom_branding`, and
  `BRANDING_ASSETS_ENABLED=true`. Storage put/delete runs outside the database
  transaction with orphan cleanup, and the audit actions
  `branding.asset.created` / `branding.asset.replaced` /
  `branding.asset.removed` co-commit with the row/FK change and cache
  invalidation.
- **Reset lifecycle**: `POST /branding/reset` deletes the tenant branding row
  and every linked `BrandingAsset` row inside the same transaction and never
  deletes storage objects in-request. The transaction also co-commits the
  `branding.reset` audit — recording `hadAssets` (`logoLight`/`logoDark`/
  `favicon`) plus the prior asset ids and storage keys — and, when objects were
  disconnected, exactly one tenant-scoped `PENDING` `BrandingResetCleanupIntent`
  capturing those opaque keys (additive migration
  `20260911000002_branding_reset_cleanup_intent`, ordered after
  `20260911000001_tenant_lifecycle`). After commit the API enqueues the intent
  id (`jobId = intentId`) on the `branding-reset-cleanup` queue; enqueue failure
  is non-fatal and leaves the intent `PENDING` for the worker's reconciliation
  sweep. The worker retires only the captured keys idempotently and moves
  `PENDING` → `COMPLETED` through a guarded transition that writes exactly one
  SYSTEM `branding.reset.storage_retired` audit. Retries are bounded (five
  attempts, exponential backoff); exhaustion sets terminal `DEAD_LETTER` with a
  sanitized `lastError` and one SYSTEM `branding.reset.storage_cleanup_failed`
  audit. A same-kind upload after reset is never blocked by the `(tenant, kind)`
  unique constraint.
- **Tenant isolation invariant**: asset routes accept no client-supplied tenant
  id — the tenant is authoritative from the authenticated request context, so a
  "foreign target" cannot be expressed and a client tenant id is never trusted.
  Cross-tenant read/replacement/removal is therefore proven as tenant-relative
  resolution: Tenant B's context sees no matching asset (`404`, or
  `removed: false` on DELETE) and never mutates Tenant A's row. The anonymous
  public content route trusts only the HMAC token, which the server mints for a
  specific asset id.
- **Cache**: `BrandingCache` keys on tenant + a revision derived from the
  branding row and linked assets; every mutation invalidates it and replacement
  retires the previous storage object so old signed URLs fail.
- **Resolved contract**: `ResolvedBrand.assets` carries `logoLightUrl`,
  `logoDarkUrl`, and `faviconUrl` (signed URLs only); the staff shell renders
  the tenant logo when present.
- **Public DTO**: adds the three signed URL fields alongside
  `productDisplayName`, `displayName`, and theme tokens.
  `assertPublicBrandingDto` fails closed if any non-allowlisted key or a
  forbidden fragment (`assetKey`, `bucket`, `tenantId`, `updatedBy`, `audit`,
  `membership`, `ruc`, `billingSecret`) is emitted.
- **Portal**: `(portal)/layout.tsx`, `(portal)/[slug]/page.tsx`, and
  `components/portal/tenant-header.tsx` server-fetch
  `GET /api/v1/public/tenants/:slug/branding` with `cache: "no-store"` and no
  staff cookie. The slug resolves from the `[slug]` path param or the
  `x-tenant-slug` header (server-set by `middleware.ts`, which overwrites any
  client-supplied value and forwards an empty value on staff/root paths);
  `lib/public-branding.ts` maps only allowlisted fields onto `ResolvedBrand` and
  falls back to the product preset.
- **System appearance**: `appearanceBootstrapScriptWithTenantDefault(...)` and
  the exported `SYSTEM_VALUE` resolve appearance as explicit local
  `light`/`dark` > tenant `defaultAppearance` > OS `prefers-color-scheme` > Core
  `light`. `ResolvedBrand.defaultAppearance` carries the tenant layer only and
  stays `undefined` when the tenant did not set one, so the OS preference wins.
  Inaccessible storage is caught around the `localStorage` read only, preserving
  the tenant/OS fallback. `AppearanceToggle` defers (system) when no stored
  preference exists and attaches the `matchMedia` listener only while the local
  mode is `system` and no explicit tenant default overrides.

### DEC-005 — inactive tenant slug enforcement (ADR-004)

- **Public lookup**: `GET /api/v1/public/tenants/:slug/branding` resolves the
  tenant with `where: { slug, status: "ACTIVE" }`. A tenant whose `TenantStatus`
  is `SUSPENDED` is therefore absent from the lookup and follows the exact same
  `404 NOT_FOUND` envelope (`error.code = "NOT_FOUND"`) as an unknown slug — no
  existence leak, no status signal, no new error code.
- **Model**: additive `TenantStatus` enum (`ACTIVE` default / `SUSPENDED`) with
  migration `20260911000001_tenant_lifecycle`; existing tenants backfill to
  `ACTIVE`. See [[DEC-005]] and [[ADR-004]].
- **Scope fence**: no suspension command, authorization, audit or DTO change;
  active-slug resolution and the allowlisted public DTO are unchanged.

## Not yet implemented

Preset-driven dark-mode recoloring remains outstanding. Playwright E2E coverage
for the branding settings surface is deferred to
[[TD-007 Playwright E2E deferred]].

## Known limitations / blockers

- Playwright E2E coverage for branding settings is **explicitly deferred**:
  Playwright is not installed or configured in the repository; the deferral is
  formalized in [[TD-007 Playwright E2E deferred]]. The Vitest suite covers
  unit, integration, SSR CSS bridge, and bounded preview locality; a future
  change that adds Playwright should implement the settings-page E2E scenario
  before removing this note.
- Branding asset and portal E2E is **not** configured: Playwright is absent (see
  [[TD-007 Playwright E2E deferred]]). Coverage is provided by API integration
  tests plus the portal layout snapshot; a browser-level portal flow remains
  outstanding.
- The CI migrations job runs `apps/api/test/live-pg-isolation.e2e-spec.ts`
  against a disposable PostgreSQL database. It proves cross-tenant
  `404 NOT_FOUND` for Customer/Address/Contact mutations and proves that
  authorized tenant-relative TenantBranding mutations succeed for each tenant
  without affecting the other. It does **not** exercise branding cross-tenant or
  entitlement-denial paths against PostgreSQL; those remain covered by the
  in-memory Prisma boundary used by `bootTestApp` and are tracked under
  [[TD-006]].
- Live cross-tab appearance synchronization is **explicitly deferred**:
  appearance is per-tab local state only; the deferral is formalized in
  [[TD-008 Cross-tab appearance sync deferred]].
- **Reset storage retirement is asynchronous**: reset commits a `PENDING`
  cleanup intent and returns; a reset-orphaned object is retired only after the
  worker drains the intent (or the interval sweep re-enqueues a lost one).
  `DEAD_LETTER` intents are terminal and audited, but no operator alert is wired
  and completed/dead-letter intent rows are retained with no archival policy yet
  (Tech Debt candidate).
- **Root closure gates are green** (2026-09-11 fresh verification, Engram
  verify-report #2144): all five root gates exited 0 on candidate `2a637cfd…`
  (`evidence_revision sha256:9eb9ef6e…`; 0 blockers, 10/10 requirements, 16/16
  scenarios) — `pnpm lint`, `pnpm format-check`, `pnpm typecheck`, `pnpm test`
  (API 359 passed / 5 skipped; web 91; worker 27; database 85; shared 16), and
  `pnpm build`. The pre-correction failing gate was **root `pnpm format-check`**
  (six unformatted files), now formatted. This documentation correction's own
  root-gate verification also completed on 2026-09-11 (Engram verify-report
  #2170, verdict `pass`): all five root gates exited 0 on candidate
  `sha256:d7aaf517b471b7ca527d35a00051bcc3bbcf43039ee9df1965524facdaad015e` (0
  blockers, 6/6 requirements, 8/8 scenarios).
- **Asset delivery split**: resolved staff-brand and portal DTO URLs use the
  canonical anonymous public API-local HMAC URL returned by
  `GET /branding/current`; the staff settings preview and staff shell render
  that canonical public URL. Management `GET /branding/assets/:kind` and the
  upload response return the relative staff-audience URL, which the protected
  same-origin proxy at
  `apps/web/src/app/branding/assets/[kind]/content/route.ts` can serve, but no
  current settings UI renders it. Browser-level asset/portal E2E remains
  deferred to [[TD-007 Playwright E2E deferred]].

## Veterinary preset: Clinical Precision

Implemented in EPIC-03 Phase A as
`packages/ui/src/branding/presets/veterinary-default.ts`: teal primary and amber
accent over teal-tinted neutrals (hue range ~173–183), `Noto Sans` sans stack,
`0.75rem` radius scale. Tenant asset overrides (light/dark logo, favicon) are
delivered as signed URLs when configured; the preset remains the fallback when
no tenant asset exists. Live cross-tab appearance sync is accepted-deferred to
[[TD-008 Cross-tab appearance sync deferred]] and is not claimed as implemented.

## Related

- [[Branding and Theming]]
- [[ADR-002 Branding Theme Layering]]
