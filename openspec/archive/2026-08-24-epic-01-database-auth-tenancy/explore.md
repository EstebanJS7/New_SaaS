# Exploration: EPIC-01 — Database / Auth / Tenancy

Date: 2026-08-24 · Phase: explore (research only; no application code touched)

## Verdict Summary

EPIC-01 has **no epic file and no story definitions anywhere in the docs tree**
(`docs/01-roadmap/` contains only EPIC-00, EPIC-03 and ROADMAP.md;
`docs/02-stories/` contains only BRAND-001). The PRD defines its _requirements_
implicitly through §7 (Multi-tenancy), §8 (Identity), §9 (RBAC seeds), §10
(Entitlements), §28 (API error contract), §29 (Security), §36 (MVP acceptance
journey) and §42 (Demo Tenant) — but never enumerates EPIC-01 stories or
acceptance criteria. An `EPIC-01-Database-Auth-Tenancy.md` file MUST be created
before proposal, derived strictly from those PRD sections.

The codebase today has **zero persistence, zero identity, zero tenancy**: no
Prisma schema exists anywhere in the repo, `apps/api` ships only a health
module, and there is no error filter, request-id plumbing, tenant-context guard,
or audit scaffolding. Everything EPIC-01 touches is greenfield on top of an
otherwise solid foundation (env validation with `DATABASE_URL` already required,
postgres+redis compose services, guarded demo-seed CLI, internal event
dispatcher).

One structural tension dominates the design space: **PRD §3/§8 prefer external
managed authentication (e.g. Supabase Auth) for MVP, while the architecture
freeze (§43) forbids introducing a new authentication strategy/provider without
an accepted ADR.** Since no auth infrastructure of any kind exists yet, _any_
choice here (first-party email+password sessions, or a managed provider) either
fits inside the freeze trivially (first-party) or requires an ADR (managed
provider). This is the single biggest product question for the maintainer.

## Findings

### 1. What the PRD actually mandates for EPIC-01

Direct mandates found (by section):

| PRD § | Mandate relevant to EPIC-01                                                                                                                                                                                            |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5     | Core domains include `identity`, `tenancy`, `branches`, `plans/entitlements`, `audit`                                                                                                                                  |
| 7     | Every company is a Tenant; every private aggregate tenant-scoped; tenant authority from **server-side authenticated request context**, never frontend `tenantId`; cross-tenant UUID → `404`; isolation tests mandatory |
| 8     | Domain records: `UserProfile`, `TenantMembership`, `Role`, `Permission`, `CustomerPortalAccess`; staff and portal are separate security boundaries; "external managed authentication preferred"                        |
| 9     | Seed roles OWNER/ADMIN/VETERINARIAN/RECEPTIONIST/CASHIER/INVENTORY_MANAGER; permission naming `domain.resource.action`; backend enforcement mandatory                                                                  |
| 10    | Capability-based entitlements (`entitlements.has("...")`); 12 initial feature codes incl. `custom_branding`, `multi_branch`                                                                                            |
| 10.1  | Public tenant lookup resolves tenant from trusted **slug/host mapping**; custom domains explicitly NOT required for MVP but brand resolution should prepare for slug → subdomain → custom domain                       |
| 21/28 | API base `/api/v1`; DTO-only responses; stable error shape `{error:{code,message,requestId}}`                                                                                                                          |
| 29    | Secure session cookies, controlled CORS, security headers, rate limits on sensitive endpoints, sanitized logs                                                                                                          |
| 30    | `/health/live`, `/health/ready`; structured logs with request ID                                                                                                                                                       |
| 36    | Journey starts with "register organization → create branch → invite staff" — implies tenant provisioning + branches + staff invitations eventually, though not necessarily all in EPIC-01                              |
| 41    | Data classification applies to new sensitive fields (credentials = RESTRICTED; password hashes must never be logged)                                                                                                   |
| 42    | Reproducible synthetic demo tenant seed, guarded from production                                                                                                                                                       |

**Missing artifact:** `docs/01-roadmap/EPIC-01-Database-Auth-Tenancy.md`. Per
DOCUMENTATION-RULES it needs YAML frontmatter (`id: EPIC-01`,
`depends_on: [EPIC-00]`, `prd_sections: ["5","7","8","9","29","30"]`) and status
vocabulary. ROADMAP.md row must flip to the active status when work starts.
Stories do **not** exist — they must be authored during the SDD proposal/spec
phase, not silently invented here.

### 2. Tenancy model

- **Identification:** PRD never picks slug vs subdomain vs header for staff
  routes. It only fixes two things: (a) the _public_ branding endpoint uses a
  trusted slug/host mapping (`GET /api/v1/public/tenants/:slug/branding`), and
  (b) staff tenant authority must come from the authenticated session's
  membership, i.e. **the effective tenant for staff APIs derives from the
  `TenantMembership` bound to the session — not from any client-supplied
  header/slug**. This means EPIC-01's guard is primarily an
  _authentication-derived_ tenant context, with slug/host resolution needed only
  for unauthenticated public endpoints.
