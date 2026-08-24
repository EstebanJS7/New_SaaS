# Archive Report — epic-03-staff-shell-branding (Phase A)

## Metadata

- Archived: 2026-08-24
- Destination: `openspec/archive/2026-08-24-epic-03-staff-shell-branding/`
- Verify verdict: PASS-WITH-AUTHORIZED-DEFERRALS (envelope verdict
  `pass_with_warnings`; `verify-report.md`, this folder; evidence revision =
  HEAD `ed3b47f` at verification time; blockers 0, critical findings 0,
  requirements 9/9, scenarios 13/13)
- Closure authorization: repository maintainer — the Phase B deferrals below are
  proposal-scoped (maintainer-approved 2026-08-23) with an explicit re-entry
  condition. Documented authority, not hidden gaps.

## Commits delivered by this change

| Commit  | Subject                                                             |
| ------- | ------------------------------------------------------------------- |
| 96ad353 | feat(BRAND-001): complete token layer with dark set and shadcn base |
| 1a862f0 | feat(BRAND-002): add schema-valid veterinary brand preset           |
| 21d67ec | feat(BRAND-006): add brand resolver, CSS bridge and override schema |
| e1f2077 | feat(EPIC-03): add staff shell skeleton with brand bridge           |
| c1b1bf1 | chore(format): repo-wide prettier pass                              |
| ed3b47f | feat(EPIC-03): add appearance toggle with pre-paint bootstrap       |

The terminal commit of the cycle is the single archive commit containing this
report and the folder move itself.

## Implemented (Phase A)

- Token layer completion: `--popover` pair added, complete `.dark` block
  mirroring every `:root` property (incl. status/radius/font vars);
  literal-color scan tests over `packages/ui/src/components/**` and
  `apps/web/src/**` enforcing token-only styling; shadcn monorepo wiring with
  `button`/`card` primitives (`96ad353`).
- Schema-valid `veterinary-default` product preset (`satisfies BrandTheme`,
  asset fields reserved) (`1a862f0`).
- Brand resolver with core ← preset ← tenant(reserved) fallback chain,
  CSS-variable bridge (strips `hsl()`, normalizes conditional hex, radius and
  fonts verbatim) and versioned brand-override schema v1 with stable error codes
  `UNKNOWN_KEY` / `INVALID_VALUE` / `UNSUPPORTED_VERSION`; EPIC-00
  `brandThemeSchema` behavior frozen (additive exports only) (`21d67ec`).
- Staff shell skeleton `(app)` route group: sidebar/topbar chrome composed from
  shared Button/Card primitives, `<main data-shell-content>` bounded region,
  home card + deep-link placeholder pages; server-resolved preset injected as
  `<style>` under `:root:not(.dark)`; typed brand-provider deleted during U4
  review in favor of identity via RSC props (`e1f2077`, carry-overs fixed in
  `ed3b47f`).
- Client-local appearance toggle (flips `documentElement.dark`, persists
  `localStorage["newsaas.appearance"]` in try/catch, defaults light) with
  parser-blocking pre-paint bootstrap script (`ed3b47f`). Dev-server smoke:
  `/app` and `/app/placeholder` returned 200 with shell markers (apply-progress
  memory #1575).
- Docs sync per DEC-001: `docs/03-architecture/BRANDING-THEMING.md` shipped
  layering, EPIC-03 roadmap progress note, Branding.md module doc — confirmed
  accurate by the verify-report docs-truth audit.

## Deferred (authorized — proposal scope, never verification failure)

Zero delta-spec requirements or scenarios were deferred-by-scope or failed (9/9,
13/13 verified). The deferral qualifier applies to the change as a whole: all
persistence-dependent work is Phase B per `proposal.md` Out-of-Scope,
maintainer-approved 2026-08-23:

- BRAND-003 tenant branding persistence/API;
- BRAND-004 logo/favicon asset upload (storage decision deferred with EPIC-01);
- BRAND-005 branding settings page, live preview, reset-to-defaults;
- BRAND-006 backend/public DTO;
- `custom_branding` entitlement gating;
- cross-tab appearance sync (Branding.md not-yet-shipped list).

Re-entry condition: **EPIC-01 merged** (auth/tenancy/persistence available).

Consequently `docs/01-roadmap/EPIC-03-Staff-Shell-Design-System-Branding.md`
remains `status: in-progress` with exactly the three verifiably-met Phase-A
acceptance criteria ticked (semantic tokens; preset swappable without editing
shared components; missing-tenant fallback). All persistence-dependent criteria
stay unticked pending Phase B. This archive does NOT mark EPIC-03 done.

## Known limitations (accepted, non-blocking — from verify-report)

1. Dark recolor open question: the `.dark` palette stays design-system-owned;
   presets do not recolor dark mode (disclosed in BRANDING-THEMING.md and
   Branding.md).
2. Cross-tab appearance sync deferred to Phase B.
3. Literal-color scan gap: app-level `.css` literals sit outside the scan scope
   and regex detection has inherent blind spots (e.g. `rgb(` forms); accepted
   residual risk for Phase A.
4. Deep-link test compositional: sub-route shell coverage renders
   `AppShellLayout` directly instead of driving the Next.js router; the recorded
   dev-server smoke compensates at integration level.

## Task completion gate

`tasks.md` Phases 1–6, tasks 1.1–6.2: all `[x]` at archive time. No checkbox
reconciliation was required for this archive.

## Specs note

Delta specs (`brand-tokens-and-presets`, `staff-shell`) are preserved verbatim
in this archived folder as the audit trail. They were not merged into
`openspec/specs/` because that directory holds no main specs in this repository:
DEC-001 (accepted 2026-08-23) designates `docs/` as the permanent documentation
authority and OpenSpec change folders as temporary SDD trace.

## Audit trail

The change folder was moved mechanically with `git mv`; a recursive `diff -r`
against a pre-move snapshot returned no differences. Nothing was deleted or
modified inside the archived artifacts except this additive report.
