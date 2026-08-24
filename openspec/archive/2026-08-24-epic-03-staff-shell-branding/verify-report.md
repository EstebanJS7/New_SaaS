```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:52c5485300b90b0f8a816fb1684c879ee175dc2d44686f34234eb3044bf1fa3f
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 9/9
scenarios: 13/13
test_command: "pnpm -F @newsaas/ui test && pnpm -F @newsaas/web test"
test_exit_code: 0
test_output_hash: sha256:14433fe0374b7071104221180e197279e86bff60ddfbfe4989653c9eb581c5ff
build_command: pnpm build
build_exit_code: 0
build_output_hash: sha256:14433fe0374b7071104221180e197279e86bff60ddfbfe4989653c9eb581c5ff
```

# Verify Report: epic-03-staff-shell-branding (Phase A)

Verdict: **PASS-WITH-AUTHORIZED-DEFERRALS** (envelope verdict
`pass_with_warnings`).

All 9 requirements and 13 scenarios of the two delta specs are verified against
HEAD `ed3b47ff63c1f49279c47cf9ac304e5f9985f3c6` (clean tree). Zero requirements
or scenarios are `deferred-by-scope` inside the delta specs and zero are
`failed`. The deferral qualifier applies to the change as a whole: Phase B epic
criteria are excluded by proposal scope, never by verification failure.

Evidence revision: commits `96ad353` (U1 tokens/dark/shadcn), `1a862f0` (U2
preset), `21d67ec` (U3 resolver/bridge/schema), `e1f2077` (U4 shell), `c1b1bf1`
(prettier), `ed3b47f` (U5 toggle/bootstrap/docs).

## Authorized-deferral statement (scope contract)

The four persistence-dependent EPIC-03 criteria — logo/favicon upload, public
branding endpoint, tenant-isolation enforcement, branding audit — plus BRAND-003
persistence/API, BRAND-005 settings UI/live preview/reset-to-defaults, BRAND-006
backend/public DTO and `custom_branding` entitlement gating are
**proposal-scoped authorized deferrals** per `proposal.md` Out-of-Scope
(re-entry condition: **EPIC-01 merged**). Maintainer-approved 2026-08-23. They
are not requirements of this change's delta specs and are recorded here
explicitly so their absence is never misread as a failure.

## Verification matrix — brand-tokens-and-presets (5 requirements, 7 scenarios)

| #    | Requirement / Scenario                      | Status   | Evidence                                                                                                                                                                      |
| ---- | ------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1   | Semantic token completeness                 | verified | `packages/ui/src/components/literal-color.test.ts` source-scans `src/components/**`; fresh run green                                                                          |
| S1.1 | No literal brand colors                     | verified | `literal-color.test.ts:32-60` zero violations + non-empty-scan guard; `ui/button.tsx`, `ui/card.tsx` token-only classes (`bg-card`, `text-muted-foreground`)                  |
| R2   | Complete dark token set                     | verified | `apps/web/src/app/globals.css:5-30` (`:root`) fully mirrored by `.dark` at lines 39-64, incl. popover pair, status/radius/font vars                                           |
| S2.1 | Light/dark parity check                     | verified | `tokens.test.ts:90-95` bidirectional parity; removing any counterpart fails; `:97-104` proves values actually switch                                                          |
| R3   | Presets supply identity via configuration   | verified | `presets/veterinary-default.ts` complete `BrandTheme` (`satisfies BrandTheme`, line 51); UI reaches it only through the bridge                                                |
| S3.1 | Swap re-themes with zero component edits    | verified | `to-css-variables.test.ts:84-97` alternative fixture vs veterinary maps differ only where values differ; swap touches `packages/ui/src/branding/` only                        |
| R4   | Brand resolution fallback chain             | verified | `resolve-brand.ts:84-98` merges core ← preset ← patch ← tenant(reserved); silent fallbacks; typed `ResolvedBrand` exported from `index.ts:1-28`                               |
| S4.1 | Preset overrides core defaults              | verified | `resolve-brand.test.ts:8-30`: preset-defined properties win; undefined properties keep core defaults                                                                          |
| S4.2 | Missing tenant layer falls back             | verified | `resolve-brand.test.ts:46-54`: absent/null/empty tenant layers produce results equal to preset-over-core, no error                                                            |
| R5   | Versioned schemas, tenant-editable contract | verified | `brand-override.schema.ts:12-38`: `BRAND_OVERRIDE_SCHEMA_VERSION=1`, strict camelCase subset `primary/accent/radius/defaultAppearance`; `brandThemeSchema` behavior unchanged |
| S5.1 | Valid partial override accepted             | verified | `brand-override.schema.test.ts:19-35`: complete payload and every subset parse carrying explicit `schemaVersion`                                                              |
| S5.2 | Unknown keys or unsafe values rejected      | verified | `brand-override.schema.test.ts:43-101`: stable codes `UNKNOWN_KEY` / `INVALID_VALUE` / `UNSUPPORTED_VERSION` for `background`, `url(...)`, wrong versions                     |

