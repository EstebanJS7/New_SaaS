# Exploration: EPIC-07 — Scheduling

**Mode**: read-only SDD explore. No product code, docs, OpenSpec artifacts,
migrations, or Git state were modified. Only this exploration file was written.
**Change**: `epic-07`. **Artifact store**: `openspec` (file) + Engram
(`sdd/epic-07/explore`). **CodeGraph**: `.codegraph/` exists and was used for
structural queries; docs/config were read with built-in tools. **Language**:
technical artifact in English.

---

## TL;DR

- **The canonical EPIC-07 document does not exist.** EPIC-07 is only a roadmap
  row and a PRD implementation-order line. There is no
  `docs/01-roadmap/EPIC-07-*.md`, no Stories, no module doc, and no delta spec.
- **No scheduling code exists.** No `Appointment` model, no API module, no
  agenda route, no calendar dependency.
- The epic is **well-founded but under-specified**: PRD §14 defines the agenda
  and a 7-state lifecycle, while §24/§26/§38/§39 add reminder, portal-booking,
  settings and event obligations that are not clearly in or out of EPIC-07.
- **Ready for proposal: conditional yes.** Proposal can start after 5 product
  decisions are fixed (see `Unresolved Product Decisions`).
- The single pre-seeded permission `scheduling.appointment.manage` already maps
  to OWNER/ADMIN/RECEPTIONIST, so the authorization seed has a starting point.

---

## Canonical Identity and Source of Truth

| Item             | Value                                                                      | Source                                                   |
| ---------------- | -------------------------------------------------------------------------- | -------------------------------------------------------- |
| Epic ID / title  | `EPIC-07` — **Scheduling**                                                 | `docs/01-roadmap/ROADMAP.md:18`; PRD §34 (`PRD.md:1015`) |
| Status           | `planned`                                                                  | `ROADMAP.md:18`                                          |
| Depends on       | EPIC-04 (Customers), EPIC-05 (Veterinary Patients) — both `done`           | `ROADMAP.md:18`                                          |
| Roadmap file     | **MISSING** (every other planned/closed epic has one)                      | `docs/01-roadmap/` listing                               |
| Stories          | **NONE**                                                                   | `docs/02-stories/` (only PAT-*, VET-004, BRAND-001)      |
| Module doc       | **MISSING** (`Scheduling.md` listed only as "recommended")                 | `docs/05-modules/README.md:41`                           |
| Delta/main spec  | **NONE** (`openspec/specs/` has no scheduling domain)                      | `openspec/specs/`                                        |
| Active change    | **NONE** (this exploration creates `openspec/changes/epic-07/`)            | `openspec/changes/`                                      |
| Linked ADRs      | `ADR-003` (minimal internal events) lists `AppointmentConfirmed/Cancelled` | `docs/04-adrs/ADR-003`; `INTERNAL-EVENTS.md:51-52`       |
| Linked Decisions | None direct; `DEC-002` (unprefixed routes) governs route style             | `docs/07-decisions/`                                     |

**Governance read**: `AGENTS.md`, `docs/99-governance/ENGINEERING-RULES.md`,
`docs/99-governance/DOCUMENTATION-RULES.md` were read in full. The epic must
create its Epic + Stories + module doc + delta spec alongside implementation
(AGENTS.md; PRD §35). `done` for prior epics means implementation closure only,
not production readiness.

---

## Planned Scope (what the docs actually mandate)

EPIC-07 scope is spread across several PRD sections; none of them says what is
_out_ of the epic.

