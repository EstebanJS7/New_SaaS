---
id: VET-004
type: story
title: Clinical Encounter
epic: EPIC-06
status: done
priority: high
depends_on:
  - PAT-003
prd_sections:
  - "6"
  - "7"
  - "9"
  - "10"
  - "13"
  - "27"
  - "28"
  - "29"
  - "41"
permissions:
  - vet.clinical.read
  - vet.clinical.create
  - vet.clinical.update
  - vet.clinical.close
  - vet.clinical.amend
branch: feat/epic-06-clinical
created: 2026-09-11
updated: 2026-09-13
---

# VET-004 — Clinical Encounter

## Objective

Give veterinary staff a durable, tenant-scoped clinical record for a Patient:
structured encounters that autosave while open, become immutable once closed,
and are corrected only through linked audited amendments, plus five typed
subdomain records (treatments, vaccinations, deworming, studies, weights).

## Context

EPIC-05 established the Patient aggregate, the `veterinary` entitlement gate and
the audit/isolation seams this Story consumes. Clinical is a leaf module: it
imports Context, RBAC, Audit and Entitlements, is never imported by Core or
Patients, and adds no runtime, broker or dependency.

## In Scope

- Six clinical models, migration with RESTRICT FKs, indexes and the CLOSED
  immutability/no-delete trigger.
- Encounter lifecycle (create/list/get, versioned autosave, close, linked
  amendments) and five subdomain record services.
- `vet.clinical.*` permissions + role matrix and synthetic demo data.
- HTTP contracts, Zod validation, allowlisted DTOs, and the runtime route fence.
- Staff web proxy + API client + Patient-detail clinical workspace.
- Live-PostgreSQL cross-tenant/concurrency evidence and delivery documentation.

## Out of Scope

- Scheduling/appointment linkage, Portal, files, reports, billing/fiscal, and
  hard deletion.
- Patient 360 redesign, branch scoping, and generic EAV/low-code entities.

## Acceptance Criteria

- [x] A DRAFT encounter is editable/autosaved; a CLOSED encounter is immutable
      and not hard-deletable.
- [x] Autosave is version-guarded; a stale write persists nothing and returns
      `409 CONFLICT`.
- [x] Amendment is an explicit `vet.clinical.amend` operation creating a linked
      CLOSED record with a reason; repeated requests with the same idempotency
      key resolve to the existing amendment.
- [x] Tenant isolation is enforced: foreign Patient UUIDs and foreign clinical
      aggregate UUIDs return byte-equivalent `404 NOT_FOUND` and persist
      nothing.
- [x] Backend authorization and the `veterinary` entitlement are enforced on
      every clinical route.
- [x] Every mutation appends exactly one co-committed audit row using stable IDs
      and field names only.
- [x] Staff workspace exposes loading/empty/error/success/permission-denied
      states with semantic tokens and never surfaces `internalNotes` to clients.
- [x] Required tests pass, including live-PostgreSQL isolation/concurrency
      evidence (WU5).

## Domain Invariants

- A clinical record belongs to exactly one tenant and one same-tenant Patient;
  the composite `(tenant_id, patient_id)` FK makes cross-tenant anchoring
  impossible in the database.
- CLOSED encounters are immutable; correction is an INSERT of a linked CLOSED
  amendment that never mutates the original.
- A weight quantity is strictly positive (`Decimal(10,3)` + CHECK).

## API

### Added

```text
GET|POST  /patients/:patientId/clinical/encounters
GET|PUT   /patients/:patientId/clinical/encounters/:id
POST      /patients/:patientId/clinical/encounters/:id/close
POST      /patients/:patientId/clinical/encounters/:id/amendments
GET|POST  /patients/:patientId/clinical/{treatments|vaccinations|deworming|studies|weights}
PUT       /patients/:patientId/clinical/{kind}/:id
GET       /api/clinical/[...path]   (Next.js authenticated staff proxy)
```

