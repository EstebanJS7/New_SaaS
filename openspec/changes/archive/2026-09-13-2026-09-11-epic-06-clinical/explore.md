# Exploration: EPIC-06 — Clinical

**Mode**: read-only SDD explore. No code, docs, OpenSpec artifacts, migrations,
or Git state were modified. Only this exploration file was written. **Change**:
`2026-09-11-epic-06-clinical` (active change folder). **Artifact store**:
`openspec` (file) + Engram (`sdd/2026-09-11-epic-06-clinical/explore`). **Note
on filename**: the canonical OpenSpec convention lists `exploration.md`; this
change uses `explore.md` per the launch instruction. **CodeGraph**: no
`.codegraph/` index exists; inspection used built-in tools (read-only fallback).
**Language**: technical artifact in English.

---

## Current State

EPIC-05 (`done`, archived `c62b12c`) delivered the first Veterinary aggregate:
tenant-scoped `Patient`, `PatientGuardian` (database-enforced exactly-one active
primary), global seeded `Species`/`Breed`, `patients.*` permissions, the
`veterinary` entitlement gate, append-only audit, and a minimal staff workspace.
**No clinical persistence, API, or UI exists** — the Prisma schema has 27 models
and none is clinical.

Platform seams already available to reuse:

| Capability                | Location                                                                            | Clinical reuse                       |
| ------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| Tenant authority          | `apps/api/src/context/request-context.service.ts` (`requireTenantId`)               | mandatory                            |
| Guard chain               | `AuthGuard → TenantActiveGuard → PermissionGuard` + `@RequirePermissions`           | mandatory per route                  |
| Permission catalog        | `packages/database/src/reference-seed.ts`                                           | extend for clinical                  |
| Entitlement gate          | `EntitlementsService.has(tenantId, "veterinary")`, service-level (no generic guard) | reuse                                |
| Append-only audit         | `apps/api/src/audit/audit-writer.service.ts` (`append(input, tx?)`)                 | co-commit close/amend                |
| Internal events           | `packages/shared/src/events/dispatcher.ts` (`createEventDispatcher`)                | only if a concrete subscriber exists |
| Route inventory probe     | `apps/api/src/rbac/route-contract.probe.test.ts`                                    | extend                               |
| Live-PG isolation harness | `apps/api/test/live-pg-isolation.e2e-spec.ts`                                       | extend                               |

Documentation reality: the ROADMAP lists
`EPIC-06 | Clinical | planned | EPIC-05` and PRD §34 names `EPIC-06 Clinical`,
but there is **no `EPIC-06-*.md` roadmap file, no `CLI-*` Stories, no
`docs/05-modules/Clinical.md`, and no `openspec/specs/clinical-management/`**.
As with EPIC-05, Epic + Stories + module doc + delta spec must be created
alongside the implementation (AGENTS.md, PRD §35).

---

## Scope Map (what the docs actually define)

EPIC-06 scope is **not singularly defined** by the documentation. Three PRD
sections describe clinical-adjacent boundaries differently:

| Source                    | Content                                                                                                                                                                                                                                                                     | Consequence for EPIC-06                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| PRD §13 Clinical          | The only normative clinical behavior: `ClinicalEncounter` states `DRAFT`/`CLOSED`; DRAFT editable + autosaved; CLOSED immutable by default; amendments require explicit permission + audit; separate `internalNotes`/`clientSummary`; Portal never exposes `internalNotes`. | Core of the Epic.                                                                                          |
| PRD §6 Veterinary domains | Lists `clinical`, `vaccinations`, `deworming`, `treatments`, `studies`, `weights` as **separate** domains.                                                                                                                                                                  | These are distinct aggregates; unclear whether they belong in EPIC-06.                                     |
| PRD §12 Patient 360       | Primary workspace with header (incl. current weight) and tabs: Summary, History, Vaccines, Treatments, Deworming, Studies, Weights, Files, Billing.                                                                                                                         | A full Patient 360 is **not** implied by "Clinical" alone; EPIC-05 explicitly deferred "Patient 360 tabs". |
| PRD §25/§26/§27/§31/§41   | Clinical files private; Portal clinical summary + vaccines; audit clinical close/amend; reports vaccines/deworming; clinical data CONFIDENTIAL.                                                                                                                             | Downstream consumers; forward dependencies to defer.                                                       |

**Unresolved boundary**: the implementation order
(`EPIC-06 Clinical → EPIC-07 Scheduling → EPIC-08 Portal`) suggests an
encounter-centric slice, while §6/§12 suggest a broader veterinary-records
bundle. This must be fixed by an explicit Decision before spec/design; it is the
single biggest scope risk.

---

## Dependencies

Backward (available, EPIC-05 `done`):

- `Patient` + `PatientGuardian` aggregate, tenant scoping, invariants.
- `patients.*` permission catalog and the `veterinary` entitlement.
- RBAC/entitlement platform (EPIC-02), staff shell + semantic tokens (EPIC-03).
- Audit writer, request context, route-contract probe, live-PG harness.

