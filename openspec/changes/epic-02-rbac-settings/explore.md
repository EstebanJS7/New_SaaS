# Exploration: EPIC-02 — RBAC / Entitlements / Tenant Settings

Date: 2026-08-25 · Phase: explore (research only; no application code touched)

## Verdict Summary

| #   | Question                                       | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | What does "RBAC complete" mean beyond records? | Records are **fully inert**: `roleCode` reaches the RequestContext but is never consulted; no policy evaluation exists anywhere. Missing: an enforcement point, per-domain permission keys (seed has only 6), and a role-assignment surface (memberships today come only from the guarded demo seed). PRD §9 mandates backend enforcement but does NOT enumerate endpoint→permission mappings — keys must be derived per epic as domains land. |
| 2   | Enforcement design?                            | A third global guard link (`AuthGuard → TenantActiveGuard → PermissionGuard`) driven by a `@RequirePermissions` decorator mirrors the proven `@Public`/Reflector pattern and the pinned wire-order convention. Explicit service-level checks remain necessary where resource conditions apply. Hybrid recommended. Default posture of the guard (deny-by-default vs opt-in) is a product question.                                             |
| 3   | Tenant Settings?                               | **Schema gap confirmed**: no `TenantSettingNamespace` model exists in `schema.prisma`. Registry/service shape is well-specified by docs. But NO downstream epic consumes settings until EPIC-07 (Scheduling) — shipping all seven documented namespaces now would be speculative. Ship infrastructure + minimal v1 namespace set; defer the rest to consuming epics. Which namespaces land in v1 = product question.                           |
| 4   | Entitlements gaps?                             | `EntitlementsService.has()` has **zero call sites** outside its own module/tests. No plan-switching surface exists (plans inert, grants ops/demo-seed only). Enforcement point(s) must be created in this epic or entitlement gating keeps sliding rightward (EPIC-03 Phase B already deferred it once).                                                                                                                                       |
| 5   | Downstream hard deps?                          | EPIC-04/EPIC-09 need exactly: a working enforcement mechanism + their permission keys seeded into catalog/matrix + role-assignment semantics settled. Neither needs settings namespaces to start.                                                                                                                                                                                                                                              |
| 6   | Risks / questions                              | 6 candidate product questions below; biggest scope risk is building a role-CRUD admin surface the PRD never asks for.                                                                                                                                                                                                                                                                                                                          |

## Findings

### 1. Gap analysis — what "RBAC complete" means beyond records

Current state (all verified in code):

- `Role`, `Permission`, `RolePermission`, `TenantMembership` exist in
  `packages/database/prisma/schema.prisma` (lines ~141–240); reference seed
  (`packages/database/src/reference-seed.ts`) upserts 6 roles × 6 permission
  keys via `ROLE_PERMISSION_MATRIX`.
- `TenantActiveGuard` resolves the active membership server-side and stores
  `tenantId/membershipId/roleCode` in the ALS RequestContext
  (`apps/api/src/context/request-context.service.ts`). `roleCode` is carried
  **but read by nothing**.
- The only private routes are the read-only `MembershipsController`
  (`GET /memberships`, `GET /memberships/:id`) — no authorization beyond
  authentication+tenancy, deliberately ("RBAC scope fence", schema comment:
  "Policy evaluation belongs to EPIC-02").
- Membership creation happens ONLY through the guarded demo seed CLI; there is
  no invite/assign API.

Gaps this epic must close for "RBAC complete":

1. **Enforcement point** — nothing evaluates permissions today.
2. **Permission catalog coverage** — the 6 seeded keys cover clinical,
   inventory-transfer, cash-close, fiscal-issue, membership-manage and
   scheduling examples. PRD §9 gives naming (`domain.resource.action`) plus 5
   example keys, not an exhaustive matrix. There is NO authoritative
   endpoint→permission mapping anywhere in the vault. Each downstream domain
   epic (Customers, Catalog…) must contribute its own keys when it lands —
   EPIC-02 should own the _mechanism_ and the key-expansion _convention_, not
   guess every future key.