EPIC-00-green clause of R5: `brand-theme.schema.ts` gained only additive exports
(`hslOrHex`, `remValue`); `brand-theme.test.ts` passed 7/7 in the fresh run —
EPIC-00 behavior frozen as required.

## Verification matrix — staff-shell (4 requirements, 6 scenarios)

| #    | Requirement / Scenario                    | Status   | Evidence                                                                                                                                                          |
| ---- | ----------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R6   | Shell skeleton renders navigation chrome  | verified | `(app)/layout.tsx:14-26` `<aside>` sidebar + `<header>` topbar + `<main data-shell-content>`, composed from shared Button/Card primitives                         |
| S6.1 | Shell wraps content on direct visit       | verified | `(app)/layout.test.tsx:17-31`: sidebar+topbar render around region; sample card hosted inside                                                                     |
| S6.2 | Sub-route keeps the shell                 | verified | `(app)/layout.test.tsx:33-46`: placeholder deep-link page renders inside same group layout                                                                        |
| R7   | Chrome-only placeholder navigation        | verified | `nav-sidebar.tsx:11,24-34` inert labeled buttons (no `href`, no handlers); `/app` ships only home card + placeholder pages                                        |
| S7.1 | Nav entries carry no hidden features      | verified | `nav-sidebar.test.tsx:21` no links/business destinations; topbar Account entry inert (`topbar.test.tsx:16`)                                                       |
| R8   | Appearance switch                         | verified | `appearance-toggle.tsx:40-61` toggles `documentElement.dark` + persists `localStorage["newsaas.appearance"]` in try/catch; pre-paint bootstrap `appearance.ts:27` |
| S8.1 | Toggle flips theme without reload         | verified | `appearance-toggle.test.tsx:17` class flips, URL/href unchanged (no navigation)                                                                                   |
| S8.2 | Choice persists across visits             | verified | `appearance.test.ts:26-53` evaluates the exact shipped script source: stored dark applied pre-paint; absent/corrupted/storage-throws → light; mount resync tests  |
| R9   | Bounded sample-card content region        | verified | `<main data-shell-content>` bounded region hosts self-contained Card home (`(app)/app/page.tsx`)                                                                  |
| S9.1 | Region hosts and re-themes sample content | verified | `(app)/layout.test.tsx:48-66` card carries `bg-card`/`text-card-foreground`, null inline styles; `appearance-toggle.test.tsx:68` re-themes across dark↔light      |

## Traceability confirmation

`tasks.md` traceability table (14 rows = all 13 scenarios plus the normative
EPIC-00-green clause of R5) was cross-checked against actual task IDs 1.1–6.2,
all marked `[x]`. Reverse check: no orphan tasks, no orphan scenarios.

## Review-fix confirmation (present in HEAD)

