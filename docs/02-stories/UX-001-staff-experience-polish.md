---
id: UX-001
type: story
title: Staff experience and design-system polish
epic: EPIC-03
status: review
priority: high
depends_on: []
prd_sections: ["3", "10.1", "29", "31"]
permissions: []
branch: main
created: 2026-10-26
updated: 2026-10-26
---

# UX-001 — Staff experience and design-system polish

## Scope

User-authorized visual/interaction improvements inspired by the local Investor
frontend. Preserve this product's semantic branding, existing data contracts,
authorization and all pending DEV-001 changes. No PRD edits or new dependencies.

## Acceptance Criteria

- [x] Responsive staff shell with grouped navigation, current section and mobile
      keyboard navigation.
- [x] Remove inactive placeholder controls; retain links to implemented modules
      and entitlement UX.
- [x] Shared shadcn-style controls, loading/skeleton/empty/error feedback using
      semantic tokens.
- [x] Dashboard, customer/patient lists and sign-in have clearer hierarchy and
      usable small-screen layouts.
- [x] Loading and unexpected-error route boundaries provide accessible feedback
      and recovery.
- [x] Verify list-to-detail navigation, desktop/mobile, light/dark and CSP
      behavior in a browser.
- [ ] Applicable typecheck, lint, tests and build pass; report existing
      verification limitations separately.
- [x] Record UX audit, implementation coverage and prioritized recommendations.

## Invariants

No fabricated metrics, new aggregates, business API mutations, permission
changes or tenant CSS injection. No financial calculations added in
presentation. Preserve server-resolved branding and session authority. UI
remains a single Tailwind / shadcn foundation. No new sensitive fields,
migrations or backend endpoints. The sign-out control uses a private same-origin
BFF for the existing session revocation command; the public authentication proxy
remains credential-less.

## Verification / Implementation

### Implementation

- Shared UI primitives and pending buttons; responsive staff shell with actual
  module links, active state, keyboard-accessible mobile dialog and skip link.
- Dashboard, customer/patient/catalog lists and login redesigned; patient
  guardian actions wrap on small screens. All existing data contracts retained.
- Route skeleton/error boundaries and loading/search-empty/retry feedback.
- `DocumentNonceProvider` keeps branding styles authorized by the initial
  document CSP across RSC navigation. Sign-in opens a complete authenticated
  document. Root/staff/portal theme resolution and public asset URLs retained.
- New private BFF `POST /api/session/logout` forwards only the staff credential
  to the existing API logout command, rejects foreign origins and clears the
  cookie only after confirmed revocation or expired/missing session. An outage
  is recoverable. Public auth proxy allowlist remains unchanged.
- No migrations, new private aggregates, backend endpoints, sensitive fields,
  dependencies or PRD changes. Root dev now builds the shared UI package before
  starting servers, alongside the pending DEV-001 fixes.
- Audit and roadmap: [[UX-AUDIT-2026-10-26]].

### Automated verification (Windows / Node 22.14.0)

| Check                                                                                                                           | Result                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @newsaas/ui build`                                                                                               | Pass                                                                                                                                                                      |
| UI typecheck / lint                                                                                                             | Pass                                                                                                                                                                      |
| UI unit suite                                                                                                                   | 36/36 pass                                                                                                                                                                |
| Web lint / typecheck                                                                                                            | Pass                                                                                                                                                                      |
| `pnpm --filter @newsaas/web build` and postbuild output verification                                                            | Pass                                                                                                                                                                      |
| Web suites covering navigation, dialog, activity, CSP, nonce lifetime, appearance, layouts, sign-in, lists/details and sign-out | 119/119 pass across 20 files                                                                                                                                              |
| Full web unit run before final targeted fixes                                                                                   | 1363 pass / 11 fail across 126 files; three layout/provider mock failures fixed and verified in the final targeted run; eight existing agenda/portal date failures remain |
| Formatting of UX source/docs and `git diff --check`                                                                             | Pass                                                                                                                                                                      |

Vitest runs with `NODE_OPTIONS=--experimental-strip-types` and at most two
workers. The full suite is not green: [[TD-064]] records stale Asuncion timezone
data in this runtime. No date assertions or business rules were relaxed. The
final targeted run includes new nonce/activity tests collected after the full
run; its count must not be presented as a new full-suite total. The build warns
about existing TypeScript project references and Next ESLint plugin detection,
but exits successfully.

### Browser verification

- Local demo environment: Docker PostgreSQL/Redis/MinIO, API on 3001 and web
  on 3000. Production build also exercised with `next start`.
- Demo owner sign-in, dashboard data, sign-out to login and sign-in again.
- Customer search and Ana detail (contacts/addresses), catalog search and
  service detail, patient search/no-results/reset and Bobby clinical detail.
- Desktop 1440 x 1000 and mobile 390 x 844; no horizontal page overflow in
  reviewed dashboard/list surfaces. Mobile dialog opens with focus inside,
  closes with Escape, returns focus to its trigger and closes after navigation.
- Light/dark/system switch; validated primary remains `173 80% 28%` after
  authenticated light-mode SPA navigation. Production navigation did not log new
  CSP errors. Existing dev nonce hydration warnings were observed; no CSP
  relaxation or blanket warning suppression was introduced.
- Screenshots saved in the local Codex visualization workspace under
  `ux-review/`; they are local review evidence, not deployed assets.

### Limits

Story remains **review** because the required full test gate has existing
failures. No full clinical/financial E2E transaction was executed for this
visual change. Route-error recovery is implemented and type/build verified;
deliberate production fault injection was not performed. Search currently
filters existing API results locally; [[TD-026]] requires a separate
pagination/search contract. The portal and every individual business form were
not comprehensively redesigned. Localization, shared confirmations and
task-level usability work are prioritized in the audit. Existing changes from
DEV-001 are preserved.