| Source                        | Obligation for Scheduling                                                                                                                                                                                                                                                                                                                  | In/out of EPIC-07?                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| PRD §14 Scheduling            | Agenda day/week/month/list views; drag-and-drop; resize; time-range creation; branch/professional/status/service filters; working hours; schedule blocks; conflict validation; responsive mobile. 7-state lifecycle. Explicit backend transition operations. "Portal can request appointments." Default booking policy `REQUIRE_APPROVAL`. | **Core** (but see decisions)                                        |
| PRD §36 acceptance journey    | `book appointment → patient arrives → clinical consultation`                                                                                                                                                                                                                                                                               | **Core**                                                            |
| SCOPE.md Operations           | visual agenda; working hours and blocks; appointment statuses; portal booking; reminders; audit                                                                                                                                                                                                                                            | agenda/blocks/statuses = core; portal booking + reminders ambiguous |
| PRD §24 Notifications         | Appointment reminders must be idempotent and cancelled if the appointment is cancelled                                                                                                                                                                                                                                                     | Likely **deferred to EPIC-17**                                      |
| PRD §26 Portal                | Portal capabilities include appointments and booking (EPIC-08 dependency on EPIC-07)                                                                                                                                                                                                                                                       | **Likely EPIC-08**                                                  |
| PRD §38 Typed Tenant Settings | `scheduling` is a listed initial namespace; EPIC-02 shipped only `sales` and marked scheduling as its first real consumer                                                                                                                                                                                                                  | **In scope** (schema only?)                                         |
| PRD §39 / ADR-003             | `AppointmentConfirmed`, `AppointmentCancelled` — emit "only when a concrete subscriber exists"                                                                                                                                                                                                                                             | **Deferred** (no subscriber yet)                                    |
| PRD §41                       | Appointment details are CONFIDENTIAL                                                                                                                                                                                                                                                                                                       | **In scope**                                                        |
| PRD §42 / DEMO-TENANT.md      | Demo tenant must include appointments                                                                                                                                                                                                                                                                                                      | **In scope**                                                        |

**The scope seams that must be decided, not assumed**: portal booking (§26),
reminders (§24), and event emission (§39) all touch Scheduling but belong to
later epics (EPIC-08, EPIC-17). PRD §14's single sentence "Portal can request
appointments" is the highest-risk ambiguity.

---

## Current Implementation State (evidence)

**Schema** — `packages/database/prisma/schema.prisma` (1,021 lines) has **no
`Appointment`-class model**. Inventory: identity/tenancy/RBAC/branding/
entitlements/customers/patients/clinical/audit only. Scheduling enums absent.

Existing anchors an `Appointment` would need:

| Anchor                           | State                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `Tenant`                         | present                                                                                               |
| `Branch` (`:158`)                | **inert scaffold** — no service/endpoint; not linked to `Patient`; `multi_branch` feature code exists |
| `Customer` (`:558`)              | present, tenant-scoped, `isActive`                                                                    |
| `Patient` (`:744`)               | present; `@@unique([tenantId, id])` composite-FK target; **not branch-scoped**                        |
| `PatientGuardian`                | Patient ↔ Customer bridge; exactly-one active primary                                                 |
| `UserProfile`/`TenantMembership` | staff identity — **no dedicated "professional"/practitioner entity**                                  |
| Catalog / service                | **does not exist** (EPIC-09)                                                                          |
| `ClinicalEncounter` (`:809`)     | present; **no `appointmentId`** (EPIC-06 explicitly deferred linkage to EPIC-07)                      |

**API** — `apps/api/src/` has
`audit, auth, branding, clinical, common, config, context, customers, entitlements, error-envelope, health, patients, rbac, settings, tenancy`.
**No `scheduling` module.** Controllers use unprefixed paths
(`@Controller("patients")`, `@Controller("customers")`) per DEC-002.

**Web** — route tree under `apps/web/src/app` has `customers`, `patients`,
`settings`, `placeholder`. **No `/app/agenda` route** and no calendar view.
`nav-sidebar.tsx` exposes only Customers and Patients plus inert placeholders.

**Frontend stack** — `ENGINEERING-RULES.md` lists **FullCalendar**, but it is
**not installed** in any `package.json`. Drag/resize/mobile agenda requirement
therefore has no shipped dependency today.

**Authorization seed** — `packages/database/src/reference-seed.ts:59` already
seeds `scheduling.appointment.manage`, mapped to `OWNER`, `ADMIN` (`:92,:117`)
and `RECEPTIONIST` (`:144`). No granular read/transition family.

**Tenant settings** — `apps/api/src/settings/registry.ts` ships only the `sales`
namespace (`SettingsNamespace = "sales"`). `scheduling` is documented in PRD §38
and `TENANT-SETTINGS.md` expansion convention but not implemented.

**Demo seed** — `packages/database/src/demo-seed.ts` seeds customers, patients,
guardians; **no appointments**.

