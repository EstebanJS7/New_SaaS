# Exploration: EPIC-03 — Staff Shell, Design System and Branding

Date: 2026-08-23 Phase: explore (research only; no application code touched)

## Verdict Summary

| #   | Acceptance Criterion                                           | Status      | Evidence                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Shared components use semantic design tokens                   | **partial** | `apps/web/src/app/globals.css` defines full shadcn token set in `:root`; `tailwind.config.ts` maps them via `hsl(var(--…))`. But there are almost no shared components yet (only `HealthIndicator`), no `.dark` token block, no shadcn/ui components installed. |
| 2   | Veterinary preset changeable without editing shared components | **missing** | No `ProductBrandPreset`, no `presets/veterinary-default.ts`, no `resolve-brand.ts`. Only `coreDesignDefaults` exists in `packages/ui/src/branding/`.                                                                                                            |
| 3   | Tenant uploads light/dark logos + favicon when entitled        | **missing** | No upload/files capability anywhere (`apps/api` has only `health`). No Prisma schema exists at all (EPIC-01 not started). No object-storage service in `docker-compose.yml` (only postgres + redis).                                                            |
| 4   | Tenant can change approved theme properties                    | **missing** | No tenant branding persistence, no settings UI, no API.                                                                                                                                                                                                         |
| 5   | Theme input is schema validated                                | **exists**  | `packages/ui/src/branding/brand-theme.schema.ts` — strict Zod: HSL/hex-only colors, rem radius, allowlisted font families. Unit-tested in `brand-theme.test.ts`.                                                                                                |
| 6   | Arbitrary CSS/JS cannot be injected                            | **partial** | Schema rejects non-conforming values client/package-side, but nothing enforces it at an API boundary yet (no API). SVG policy undecided.                                                                                                                        |
| 7   | Staff and portal consume same ResolvedBrand contract           | **missing** | No `ResolvedBrand` type, no resolver, no portal app. `BrandProvider` only forwards `--radius`.                                                                                                                                                                  |
| 8   | Missing tenant overrides fall back to product preset           | **missing** | No merge/fallback logic exists (only Core defaults layer).                                                                                                                                                                                                      |
| 9   | Reset restores product defaults                                | **missing** | Nothing to reset yet.                                                                                                                                                                                                                                           |
| 10  | Public branding endpoint exposes only safe fields              | **missing** | No tenants domain, no public routes in `apps/api`.                                                                                                                                                                                                              |
| 11  | Tenant A cannot edit Tenant B branding                         | **missing** | No auth, tenancy, or tenant context resolution (EPIC-01 planned, not implemented).                                                                                                                                                                              |
| 12  | Branding changes are audited                                   | **missing** | No audit module.                                                                                                                                                                                                                                                |
| 13  | Live preview does not persist until Save                       | **missing** | No settings page. Note: current `BrandProvider` applies theme via inline style on a wrapper div — a workable hook for local-state preview.                                                                                                                      |
| 14  | Lint/typecheck/tests/build green                               | **exists**  | EPIC-00 done: CI runs install/lint/typecheck/test/build; baseline green.                                                                                                                                                                                        |

**Counts: exists 2 · partial 2 · missing 10**

## Findings

### Current codebase state

- `apps/web/src`: minimal Next.js app. Routes: `/` (health demo page),
  `/api/health/live`. Root layout wraps `QueryProvider → BrandProvider`. **There
  is no staff shell, no `/app/*` route group, no nav/sidebar/topbar.**
- `apps/api/src`: NestJS skeleton with only a health module. **No Prisma schema
  anywhere in the repo**, no modules for tenants, entitlements, files, or audit.
- `apps/worker/src`: boots, connects to Redis, no business queues.
- `docker-compose.yml`: postgres + redis only. No object storage (MinIO/S3)
  despite "object-storage" being a listed MVP deployable in ENGINEERING-RULES.
- `packages/ui/src`: contains ONLY `branding/` (`types.ts`, `core-defaults.ts`,
  `brand-theme.schema.ts`, tests) plus barrel exports. No Button/Card/etc.

### What EPIC-00 left us (and what it constrains)

- BrandProvider (`apps/web/src/providers/brand-provider.tsx`) intentionally
  ships only `coreDesignDefaults.radius` as `--radius`; comments explicitly
  defer presets/tenant overrides to EPIC-03.
- `BrandTheme` type uses **kebab-case color keys** and requires ALL colors; the
  PRD 10.1 tenant override list uses **camelCase optional fields** plus
  properties the current schema lacks entirely (`defaultAppearance`,
  heading/body font selection, displayName/assets keys). The schema will need a
  partial-override variant and versioning before persistence.
- Tailwind `darkMode: ["class"]` is configured but no `.dark { … }` token block
  exists — dark/system appearance has zero foundation today.
- No auth/session scaffolding constrains the shell: EPIC-00 shipped none by
  design ("no business-domain feature implemented early").

### Critical dependency finding

