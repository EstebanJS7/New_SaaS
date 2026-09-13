---
type: module
module: clinical
status: implemented
updated: 2026-09-13
---

# Module — Clinical

## Responsibility

Tenant-scoped veterinary clinical records for a Patient: a versioned
`ClinicalEncounter` with linked amended corrections, and five typed subdomain
records (treatments, vaccinations, deworming, studies, weights).

## Does Not Own

- Scheduling/appointment linkage, Portal delivery, files, reports, billing or
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

## Related ADRs

- [[ADR-001 Modular Monolith]]
