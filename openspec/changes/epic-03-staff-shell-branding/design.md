# Design: EPIC-03 Phase A — Staff Shell, Tokens and Branding

**Approach**: pure frontend/package slices — complete the token layer, add a schema-valid veterinary preset, resolve it server-side into CSS variables, wrap it in a chrome-only `/app` shell with a client-local appearance toggle. No persistence, no new runtime deps beyond the shadcn primitive foundation.

## Technical Approach

Brand values flow one way: **preset (TS, schema-validated) → resolver → CSS-variable map → SSR `<style>` tag → semantic tokens → shadcn/Tailwind classes**. Shared components never see brand values, only tokens (`bg-primary`, `rounded-lg`). This implements ADR-002 layering; specs: `brand-tokens-and-presets`, `staff-shell`.

```text
packages/ui/branding                     apps/web
┌────────────────────────┐   SSR HTML   ┌──────────────────────────┐
│ coreDefaults ─┐        │  <style>     │ layout.tsx renders style  │
│ vetPreset  ───┤resolve ├─────────────▶│ :root:not(.dark){…}       │
│ tenant(res.) ─┘ toVars │              │ (app)/layout.tsx shell    │
└────────────────────────┘              └──────────────────────────┘
```

## Architecture Decisions

| # | Decision | Choice | Alternatives rejected | Rationale |
|---|----------|--------|----------------------|-----------|
| D1 | Where tokens live | CSS variables in `globals.css` `:root` + `.dark`; branding package owns *values*, stylesheet owns *declarations* | Codegen CSS from TS; inline styles on `<html>` | Inline style beats `.dark` rules (inline > stylesheet) and would kill the dark toggle; codegen adds a pipeline. Existing EPIC-00 pattern kept. |
| D2 | Dark-vs-brand precedence | Bridge emits selector `:root:not(.dark)` (not `:root`) | `!important` on `.dark`; React 19 `<style precedence>` hoisting order games | `(0,2,0)` beats `.dark` in light regardless of tag order; goes inert under `.dark`. Deterministic, no ordering fragility. Consequence: dark palette is design-system-owned in Phase A (parity is what the spec demands). |
| D3 | Radius format | **rem string**, reusing approved `remValue` regex (`/^\d+(\.\d+)?rem$/`) | BRANDING-THEMING enum `"none"\|"sm"\|"md"\|"lg"` | Spec mandates "reusing approved value formats"; maps 1:1 to `--radius` which Tailwind derives into lg/md/sm via `calc()`. The enum snippet is explicitly advisory ("Recommended contract"), and an enum would just alias rem constants plus a mapping table. PRD's untyped "radius scale" = rem base + derived scale. |
| D4 | Preset injection | Runtime server resolution in RSC layout; preset swap = editing files under `packages/ui/src/branding/` only | Build-time CSS generation; client-side injection | Zero deps, no FOUC (style ships in first paint), satisfies swap scenario literally; Phase B tenant overrides plug into the same bridge server-side. |
| D5 | Override key casing | Tenant surface camelCase (PRD 10.1); internal `BrandTheme` color keys stay kebab-case | Migrating shipped schema | Allowed keys (`primary`,`accent`,`radius`,`defaultAppearance`) have no compound names → no collision; bridge maps `primary → --primary`. |
| D6 | FOUC avoidance | Parser-blocking inline `<script>` as first `<body>` child: reads `localStorage["newsaas.appearance"]`, adds `dark` class to `documentElement` before paint; `<html suppressHydrationWarning>` | next-themes dep; cookie-based SSR flash-free variant | Standard zero-dep pattern; spec fixes default light, so script acts only on stored `'dark'`. Storage access wrapped in try/catch (private-mode Safari throws) → silent fallback to light. |
| D7 | DOM test env | **No new shared config**: apps/web already runs jsdom ^26.1.0 via local `vitest.config.ts` merge override + `vitest.setup.ts` | Add `vitest.dom.ts` to `packages/vitest-config`; happy-dom | One consumer exists; promoting now is an abstraction without a second user. jsdom already installed/proven with Testing Library + jest-dom. Promote when a second consumer appears. |
| D8 | Shell primitives | shadcn `button` + `card` only (bring cva/clsx/tailwind-merge/@radix-ui/react-slot); plain `<aside>`/`<header>`/`<main>` composition | shadcn `sidebar` component; radix dropdown-menu | No scenario needs overlays or the full sidebar kit; stack freeze says minimum. Nav entries are inert placeholders (chrome-only gate). |

## Data Flow