**Prior epic trail** — EPIC-06 (`done`) deliberately left two seams for EPIC-07:
a nullable `ClinicalEncounter.appointmentId` (to be added by an EPIC-07
migration) and the `ClinicalEncounterClosed` event (deferred). `TD-011` (open)
records the concurrent-write → `500` mapping class EPIC-07 conflict races will
re-encounter.

---

## Affected Areas

- `packages/database/prisma/schema.prisma` — new `Appointment` model + status
  enum(s); possibly `appointmentId` FK on `ClinicalEncounter`.
- `packages/database/prisma/migrations/<ts>_scheduling/migration.sql` —
  tenant-scoped/composite FKs, overlap/unique constraints, transition guards.
- `packages/database/src/reference-seed.ts` + tests — scheduling permission
  expansion and role matrix.
- `packages/database/src/demo-seed.ts` + tests — synthetic appointments.
- `packages/database/src/schema-*.test.ts` — schema/invariant inventory.
- `apps/api/src/scheduling/**` — service, Zod, DTO, permissions constants,
  controllers, tests (mirror `apps/api/src/patients/**`).
- `apps/api/src/app.module.ts` — module registration.
- `apps/api/src/settings/registry.ts` + seed — `scheduling` namespace (if in).
- `apps/api/src/rbac/route-contract.probe.test.ts` — route inventory.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — isolation + concurrency probe.
- `apps/web/src/app/(app)/app/agenda/**` — agenda views, drag/drop, resize.
- `apps/web/src/app/api/scheduling/**` — authenticated proxy.
- `apps/web/src/components/shell/nav-sidebar.tsx` — Agenda entry.
- `apps/web/package.json` — calendar dependency (FullCalendar) if adopted.
- Docs: new `docs/01-roadmap/EPIC-07-Scheduling.md`, `SCH-*` Stories,
  `docs/05-modules/Scheduling.md`, `openspec/specs/scheduling*/spec.md`,
  `ROADMAP.md`, `CHANGELOG.md`.

---

## Platform Seams to Reuse (no new infrastructure needed)

| Capability               | Location                                                                  | Scheduling reuse       |
| ------------------------ | ------------------------------------------------------------------------- | ---------------------- |
| Tenant authority         | `apps/api/src/context/request-context.service.ts`                         | mandatory              |
| Guard chain              | `AuthGuard → TenantActiveGuard → PermissionGuard` + `@RequirePermissions` | mandatory per route    |
| Entitlement gate         | `EntitlementsService.has(tenantId, code)`                                 | only if a code applies |
| Append-only audit        | `apps/api/src/audit/audit-writer.service.ts` (`append(input, tx?)`)       | co-commit transitions  |
| Typed settings           | `apps/api/src/settings/registry.ts` + service                             | scheduling namespace   |
| Internal events          | `packages/shared/src/events/dispatcher.ts`                                | only with a subscriber |
| Route inventory probe    | `apps/api/src/rbac/route-contract.probe.test.ts`                          | extend                 |
| Live-PG harness          | `apps/api/test/live-pg-isolation.e2e-spec.ts`                             | extend                 |
| Command-endpoint pattern | `clinical.encounters.controller.ts` `POST .../close` etc.                 | transition endpoints   |

---

## Approaches

1. **Minimal staff scheduling core, chained PRs, forward deps deferred**
   _(recommended)_ — tenant-scoped `Appointment` with the 7-state lifecycle and
   explicit transition endpoints; agenda day/week/month/list views with
   drag/drop + resize; working hours + schedule blocks; branch/professional/
   status/service filters; conflict validation; `scheduling` settings namespace;
   optional nullable `ClinicalEncounter.appointmentId` seam; demo data.
   - Pros: matches PRD §14 literally; reuses every existing seam; keeps Portal
     (EPIC-08), reminders/events (EPIC-17), and Catalog linkage (EPIC-09) out;
     fits the roadmap dependency graph.
   - Cons: PRD §14's portal-booking sentence remains unimplemented until
     EPIC-08; requires explicit Decisions to bound scope.
   - Effort: **High**.

