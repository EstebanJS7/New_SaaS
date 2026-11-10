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

| ID  | Specs    | Route                        | Status  | Commit / evidence |
| --- | -------- | ---------------------------- | ------- | ----------------- |
| T1  | S1-S3,S5 | delegated (context backstop) | done    | see L4            |
| T2  | S4       | tbd                          | pending |                   |
| T3  | S1-S6    | tbd                          | pending | browser + docs    |

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
