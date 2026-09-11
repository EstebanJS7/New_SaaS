---
id: TD-009
type: tech-debt
title:
  Defer logo/favicon uploads, portal brand consumption, and system appearance
  mode for Branding
status: open
severity: medium
related_epics:
  - EPIC-03
related_stories:
  - BRAND-004
  - BRAND-005
  - BRAND-006
related_decisions:
  - DEC-004
  - DEC-005
created: 2026-09-08
updated: 2026-09-11
---

# TD-009 — Defer logo/favicon uploads, portal brand consumption, and system appearance mode for Branding

## Resolution

**Implemented on 2026-09-10; reconciliation updated 2026-09-11; not yet
resolved** pending the deferred virus scanning and reset-cleanup dead-letter
alerting/retention, and the pending commit. The 2026-09-11 fresh root
verification (Engram verify-report #2144) passed all five root gates on
candidate `2a637cfd…` (`evidence_revision sha256:9eb9ef6e…`; 0 blockers, 10/10
requirements, 16/16 scenarios): `pnpm lint`, `pnpm format-check`,
`pnpm typecheck`, `pnpm test` (API 359 passed / 5 skipped; web 91; worker 27;
database 85; shared 16), and `pnpm build`. The pre-correction failing gate was
`pnpm format-check` (six unformatted files), now formatted. This documentation
correction's own root-gate verification also completed on 2026-09-11 (Engram
verify-report #2170, verdict `pass`): all five root gates exited 0 on candidate
`sha256:d7aaf517b471b7ca527d35a00051bcc3bbcf43039ee9df1965524facdaad015e` (0
blockers, 6/6 requirements, 8/8 scenarios). The DEC-004 implementation is
present as uncommitted working-tree changes; correction passes changed the audit
action to `branding.asset.created`, added anonymous public asset delivery,
corrected the appearance precedence, added tenant-isolation and
token-expiry/tamper coverage, and made reset storage retirement durable.

**Delivery reference:**
`openspec/changes/2026-09-08-dec-004-branding-expansion/` (feature-branch-chain
PR 1 → PR 2 → PR 3; tasks 1.1–4.2), with the durable-reset-cleanup remediation
in the Engram change `2026-09-11-branding-commit-readiness-remediation` (units
U1–U6). The resolving change is currently present as uncommitted working-tree
changes on `main`; the commit/PR link is created by the orchestrator when the
chain is committed, since this closure slice is not authorized to commit or
push.

**Inactive-slug criterion delivered (2026-09-11):** the previously unresolved
half of the portal slug requirement is now representable and implemented.
[[DEC-005]] was accepted on 2026-09-11 and [[ADR-004 Tenant Lifecycle Status]]
(accepted 2026-09-11) introduces the additive Core `TenantStatus` enum (`ACTIVE`
default / `SUSPENDED`, migration `20260911000001_tenant_lifecycle`). The public
branding lookup is restricted to `ACTIVE`, so a `SUSPENDED` slug returns the
identical `404 NOT_FOUND` envelope as an unknown slug. See
`docs/07-decisions/DEC-005-inactive-tenant-slug-branding.md` and
`docs/04-adrs/ADR-004-tenant-lifecycle-status.md`.

**Implementation:** tenant asset lifecycle (`BrandingAsset`, migration
`20260908000001_branding_assets`, `StoragePort`, signed-URL delivery, strict
MIME/size validation, audit co-commit), portal consumption of the allowlisted
public DTO (`(portal)/layout.tsx`, `[slug]/page.tsx`,
`components/portal/tenant-header.tsx`), and `system` appearance precedence
(`appearanceBootstrapScriptWithTenantDefault`). See `apps/api/src/branding/**`,
`apps/web/src/lib/appearance.ts`,
`apps/web/src/components/shell/appearance-toggle.tsx`, and
`docs/05-modules/Branding.md`.

**Durable reset cleanup:** `POST /branding/reset` deletes the tenant branding
row and every linked `BrandingAsset` row in one `$transaction` and never deletes
storage objects in-request. The same transaction co-commits the `branding.reset`
audit (`hadAssets`, prior asset ids/keys) and, when objects were disconnected,
exactly one `PENDING` `BrandingResetCleanupIntent` capturing the opaque keys
(additive migration `20260911000002_branding_reset_cleanup_intent`). After
commit the API enqueues the intent id (`jobId = intentId`) on the
`branding-reset-cleanup` queue; enqueue failure is non-fatal and leaves the
intent `PENDING`. The worker retires only the captured keys idempotently and
performs a guarded `PENDING → COMPLETED` transition with exactly one SYSTEM
`branding.reset.storage_retired` audit. Retries are bounded (five attempts,
exponential backoff); exhaustion sets terminal `DEAD_LETTER` with a sanitized
`lastError` and one SYSTEM `branding.reset.storage_cleanup_failed` audit. A
worker interval sweep re-enqueues `PENDING` intents older than a threshold.

**Verification evidence:** branding-focused suites pass in isolation (`apps/api`
branding integration/service suites; `apps/web`
appearance/toggle/portal/app-layout/middleware suites; `@newsaas/ui` branding
36/36; API/Web/UI lint and typecheck green). The 2026-09-11 fresh root
verification (Engram verify-report #2144) ran the full gate chain and all five
gates exited 0 on candidate `2a637cfd…` (`evidence_revision sha256:9eb9ef6e…`; 0
blockers, 10/10 requirements, 16/16 scenarios): `pnpm lint`,
`pnpm format-check`, `pnpm typecheck`, `pnpm test` (API 359 passed / 5 skipped;
web 91; worker 27; database 85; shared 16), and `pnpm build`. The pre-correction
failing gate was `pnpm format-check` (six unformatted files), now formatted.
This documentation correction's own root-gate verification also completed on
2026-09-11 (Engram verify-report #2170, verdict `pass`): all five root gates
exited 0 on candidate
`sha256:d7aaf517b471b7ca527d35a00051bcc3bbcf43039ee9df1965524facdaad015e`. The
record is not closed because the deferred sub-items below and the feature-branch
chain commit remain pending.

## Context

DEC-004 — Expand EPIC-03 Branding scope to resolve TD-009 was accepted on
2026-09-08 (Option A). This debt item is now scheduled for implementation; it is
not yet resolved and must remain open until delivery verification.

EPIC-03 Phase B shipped tenant branding persistence, the private management API,
public safe DTO, server-side brand resolution, staff settings UI with bounded
live preview, and client-local `light`/`dark` appearance persistence. All
required acceptance criteria that do not depend on the three items below are
evidence-passing and recorded in the EPIC-03 task and verify artifacts.

Three scope items were originally deferred by this record. They are now
**implemented** by DEC-004, present as uncommitted working-tree changes pending
the feature-branch chain commit:

1. **Controlled logo/favicon uploads — implemented.** `BrandingAsset`, the
   `StoragePort` boundary, strict MIME/size validation, signed-URL delivery, and
   the audit-co-committed upload/replace/remove endpoints exist (see
   `apps/api/src/branding/**` and migration `20260908000001_branding_assets`).
2. **Portal brand consumption — implemented.** `(portal)/layout.tsx`,
   `[slug]/page.tsx`, and `components/portal/tenant-header.tsx` consume the
   allowlisted public DTO (`GET /api/v1/public/tenants/:slug/branding`) without
   staff cookies; the staff shell and the settings preview render the same
   canonical anonymous public asset URL, and anonymous asset bytes are served by
   the token-verified public content route.
3. **`system` appearance mode — implemented.** `apps/web/src/lib/appearance.ts`
   supports `light`/`dark`/`system` with precedence local > tenant default > OS
   `prefers-color-scheme` > Core light, applied pre-paint by a parser-blocking
   bootstrap (root layout owns the tenant-aware script).

## Debt

The three scope items are implemented and the inactive-slug criterion is now
delivered. What remains is closure hygiene plus explicitly deferred sub-items:

- **Inactive-slug criterion — delivered (2026-09-11).** [[DEC-005]] was accepted
  and [[ADR-004 Tenant Lifecycle Status]] adds the additive `TenantStatus` enum;
  the public lookup filters `ACTIVE`, so a `SUSPENDED` slug is indistinguishable
  from an unknown slug. No residual gap remains here.
- **Virus scanning at the storage boundary — deferred.** The asset lifecycle
  validates declared MIME against content, size, and SHA-256, but does not scan
  for malware. This sub-item was not delivered by DEC-004.
- **Reset cleanup dead-letter alerting/retention — deferred.** Terminal
  `DEAD_LETTER` cleanup intents are persisted and audited, but no operator alert
  is wired and completed/dead-letter intent rows have no archival policy yet;
  this is a candidate for a new Tech Debt item.
- Root verification is green. The 2026-09-11 fresh root verification (Engram
  verify-report #2144) showed all five gates exit 0 on candidate `2a637cfd…`
  (`evidence_revision sha256:9eb9ef6e…`; 0 blockers, 10/10 requirements, 16/16
  scenarios): `pnpm lint`, `pnpm format-check`, `pnpm typecheck`, `pnpm test`,
  and `pnpm build`. The pre-correction failing gate was `pnpm format-check` (six
  unformatted files), now formatted. This documentation correction's own
  root-gate verification also completed all-green on 2026-09-11 (Engram
  verify-report #2170) against candidate
  `sha256:d7aaf517b471b7ca527d35a00051bcc3bbcf43039ee9df1965524facdaad015e`; the
  record remains open only for the deferred sub-items and the pending commit.
- The feature-branch chain is intentionally uncommitted in this slice, so no
  commit/PR link exists yet.

## User Impact

- Staff can upload light/dark logos and a favicon and see them in the shell and
  the settings preview through the canonical anonymous public asset URL resolved
  from `GET /branding/current`; the upload response and management endpoints
  return a relative staff-audience URL that the current settings UI does not
  render.
- Portal visitors resolve tenant/product identity from the public endpoint,
  including anonymous asset bytes; staff and portal render the same resolved
  logo URL and primary token.
- Staff can defer appearance to the OS with the `system` option; a tenant
  `defaultAppearance` is honored pre-paint from the root layout.

## Why Closure Is Still Deferred

- The capability is verified green at the root (#2144), and this documentation
  correction's own root-gate re-verification also completed all-green on
  2026-09-11 (verify-report #2170, candidate
  `sha256:d7aaf517b471b7ca527d35a00051bcc3bbcf43039ee9df1965524facdaad015e`);
  the record stays open for the deferred sub-items and the pending commit, not
  for an unproven verification.
- Virus scanning at the storage boundary remains undelivered and must not be
  read as delivered scope.
- Reset-cleanup dead-letter alerting and intent retention policy remain
  unimplemented.
- No production tenants or end users exist yet, so the residual gaps are not
  exposed as broken features.
- No security, tenancy, or data-integrity invariant is weakened by the residual
  gaps.

## Non-Goals

- This debt does **not** authorize arbitrary CSS/JS injection, custom-domain
  provisioning, per-tenant component forks, or a generic CMS/page builder.
- It does **not** weaken tenant isolation, entitlement checks, or audit
  requirements when the deferred features are eventually implemented.
- It does **not** require lowering the existing schema validation or public-DTO
  allowlist.

## Risk

Open-but-implemented record, medium likelihood, moderate impact:

- The 2026-09-11 fresh root verification (#2144) passed all five gates (`lint`,
  `format-check`, `typecheck`, `test`, `build`) on candidate `2a637cfd…`; the
  pre-correction failing gate was `format-check` (six files), now formatted.
  This documentation correction's own root-gate re-verification also completed
  all-green on 2026-09-11 (verify-report #2170) against candidate
  `sha256:d7aaf517b471b7ca527d35a00051bcc3bbcf43039ee9df1965524facdaad015e`; the
  record remains open for the deferred sub-items and the pending commit.
- Reset cleanup is asynchronous: a reset-orphaned object is retired only after
  the worker drains the committed `PENDING` intent (or the sweep re-enqueues
  it), and terminal `DEAD_LETTER` intents have no operator alert yet.
- Virus scanning remains deferred and must not be reported as delivered.
- The feature-branch chain is uncommitted, so the delivery reference is
  incomplete.

No security, tenancy, or data-integrity invariant is weakened.

## Affected Phase B Behavior

- The branding settings page edits scalar theme properties plus logo/favicon
  assets. Save does not clear uploaded assets; Reset deletes the tenant branding
  row and every linked `BrandingAsset` row and queues durable storage
  retirement.
- The public branding endpoint is consumed by the portal surface.
- The staff appearance toggle offers `light`, `dark`, and `system`.

## Proposed Resolution

Partially delivered by DEC-004 (see Resolution above); retained for history. The
delivered subset is the asset lifecycle, signed-URL delivery, portal
consumption, and `system` appearance described above. The virus-scanning step
listed below was **not** delivered by DEC-004 and remains deferred; it must not
be read as delivered scope.

1. **Asset uploads:**
   - Introduce a `BrandingAsset` aggregate with storage-backed file records,
     signed URLs, and strict MIME/size validation. _Delivered by DEC-004._
   - Virus scanning at the storage boundary. _Not delivered; still deferred._
   - Implement upload endpoints gated by `branding.settings.manage` plus the
     `custom_branding` entitlement.
   - Update `ResolvedBrand` and the public DTO to include asset URLs and consume
     them in staff shell and portal layouts.
2. **Portal consumption:**
   - Create portal route(s) that fetch public branding by tenant slug and apply
     the resolved CSS variables through the same `BrandProvider`/resolver
     contract used by staff.
3. **System appearance:**
   - Extend `apps/web/src/lib/appearance.ts` to support `"system"` and use
     `matchMedia('(prefers-color-scheme: dark)')` when no explicit local
     override exists.
   - Preserve documented precedence: explicit local choice > tenant default >
     system preference > Core default.
   - Add tests covering system-mode fallback and tenant-default precedence.

## Trigger / Target

Re-entry was triggered by DEC-004 on 2026-09-08; implementation is present, the
inactive-slug criterion is delivered ([[DEC-005]] / [[ADR-004 Tenant Lifecycle
Status]], 2026-09-11), and the record remains open pending the feature-branch
chain commit and the deferred virus-scanning and reset-cleanup sub-items.

Must be resolved (record closed) before broad production onboarding where brand
identity matters.

## Verification After Resolution

- [x] Upload endpoint rejects non-image files, oversized files, and untrusted
      MIME types.
- [x] Upload endpoint is gated by `branding.settings.manage` and the
      `custom_branding` entitlement. The API accepts no client-supplied tenant
      id (tenant is authoritative from the request context), so cross-tenant
      read/replacement/removal is proven as tenant-relative isolation
      (`404`/`removed: false`) rather than a foreign-target `404`.
- [x] Uploaded assets appear in `ResolvedBrand` and the public DTO with signed
      URLs; both the staff resolved-brand endpoint and the public DTO emit the
      canonical absolute anonymous-route URL. Management responses return the
      protected relative content route, which the current settings UI does not
      render.
- [x] Staff shell renders tenant logo/favicon when overrides exist, using the
      canonical anonymous public URL; the relative staff-audience URL can be
      served by the staff web content proxy
      (`apps/web/src/app/branding/assets/[kind]/content/route.ts`), which
      forwards the staff cookie to the protected API content route, but no
      current settings UI renders it. Browser-level delivery remains covered by
      focused proxy tests, with full E2E deferred to
      [[TD-007 Playwright E2E deferred]].
- [x] Portal route applies tenant/product branding from the public endpoint; the
      anonymous token route serves the bytes (browser E2E remains deferred to
      [[TD-007 Playwright E2E deferred]]).
- [x] Appearance selector offers `system` and falls back to OS preference when
      no local override exists; an absent tenant default no longer collapses to
      Core `light` before the bootstrap.
- [x] `system` precedence is covered by unit/integration tests, including OS
      fallback with no tenant default and inaccessible-storage fallback.
- [x] `docs/05-modules/Branding.md` no longer lists these items as deferred.
- [x] Inactive-slug criterion delivered: [[DEC-005]] was accepted and
      [[ADR-004 Tenant Lifecycle Status]] introduced the additive `TenantStatus`
      enum; a `SUSPENDED` slug returns the identical `404 NOT_FOUND` envelope as
      an unknown slug (migration `20260911000001_tenant_lifecycle`).
- [x] Reset storage retirement is durable and retryable: reset co-commits one
      `PENDING` cleanup intent (or none when nothing was disconnected); the
      worker retires only the captured keys with a guarded completion plus a
      SYSTEM retirement audit; bounded retries reach a terminal `DEAD_LETTER`
      with a SYSTEM failure audit; and an interval sweep re-enqueues stale
      `PENDING` intents.
- [ ] This record is closed. This documentation correction's own root-gate
      verification completed on 2026-09-11 (Engram verify-report #2170, verdict
      `pass`): all five gates exited 0 on candidate
      `sha256:d7aaf517b471b7ca527d35a00051bcc3bbcf43039ee9df1965524facdaad015e`
      (`pnpm lint`, `pnpm format-check`, `pnpm typecheck`, `pnpm test`, and
      `pnpm build`). The record stays open only for the deferred virus scanning
      and reset-cleanup dead-letter alerting/retention, and because the
      commit/PR link is pending: the feature-branch chain is intentionally
      uncommitted in this slice.