3. **Role assignment** — `users.membership.manage` exists in the matrix with
   name "Manage staff memberships", implying an anticipated mutation surface,
   but none exists. Options: full assignment API now vs seed/ops-only until a
   staff-invitation epic. Note PRD §36's acceptance journey starts with "invite
   staff", so this surface eventually exists somewhere — the question is whether
   it is EPIC-02 or later.
4. **Custom roles** — PRD §9 defines six FIXED seed roles and says nothing about
   tenant-defined roles. Absent a requirement, role CRUD is out of scope
   (complexity budget).
5. **Audit of RBAC mutations** — `AuditWriter.append()` exists (append-only,
   requestId-stamped). If EPIC-02 ships membership-role changes or settings
   writes, those become the first business audit emitters beyond login events.

### 2. Enforcement design options

Existing chain (pinned by import order in `app.module.ts` +
`tenancy.wiring.test.ts`):

```text
AuthGuard (session → userProfileId)
  → TenantActiveGuard (membership → tenantId/membershipId/roleCode)
    → handler
```

Both guards: global `APP_GUARD`s, Reflector-based `@Public` skip, fail-closed
with `DomainError` (`UNAUTHENTICATED` / `FORBIDDEN`). Error registry
(`packages/shared/src/errors/registry.ts`) is frozen-append-only; `FORBIDDEN`
(403) already covers permission denial — a distinct `PERMISSION_DENIED` code
would be a new append-only entry, not required by anything yet.

**Option A — decorator-based `@RequirePermissions('domain.resource.action')`
guard** (third chain link):

- Pros: mirrors `@Public`/Reflector idiom exactly; declarative route metadata
  enables tests/enumeration ("every private route declares its contract"); fits
  the established wire-order + fail-closed conventions; cheap wiring test
  precedent exists.
- Cons: coarse — cannot express resource-level conditions (e.g. "own draft
  only"); default posture must be decided: deny-by-default (every private route
  MUST declare, else FORBIDDEN — safest, but forces annotating existing routes
  like `/auth/me` exemptions) vs opt-in annotation (silent fail-open risk on
  forgotten routes).

**Option B — explicit service checks** (`AuthorizationService.assert(key)`
called inside application services):

- Pros: works outside HTTP (future BullMQ worker jobs); expresses conditional/
  resource-scoped logic naturally; no reflection magic.
- Cons: easy to forget on a route (no static guarantee); duplicates boilerplate
  across controllers/services; not enumerable for audits/tests.

**Recommendation: hybrid.** Global `PermissionGuard` with decorator metadata as
the mandatory coarse gate (decide default-deny vs default-opt-in — product
question Q2), plus service-level checks reserved for genuinely conditional
cases. Entitlements follow the same split: an `@RequireEntitlement('code')`
decorator (or guard check reading route metadata) for capability-gated routes,
while `EntitlementsService.has()` remains the programmatic boundary for
non-route logic.

Performance note: permission resolution requires role→permission joins per
request unless cached. The membership lookup already runs each request; adding
permission-set resolution in the same guard pass is one more query (or a Redis
cache keyed by roleId with invalidation on matrix change — decide during design;
no caching shipped for entitlements in EPIC-01 either).

### 3. Tenant Settings

- **Storage gap confirmed**: grep of `schema.prisma` finds no
  `TenantSettingNamespace` (or any settings table). The doc-recommended model
  (`docs/03-architecture/TENANT-SETTINGS.md`): unique `(tenantId, namespace)`,
  `schemaVersion Int`, `data Json`. This migration belongs in EPIC-02.
- **Registry shape** (doc-mandated): code-level
  `SettingsDefinition<T> { namespace, version, zodSchema, defaults }`; access
  ONLY through typed `TenantSettingsService.get(namespace, ctx)` /
  `.update(namespace, patch, ctx)`; unknown keys rejected; defaults returned
  when row absent; writes require explicit `*.settings.manage`-style
  permissions; secrets/branding/entitlements explicitly excluded.
