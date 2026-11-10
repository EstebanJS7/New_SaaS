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

| ID  | Specs | Route                                 | Status  | Commit / evidence |
| --- | ----- | ------------------------------------- | ------- | ----------------- |
| T1  | S1    | delegated (context backstop, with T2) | done    | see L3            |
| T2  | S2,S4 | delegated (context backstop, with T1) | done    | see L3            |
| T3  | S3    | tbd                                   | pending |                   |
| T4  | S1-S5 | tbd                                   | pending | browser + docs    |

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
