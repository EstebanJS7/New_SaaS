---
type: module
module: clinical
status: implemented
updated: 2026-10-28
---

# Module — Clinical

## Responsibility

Tenant-scoped veterinary clinical records for a Patient: a versioned
`ClinicalEncounter` with linked amended corrections, and five typed subdomain
records (treatments, vaccinations, deworming, studies, weights).

## Does Not Own

- Scheduling/appointment lifecycle, Portal delivery, files, reports, billing or
  fiscal behavior.
- Patient identity or guardian links (owned by EPIC-05 Patients).
- A generic event bus; `ClinicalEncounterClosed` is intentionally not emitted.

## Public Capabilities

- Create/list/get encounters anchored to a Patient.
- Version-guarded DRAFT autosave; explicit close; linked, audited, idempotent
  amendments.
- Create/list/update for the five subdomain record kinds (no delete).
- A staff HTTP surface behind granular permissions and the `veterinary`
  entitlement, plus an authenticated web proxy and staff workspace.
- A staff ENTRY surface for vaccinations and deworming, including the
  staff-entered `nextDueAt` a report reads ([[REP-010]]).

## Main Entities

- `ClinicalEncounter` — content + `internalNotes`/`clientSummary`, `status`,
  `version`, `amendsEncounterId`/`amendmentReason`, `idempotencyKey`.
- `ClinicalTreatment`, `ClinicalVaccination`, `ClinicalDeworming`,
  `ClinicalStudy`, `ClinicalWeight` — typed minimum facts, Patient-anchored.

## State Transitions

```text
ClinicalEncounter: DRAFT --autosave(version N -> N+1)--> DRAFT
                   DRAFT --close(version N)--> CLOSED
                   CLOSED --amend(reason[, idempotencyKey])--> new linked CLOSED row
```

A CLOSED encounter is immutable; the original is never mutated.

## Permissions

- `vet.clinical.read|create|update|close|amend`, each pinned per route by the
  route-contract probe.
- The service re-applies the `veterinary` entitlement
  (`403 FEATURE_NOT_ENTITLED`) and the granular permission (`403 FORBIDDEN`) as
  defense in depth.

## Staff surface (web)

The Spanish staff workspace ([[UX-002]]) reviews closure in a modal. Pending
draft content is saved first; the close command consumes the saved response's
version immediately, without depending on a React render. A failed/conflicted
save or a newer local edit prevents closing and preserves the draft. Cancelling
the confirmation does not issue a close command.

One page, `apps/web/src/app/(app)/app/patients/[id]/`, rendered inside the staff
`(app)` shell through the authenticated `/api/clinical` proxy:

- **Clinical records** — the encounter card: create, version-guarded autosave,
  close, amend.
- **Vaccinations and deworming** — the specialized-record card
  (`clinical-records.tsx`): list, create, correct, and **clear the due date**.

Both cards are per-patient and independent. The second one is the only staff
path that fills `next_due_at`, the nullable column [[DEC-065]] added for PRD
§31's "upcoming/overdue vaccines" and "upcoming deworming" reports; [[DEC-067]]
scoped that entry path to these two record kinds and to nothing else.

What the surface guarantees, all of it UX-only — the API re-asserts every gate:

- An empty due date renders the explicit "No due date recorded" state, never a
  blank or a placeholder date. `null` means "not monitored", and the reports
  omit the row instead of deriving one.
- A wrong due date is REMOVABLE, not only replaceable: the correction form sends
  an explicit `nextDueAt: null`, which is the contract `PUT …/:id` already
  accepted. A create with no due date OMITS the key, because the create schema
  treats an absent key as "no due date" and rejects `null` there.
- Entry and display use `<input type="datetime-local">`, and the typed
  wall-clock value is converted to an ISO instant in the browser before it
  leaves, so the reports bucket the row to the local day staff chose.
- The create and correct affordances are hidden when the shell supplies
  permissions without `vet.clinical.create` / `vet.clinical.update`; when the
  shell supplies none (`undefined` = unknown), they stay visible and the API's
  `403 FORBIDDEN` remains the authority.
- Loading, empty, error, success and permission-denied states exist for both
  lists, styled with semantic branding tokens only.

**Remaining gap.** Treatments, studies and weights have routes, validation and
permissions but **no staff UI** — they are API-only, so a staff member cannot
record them through the product. That is [[TD-055]], narrowed from five kinds to
three by [[DEC-067]] and still open. There is also no cross-patient "all
vaccinations" view: the due reports are that view, aggregated.

## Clinical form and closure refinement — UX-002

The working copy preserves spaces while typing. Each optional text field mirrors
the API's 10,000-character bound with a linked error/count; invalid content cannot
autosave or close. Manual draft save retries failures explicitly instead of
repeatedly retrying an unchanged failed write. The mounted guard is re-enabled
correctly after React StrictMode effect cleanup/setup.

Pending edits disable switching/creating encounters. Same-document section links
remain available. Other clicked links require an accessible exit confirmation;
autosave pauses while deciding, and in-flight writes must finish before exiting.
Reload/window close uses native beforeunload. Back/Forward and programmatic same-document route changes retain pending content
in QueryClient memory for ten minutes while away. A fresh authorized read gates
restoration; explicit manual save confirms the recovered content. Version drift
blocks overwrites; a remotely closed record stays immutable. See [[TD-065]].
No draft content is written to browser storage; recovery does not survive a new
document or logout.