2. **Full scheduling incl. portal booking, reminders, events now** — add portal
   request/approval flow, reminder jobs, `AppointmentConfirmed/Cancelled`
   emission.
   - Pros: completes §14 + §24 + §26 in one pass.
   - Cons: pulls EPIC-08 and EPIC-17 forward, violates "no unused events",
     doubles surface; high review-budget risk.
   - Effort: **Very High** — rejected.

3. **Data/API-only scheduling, defer the agenda UI** — ship the model and
   transitions, no calendar.
   - Pros: smaller PR.
   - Cons: contradicts PRD §14, which is explicitly an agenda-UI requirement;
     delivers no user value for the acceptance journey.
   - Effort: Medium but **incomplete**.

---

## Proposed Delivery Slices (chained PRs, pending scope decisions)

| Slice | Scope                                                                                                                                                                        | Notes                                               |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| WU1   | Persistence: `Appointment` model, status enum, composite tenant FKs, overlap/constraints, permissions seed expansion, `scheduling` settings namespace, demo seed             | tenant-scoped, no hard delete, transition integrity |
| WU2   | Application service + tenant safety: create/reschedule/transition/cancel, conflict validation, entitlement, transactional audit, isolation + concurrency tests               | `409` for conflicts (TD-011 class)                  |
| WU3   | API + route contract: Zod/DTO allowlist, `@RequirePermissions`, transition endpoints, route probe                                                                            | explicit commands, no `PATCH status`                |
| WU4   | Staff agenda UI: day/week/month/list, drag/drop, resize, time-range create, filters, working hours/blocks admin, loading/empty/error/success/denied states, proxy, nav entry | FullCalendar vs custom decision                     |
| H1    | Hardening: root gates, live-PG evidence, docs/spec sync, optional `appointmentId` seam on `ClinicalEncounter`                                                                | review-budget check                                 |

Forecast: model + lifecycle + agenda UI + working-hours admin will exceed the
800-line review budget in one PR; chained slices are recommended (`sdd-tasks`
must confirm and emit the guard lines).

---

## Unresolved Product Decisions

These MUST be resolved before `sdd-spec`/`sdd-design`; none is answered by the
current PRD.

1. **Portal booking boundary** — PRD §14 says "Portal can request appointments"
   with default policy `REQUIRE_APPROVAL`, but the 7-state list has no
   `REQUESTED`/`PENDING` state and EPIC-08 owns the Portal. Is portal booking in
   EPIC-07, or deferred to EPIC-08 with EPIC-07 providing only the staff-created
   lifecycle? _(Recommended: defer the portal surface to EPIC-08; if approval is
   modelled, do it as an EPIC-08 addition to the lifecycle, or add an explicit
   `REQUESTED` state now only if the user confirms.)_
2. **Professional / resource model** — What is an appointment's "professional"?
   Any `TenantMembership` (staff), a role-filtered membership (VETERINARIAN), or
   a new per-tenant practitioner entity? No such model exists today.
   _(Recommended: reference a staff `TenantMembership`/`UserProfile` for MVP; no
   new practitioner entity.)_
3. **Branch scoping** — `Branch` exists but is inert and `Patient` is not
   branch-scoped. Is an `Appointment` branch-scoped now (enabling the §14 branch
   filter and `multi_branch`)? _(Recommended: branch-scoped nullable FK, with
   branch administration deferred.)_
4. **Service linkage** — Appointments likely reference a catalog service, but
   Catalog is EPIC-09 (not built). Use a free-text label now, a nullable service
   FK seam, or omit? _(Recommended: nullable/internal label now; add the catalog
   FK when EPIC-09 lands.)_
5. **Working hours & schedule blocks ownership** — Tenant-level `scheduling`
   settings, branch-level, per-professional availability, or a mix? Are
   "schedule blocks" ad-hoc time-off or recurring? _(Recommended:
   per-professional availability + branch working hours, both minimal; ad-hoc
   blocks; no recurrence in MVP unless confirmed.)_
6. **Conflict policy** — Hard reject overlapping bookings vs.
   warn/allow-override? Should `scheduling` namespace expose `conflictPolicy`?
   _(Recommended: hard conflict → `409 CONFLICT`, configurable via
   `scheduling.conflictPolicy`.)_