Forward (must NOT be built in EPIC-06; keep seams nullable/deferred):

- EPIC-07 Scheduling — `Appointment` and any `appointmentId` linkage.
- EPIC-08 Portal — `clientSummary` delivery, `CustomerPortalAccess` chain.
- EPIC-18/§31 Reports — consultations, upcoming/overdue vaccines, deworming.
- Files/attachments (§25) — private object storage + signed URLs.
- Billing/Sales/Fiscal — encounter-to-charge linkage.

Existing platform debt that touches clinical patterns:

- `TD-006` — broader cross-tenant isolation and concurrency live-PG gates
  unproven.
- `TD-011` — losing concurrent write surfaced as unmapped `500`; needs `409`.
  Clinical state transitions (double close/amend) will hit the same class.
- `TD-007` — Playwright E2E deferred (no E2E gate for clinical UI).

---

## Affected Areas

- `packages/database/prisma/schema.prisma` — new `ClinicalEncounter` (+
  amendment child if adopted) and any clinical enum(s).
- `packages/database/prisma/migrations/<ts>_clinical/migration.sql` — additive
  DDL, tenant-scoped FKs, immutability/transition constraints.
- `packages/database/src/reference-seed.ts` + tests — clinical permission
  catalog and role matrix (`vet.clinical.create` already exists; expansions
  required).
- `packages/database/src/demo-seed.ts` + tests — synthetic encounters (no real
  PII).
- `packages/database/src/schema-*.test.ts` — schema/invariant inventory.
- `apps/api/src/clinical/**` (or `apps/api/src/veterinary/clinical/**`) —
  service, Zod, DTO, permissions, controllers, tests.
- `apps/api/src/app.module.ts` — module registration.
- `apps/api/src/rbac/route-contract.probe.test.ts` — route inventory.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — application-path live
  evidence.
- `apps/web/src/app/(app)/app/patients/[id]/**` — clinical tab/workspace entry.
- `apps/web/src/app/api/clinical/**` — authenticated proxy.
- `apps/web/src/components/shell/nav-sidebar.tsx` — entry decision.
- `packages/shared/src/events/**` — only if `ClinicalEncounterClosed` is
  emitted.
- Docs: new `docs/01-roadmap/EPIC-06-Clinical.md`, `CLI-*` stories,
  `docs/05-modules/Clinical.md`, `openspec/specs/clinical-management/spec.md`,
  `ROADMAP.md`, `CHANGELOG.md`.

---

## Approaches

1. **Minimal `ClinicalEncounter` core, chained PRs, forward deps deferred**
   _(recommended)_ — DRAFT/CLOSED lifecycle, `internalNotes`/`clientSummary`,
   explicit audited amendment, autosave, staff workspace entry on the existing
   Patient detail.
   - Pros: matches PRD §13 literally; smallest correct surface; reuses every
     EPIC-05 seam; aligns with implementation order before Scheduling/Portal.
   - Cons: §6/§12 remain partially unimplemented; requires a Decision to bound
     scope.
   - Effort: Medium.

2. **Full veterinary-records bundle in EPIC-06** — encounter + vaccinations +
   deworming + treatments + studies + weights + Patient 360 tabs.
   - Pros: completes §6/§12 veterinary data in one Epic.
   - Cons: several independent aggregates, high review-budget risk, pulls
     Weight/ Vaccination scheduling semantics before Scheduling/Reports exist;
     effectively multiple Epics.
   - Effort: High.

3. **Clinical notes attached to `Patient`** — add free-text fields to `Patient`.
   - Pros: trivial.
   - Cons: contradicts PRD §13 (DRAFT/CLOSED, immutability, amendments),
     violates aggregate boundaries and auditability; rejected.
   - Effort: Low but incorrect.

---

## Proposed Delivery Slices (chained PRs, pending scope decision)

| Slice | Scope                                                                       | Notes                                                                                      |
| ----- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| WU1   | Persistence, invariants, permissions seed, audit action contract, demo seed | tenant-scoped, no hard delete, transition integrity                                        |
| WU2   | Application service + tenant safety                                         | DRAFT/CLOSED transitions, amendment, entitlement, transactional audit, isolation tests     |
| WU3   | API + route contract                                                        | Zod/DTO allowlist, `@RequirePermissions`, route probe                                      |
| WU4   | Staff UI                                                                    | clinical tab on Patient detail, autosave, loading/empty/error/success/denied states, proxy |
| H1    | Hardening                                                                   | root gates, live-PG evidence, docs/spec sync                                               |

Forecast: encounter + amendment + autosave + UI likely exceeds the 800-line
review budget in one PR; chained slices are recommended (`sdd-tasks` must
confirm).

---

## Unresolved Product Decisions

These MUST be resolved before `sdd-spec`/`sdd-design`; none is answered by the
current PRD.

1. **EPIC-06 scope boundary** — encounter only, or encounter + a subset of
   vaccines/deworming/treatments/studies/weights? _(Recommended: encounter only;
   defer the rest to explicit later veterinary Epics/slices.)_