Closure reviews the current staff content, separates client summary from internal
notes and keeps the existing save/version/close sequence. Blank fields remain
optional. Closed consultations render persisted content read-only beside the
existing explicit amendment command. Closing does not complete an appointment or
create a sale. No appointment/professional linkage was added to the clinical DTO.

## API

- `GET|POST /patients/:patientId/clinical/encounters`
- `GET|PUT /patients/:patientId/clinical/encounters/:id`
- `POST /patients/:patientId/clinical/encounters/:id/close`
- `POST /patients/:patientId/clinical/encounters/:id/amendments`
- `GET|POST /patients/:patientId/clinical/{treatments|vaccinations|deworming|studies|weights}`
- `PUT /patients/:patientId/clinical/{kind}/:id`
- `GET /api/clinical/[...path]` — authenticated staff web proxy (allowlisted
  route shapes, UUID-only Patient anchor, re-encoded segments).

## Events / Jobs

- None. No internal event or background job is emitted; corrections are explicit
  application commands.

## Invariants

- One atomic conditional `updateMany(status=DRAFT, version=N)` makes autosave
  concurrency-safe: a stale/concurrent write changes nothing and returns
  `409 CONFLICT`.
- Amendments take `SELECT … FOR UPDATE` on the original inside the transaction,
  so concurrent corrections serialize; a repeated idempotency key resolves to
  the existing amendment.
- Exactly one audit row is appended per mutation, co-committed in the same
  transaction.
- Database-enforced: CLOSED rows are immutable and not hard-deletable; subdomain
  rows are not hard-deletable; a weight quantity is strictly positive.

## Security / Tenant Rules

- Tenant identity comes only from `RequestContextService`; a route/body
  `tenantId` is never trusted.
- A foreign Patient UUID or foreign clinical aggregate UUID returns a
  byte-equivalent `404 NOT_FOUND` and persists nothing.
- DTOs are allowlisted and CONFIDENTIAL; Prisma models are never returned.
  `internalNotes` is excluded from client-safe projections and never logged.

## Verification

- `apps/api/test/live-pg-isolation.e2e-spec.ts` — "EPIC-06 clinical
  application-path isolation" (8 tests) against a disposable PostgreSQL 16
  database: allowlisted DTO + autosave, live encounter CLOSED immutability and
  encounter no-delete trigger enforcement (the five subdomain no-delete triggers
  are pinned statically by the WU1 schema migration test, not live-executed),
  linked audited amendment, byte-equivalent cross-tenant `404`, negative
  cross-tenant amendment before/after assertions, and a deterministic-barrier
  parallel-autosave race yielding one success + one `409 CONFLICT`.

## Related Stories

- [[VET-004 Clinical Encounter]]
- [[REP-010]] — the vaccination/deworming entry surface and the due date it
  fills

## Related Decisions

- [[DEC-065]] — `next_due_at` on both tables, entered by staff, NULL = not
  monitored
- [[DEC-067]] — this entry path is scoped to vaccinations and deworming

## Technical Debt

- [[TD-055]] — treatments, studies and weights stay API-only (open)

## Related ADRs

- [[ADR-001 Modular Monolith]]


## Appointment navigation context — UX-005

Staff navigation can carry an appointment ID from agenda to patient detail and
then POS. A Veterinary frontend composition reads the existing authorized
appointment and presents date/status/professional/service; patient-detail context
must match the current patient. Invalid/unreadable context has explicit feedback
without blocking the independent workspace. The closed consultation offers a POS
link; no sale, payment or appointment transition is issued by navigation.

This is not a persisted appointment/encounter/sale association. No clinical data
or price is placed in URLs, no new API or financial orchestration was added, and
no Core backend module imports Veterinary implementation. See [[UX-005]] and the
still-proposed [[DEC-083-appointment-clinical-sale-journey]] for the boundary.


## Explicit care links — UX-006 / DEC-083

Veterinary now owns immutable, typed ClinicalAppointmentLink and ClinicalSaleLink
records. One appointment can have multiple encounters, one encounter at most one
appointment origin. One encounter can have multiple sales; a sale belongs to at
most one encounter. Standalone encounters/sales remain allowed. A link can be
added to a closed encounter without editing its clinical content.

GET `/patients/:patientId/clinical/appointments/:id/encounters` lists linked IDs.
GET `/patients/:patientId/clinical/encounters/:id/links` returns allowlisted IDs,
sale status and related-domain read availability. POST `.../links/appointment`
and `.../links/sale` validate strict UUID bodies; identical requests replay without
duplicate audit, incompatible origins return 409. Missing/foreign/mismatched
patient resources return 404. Every mutation requires clinical read/update and
the target domain's read permission; Veterinary entitlement is always required,
and sale links also respect the sales entitlement. Tenant context is server-owned.

Link creation and audit share a transaction; encounter/sale row locks serialize
competing origin links. Composite tenant/patient FKs, unique origin constraints
and immutable-link triggers back the application checks. No delete/relink endpoint.
The staff UI explicitly confirms linking and can reopen linked consultations and
existing draft sales. POS can link the newly created sale without recreating it.
The scheduled service is suggested only through current active catalog data and
operator acceptance. Customer selection, closing an encounter, appointment
completion and payment completion remain separate commands. No price or clinical
content is copied into the association or URL.

Migration: `20261028000001_clinical_journey_links`. CONFIDENTIAL staff-only IDs;
no new Portal projection, logs of content or destructive retention.