- **What downstream epics will actually consume**:
  - EPIC-04 Customers: nothing identifiable in PRD §11 (pure aggregate CRUD).
  - EPIC-09 Catalog/Taxes: tax rates are "data/configuration" (PRD §15) —
    arguably catalog data rows rather than a settings namespace; possibly
    `sales.defaultCurrency` at pricing level.
  - EPIC-07 Scheduling: first REAL consumer — `scheduling.conflictPolicy`,
    `portalBookingPolicy`, `defaultAppointmentMinutes` (PRD §14 conflict
    validation).
  - Branding-B: explicitly NOT here — branding stays its own capability
    (`TENANT-SETTINGS.md` "Not stored here"; AGENTS.md branding section).
- **Implication**: the seven documented namespaces have zero consumers inside
  EPIC-02 itself. Shipping the infrastructure (table + service + versioning +
  isolation/defaults/rejection tests) plus ONE thin namespace as proof
  (candidate: `sales` with `defaultCurrency`, or even a placeholder consumed by
  nothing but tested) satisfies TENANT-SETTINGS.md without speculative schema
  definitions that may churn. Alternatively pre-register all seven namespaces
  with defaults-only schemas — cheaper than it sounds, but invites drift before
  real requirements arrive. Product question Q3.

### 4. Entitlements gaps

- `has()` call sites: NONE outside `entitlements.module.ts` /
  `entitlements.service.ts` / tests. It is a boundary awaiting consumers.
