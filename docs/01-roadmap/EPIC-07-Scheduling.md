---
id: EPIC-07
type: epic
title: Scheduling
status: done
priority: high
depends_on:
  - EPIC-04
  - EPIC-05
prd_sections:
  - "5"
  - "14"
  - "27"
  - "28"
  - "29"
  - "38"
  - "41"
created: 2026-09-14
updated: 2026-09-15
---

# EPIC-07 — Scheduling

## Objective

Give veterinary staff a tenant- and branch-scoped agenda to create and manage
appointments, per-professional availability and one-off blocks, and conflict
handling through a typed policy — without advancing Portal, Catalog, recurrence,
or clinical-linkage scope.

## Scope

- An `Appointment` aggregate anchored to an in-tenant Branch, Patient and
  `VETERINARIAN` `TenantMembership`, persisted in UTC with an explicit lifecycle
  and no practitioner entity.
- A staff agenda over the tenant's branch-scoped appointments: day/week/month/
  list views, time-range creation, drag/resize reschedule, branch/professional/
  status filters, and loading/empty/error/success/permission-denied states.
- A typed `scheduling` tenant-settings namespace (`conflictPolicy`,
  availability, one-off blocks) plus granular `scheduling.appointment.*` and
  `scheduling.settings.manage` permissions.
- A confidential allowlisted HTTP surface, authenticated web proxies,
  transactional audit, and durable live-PostgreSQL isolation/concurrency
  evidence.

## Out of Scope

- Portal booking/approval (EPIC-08), Catalog service relations and free-text
  service labels (EPIC-09).
- Recurring appointments/blocks, reminders, and internal appointment events
  (`AppointmentConfirmed`/`AppointmentCancelled` are intentionally not emitted).
- A separate practitioner entity, branch administration, and a
  `ClinicalEncounter.appointmentId` linkage.

## Acceptance Criteria

- [x] Appointments are tenant- and branch-scoped, reference only an in-tenant
      Patient and a `VETERINARIAN` membership, and persist UTC times.
- [x] The lifecycle moves only through the six named commands; illegal or
      terminal edges return `409 CONFLICT` with state unchanged, and no generic
      status-update route exists.
- [x] Overlaps follow the typed `conflictPolicy`; under `REJECT` a conflicting
      create/reschedule persists nothing and returns `409 CONFLICT`, including
      under concurrent requests (durable live-PostgreSQL race).
- [x] Availability windows and one-off blocks are enforced from the typed
      `scheduling` namespace; violations return `409 CONFLICT` and persist
      nothing.
- [x] Every route enforces a granular `scheduling.appointment.*` permission and
      the service re-asserts it as defense in depth.
- [x] Cross-tenant Patient/Branch/membership anchors and appointment UUIDs
      return a byte-equivalent `404 NOT_FOUND` and persist nothing.
- [x] DTOs are allowlisted and CONFIDENTIAL; every mutation appends exactly one
      co-committed audit row and no appointment event is emitted.
- [x] The staff agenda and both authenticated proxies render the required states
      with semantic tokens; the required suites pass, including the durable
      live-PostgreSQL overlap race.

## Stories

No standalone Story file: the epic is delivered as the chained SDD change
`openspec/changes/epic-07/` — WU1 data/settings → WU2 domain service → WU3 HTTP
API → WU4 staff agenda → WU5 live-PG evidence and docs.

## Dependencies

- [[EPIC-04 Customers]] and [[EPIC-05 Veterinary Patients]] supply the Customer
  and Patient anchors.
- [[EPIC-02 RBAC Entitlements Tenant Settings]] supplies permissions, audit and
  the typed tenant-settings registry.
- [[EPIC-03 Staff Shell Design System Branding]] supplies the staff shell and
  semantic design tokens.

## Exit Criteria

- [x] Lint/typecheck/tests/build required for the Epic are green at the epic
      level.
- [x] Documentation is current (this Epic, [[Scheduling]] module doc, roadmap
      index).
- [x] `sdd-verify` and archive complete; closure is evidence-based.

`status: done` means the implementation slices WU1–WU5 are complete, the durable
live-PostgreSQL race passed, and the full `sdd-verify` gate and archive are
complete. It means epic implementation closure only, not production readiness —
[[EPIC-20]] Production Hardening and the open Tech Debt items remain.

## Decisions / ADRs

- No new ADR: the epic adds no runtime, broker, ORM, auth strategy or
  design-system change and stays inside the frozen MVP architecture. The
  `pg_advisory_xact_lock` concurrency choice is recorded in the change design.
- FullCalendar React was adopted for the day/week/month agenda views — a
  deliberate deviation from the original "no third-party calendar" assumption,
  recorded in `openspec/changes/epic-07/apply-progress.md`.

## Technical Debt

- [[TD-011]] — a P2002 primary-guardian write race maps to `500 INTERNAL` rather
  than `409 CONFLICT` (pre-existing EPIC-05 patient concern, not EPIC-07).
- [[TD-006]] — the scheduling concurrency test now runs in
  `apps/api/test/live-pg-isolation.e2e-spec.ts`; the broader Batch 5/RBAC
  live-PG gates remain open.
- [[TD-007]] — Playwright E2E remains deferred; agenda behavior is covered by
  Vitest + testing-library.
- WU5's durable run surfaced and fixed two live-only defects invisible to the
  in-memory harness: the EPIC-07 race fixture created an active Patient without
  its required primary guardian, and the advisory-lock query returned `void`,
  which Prisma `$queryRaw` cannot deserialize (P2010).