7. **Permission granularity** — Keep the single `scheduling.appointment.manage`,
   or expand to a family (`read/create/update/transition/cancel`)?
   _(Recommended: expand to a `scheduling.appointment.*` read/mutate family,
   mirroring `vet.clinical.*`.)_
8. **Recurrence & reminders** — Are recurring appointments MVP? Are reminders in
   EPIC-07 or deferred to EPIC-17? _(Recommended: no recurrence; reminders
   deferred to EPIC-17; do not emit unused events.)_
9. **Event emission** — Emit `AppointmentConfirmed`/`AppointmentCancelled` now
   or when EPIC-17 lands? _(Recommended: defer; governance bans unused events.)_
10. **Clinical linkage direction** — Add nullable `appointmentId` to
    `ClinicalEncounter`, or `encounterId` to `Appointment`? _(Recommended: add
    `appointmentId` to `ClinicalEncounter` via EPIC-07 migration, as EPIC-06
    anticipated.)_
11. **Calendar library** — FullCalendar (in the baseline stack, not installed)
    vs. a custom agenda. _(Recommended: FullCalendar; it is already approved
    stack, so no ADR needed — only a Decision record.)_
12. **Data classification** — Appointment details are CONFIDENTIAL; confirm
    reminder/contact fields are excluded from logs. _(Recommended: CONFIDENTIAL,
    IDs-only logs/audit.)_

---

## Risks

- **Scope ambiguity is the top risk** — §14/§24/§26/§38/§39 pull EPIC-08 and
  EPIC-17 obligations into EPIC-07; without Decisions this silently expands
  scope.
- **No canonical Epic artifact** — no roadmap file, Stories, module doc, or spec
  exist; they must be authored with the implementation, not after.
- **Undefined professional/resource entity** — scheduling cannot proceed cleanly
  without deciding what an appointment belongs to.
- **Branch scoping undecided** — `Branch` is inert; branch filters and
  `multi_branch` semantics are unproven.
- **Calendar UI cost** — FullCalendar is not installed; drag/drop/resize/mobile
  are non-trivial and likely blow the 800-line review budget.
- **Timezone/DST** — tenant TZ `America/Asuncion`, UTC persistence; naive local
  times and DST offset handling are a real correctness risk.
- **Conflict-races** — concurrent booking overlap needs a DB-level guarantee and
  correct `409` mapping (same class as `TD-011`, which is still open).
- **Transition integrity** — 7-state lifecycle must use explicit endpoints and
  reject illegal transitions; no generic `PATCH status`.
- **Data leakage** — appointment details are CONFIDENTIAL; must not be logged or
  exposed across tenants; cross-tenant UUID → `404`.
- **No E2E gate** — `TD-007` (Playwright deferred) leaves the agenda UI without
  E2E safety.
- **Forward-dependency creep** — building Catalog linkage, Portal booking, or
  reminders now pulls later epics forward.
- **Live-PG isolation** — `TD-006` breadth remains open; a new private aggregate
  requires isolation tests.

---

## Recommendation

Adopt **Approach 1**: a minimal, tenant-scoped staff scheduling core built on
the existing seams, delivered as chained PR slices (WU1–WU4 + H1). Keep Portal
booking/approval, reminders, event emission, recurrence, and Catalog linkage
explicitly out of EPIC-07, with the narrow exception of the nullable
`ClinicalEncounter.appointmentId` seam that EPIC-06 anticipated.

Before `sdd-propose`/`sdd-spec`, the user must resolve decisions **1–5**
(portal-booking boundary, professional model, branch scoping, service linkage,
working-hours/blocks ownership). Decisions 6–12 have safe recommended defaults
but should be confirmed.

---

## Ready for Proposal

**Conditional yes.** The epic is well-founded on EPIC-04/05/06 seams and PRD
§14, but proposal/spec cannot start until the portal-booking boundary,
professional model, branch scoping, service linkage, and working-hours/blocks
ownership are fixed. The orchestrator should tell the user: EPIC-07 is ready to
explore but **blocked on 5 product scope decisions**, with recommendations
supplied above, and the Epic/Story/module-doc/delta-spec artifacts must be
created alongside the implementation.