- **Branch vs Tenant:** Tenant = the company (billing/entitlement/branding
  unit). Branch = physical location used by scheduling filters, cash registers,
  inventory transfers (`multi_branch` is itself an entitlement code, implying
  some tenants are single-branch). PRD §36 journey includes "create branch", but
  nothing forces branch tables to land in EPIC-01 — a deferred-but-modeled
  choice is viable.
- **Resolution location:** NestJS guard/middleware producing a
  `RequestContext { requestId, userId?, tenantId?, role? }` consumed by
  services/repositories. Nothing exists yet; this is new plumbing.

### 3. Identity / auth

- Staff vs portal identities are separate boundaries (PRD §8): staff via
  `UserProfile` + `TenantMembership`; customers via `CustomerPortalAccess`.
- Stack freeze: no NEW auth provider without ADR. But the freeze baseline (PRD
  v1.3 stack list) contains **no auth library at all** — so:
  - First-party email+password with secure httpOnly session cookies (sessions in
    PostgreSQL or Redis, both already approved stores; argon2/bcrypt hashing) is
    implementable _within_ the freeze as plain application code — arguably not a
    "new auth provider" at all.
  - Adopting Supabase Auth (PRD's stated preference) = new authentication
    provider = requires an accepted ADR first.
- Minimal compliant slice candidates: email+password login/logout/session
  middleware for STAFF only, deferring magic links, MFA, password-reset email
  flows, and the entire portal identity to later epics (password reset needs
  email delivery which lands with Notifications EPIC-17).

### 4. Database bootstrap

- **No Prisma schema/package exists.** PRD §4 layout includes
  `packages/database`, which was not created by EPIC-00 (its packages list
  matches PRD except `database`). Decision point: create `packages/database`
  (Prisma client + schema + migrations) vs putting Prisma inside `apps/api`. PRD
  §4 suggests the package; ENGINEERING-RULES say deployables stay web/api/worker
  — a shared client package is consistent with both.
- `DATABASE_URL` is already mandatory in `apps/api/src/config/api-env.schema.ts`
  and `.env.example` points at the compose postgres (16-alpine, healthchecked).
- Migration workflow: `prisma migrate dev` locally; migrations committed; CI
  currently runs lint/typecheck/test/build only — whether CI applies migrations
  against a service container is a scoping question.
- **Seeding policy:** the demo-seed CLI (`.opencode/commands/demo-seed.ts`) is
  guarded by `ENABLE_DEMO_SEED=true` and tested in
  `packages/shared/src/demo-seed.test.ts`. EPIC-01 seeding (roles, feature
  codes, demo tenant) should extend this same guarded entrypoint — reference
  data (roles/entitlement codes) may warrant a separate non-guarded idempotent
  seed vs the guarded synthetic demo tenant, matching PRD §42's distinction.

### 5. Entitlements — minimal model now vs later

EPIC-03 Phase B gates branding edits on `custom_branding` entitlement. Full
Plan/billing machinery belongs to EPIC-02. Minimal EPIC-01 slice that unblocks
Phase B without stealing EPIC-02 scope:

- `FeatureCode` enum/table seeded with the 12 PRD codes;
- a tenant-level entitlement grant record (even if flat, e.g. rows in
  `tenant_entitlement`);
- an `EntitlementsService.has(tenantId, code)` application boundary so callers
  never hardcode plan checks (PRD §10 rule).

EPIC-02 can later add plans, subscription state, and settings namespaces on top
without breaking the boundary.

### 6. Existing API skeleton gaps (everything EPIC-01 must add)

Current surface: `app.module.ts`, `config/api-env.{ts,schema.ts}` (zod,
fail-fast), `health/` module/controller/test, e2e env-validation spec. Gaps:

- **No global exception filter** implementing the PRD §28 error envelope
  (`{error:{code,message,requestId}}`) — needs a domain-error type with stable
  codes (e.g. `TENANT_NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_FAILED`) and
  Fastify-compatible filter.
- **No request-id plumbing** — Fastify `genReqId` hook + response header +
  structured log binding (PRD §30).
- **No tenant/auth guard, no RequestContext** propagation (AsyncLocalStorage is
  the natural NestJS/Fastify-compatible mechanism; no new dependency).
- **No audit scaffolding** despite audit being a listed Core domain and an
  EPIC-03 Phase B criterion ("branding changes are audited") — EPIC-01 should
  ship at minimum the append-only `AuditLog` table + writer service, even if no
  business events write to it yet.
- **No Prisma lifecycle integration** (PrismaService with
  `onModuleInit`/shutdown hooks).
- Health module lacks `/health/ready` (DB/Redis ping) — cheap add once Prisma
  exists.
- `@newsaas/shared` currently exports only the event dispatcher/envelope —
  shared contracts for domain errors, RequestContext type, and entitlement codes
  would live naturally here.

### 7. How EPIC-03 Phase B depends on this epic

From `openspec/archive/2026-08-24-epic-03-staff-shell-branding/explore.md` and
the EPIC-03 progress note: Phase B criteria (uploads, tenant theme persistence,
public branding endpoint, cross-tenant isolation, audit, reset) need exactly
four things from EPIC-01: **Prisma/persistence, authenticated staff identity
with tenant context, tenant-safe repositories returning 404 cross-tenant, and an
auditable action trail.** Phase A deliberately shipped UI-only and stopped. The
entitlement gate (`custom_branding`) additionally needs the minimal entitlements
boundary from finding 5.

## Approaches

1. **First-party email+password sessions, staff-only, full tenancy plumbing**
   - Pros: zero new dependencies/providers → no ADR needed; sessions in
     already-approved PostgreSQL/Redis; satisfies PRD §29 secure cookies;
     smallest compliant path to unblock EPIC-02/03.
   - Cons: PRD states managed auth "preferred"; we own password storage,
     rotation, rate limiting; portal auth still future work.
   - Effort: Medium
2. **Managed auth provider (e.g. Supabase Auth / similar) per PRD preference**
   - Pros: matches PRD §3/§8 stated preference; offloads credential handling.
   - Cons: violates complexity budget until an accepted ADR; adds an external
     runtime dependency to the frozen deployable list; domain rules must still
     pass through our API (PRD note), so integration cost remains.
   - Effort: High (ADR + integration)
3. **Defer real auth; fake/dev session header behind a flag**
   - Pros: fastest to unblock downstream epics structurally.
   - Cons: unacceptable — tenant authority _is_ the authenticated context (PRD
     §7); building tenancy on a fake identity guarantees rework and invalidates
     isolation-test semantics.
   - Effort: Low, but rejected.

**Recommendation:** Approach 1, sliced as roughly: (a) Prisma bootstrap +
migrations workflow; (b) error filter + request-id + health/ready; (c) identity
tables + email/password auth + session middleware + RequestContext guard; (d)
tenant/branch(+defer?) tables, TenantMembership, tenant-safe repository
conventions + isolation tests; (e) minimal entitlements boundary; (f) audit log
scaffolding; (g) guarded seed extension. Branches can be modeled in schema now
and surfaced in UI/API later if the maintainer agrees.

## Risks

1. **Auth decision deadlock**: PRD prefers managed auth; freeze forbids new
   providers without ADR. Without a maintainer ruling, proposal phase stalls on
   the very first story.
2. **Scope creep into EPIC-02**: roles/permissions tables invite implementing
   RBAC early. EPIC-01 should seed role _records_ but defer policy engine.
3. **CI migration gap**: quality gates don't cover migration application; a
   broken migration passes CI until local run.
4. **Session store ambiguity**: PostgreSQL-backed vs Redis-backed sessions have
   different revocation semantics; Redis TTL sessions complicate "logout
   everywhere". Needs an explicit small decision.
5. **Password reset / email verification** depend on Notifications (EPIC-17);
   shipping accounts without recovery paths is a UX/security gap needing an
   explicit deferral record (Tech Debt item).
6. **AsyncLocalStorage + Fastify/Nest interplay**: request-context plumbing
   under Nest 11 + Fastify is well-trodden but the logging integration must
   avoid leaking CONFIDENTIAL fields (PRD §41).

## Candidate Product Questions (for maintainer)

1. **Auth mechanism within the freeze** — accept first-party email+password
   sessions for MVP (no ADR friction), or do you want the ADR path toward a
   managed provider (Supabase Auth et al.) as PRD §3/§8 prefers?
2. **Tenant provisioning flow for MVP** — self-service organization registration
   (as §36's journey implies) vs admin/ops-created tenants only?
   Self-registration implies public signup endpoints + abuse controls now.
3. **Do Branch tables land in EPIC-01** (schema-ready, single default branch per
   tenant) or wait for a later epic? `multi_branch` entitlement suggests
   modeling now is safe, but API/UI surface could be deferred.
4. **Session storage & lifetime** — PostgreSQL-persisted sessions (revocable,
   queryable) vs Redis TTL sessions (fast, auto-expiring)? And acceptable
   absolute/idle lifetimes for staff sessions?
5. **Account recovery scope** — is shipping EPIC-01 without password
   reset/forgot-password (blocked on email delivery, EPIC-17) acceptable with a
   recorded Tech Debt + ops-manual workaround?
6. **Portal identity timing** — create `CustomerPortalAccess` scaffolding
   (schema only) in EPIC-01 to fix the data model early, or keep the epic
   strictly staff-scoped?

## Ready for Proposal

Yes — conditional on maintainer answers to questions 1–3 (auth mechanism,
provisioning flow, branch timing). Questions 4–6 can be resolved inside the
proposal as explicit recommendations if the maintainer prefers. The missing
`EPIC-01-Database-Auth-Tenancy.md` roadmap file should be created as part of the
change (docs+code atomicity), deriving scope strictly from PRD §§5, 7–10, 28–30,
36, 41–42.
