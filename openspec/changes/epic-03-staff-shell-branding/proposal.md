# Proposal: EPIC-03 Phase A — Staff Shell, Tokens and Branding

## Intent

Four EPIC-03 criteria (upload, public endpoint, isolation, audit) are
unimplementable until EPIC-01 ships auth/tenancy/persistence. Rather than stall
the whole epic, this change delivers its persistence-free foundation — semantic
tokens, the veterinary `ProductBrandPreset`, the brand resolution/fallback
chain, and the staff shell — so every later screen and the Phase B branding API
start from a working base. Per DEC-001, `docs/` remains permanent truth;
OpenSpec folders stay temporary trace.

## Scope

### In Scope

- Complete token layer: full shadcn semantic set plus a complete `.dark`
  counterpart; install foundational shadcn/ui components (BRAND-001).
- `presets/veterinary-default.ts` preset validated by `brandThemeSchema`,
  extending `coreDesignDefaults` (BRAND-002).
- Resolver + CSS-variable bridge: `CoreDesignDefaults → Preset` merge with the
  tenant layer reserved but absent; typed `ResolvedBrand` contract ready for
  staff/portal sharing (BRAND-006 frontend part).
- Staff shell skeleton (`/app` route group): sidebar/topbar, placeholder nav,
  chrome-only.
- Minimal light/dark appearance toggle, client-local (localStorage only).

### Out of Scope

All four persistence-dependent epic criteria — logo/favicon upload, public
branding endpoint, tenant-isolation enforcement, branding audit:

- Phase B: BRAND-003 persistence/API; BRAND-004 asset upload (storage decision
  deferred with EPIC-01); BRAND-005 settings page, live preview,
  reset-to-defaults; BRAND-006 backend/public DTO; entitlement gating.
- Re-entry condition: **EPIC-01 merged**.

## Capabilities

### New Capabilities

- `brand-tokens-and-presets`: light/dark semantic token sets, core defaults,
  presets, validation schema, resolver/fallback chain, `ResolvedBrand` contract.
- `staff-shell`: application chrome for the authenticated area, consuming
  resolved brand and tokens only.

### Modified Capabilities

None. No existing capability covers branding or the shell.

## Approach

Ordered small slices:

1. BRAND-001: token completion incl. dark set; install shadcn/ui primitives.
2. BRAND-002: veterinary preset consuming tokens via schema.
3. BRAND-006 (frontend): resolver/fallback
   `CoreDesignDefaults → Preset → (no tenant yet)`; types reserve exactly four
   tenant-editable properties — primary, accent, radius, defaultAppearance — as
   the Phase B contract target.
4. Shell skeleton on shadcn/ui + tokens; composed sample-card-friendly (bounded
   preview card, not real-shell preview, chosen for the later phase).
5. Minimal appearance switch activating `.dark`.

## Affected Areas

| Area                              | Impact       | Description                                                     |
| --------------------------------- | ------------ | --------------------------------------------------------------- |
| `apps/web/src/app/globals.css`    | Modified     | Add `.dark` token block.                                        |
| `apps/web/src/app/(app)/**`       | New          | Shell routes, nav, appearance toggle.                           |
| `packages/ui/src/branding/`       | New/Modified | Resolver, preset, `ResolvedBrand`, partial-override groundwork. |
| `packages/ui/src/components/ui/*` | New          | Installed shadcn/ui primitives, token-only styling.             |

## Risks

| Risk                                                | Likelihood | Mitigation                                                        |
| --------------------------------------------------- | ---------- | ----------------------------------------------------------------- |
| Schema drift vs PRD 10.1 partial/camelCase contract | Med        | Add versioned partial-override variant; keep EPIC-00 tests green. |
| Dark tokens underestimated                          | Med        | Dedicated slice, proven by the toggle.                            |
| Placeholder nav grows premature features            | Med        | Chrome-only acceptance gate.                                      |

## Rollback Plan

Revert the change commits: drop the `(app)` route group, resolver/preset files,
and `.dark` block. Pure frontend/package code — no migrations or data. EPIC-00
artifacts stay untouched.

## Dependencies

- None on EPIC-01 (deliberately avoided by this slicing).
- Stack-approved Tailwind/shadcn; zod already present.

## Success Criteria

- [ ] Shared components consume semantic design tokens; no literal brand colors.
- [ ] Veterinary preset changes require no edits to shared components.
- [ ] Missing overrides fall back to defaults through the documented chain (unit
      tested).
- [ ] Lint/typecheck/tests/build green.

## Proposal question round

Maintainer decisions 2026-08-23, recorded as answered:

1. **Phase A only?** Yes — persistence blocked on EPIC-01; re-entry when merged.
2. **Dark mode in v1?** Yes at token layer (full dark set alongside light);
   visual activation shipped as the _minimal_ toggle (chosen over deferral — it
   proves the dark set works).
3. **Editable theme properties:** primary, accent, radius, defaultAppearance
   only — Phase B contract target.
4. **Asset storage:** deferred to Phase B together with EPIC-01.
5. **Live preview:** bounded sample card, never real-shell preview; Phase A
   keeps sample-card-friendly structure only.