2. **Encounter content model** — which structured fields (reason/anamnesis,
   diagnosis, plan, vitals) beyond `internalNotes`/`clientSummary` are MVP?
   _(Recommended: minimal structured set + free text; avoid a generic EAV/notes
   engine, which is banned by AGENTS.md.)_
3. **Autosave semantics** — cadence, granularity, and optimistic concurrency
   (`version`/`updatedAt` guard) for DRAFT. _(Recommended: explicit version
   guard, conflict → `409`.)_
4. **Amendment model** — is an amendment a new immutable record/version linked
   to the original, or an appended amendment log preserving prior state? Which
   permission gates it? _(Recommended: separate amendment record preserving
   previous state + audit.)_
5. **Permission catalog expansion and naming** — `vet.clinical.create` already
   exists (PRD §9 verbatim). Need `read`/`update`/`close`/`amend` and a naming
   decision: `vet.clinical.*` vs `clinical.*`. _(Recommended: keep the `vet.`
   family for consistency, add `vet.clinical.read/update/close/amend`.)_
6. **Appointment linkage** — does `ClinicalEncounter` reference `appointmentId`
   now (nullable, EPIC-07 later) or omit it entirely? _(Recommended: omit now;
   add via EPIC-07 migration.)_
7. **Branch scoping** — branch-ready architecture exists, but EPIC-05 `Patient`
   is not branch-scoped. Is an encounter branch-scoped? _(Recommended: not in
   EPIC-06; revisit with Scheduling/POS.)_
8. **`ClinicalEncounterClosed` event** — PRD §39/ADR-003 list it, but no
   subscriber exists and governance says do not create unused events.
   _(Recommended: do NOT emit in EPIC-06; wire when Portal/notification
   subscriber lands.)_
9. **Workspace placement** — Patient 360 tabs vs. a clinical tab on the existing
   Patient detail page. _(Recommended: clinical tab on Patient detail; full
   Patient 360 shell deferred.)_
10. **DRAFT terminal behavior** — can a DRAFT be discarded/voided, or only
    closed? No hard delete is allowed for clinical data. _(Recommended:
    void/discontinue as an audited state or leave DRAFT retained; no delete.)_
11. **Data classification** — clinical is CONFIDENTIAL; is `internalNotes`
    RESTRICTED? Logs must never carry values. _(Recommended: classify both
    CONFIDENTIAL; `internalNotes` excluded from all portal/API projections.)_
12. **Weights ownership** — `Weights` is a separate §6 domain and the Patient
    360 header shows "current weight". _(Recommended: separate later Epic; do
    not fold into EPIC-06.)_

---

## Risks

- **Scope ambiguity is the top risk** — §6/§12/§13 disagree on what "Clinical"
  includes; implementing without a Decision silently expands scope.
- **Immutability + concurrency** — CLOSED immutability and double-close/amend
  races must map to `409`, not `500` (same class as `TD-011`).
- **Autosave correctness** — lost updates without an explicit version guard;
  must not violate DRAFT-only editability.
- **Audit completeness** — close and amend are explicitly PRD §27 audited
  operations; the audit row must co-commit in the transition transaction.
- **Data leakage** — `internalNotes` must never reach Portal/other projections;
  clinical free text is CONFIDENTIAL and must not be logged.
- **Forward-dependency creep** — building `appointmentId`, Portal summary,
  files, or reports now would pull later Epics into EPIC-06.
- **Review budget (800 lines)** — encounter + amendments + autosave + UI in one
  PR is likely oversized; chained PRs are needed.
- **Live-PG isolation** — clinical is a new private aggregate; tenant-isolation
  tests are mandatory (EPIC-05 pattern), and `TD-006` breadth remains open.
- **No E2E gate** — `TD-007` (Playwright deferred) means clinical UI has no E2E
  safety net.
- **Docs debt** — no EPIC-06 roadmap file, Stories, module doc, or spec exists
  yet; they must be created with the implementation, not after.

---

## Recommendation

Adopt **Approach 1**: a minimal, tenant-scoped `ClinicalEncounter` core with
DRAFT/CLOSED lifecycle, `internalNotes`/`clientSummary` separation, explicit
audited amendment, version-guarded autosave, reusing EPIC-05 platform seams, and
delivered as chained PR slices (WU1–WU4 + H1). Keep all forward dependencies
(Scheduling `appointmentId`, Portal summary, files, reports, weights,
vaccinations/deworming/treatments/studies) explicitly out of EPIC-06.

Before `sdd-propose`/`sdd-spec`, the user must resolve decisions **1–5** (scope
boundary, content model, autosave, amendment model, permission catalog);
decisions 6–12 have safe recommended defaults but should be confirmed.

---

## Ready for Proposal

**Conditional yes.** The Epic is well-founded on EPIC-05 seams and PRD §13, but
proposal/spec cannot start until the EPIC-06 scope boundary and the encounter
content/amendment/autosave/permission decisions are fixed. The orchestrator
should tell the user: EPIC-06 is ready to explore but **blocked on a product
scope Decision** for §6/§12/§13, with recommendations supplied above.
