# Exploration: EPIC-08 — Portal

**Mode**: read-only SDD explore. No product code, migrations, docs, Git state or
other change artifacts were modified. Only this exploration file was written.
**Change**: `epic-08` (active change folder). **Artifact store**: hybrid — this
file plus Engram `sdd/epic-08/explore`. **CodeGraph**: `.codegraph/` index
present; structural facts below come from indexed source. **Language**:
technical artifact in English.

---

## Current State

EPIC-04 (Customers), EPIC-05 (Patients), EPIC-06 (Clinical) and EPIC-07
(Scheduling) are `done`. EPIC-08 Portal is `planned` and the next epic in
[`docs/01-roadmap/ROADMAP.md`](../../../docs/01-roadmap/ROADMAP.md), depending
on EPIC-04, EPIC-05 and EPIC-07. **No portal domain implementation exists** —
only a branded public landing surface and one inert database scaffold.

### What already exists (reusable)

| Seam                              | Location                                                                                                                                                  | Portal relevance                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Public branded landing            | `apps/web/src/app/(portal)/[slug]/page.tsx`, `(portal)/layout.tsx`                                                                                        | Portal shell + brand resolution (no auth today)          |
| Trusted tenant-slug resolution    | `apps/web/src/middleware.ts` (`x-tenant-slug`)                                                                                                            | Tenant context for public/portal paths (never authority) |
| Public brand contract             | `GET /api/v1/public/tenants/:slug/branding` (`apps/api/src/branding/public-branding.controller.ts`)                                                       | Portal/staff shared identity, safe PUBLIC DTO            |
| Tenant-scoped Customer + contacts | `Customer`, `CustomerContact`, `CustomerAddress`                                                                                                          | Portal profile + own-account data                        |
| Guardian bridge                   | `PatientGuardian` (`patientId` ↔ `customerId`)                                                                                                            | "Own pets" authorization chain                           |
| Patient + species/breed           | `Patient`, `Species`, `Breed`                                                                                                                             | Portal pet list/detail                                   |
| Clinical records                  | `ClinicalEncounter` (`internalNotes`/`clientSummary`), `ClinicalVaccination`, `ClinicalTreatment`, `ClinicalDeworming`, `ClinicalStudy`, `ClinicalWeight` | Allowed clinical summary + vaccines                      |
| Scheduling                        | `Appointment` + 6 lifecycle commands, `scheduling` settings namespace                                                                                     | Portal appointments + booking                            |
| Entitlements                      | `EntitlementsService.has(tenantId, code)`; `portal` and `custom_branding` feature codes are seeded                                                        | Portal gating                                            |
| Guard chain                       | `AuthGuard → TenantActiveGuard → PermissionGuard`, `@Public` opt-out                                                                                      | Must be extended/segregated for portal                   |
| Audit                             | append-only `AuditWriter.append()` co-committed per mutation                                                                                              | Portal actions auditability                              |
| Route inventory probe             | `apps/api/src/rbac/route-contract.probe.test.ts` + `route-enumeration.ts`                                                                                 | Must classify portal routes                              |
| Live-PG harness                   | `apps/api/test/live-pg-isolation.e2e-spec.ts`                                                                                                             | Portal isolation/concurrency evidence                    |

### What does NOT exist (blockers to design around)

- **Portal identity.** `CustomerPortalAccess` is an **INERT SCAFFOLD**: columns
  `tenantId`, `contactEmail`, `status` only — no FK to `Customer`, no
  credential, no session table, no service, controller, route, or UI
  (`packages/database/prisma/schema.prisma:213`). The PRD chain
  `UserProfile → CustomerPortalAccess → Customer → PatientGuardian → Patient`
  (§26) is not modelled yet.
- **Portal authentication.** `AuthGuard` is global and requires a live
  `ns_staff_session` cookie for every non-`@Public` route; `TenantActiveGuard`
  requires an ACTIVE staff membership. There is no portal cookie, portal
  session, or portal guard. PRD §8 requires staff and portal authorization to be
  **separate security boundaries** and forbids portal identities gaining staff
  access through shared controllers.
- **Notifications / email (EPIC-17).** No email delivery exists. Password reset
  is deferred (`docs/08-tech-debt/TD-004-password-reset-deferred.md`, blocked on
  EPIC-17). Email invitation, magic-link, and OTP delivery are therefore not
  available now.