Toggle path: click → `classList.toggle('dark')` + `localStorage.setItem` (try/catch) → CSS cascade swaps token values; no reload, no React state for theming.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/web/src/app/globals.css` | Modify | Add `--popover/--popover-foreground` to `:root`; add full `.dark` block (parallel set incl. status/radius/font vars). |
| `apps/web/src/styles/tokens.test.ts` | Create | Parity scan (`:root` set == `.dark` set) + literal-color scan. |
| `packages/ui/src/components/ui/{button,card}.tsx` | Create | Installed shadcn primitives, token-only styling. |
| `packages/ui/src/components/literal-color.test.ts` | Create | Source scan over `src/components/**`: rejects hex/hsl literals + palette utilities (`/-?(bg\|text\|border\|ring)-[a-z]+-\d{2,3}/`). Fails non-zero on violation. |
| `packages/ui/src/branding/types.ts` | Modify | Add `ProductBrandPreset`, `ResolvedBrand`, `BrandOverride`, `DefaultAppearance`. |
| `packages/ui/src/branding/presets/veterinary-default.ts` | Create | Complete `BrandTheme`, distinct identity; asset fields reserved. |
| `packages/ui/src/branding/brand-override.schema.ts` | Create | See Interfaces; versioned partial schema. |
| `packages/ui/src/branding/brand-theme.schema.ts` | Modify | Export `hslOrHex`/`remValue` consts (additive; behavior untouched). |
| `packages/ui/src/branding/{resolve-brand,to-css-variables}.ts` | Create | Resolver + bridge. |
| `packages/ui/src/branding/index.ts` | Modify | Export new symbols + `activeProductPreset`. |
| `packages/ui/package.json` | Modify | Exports `./components/ui/*`; shadcn foundation deps. |
| `apps/web/src/app/layout.tsx` | Modify | Render brand `<style>`; appearance bootstrap script; `suppressHydrationWarning`. |
| `apps/web/src/providers/brand-provider.tsx` | Modify | Becomes `ResolvedBrand` context (drops its div `--radius` hack). |
| `apps/web/src/app/(app)/layout.tsx` | Create | Shell: sidebar + topbar + `<main data-shell-content>`. |
| `apps/web/src/app/(app)/app/page.tsx`, `(app)/app/placeholder/page.tsx` | Create | Placeholder home (sample-card-ready `Card`) + sub-route proving deep-link-in-shell. |
| `apps/web/src/components/shell/*.tsx` + tests | Create | Nav sidebar, topbar, `AppearanceToggle` (client). |

## Interfaces / Contracts

```ts
type DefaultAppearance = "light" | "dark" | "system";
interface ProductBrandPreset { code: string; productName: string; theme: BrandTheme /* complete */; assets?: reserved }
type BrandThemePatch = DeepPartial<BrandTheme>;          // resolver tolerates gaps
interface ResolvedBrand { presetCode: string; theme: BrandTheme; defaultAppearance: DefaultAppearance }

resolveBrand(preset: ProductBrandPreset, patch?: BrandThemePatch, tenant?: BrandOverride | null): ResolvedBrand
// deep merge core ← preset ← tenant; absent layers/keys fall back silently
toCssVariables(brand: ResolvedBrand): Record<`--${string}`, string>
// strips "hsl()" wrappers → bare triplets; radius/fonts emitted verbatim

export const BRAND_OVERRIDE_SCHEMA_VERSION = 1;
export const brandOverrideSchema = z.object({          // kebab/camel drift resolved per D5
  schemaVersion: z.literal(BRAND_OVERRIDE_SCHEMA_VERSION),
  primary: hslOrHex.optional(), accent: hslOrHex.optional(),
  radius: remValue.optional(),
  defaultAppearance: z.enum(["light", "dark", "system"]).optional(),
}).strict();
export function validateBrandOverride(input: unknown): BrandOverride; // stable error codes
```

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit (node, `packages/ui`) | Preset parses `brandThemeSchema`; override schema accepts subsets/rejects unknown+unsafe+wrong-version; merge precedence (preset-over-core, gap-fallback, empty/absent tenant); fixture-preset maps differ from veterinary maps | Vitest against exports |
| Scan tests | `:root`/`.dark` parity; zero literal colors in `components/**` | fs + regex source scans (non-zero exit) |
| Component (jsdom, apps/web) | Shell wraps direct visit + sub-route; toggle flips `documentElement` class without reload; persists/reapplies `localStorage`; storage failure tolerated; region hosts re-theming card | Testing Library, existing local jsdom config |
| Gates | lint/typecheck/tests/build | Repo commands |

## Threat Matrix

N/A — no routing, OS shell/subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. (App-router pages here are views; no command execution introduced.)

## Migration / Rollout

None (no data/API). Rollout = ordered commits below; each is an independent revert boundary: S1 tokens/primitives · S2+S3 branding package · S4+S5 shell+toggle. Reverting drops `(app)` group, branding additions, `.dark` block; EPIC-00 artifacts untouched.

## Execution Order

| Slice | Depends on | Verified by |
|-------|-----------|-------------|
| S1 BRAND-001 tokens + dark + primitives | — | Parity + literal scans, gates |
| S2 BRAND-002 preset | S1 (tokens exist) | Schema-parse test, gates |
| S3 BRAND-006f resolver/bridge/types | S2 | Precedence/fallback/conversion unit tests |
| S4 shell skeleton | S1, S3 | jsdom render tests (direct visit, deep link) |
| S5 appearance toggle | S4 | jsdom toggle/persist/failure tests |

## Open Questions

- [ ] Phase B: how presets/tenant `primary` recolor dark mode (appearance-aware bridge vs preset `darkTheme`) — deferred, D2 consequence.
- [ ] When `"system"` appearance activates (schema accepts it; Phase A UI ignores it).
- [ ] Chart tokens (`--chart-*`) omitted until a chart consumer exists.
