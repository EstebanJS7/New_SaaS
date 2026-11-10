# Caller capabilities in the staff web (UX-037)

Objective: the staff web knows the caller's permissions and the clinic's
features, and hides what the caller cannot use. Branch `feat/web-capabilities`
stacked on `feat/tenant-settings-screen` (`5c3ef6d`). Delivery: `ask-on-risk`.
Runners: Vitest (api, web), Playwright lane.

## Specs

- S1: "lo de lo permisos es algo que debemos de agregar para que sea lo más
  funcional posible". API `GET /memberships/me/capabilities` →
  `{ permissions, features }` for the session's own membership and tenant only
  (assumption: authenticated + active membership, no extra permission; 401/403
  as today).
- S2: Web loads capabilities once per request in the staff layout (like
  branding) and shares them; nav and every screen that already accepts
  `permissions`/`entitlements` receive them.
- S3: Every staff module hides (or disables with a reason) actions the caller
  cannot perform; backend remains the authority.
- S4: Load failure → today's behavior (show all; API refuses).
- S5: Test-first, docs, browser gate with a limited role; CFG-001's live gating
  criterion closes.

## Tasks

| ID  | Specs | Route                                              | Status | Commit / evidence |
| --- | ----- | -------------------------------------------------- | ------ | ----------------- |
| T1  | S1    | delegated (context backstop, with T2)              | done   | see L3            |
| T2  | S2,S4 | delegated (context backstop, with T1)              | done   | see L3            |
| T3  | S3    | delegated (parallel: T3a commerce, T3b care/admin) | done   | see L4            |
| T4  | S1-S5 | delegated (context backstop)                       | done   | see L5-L6         |

Risk: item 2 (exposes the caller's own permissions; guards), item 3 (shared
memberships proxy allowlist, nav). Independent verifier at feature end.

## Log

- L1 (2026-11-10): "lo de lo permisos es algo que debemos de agregar para que
  sea lo más funcional posible"
- L2 (2026-11-10): Map: API already has `GET /memberships/me/permissions`
  (membership.controller.ts:108, `@RequirePermissions()`); memberships proxy
  allowlist refuses it only because nobody had decided to expose it
  (memberships-proxy-path.ts:7-14). EntitlementsService only has `has()`; no
  list. Staff layout `apps/web/src/app/(app)/layout.tsx` already fetches
  branding server-side with the session cookie. NavSidebar and several screens
  accept optional permissions/entitlements but nothing passes them.
- L3 (2026-11-10): T1+T2 done (delegated; resumed after the session restart).
  API `GET /memberships/me/capabilities` → sorted `{permissions, features}`
  (EntitlementsService.listGranted; same permission resolver as me/permissions),
  route probe updated, integration test with two tenants. Web: memberships proxy
  allows only `GET me/capabilities` (me/permissions still refused); staff layout
  loads capabilities server-side once per request, failure → unknown (show all);
  CapabilitiesProvider/useCapabilities; nav and already-gated screens (settings
  general, reports, imports, patient detail) fed. Full web 2475 pass, full API
  2147 pass/277 skipped, typecheck/lint/ prettier pass; parent rerun API
  capabilities+probe 32/32, web proxy/loader/ settings page 43/43. Risk: items 2
  and 3 (verifier at feature end).
- L4 (2026-11-10): Shared helper canUse/useCan committed by the parent (08fe529,
  RED 5 → GREEN 5). T3 ran as two parallel writers with disjoint surfaces. T3a
  (bab769c): catalog, suppliers, purchases, inventory, sales, cash, billing,
  fiscal — per-module action→permission maps citing controllers; sales/cash/
  billing/fiscal also need their feature; cash close disabled with reason;
  focused 711 pass. T3b (e5ffb16): agenda, customers, patients/clinical
  (veterinary feature), notifications, imports, reports, settings team/
  branches/branding (custom_branding)/fiscal, dashboard; no-access states when
  the read permission is missing; focused 932 pass. Parent seam check: full web
  197 files / 2594 tests, typecheck, lint, prettier pass. Known gaps: direct URL
  to /new and /edit pages in commerce only hidden at entry (API 403 handled by
  forms); dashboard period selector stays visible.
- L5 (2026-11-10): T4 (ef6d391): capabilities.spec.ts with an invited
  VETERINARIAN (support/team.ts) vs the owner; member suspended at the end.
  Parent then gated every nav entry by its read/manage permission (cc6ddf5;
  Pacientes also needs veterinary; Inicio/Marca always), RED 18 → GREEN, three
  tests pinning the old nav updated; spec 1/1, full lane 36/36.
- L6 (2026-11-10): Independent verifier: S1–S4 PASS (40+ mappings matched
  controllers/services; no cross-tenant/member leak; fail-open holds), S5
  partial (CFG-001 live box only half provable without partial-settings seed
  data or a tenant lacking features). Blocker B1: layout.test.tsx fixture still
  expected «Caja» with only sales.read after cc6ddf5 (parent ran shell tests,
  not the layout test). Fixed by adding cash.read/customers.read to the fixture;
  layout 16/16; full web 197 files / 2613 tests green. Advisories: counter needs
  create+complete; booking requests need read+manage (API needs manage only);
  dashboard POS shortcut on sales.create alone.