- **Billing / invoices / files (EPIC-14, §25).** No `Invoice`/`InvoiceItem`,
  `File`, storage or signed-URL capability exists. The PRD §26 portal capability
  "invoices/documents" **cannot ship** in EPIC-08.
- **`portal` tenant-settings namespace.** Registry ships only `sales` and
  `scheduling` (`apps/api/src/settings/registry.ts`). PRD §38 lists `portal` as
  an initial namespace but it is unimplemented.
- **Booking.** EPIC-07 explicitly out-of-scoped portal booking/approval. The
  `Appointment` model has no "source" or "requested-by" field, and there is no
  `REQUIRE_APPROVAL` booking command.

---

## Scope Map (what the docs define)

Portal scope is anchored by PRD §26 but several adjacent sections constrain it.
The single largest scope risk is that §26 lists a capability ("invoices/
documents") whose upstream epics have not shipped.

| Source               | Normative content                                                                                                                                                                                                              | Consequence for EPIC-08                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| PRD §26 Portal       | Separate portal routes; auth chain `UserProfile → CustomerPortalAccess → Customer → PatientGuardian → Patient`; capabilities: own pets, allowed clinical summary, vaccines, appointments, booking, invoices/documents, profile | Core of the epic                                |
| PRD §14 Scheduling   | "Portal can request appointments"; default booking policy `REQUIRE_APPROVAL`                                                                                                                                                   | Booking is in scope, approval workflow required |
| PRD §13 Clinical     | `clientSummary` is client-safe; **Portal never exposes `internalNotes`**                                                                                                                                                       | Clinical summary projection must be allowlisted |
| PRD §8 / §29         | Staff and portal are separate authorization boundaries; portal identities never gain staff access                                                                                                                              | No shared controllers/guards                    |
| PRD §10 Entitlements | `portal` feature code                                                                                                                                                                                                          | Portal gating                                   |
| PRD §10.1 Branding   | Staff and portal share resolved brand                                                                                                                                                                                          | Already delivered (DEC-004)                     |
| PRD §38              | `portal` typed settings namespace                                                                                                                                                                                              | Add via settings expansion convention           |
| PRD §27 / §41        | Audit critical actions; CONFIDENTIAL/RESTRICTED classification, no sensitive logging                                                                                                                                           | Audit + classification for portal mutations     |
| PRD §28              | `/api/v1` DTO/error envelope; never return Prisma models                                                                                                                                                                       | Allowlisted portal DTOs                         |
| PRD §44 / `DEC-002`  | `/api/v1` global prefix deferred; public branding uses a literal `api/v1/public` controller path                                                                                                                               | Portal API route path needs a recorded decision |

**Scope boundary recommendation**: deliver own pets, allowed clinical summary
(`clientSummary` only), vaccines, appointments, booking-with-approval and
profile. Explicitly **defer** invoices/documents (blocked on EPIC-14/§25) and
email-based invitation/recovery (blocked on EPIC-17).

---

## Dependencies

**Backward (available now):** Customer/Contact/Guardian/Patient; Clinical
`clientSummary` + subdomains; Appointment lifecycle + `scheduling` settings;
`portal`/`custom_branding` entitlements; RBAC + typed settings; audit writer;
staff shell/semantic tokens; portal brand resolution; middleware slug
resolution.

**Forward (must NOT be built here):**

- EPIC-14 Billing + §25 Files → portal invoices/documents.
- EPIC-17 Notifications → email invite/magic-link/recovery.
- EPIC-15/16 Fiscal → portal fiscal documents (via Billing).
- Catalog (EPIC-09) → service selection on portal booking.

**Existing debt touching portal patterns:** `TD-004` (password reset deferred),
`TD-005` (single-replica rate limiter), `TD-006` (broader live-PG gates),
`TD-007` (Playwright E2E deferred), `TD-011` (concurrent write → 500 not 409).

---

## Affected Areas

- `packages/database/prisma/schema.prisma` — extend `CustomerPortalAccess` (FK
  to `Customer`), add portal credential/session model(s), possibly booking
  provenance on `Appointment`.
- `packages/database/prisma/migrations/<ts>_portal/migration.sql` — additive,
  tenant-scoped FKs, no destructive changes.
- `packages/database/src/reference-seed.ts` + tests — portal permission catalog
  and role matrix; `portal` entitlement already seeded.
- `packages/database/src/demo-seed.ts` + tests — synthetic portal access and
  booking fixtures.
- `packages/database/src/schema-*.test.ts` — new schema/invariant inventory.
- `apps/api/src/settings/registry.ts` — new `portal` namespace + union-sync
  test.
- `apps/api/src/auth/**` or new `apps/api/src/portal/**` — portal identity,
  session, cookie, guard, policy (separate from staff).
- `apps/api/src/portal/**` — service, Zod schemas, allowlisted DTOs,
  controllers, tests.
- `apps/api/src/app.module.ts` — module registration.
- `apps/api/src/rbac/route-contract.probe.test.ts` + `route-enumeration.ts` —
  portal route classification (must not be treated as staff-private VIOLATIONs).
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — portal isolation/concurrency.
- `apps/web/src/app/(portal)/[slug]/**` — portal login, pets, pet detail,
  vaccines, clinical summary, appointments, booking, profile; loading/empty/
  error/success/denied states.
- `apps/web/src/app/api/portal/[[...path]]/route.ts` — portal proxy (portal
  cookie only; strict route/query allowlist, mirroring the scheduling proxy).
- `apps/web/src/middleware.ts` — portal route reservation/segments.
- `docs/01-roadmap/EPIC-08-Portal.md`, `docs/05-modules/Portal.md`,
  `ROADMAP.md`, `CHANGELOG.md`, plus a delta spec under
  `openspec/specs/portal-management/` (or equivalent domain).

---

## Approaches

1. **First-party portal identity mirroring the staff session architecture**
   _(recommended)_ — extend `CustomerPortalAccess` with a `customerId` FK; add a
   portal credential + `PortalSession` table and a distinct `ns_portal_session`
   cookie; add a portal guard/controller family fully separate from staff
   controllers; staff-provisioned access (no email dependency).
   - Pros: consistent with the shipped first-party auth; no new provider/ADR; no
     email dependency; portal/staff separation is explicit; reuses the proven
     session/audit/tenancy seams.
   - Cons: PRD §8 says external managed auth is "preferred" (a recorded
     deviation, similar to DEC-002 for staff auth); no self-service signup or
     email recovery within EPIC-08.
   - Effort: High.

2. **Magic-link / OTP email portal access** — passwordless access by emailed
   link or code.
   - Pros: no stored portal credential; better UX for guardians.
   - Cons: **blocked** — no email/notification capability (EPIC-17) and no
     password-recovery precedent; would pull EPIC-17 into EPIC-08.
   - Effort: High (and blocked).

3. **External managed auth provider (e.g. Supabase Auth) for the portal** —
   delegate portal identity to a managed provider.
   - Pros: aligns with PRD §8's stated preference; offloads credential
     lifecycle.
   - Cons: requires an **ADR** (new authentication strategy/provider) before
     implementation per the architecture freeze; new runtime dependency; not
     consistent with the shipped first-party staff auth; larger blast radius and
     cost than the MVP needs.
   - Effort: High + ADR gate.

---

## Recommendation

Adopt **Approach 1**. It is the only approach that delivers portal access now
without an ADR gate or a blocked upstream epic, and it keeps the staff/portal
security boundaries explicit rather than sharing controllers — which AGENTS.md
and the PRD §8/§29 explicitly forbid violating. Record the deviation from PRD
§8's "external managed auth preferred" as a Decision (mirroring `DEC-002`) and
defer email invitation/recovery to a follow-up once EPIC-17 lands. Scope the
epic to own pets, `clientSummary`-only clinical summary, vaccines, appointments,
booking-with-approval and profile; defer invoices/documents (EPIC-14/§25) and
all email flows (EPIC-17).

## Proposed Delivery Slices (chained PRs, pending scope decision)

| Slice | Scope                           | Notes                                                                                                           |
| ----- | ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| WU1   | Data + settings foundation      | `CustomerPortalAccess` FK, portal credential/session, migration, `portal` namespace, permission seed, demo seed |
| WU2   | Portal identity + tenant safety | portal service, session/cookie, portal guard/policy, access provisioning, isolation tests                       |
| WU3   | Portal HTTP read surface        | own pets, pet detail, `clientSummary`-only clinical summary, vaccines, appointments; allowlisted DTOs           |
| WU4   | Portal booking + UI             | booking request with `REQUIRE_APPROVAL`, portal pages/proxy, all UI states                                      |
| WU5   | Hardening + docs                | live-PG evidence, root gates, docs/spec sync                                                                    |

Forecast: portal identity + booking + a multi-page UI will almost certainly
exceed the 800-line review budget in one PR; **chained PRs recommended: Yes**,
`400/800-line budget risk: High`. `sdd-tasks` must produce the explicit guard
lines.

---

## Risks

- **Scope creep via §26 gaps** — "invoices/documents" and email flows are listed
  in approved scope but their upstream epics do not exist; implementing a stub
  would silently expand scope. Must be an explicit deferral decision.
- **New security boundary** — a portal identity that reuses or weakens staff
  guards/controllers is the highest-severity risk; separate cookie, session,
  guard and policy are required, and cross-tenant UUID access must return `404`.
- **Clinical leakage** — `internalNotes` must never reach any portal projection;
  `clientSummary` and explicit allowlists only; CONFIDENTIAL data must not be
  logged.
- **No recovery/email path** — staff must provision portal access; a lost
  credential has no self-service path until EPIC-17 (mirrors TD-004).
- **Schema migration over an inert scaffold** — `CustomerPortalAccess` currently
  has no `customerId`; adding the FK and any uniqueness constraints must be
  additive and must not break the existing inert-scaffold tests.
- **Audit actor model** — `AuditActorType` is only `STAFF | SYSTEM`; portal
  actions need a defined actor representation.
- **Route/guard classification** — the route-contract probe treats any private
  route without `@RequirePermissions` as a VIOLATION; portal routes need
  explicit handling, and the `/api/v1` prefix convention is unresolved
  (`DEC-002`).
- **Concurrency mapping** — booking/approval races should map to `409`, not the
  `500` class tracked by `TD-011`.
- **Review budget** — epic is larger than EPIC-07; chained slices are required
  to protect reviewer load.
- **No E2E gate** — `TD-007` (Playwright deferred) means portal UX has no E2E
  safety net; Vitest + testing-library coverage is the substitute.
- **Docs debt** — no `EPIC-08-Portal.md`, module doc, or portal spec exists yet;
  they must be created alongside the implementation (AGENTS.md, PRD §35).

---

## Unresolved Product Decisions (resolve before sdd-spec/sdd-design)

1. **Portal identity mechanism** — first-party (recommended) vs external
   provider (ADR required) vs magic-link (blocked on EPIC-17).
2. **Access provisioning** — who creates portal access (staff invitation only?)
   and what identity anchor is used (`contactEmail` vs `Customer`) —
   recommended: link to `Customer` and provision from staff.
3. **Portal session/cookie model** — separate `ns_portal_session` with its own
   idle/absolute TTLs; confirm no shared cookie with staff.
4. **Booking approval workflow** — how a portal request becomes an `Appointment`
   (status, provenance field, staff approval command) under the default
   `REQUIRE_APPROVAL` policy.
5. **Clinical summary allowlist** — exact fields exposed (`clientSummary` +
   vaccines + which subdomains); confirm `internalNotes` exclusion.
6. **`portal` settings namespace schema** — which booking/policy keys ship.
7. **Portal API path convention** — `/api/v1/portal/*` vs unprefixed; record a
   Decision consistent with `DEC-002`.
8. **Scope of "documents"** — confirm deferral of invoices/documents to a
   billing-dependent follow-up.

---

## Ready for Proposal

**Conditional yes.** The epic is well-founded on EPIC-04/05/06/07 seams and PRD
§26, and the recommended approach is clear. Proposal/spec should not start until
decisions **1–4** are fixed, and the user must explicitly approve the deferrals
of invoices/documents and email flows (and the PRD §8 deviation). The
orchestrator should tell the user: **EPIC-08 Portal is ready to explore, but
blocked on a portal-identity Decision** (first-party recommended) and an
explicit scope-deferral Decision, with recommendations supplied above.
