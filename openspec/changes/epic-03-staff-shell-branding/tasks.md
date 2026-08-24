# Tasks: EPIC-03 Phase A — Staff Shell, Tokens and Branding

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,270 total: U1≈310, U2≈95, U3≈330, U4≈330, U5≈175, U6≈30 |
| 400-line budget risk | High aggregate / Low per slice |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 → PR 5 (one per slice; U6 rides PR 5) |
| Delivery strategy | ask-always |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Aggregate exceeds 400; each unit stays ≤400. Merging U2+U3 (~425) would breach budget — not recommended.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| U1 (S1) | Token completion + dark set + shadcn primitives | PR 1 | `pnpm --filter @newsaas/ui test && pnpm --filter @newsaas/web test` | N/A — fs/regex scans are the proof; visuals arrive in U4/U5 | Revert drops `.dark`, primitives, shadcn config; EPIC-00 untouched |
| U2 (S2) | Veterinary preset, schema-valid | PR 2 | `pnpm --filter @newsaas/ui test` | N/A — pure data validated by schema test | Drop preset file; nothing consumes it yet |
| U3 (S3) | Resolver/bridge/versioned override schema | PR 3 | `pnpm --filter @newsaas/ui test` | N/A — pure functions, node Vitest | Remove branding additions; types additive-revertable |
| U4 (S4) | Shell skeleton consuming resolved brand | PR 4 | `pnpm --filter @newsaas/web test` | `pnpm --filter @newsaas/web dev` smoke: `/app` + deep link | Delete `(app)` group + shell components; restore old layout/provider |
| U5 (S5) | Appearance toggle + pre-paint bootstrap | PR 5 | `pnpm --filter @newsaas/web test` | Dev-server toggle smoke + jsdom persistence tests | Remove toggle + bootstrap script |
| U6 | Full gates + docs sync | rides PR 5 | `pnpm lint && pnpm format-check && pnpm typecheck && pnpm test && pnpm build` | Production build | Docs-only revert |

## Phase 1: S1 — Tokens, Dark Set, Primitives (PR 1)

- [x] 1.1 Configure shadcn/ui monorepo paths (design risk): add `components.json` (repo root, aliases resolving into `packages/ui/src/components/ui`, css `apps/web/src/app/globals.css`) so CLI writes to the shared package; extend `packages/ui/package.json` exports with `./components/ui/*` and add deps `class-variance-authority`, `clsx`, `tailwind-merge`, `@radix-ui/react-slot`. Files: `components.json`, `packages/ui/package.json`, lockfile. Verify: `pnpm install && pnpm --filter @newsaas/ui typecheck`. Deps: none.
- [x] 1.2 Add `--popover`/`--popover-foreground` to `:root`; append complete `.dark` block mirroring every `:root` property incl. status/radius/font vars (D1). File: `apps/web/src/app/globals.css`. Verify: via 1.3. Deps: none.
- [x] 1.3 Scan tests (RED first): `apps/web/src/styles/tokens.test.ts` asserts `:root` set == `.dark` set; `packages/ui/src/components/literal-color.test.ts` source-scans `src/components/**` rejecting hex/HSL literals + palette utilities, non-zero exit on violation. Verify: `pnpm --filter @newsaas/web test && pnpm --filter @newsaas/ui test`. Deps: 1.2.
- [x] 1.4 Install shadcn `button` + `card` only (D8) into `packages/ui/src/components/ui/{button,card}.tsx`, token-only styling. Verify: scans from 1.3 green + `pnpm --filter @newsaas/ui build`. Deps: 1.1, 1.3.
- [x] 1.5 Gate: `pnpm lint && pnpm typecheck` green on touched packages. Deps: 1.4.

## Phase 2: S2 — Veterinary Preset (PR 2)

- [x] 2.1 Create `packages/ui/src/branding/presets/veterinary-default.ts`: complete distinct `BrandTheme` passing `brandThemeSchema`; asset fields reserved. Verify: via 2.2. Deps: U1.
- [x] 2.2 Test `presets/veterinary-default.test.ts`: preset parses `brandThemeSchema` without edits elsewhere. Verify: `pnpm --filter @newsaas/ui test`. Deps: 2.1.

## Phase 3: S3 — Resolver, Bridge, Override Schema (PR 3)

- [x] 3.1 Extend `types.ts`: `DefaultAppearance`, `ProductBrandPreset`, `BrandThemePatch`, `ResolvedBrand`, `BrandOverride`. Deps: none.
- [x] 3.2 Export `hslOrHex`/`remValue` consts from `brand-theme.schema.ts` (additive; EPIC-00 behavior frozen). Deps: none.
- [x] 3.3 Create `brand-override.schema.ts` + tests (RED first): `BRAND_OVERRIDE_SCHEMA_VERSION=1`; strict camelCase subset `primary/accent/radius/defaultAppearance`; accepts any valid subset with version, rejects unknown keys, unsafe values (`url(...)`), wrong version, stable error codes (D3/D5). Verify: `pnpm --filter @newsaas/ui test`. Deps: 3.1, 3.2.
- [x] 3.4 Create `resolve-brand.ts` + tests: deep merge core ← preset ← tenant(reserved), silent gap/layer fallback, returns `ResolvedBrand`. Cases: preset-over-core precedence; missing/empty tenant == preset-over-core. Verify: same command. Deps: 3.1.
- [x] 3.5 Create `to-css-variables.ts` + test: strips `hsl()` wrappers, radius/fonts verbatim; fixture preset vs veterinary CSS-var maps differ where values differ (swap scenario). Deps: 3.4, 2.1.
- [x] 3.6 Update `branding/index.ts`: export new symbols + `activeProductPreset`. Verify: `pnpm --filter @newsaas/ui test && pnpm --filter @newsaas/ui build`. Deps: 3.3–3.5.