- EPIC-03 archive confirms `custom_branding` entitlement gating was explicitly
  deferred out of Phase A/B completion ("BRAND-006 backend/public DTO;
  entitlement gating" listed as pending in the verify report).
- Plan machinery is inert by design: starter plan maps all 12 codes, mapping
  grants nothing; grants are explicit `tenant_entitlement` rows created only by
  demo seed. There is NO plan-switching surface, no subscription state, no
  billing semantics (those belong to Billing EPIC-14 territory anyway).
- EPIC-02 decision needed: create the first enforcement point (decorator +
  guard, and/or require `veterinary` capability in downstream epics' routes),
  and settle whether grant management stays ops-only (direct DB/ops script) —
  product question Q5.

### 5. What downstream epics REALLY need from EPIC-02

| Dependent                        | Hard dependency                                                                                                                    | Soft/no dependency                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| EPIC-04 Customers                | PermissionGuard live + `customer.*` keys added to catalog/matrix + role-assignment story settled (who gets CUSTOMER manage rights) | Settings namespaces; entitlements (unless a capability gate is wanted on customers)      |
| EPIC-09 Catalog/Taxes            | Same mechanism + `catalog.*`/`taxes.*` keys                                                                                        | Settings (maybe `sales.defaultCurrency` later); entitlement gate optional (`inventory`?) |
| EPIC-03 Phase B (parallel track) | `custom_branding` enforcement point                                                                                                | —                                                                                        |
| EPIC-07 Scheduling               | `scheduling.*` keys; scheduling settings namespace                                                                                 | —                                                                                        |

Common denominator: **the enforcement mechanism + key-expansion convention +
assignment semantics**. That is the true critical path; settings are not
blocking anyone today.

### 6. Harness/conventions EPIC-02 must preserve

- Guard wire-order pattern: module import order pins APP_GUARD registration; a
  wiring test asserts source order (`tenancy.wiring.test.ts` precedent);
  chain-contract defense (fail CLOSED if upstream context missing).
- Cross-tenant isolation e2e spec fences every new private aggregate — settings
  and any membership-mutation endpoints need the same treatment.
- Reference seed idempotency contract (upserts by natural keys, CI double-run
  probe) — expanded permission catalogs must keep rerun-no-op guarantees.
- DTO rule: no raw Prisma models; zod-validated params; error envelope via
  `DomainError`.

## Approaches

1. **Mechanism-first slice** (recommended): PermissionGuard + decorator,
   entitlement decorator/gate, settings table + typed service + one namespace,
   permission-key expansion CONVENTION (not exhaustive future keys), optional
   membership-role mutation API behind `users.membership.manage`.
   - Pros: unblocks EPIC-04/09 exactly at their stated dependency; no
     speculative scope; fits complexity budget.
   - Cons: leaves some documented namespaces unregistered until consumers appear
     (needs explicit deferral record).
   - Effort: Medium

2. **Full platform slice**: everything in 1 + all seven settings namespaces
   registered + role CRUD + custom roles + plan management surface.
   - Pros: "complete" feeling platform layer; no later touching of RBAC.
   - Cons: builds role CRUD/custom roles/plan UI nobody asked for (PRD fixes six
     roles; plans are inert by design); settings schemas drift before
     requirements; violates "prefer deleting abstraction over adding one".
   - Effort: High

3. **Minimal gate slice**: PermissionGuard + entitlement gate only; settings
   deferred entirely to EPIC-07.
   - Pros: smallest path to unblock Customers/Catalog.
   - Cons: leaves the roadmap epic name ("RBAC/Entitlements/**Tenant
     Settings**") undelivered; EPIC-04/09 would still depend on a re-opened epic
     for keys; storage-gap debt persists.
   - Effort: Low–Medium, but under-delivers the epic contract.

## Risks

1. **Scope explosion into role administration** — building custom-role CRUD /
   permission-editing UI contradicts PRD §9 fixed seeds and the complexity
   budget; must be fenced explicitly in the proposal.
2. **Permission-key guessing** — inventing keys for domains that haven't been
   designed (POS, fiscal) creates an unstable catalog and forced renames later
   (keys are natural keys in upserts); expansion should ride with each domain
   epic.
3. **Fail-open default posture** — an opt-in decorator guard silently skips
   authorization on forgotten routes; deny-by-default forces annotating existing
   routes and needs exemption handling (`/auth/*` parity). Wrong choice here is
   a security defect either direction.
4. **Per-request authorization cost** — extra role→permission query per request
   (and per-check entitlement queries) with no caching precedent; acceptable
   now, but the design should note the Redis-cache escape hatch without shipping
   it prematurely.
5. **Settings versioning machinery built before consumers** — over-engineering
   risk; ship migration/defaulting tests with the single v1 namespace and let
   real migrations be exercised by EPIC-07+.
6. **Audit expectations** — if membership-role changes land, they become the
   first privileged audited mutations; skipping audit there sets a bad precedent
   for later financial operations.

## Candidate Product Questions (for maintainer)

1. **Role assignment API now or defer?** Ship membership role
   assign/change/remove endpoints gated by `users.membership.manage` in EPIC-02,
   or keep memberships ops/seed-only until a dedicated staff-invite epic (PRD
   §36 implies "invite staff" eventually)? Without ANY assignment surface,
   multi-role staffing can't be demonstrated beyond the demo seed.
2. **Guard default posture** — deny-by-default (every private route MUST declare
   `@RequirePermissions`, missing metadata → FORBIDDEN) vs opt-in annotations
   with a lint/test that flags undeclared mutating routes?
3. **Settings namespaces in v1** — register only the infrastructure + one
   proving namespace (deferring the other six to consuming epics), or
   pre-register all seven documented namespaces defaults-only?
4. **Custom roles confirmed out?** — confirm the six seeded roles are fixed for
   MVP (no tenant-defined roles, no role/permission editing UI), with any future
   need handled as a new epic.
5. **Plan/grant management surface** — keep entitlement grants and plan
   switching strictly ops-only (scripts/SQL) for MVP, deferring self-service
   upgrade flows indefinitely?
6. **Audit of RBAC/settings changes** — should EPIC-02 emit audit entries for
   membership role changes and settings updates via the existing AuditWriter
   (recommended), or is auditing deferred to EPIC-20 hardening?

## Ready for Proposal

Yes — conditional on maintainer answers to Q1 (assignment API timing), Q2 (guard
default posture) and Q3 (settings v1 namespace set), which together fix the
proposal's scope fence. Q4–Q6 can default to the recommendations above (fixed
roles; ops-only grants; audit RBAC mutations) if the maintainer prefers to
resolve them inside the proposal. Per the EPIC-01 precedent, the missing
`docs/01-roadmap/EPIC-02-RBAC-Entitlements-Tenant-Settings.md` epic file must be
created as part of the change (docs+code atomicity), deriving scope from PRD
§§9, 10, 38 and the governance docs (TENANT-SETTINGS.md, ENGINEERING-RULES
authorization/audit sections).
