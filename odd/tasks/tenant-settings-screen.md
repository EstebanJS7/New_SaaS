# Tenant settings screen (CFG-001)

Objective: staff screen to edit the tenant settings the API already serves.
Branch `feat/tenant-settings-screen` from `main` `f32b716`. Delivery:
`ask-on-risk`. Runners: Vitest (web, api), Playwright lane. Forecast: ~1,200
authored lines.

## Specs

- S1: "Configuración › General" page with one section per namespace (sales,
  portal, notifications, scheduling), each shown and saved only with its
  permission and, where required, its feature; backend stays the authority.
- S2: Ventas: `requireCustomerForInvoice` editable; `defaultCurrency` read-only
  (assumption: only PYG invoicing exists today).
- S3: Portal: `bookingRequiresApproval`. Notifications: reminder lead hours (API
  range) and channels (≥1, no repeats).
- S4: Agenda: `conflictPolicy`; availability windows and blocks editor
  (professional, branch, weekday/time or from/to), user choice "Todo de una
  vez".
- S5: Web proxy accepts GET/PUT for the four namespaces; everything else
  rejected as before.
- S6: Test-first; docs with code; browser gate; no new namespaces/fields, no
  concurrency control (TD-010 stays).

## Tasks

| ID  | Specs    | Route                        | Status | Commit / evidence |
| --- | -------- | ---------------------------- | ------ | ----------------- |
| T1  | S1-S3,S5 | delegated (context backstop) | done   | see L4            |
| T2  | S4       | delegated (context backstop) | done   | see L5            |
| T3  | S1-S6    | delegated (context backstop) | done   | see L6            |

Risk: item 2 only if permission gating is wrong (backend re-checks); item 3 for
the shared settings proxy (pin existing behavior).

## Log

- L1 (2026-11-10): "hazlo asi, luego del pr continuamos con las pantallas"
  (after the UI coverage report listing the missing settings, roles and stock
  adjustment screens).
- L2 (2026-11-10): Scope question; user selected "Todo de una vez" (simple
  settings plus availability/blocks editor).
- L3 (2026-11-10): Map: API `GET`/`PUT /settings/:namespace` with a patch body;
  registry `apps/api/src/settings/registry.ts` (sales: defaultCurrency,
  requireCustomerForInvoice, feature sales; scheduling: conflictPolicy,
  availability[], blocks[]; portal: bookingRequiresApproval, feature portal;
  notifications: lead hours, channels). Web proxy allowlist only
  `["scheduling"]` (`apps/web/src/app/api/settings/[[...path]]/route.ts:20`).
- L4 (2026-11-10): T1 done (delegated). /app/settings/general with Ventas,
  Portal, Notificaciones, Agenda conflictPolicy; patch only changed keys;
  currency read-only; lead hours 1-168 and channels mirrored with a drift test
  reading packages/notifications source; proxy allowlist four namespaces with
  unknown/extra-segment/% behavior pinned; nav «General» with optional
  requiredAnyPermission. Web 2431 pass, typecheck/lint/prettier pass; mutation
  checks per rule. Parent fix: validation refusal now Spanish-only (UX-036 no
  English fallback), RED→GREEN, focused 83/83. Known limitation: web shell has
  no caller permissions/features, so gating is component-level only (same as
  imports/reports); recorded in the story. Extension point for T2:
  scheduling-section.tsx.
- L5 (2026-11-10): T2 done (delegated). Availability/blocks editor in the Agenda
  section: tables + add/edit/remove, one save sending only changed full arrays,
  never conflictPolicy; malformed stored lists → not editable. Semantics from
  code: weekday 0=Sunday, window minutes are clinic-local (America/Asuncion,
  appointment-invariants.ts:69-136), blocks are UTC instants converted with
  agenda-time.ts helpers (DST gap refused); 00:00 end → 1440. Pickers from GET
  /appointments/options (scheduling.appointment.read, held by both seeded
  settings-manager roles). 14 new tests RED→GREEN; web 2445 pass,
  typecheck/lint/prettier pass; parent rerun settings 43/43. Limitation: saving
  one Agenda form reloads and discards unsaved edits in the other.
- L6 (2026-11-10): T3 done (delegated). tenant-settings.spec.ts drives all four
  sections through the screen (browser in America/Los_Angeles to prove clinic-
  zone times), checks API persistence, refuses out-of-range lead hours with no
  PUT, and restores every namespace exactly in finally (DB table identical after
  runs; caveat: demo tenant now has stored rows equal to defaults — no DELETE
  exists). Spec alone 2/2, sensitive specs 9/9, full lane 35/35; parent rerun
  1/1. No product defect. Permission/feature box stays unticked (live app has no
  caller claims). Risk: none (requested proxy widening; existing proxy and nav
  behavior pinned by tests).
- L7 (2026-11-10): Live permission/feature gating closed by UX-037
  (feat/web-capabilities): capabilities loaded in the shell, browser proof for a
  no-settings role, a single-settings-key role and a clinic without
  sales/portal. CFG-001 status done (recorded on the UX-037 branch).