## Phase 4: S4 — Staff Shell Skeleton (PR 4)

- [x] 4.1 Modify `apps/web/src/app/layout.tsx`: server-resolve `activeProductPreset` → render `<style>` with `toCssVariables(ResolvedBrand)` under `:root:not(.dark)` selector (D2/D4); `<html suppressHydrationWarning>`. Deps: U3.
- [x] 4.2 Refactor `apps/web/src/providers/brand-provider.tsx` to typed `ResolvedBrand` context; delete div `--radius` hack. Deps: 4.1.
- [x] 4.3 Create `apps/web/src/app/(app)/layout.tsx`: `<aside>` sidebar + `<header>` topbar + `<main data-shell-content>` bounded region, composed from Button/Card + semantic tokens. Deps: 4.2, 1.4.
- [x] 4.4 Create `apps/web/src/components/shell/{nav-sidebar,topbar}.tsx`: inert labeled placeholder entries only (chrome-only gate). Deps: 4.3.
- [x] 4.5 Create `apps/web/src/app/(app)/app/page.tsx` (sample-card-ready Card home) + `(app)/app/placeholder/page.tsx` (deep-link proof). Deps: 4.3.
- [x] 4.6 jsdom tests (Testing Library): direct `/app` visit renders sidebar+topbar around content; nested route keeps shell; nav entries inert, no business domain; sample card hosted in region inheriting tokens. Files: colocated `*.test.tsx`. Verify: `pnpm --filter @newsaas/web test`. Deps: 4.4, 4.5.

## Phase 5: S5 — Appearance Toggle (PR 5)

- [ ] 5.1 Create `apps/web/src/components/shell/appearance-toggle.tsx` (client): toggles `dark` class on `documentElement`, persists `localStorage["newsaas.appearance"]` in try/catch, defaults light (D6). Verify: via 5.3. Deps: U4.
- [ ] 5.2 Add parser-blocking inline bootstrap `<script>` as first body child in `app/layout.tsx`: reads stored preference, applies class pre-paint. Deps: 5.1.
- [ ] 5.3 jsdom tests: toggle flips class without reload/navigation; stored dark reapplied on mount; no stored value mounts light; localStorage failure tolerated; region card re-themes on toggle. Verify: `pnpm --filter @newsaas/web test`. Deps: 5.1, 5.2.

## Phase 6: U6 — Gates and Docs

- [ ] 6.1 Full gates: `pnpm lint && pnpm format-check && pnpm typecheck && pnpm test && pnpm build`. Confirms EPIC-00 `brand-theme` tests stay green (schema untouched). Deps: U5.
- [ ] 6.2 Update `docs/03-architecture/BRANDING-THEMING.md` with shipped Phase A layering (preset→resolver→CSS bridge, toggle). Deps: 6.1.

## Traceability: Spec Requirement → Tasks

| Capability | Requirement / Scenario | Tasks |
|------------|------------------------|-------|
| brand-tokens | Semantic token completeness / no literal colors | 1.3, 1.4, 6.1 |
| brand-tokens | Dark token set / light-dark parity | 1.2, 1.3 |
| brand-tokens | Presets supply identity / swap re-themes, zero component edits | 2.1, 2.2, 3.5, 3.6 |
| brand-tokens | Fallback chain / preset overrides core | 3.4 |
| brand-tokens | Fallback chain / missing tenant falls back | 3.4 |
| brand-tokens | Versioned schema / valid partial accepted | 3.3 |
| brand-tokens | Versioned schema / unknown keys or unsafe values rejected | 3.3 |
| brand-tokens | Existing `brandThemeSchema` unchanged (EPIC-00 green) | 3.2, 6.1 |
| staff-shell | Shell skeleton / direct visit wraps chrome | 4.3, 4.6 |
| staff-shell | Shell skeleton / sub-route keeps shell | 4.5, 4.6 |
| staff-shell | Chrome-only nav / entries carry no hidden features | 4.4, 4.6 |
| staff-shell | Appearance switch / flip without reload | 5.1, 5.3 |
| staff-shell | Appearance switch / choice persists across visits | 5.1, 5.2, 5.3 |
| staff-shell | Bounded sample-card region / hosts and re-themes | 4.3, 4.5, 4.6, 5.3 |

Threat matrix: N/A per design (no applicable cases). All spec scenarios mapped — no orphans.