ROADMAP: `EPIC-03 depends_on EPIC-01` (Database/Auth/Tenancy), which is
**planned, not implemented**. Criteria 3, 10, 11, 12 (upload, public endpoint,
isolation, audit) fundamentally require tenant entities, auth context, and
Prisma. Either EPIC-01 lands first, or EPIC-03 must be sliced so its
frontend/token/shell slice proceeds without persistence while the branding-API
slice waits.

Also note: EPIC-02 (Entitlements) gates criterion 3 ("when entitled") but is NOT
a declared dependency of EPIC-03 — the entitlement check can be stubbed behind a
boundary or deferred within BRAND-003/004.

### Where tokens live / literal-color audit

- Tokens: CSS variables in `globals.css` `:root` (HSL triplets without `hsl()`
  wrapper), consumed through Tailwind theme extension. Fonts via
  `--font-sans/--font-mono`.
- Existing components consume tokens correctly (`text-muted-foreground`,
  `bg-background`; status dots use `--status-success/error`). No literal brand
  colors found in app code. Risk is future, not current: once real screens are
  built, token discipline needs enforcement (lint rule or review checklist).

## Approaches considered for slicing

1. **UI-first slice (BRAND-001/002 + shell)** — semantic tokens completion (dark
   mode), veterinary preset, resolver/CSS-variable bridge, staff shell consuming
   resolved identity.
   - Pros: zero backend dependency; immediately visible; unblocks every later
     screen; matches "EPIC-01 not started" reality.
   - Cons: tenant-facing criteria stay open until API slice.
   - Effort: Medium
2. **API-first slice (BRAND-003 first)** — Prisma schema, branding endpoints,
   isolation tests.
   - Pros: data contract settled early.
   - Cons: blocked on EPIC-01 (auth/tenancy); produces no user-visible value;
     high rework risk if EPIC-01 shapes differ.
   - Effort: High (given missing foundations)
3. **Full epic in one change** — rejected: spans frontend + persistence +
   files + auth dependencies; violates small-change SDD discipline.

**Recommendation:** Approach 1, sequenced after (or alongside) EPIC-01. Order:
BRAND-001 → BRAND-002 (+shell skeleton) → BRAND-006 resolver contract →
BRAND-003/004 (needs EPIC-01) → BRAND-005.

## Risks

1. **EPIC-01 gap**: four acceptance criteria are unimplementable without
   tenancy/auth/persistence. Biggest scheduling risk.
2. **Schema drift**: existing `brandThemeSchema` shape diverges from PRD 10.1
   override contract (required-all vs optional-partial; kebab vs camelCase;
   missing `defaultAppearance`/font-heading/body). Changing it now touches
   EPIC-00 artifacts and their tests.
3. **Object storage absent**: logo/favicon upload needs an approved storage
   decision (MinIO dev container? signed URLs?) — likely needs a small decision
   record since infra is frozen-ish.
4. **Dark mode scope**: `darkMode: class` configured but no dark tokens exist;
   "light/dark/system" is in epic scope and is a real chunk of design work,
   easily underestimated.
5. **shadcn/ui not installed**: BRAND-001 implicitly includes installing the
   component foundation; that's setup work EPIC-00 deliberately skipped.
6. **SVG temptation**: favicon uploads commonly arrive as SVG; PRD allows
   disallowing initially — enforce PNG/WebP/ICO in v1 to avoid sanitization
   scope.

## Candidate Product Questions (for maintainer)

1. **Does EPIC-01 start before EPIC-03's branding-API slice?** Criteria
   3/10/11/12 need tenants+auth+Prisma. If yes, we propose slicing EPIC-03 into
   "shell/tokens/preset" now and "persistence/API" after EPIC-01; if no, we must
   stub tenant context, which creates rework.
2. **Is dark mode in v1?** The epic lists "light/dark/system appearance", but
   zero dark tokens exist. Including it roughly doubles token design work;
   deferring it would need an explicit story cut.
3. **Which theme properties are editable by tenants in v1?** PRD suggests
   primary/accent/background/border/radius/fonts/appearance; the shipped schema
   exposes ~18 colors. Fewer editable props = simpler UI + validation.
   Recommend: primary, accent, radius, defaultAppearance only.
4. **Where do branding assets live in dev/MVP?** No object-storage service
   exists. Options: MinIO container locally + S3-compatible prod, or
   filesystem/DB-backed placeholder. This may warrant a mini ADR given the
   architecture freeze.
5. **Live preview fidelity**: full-page live preview of the actual shell (apply
   CSS vars to a preview iframe/root) vs. a bounded preview card
   (buttons/cards/form sample)? Full fidelity costs notably more and interacts
   with server components.
6. **Is the staff shell in-scope for navigation content now, or chrome-only?**
   With no domains implemented, sidebar items would be placeholders. Confirm
   whether placeholder nav entries are acceptable for this epic.

## Ready for Proposal

Yes — with the caveat that the proposal should explicitly sequence around the
EPIC-01 dependency (recommend two-phase slicing) and surface questions 1–4 to
the maintainer before the persistence slice is scoped.
