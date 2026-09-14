---
id: EPIC-06
type: epic
title: Clinical
status: done
priority: high
depends_on:
  - EPIC-05
prd_sections:
  - "6"
  - "7"
  - "9"
  - "10"
  - "12"
  - "13"
  - "27"
  - "28"
  - "29"
  - "41"
created: 2026-09-11
updated: 2026-09-13
---

# EPIC-06 — Clinical

## Objective

Deliver tenant-scoped veterinary clinical records: a versioned DRAFT/CLOSED
`ClinicalEncounter` with linked audited amendments, five typed Patient-anchored
subdomain records, granular `vet.clinical.*` authorization, a staff HTTP surface
and workspace, and live-PostgreSQL isolation/concurrency evidence.

## Scope

- Six tenant-scoped clinical models (encounter + treatments/vaccinations/
  deworming/studies/weights) with RESTRICT FKs and a DB-enforced CLOSED
  immutability/no-delete trigger.
- Version-guarded DRAFT autosave (`409 CONFLICT` on drift), explicit close, and
  linked, audited, idempotent amendments.
- `vet.clinical.read|create|update|close|amend` permissions plus the
  `veterinary` entitlement gate; allowlisted CONFIDENTIAL DTOs.
- Staff clinical proxy (`/api/clinical`) and the Patient-detail clinical
  workspace.
- Synthetic demo data, schema/seed/service/API/UI tests, and live-PG
  cross-tenant and parallel-autosave evidence.

## Out of Scope

- Scheduling/appointment linkage, Portal, files, reports, billing and fiscal.
- Hard deletion, generic EAV/low-code entities, branch scoping, and Patient 360
  redesign.
- Emitting `ClinicalEncounterClosed` (no subscriber; unused events are banned).

## Acceptance Criteria

- [x] Encounters and subdomain records are tenant-scoped, Patient-anchored, and
      classified CONFIDENTIAL; a CLOSED encounter is immutable and no clinical
      record is hard-deletable.
- [x] DRAFT autosave is version-guarded (409 on drift); correction is a linked,
      audited, idempotent amendment that preserves the original.
- [x] Every clinical route enforces a granular `vet.clinical.*` permission and
      the service re-applies the `veterinary` entitlement.
- [x] Cross-tenant Patient anchors and aggregate UUIDs return a byte-equivalent
      `404 NOT_FOUND` and persist nothing.
- [x] Every mutation appends exactly one co-committed audit row with stable IDs
      and field names only.
- [x] Staff reach the clinical workspace through the authenticated proxy with
      loading/empty/error/success/permission-denied states and semantic tokens.
- [x] Required schema, seed, service, API, UI and live-PostgreSQL tests pass
      before closure.

## Stories

- [[VET-004 Clinical Encounter]] — data foundation, encounter lifecycle,
  specialized records, API contracts, staff workspace, and live-PG evidence.
  `done` (WU5 reviewed and merged; implementation closure only).

## Dependencies

- [[EPIC-05 Veterinary Patients]] supplies the Patient anchor and the
  `veterinary` entitlement precedent.
- [[EPIC-02 RBAC Entitlements Tenant Settings]] supplies permissions,
  entitlements and audit.
- [[EPIC-03 Staff Shell Design System Branding]] supplies the staff shell and
  semantic design tokens.

## Exit Criteria

- [x] Lint/typecheck/tests/build required for the Epic are green.
- [x] Documentation is current (this Epic, [[VET-004 Clinical Encounter]],
      [[Clinical]] module doc, roadmap index).
- [x] Fresh review of WU5 (verification evidence + delivery docs) is approved
      before the WU5 commit/PR.

Closure is evidence-based: the archived EPIC-06 verification report
(`openspec/changes/archive/2026-09-13-2026-09-11-epic-06-clinical/verify-report.md`)
passed all acceptance criteria (`pass_with_warnings`, 0 blockers, 10/10
requirements, 16/16 scenarios, 19/19 tasks), and the post-merge `main` CI run
[`34793644348`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34793644348)
at `ff786138` reported both jobs `success` (live-PG 24/24). `done` means epic
implementation closure only — it is **not** production readiness; [[EPIC-20]]
Production Hardening and the open Tech Debt items remain.

## Decisions / ADRs

- No new ADR: the Epic adds no runtime, broker, ORM, auth strategy or
  design-system change and stays inside the frozen MVP architecture.

## Technical Debt

- [[TD-006]] — broader Batch 5/RBAC live-PG gates remain open; the EPIC-06
  clinical application-path evidence is now executed by the same suite. The live
  block asserts the encounter CLOSED-immutability and encounter no-delete
  triggers; the five subdomain no-delete triggers are pinned statically by the
  WU1 schema migration test, not live-executed.
- WU5 size: the verification + delivery-documentation slice measured **1,208
  changed lines** (excluding `.atl/`/`.codegraph/`), over the ≤800-line review
  budget; the maintainer approved the **WU5 `size:exception`** for the honest,
  non-minified measure.