- U1 W1/W2 (fixed pre-commit in `96ad353`): Tailwind content glob includes
  `packages/ui/src/**` (`apps/web/tailwind.config.ts:10`) so shared-primitive
  classes are generated; shadcn deps wired via lockfile.
- U3 conditional hex fix (`21d67ec`): `hexToTriplet` normalization at
  `to-css-variables.ts:23-49` proven by `to-css-variables.test.ts:73-82` (no hex
  survives the bridge).
- U4 carry-overs resolved in `ed3b47f`: `providers/brand-provider.tsx` deleted
  (only `query-provider.tsx` remains); product identity flows via server-layout
  props (`topbar.tsx:13`). Dev-server smoke (`/app`, `/app/placeholder` → 200
  with shell markers) recorded in apply-progress memory #1575.
- U5 docs findings W1/W2/W3/S1/S2 (fixed before `ed3b47f`): confirmed via the
  docs-truth audit below.

## Docs-truth audit (DEC-001)

- `docs/05-modules/Branding.md`: **accurate**. API section states "None shipped
  yet"; implemented-behavior list matches code file-for-file (storage key
  `newsaas.appearance`, `:root:not(.dark)` bridge, override schema v1 error
  codes); Phase B list mirrors proposal Out-of-Scope; preset description matches
  values (teal `173` primary / amber `42` accent / `0.75rem` radius / Noto
  Sans).
- `docs/01-roadmap/EPIC-03-Staff-Shell-Design-System-Branding.md`: **accurate**.
  Status `in-progress` correct; exactly the three verifiably-met acceptance
  criteria ticked (semantic tokens, preset swappable, missing-tenant fallback);
  remaining criteria left unticked pending Phase B; progress note reflects
  shipped reality.
- `docs/03-architecture/BRANDING-THEMING.md`: **accurate**. Shipped-section file
  paths all exist; specificity claim `(0,2,0)` for `:root:not(.dark)` over
  `.dark` is technically correct and the selector goes inert under `.dark`;
  honest disclosure that Next.js may emit invisible RSC markers ahead of the
  bootstrap script in SSR HTML.

## Known limitations (accepted, non-blocking)

1. Dark recolor open question: `.dark` palette stays design-system-owned;
   presets do not recolor dark mode (disclosed in BRANDING-THEMING.md and
   Branding.md not-yet-shipped lists).
2. Cross-tab appearance sync deferred to Phase B (recorded in Branding.md).
3. Literal-color scan gap: the web-side scan covers `apps/web/src/**` `.ts/.tsx`
   sources but app-level `.css` literals sit outside the shared-package scan
   scope, and regex detection has inherent blind spots (e.g. `rgb(` forms).
   Accepted residual risk for Phase A.
4. Deep-link test compositional: sub-route shell coverage renders
   `AppShellLayout` with the page directly instead of driving the Next.js
   router; the recorded dev-server smoke (both routes return 200 with shell
   markers) compensates at integration level.

## Checks executed

- Fresh on HEAD: `pnpm --filter @newsaas/ui test` → exit 0 (36/36);
  `pnpm --filter @newsaas/web test` → exit 0 (32/32). The envelope records these
  as `pnpm -F …` (`-F` is pnpm's documented `--filter` alias; kept short for the
  single-line envelope contract) and `build_command: pnpm build` following the
  EPIC-00 report convention — the full five-gate chain is enumerated here.
- Recorded (apply-progress memory #1575, session `epic-03-u5u6-apply`): full
  root gates immediately before `ed3b47f` — `lint`, `format-check`, `typecheck`,
  `test` (95 tests across 7 packages), `build` (Next.js compiled, 6 static
  pages) — all exit 0. Not rerun per verify contract.
- `test_output_hash`/`build_output_hash` are sha256 over the transcribed
  evidence bundle at `/tmp/opencode/epic03-verify-evidence.txt`.
- `evidence_revision` is sha256 over HEAD commit id + that same bundle (preimage
  preserved at `/tmp/opencode/epic03-evidence-revision-preimage.txt`).