### Changed

```text
None.
```

## Database

### Migration

```text
packages/database/prisma/migrations/20260912000001_clinical/migration.sql
```

### Models/Tables

- `clinical_encounter`, `clinical_treatment`, `clinical_vaccination`,
  `clinical_deworming`, `clinical_study`, `clinical_weight`.

## UI

- `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.tsx` mounted from
  `patient-detail.tsx`; workspace states and controls use semantic design
  tokens.

## Implementation Summary

Delivered across WU1–WU5 on the `feat/epic-06-clinical` tracker branch chain.
The encounter core uses one conditional `updateMany(status=DRAFT, version=N)`
for concurrency safety and a `SELECT … FOR UPDATE` lock for amendments; the five
subdomain services extend the same tenant/entitlement/permission/audit base. WU5
adds live-PostgreSQL evidence and the Epic/module/story documentation set.

## Verification

```text
pnpm --filter @newsaas/api test:live-pg  → 24/24 passed (local PG16)
```

WU5 extended `apps/api/test/live-pg-isolation.e2e-spec.ts` with an "EPIC-06
clinical application-path isolation" block proving, over real HTTP + PostgreSQL:
allowlisted DTO + autosave version advance; live encounter CLOSED immutability
and encounter no-delete trigger enforcement (the five subdomain no-delete
triggers are pinned statically by the WU1 schema migration test, not
live-executed); linked audited amendment with original unchanged;
byte-equivalent cross-tenant `404` for foreign Patient anchors, foreign
encounter UUIDs and foreign record UUIDs; negative cross-tenant amendment
before/after assertions (no amendment row, no audit row for either tenant, own
and foreign originals byte-equal, no other foreign encounter created); and a
deterministic-barrier parallel-autosave probe returning exactly one success and
one `409 CONFLICT`. Two one-variable RED proofs (removing `assertPatient`;
removing the version guard) failed the expected clinical tests and were reverted
byte-for-byte.

## Tests Added

- `apps/api/test/live-pg-isolation.e2e-spec.ts` — EPIC-06 clinical
  application-path isolation (8 tests).

## Known Limitations

- The WU5 verification + delivery-documentation slice measured **1,208 changed
  lines** (excluding `.atl/`/`.codegraph/`), over the ≤800-line review budget;
  the maintainer approved the **WU5 `size:exception`** for the honest,
  non-minified measure.
- The clinical workspace depends on the WU4A proxy/client UUID contract;
  fixtures use canonical UUIDs.
- Design §10 open questions (minimal encounter field set; whether `close`
  requires a non-empty `clientSummary`) remain **open** and are not resolved.

## Technical Debt

- [[TD-006]] — broader Batch 5/RBAC live-PG evidence gates remain open; EPIC-06
  clinical application-path evidence is now part of the same suite.

## Decisions / ADRs

- None. No PRD scope change and no new architecture decision.

## Files / Modules

- `packages/database/prisma/schema.prisma`, clinical migration, seeds.
- `apps/api/src/clinical/**`, `apps/api/src/rbac/route-contract.probe.test.ts`.
- `apps/web/src/app/api/clinical/[[...path]]/route.ts`,
  `apps/web/src/app/(app)/app/patients/[id]/{clinical-api.ts,clinical-workspace.tsx,patient-detail.tsx}`.
- `apps/api/test/live-pg-isolation.e2e-spec.ts`.

## Completion Notes

_Closed by evidence-based reconciliation on 2026-09-13. WU5 passed a fresh
review and merged; the archived EPIC-06 verification report
(`openspec/changes/archive/2026-09-13-2026-09-11-epic-06-clinical/verify-report.md`)
passed all acceptance criteria, and the post-merge `main` CI run
[`34793644348`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34793644348)
at `ff786138` reported both jobs `success` (live-PG 24/24). `done` means
implementation closure only — it is **not** production readiness. Design §10
open questions and the [[TD-006]] gates above remain open._
