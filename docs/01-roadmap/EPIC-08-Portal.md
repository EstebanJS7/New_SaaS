---
id: EPIC-08
type: epic
title: Portal
status: done
priority: high
depends_on:
  - EPIC-04
  - EPIC-05
  - EPIC-07
prd_sections:
  - "8"
  - "10"
  - "13"
  - "14"
  - "26"
  - "27"
  - "28"
  - "29"
  - "38"
  - "41"
created: 2026-09-15
updated: 2026-09-21
---

# EPIC-08 — Portal

## Objective

Give an account holder a first-party, Customer-linked portal that is a separate
security boundary from staff: their own pets and an allowlisted clinical
projection, their appointments, appointment requests that staff must approve,
and self-service phone/address updates — without advancing invoices, documents,
email flows or Catalog scope.

## Scope

- A first-party portal identity with its own credential, `PortalSession`,
  `ns_portal_session` cookie and `PortalAuthGuard`, fully separate from the
  staff session, cookie, guard and permission metadata.
- Staff-provisioned access: at most one active holder per Customer and per login
  email, gated on the `portal` entitlement, with revocation sweeping live
  sessions.
- Holder-owned reads: pets, pet detail (`clientSummary`-only clinical summary
  plus vaccinations), own appointments, own booking requests and own profile,
  all through allowlisted CONFIDENTIAL projections.
- Availability as a union across every in-tenant `VETERINARIAN`, plus booking
  requests that stay pending until a staff `approve`/`reject` decision promotes
  them to exactly one `PORTAL` appointment.
- Phone/address profile self-service, and holder cancel/reschedule of their own
  appointment through the shared scheduling invariants.
- A typed `portal` tenant-settings namespace, transactional `PORTAL`-attributed
  audit, a portal-only web surface and proxy, and durable live-PostgreSQL
  concurrency/isolation evidence.

## Out of Scope

- Invoices, documents and files (blocked on EPIC-14/§25).
- Email invitation, verification, magic-link, recovery and notifications
  (EPIC-17); email corrections stay staff-operated.
- Shared adult/caregiver access, service selection (Catalog, EPIC-09) and
  automatic booking confirmation.
- Staff authentication, sessions, RBAC or shell changes, and any external
  managed auth provider.

## Acceptance Criteria

- [x] A portal holder is a first-party credential linked to exactly one
      in-tenant Customer, with its own session table and cookie; staff and
      portal sessions cannot authorize each other's routes (cross-cookie `401`).
      Evidence: `apps/api/src/portal/portal-auth.integration.test.ts`,
      `live-pg-isolation.e2e-spec.ts` ("EPIC-08 portal identity").
- [x] At most one active holder per Customer and per login email; a second
      provision is `409 CONFLICT` and persists nothing, including under a
      concurrent race. Evidence: `portal-access.integration.test.ts`, live-PG
      identity block.
- [x] Every portal route and provisioning/revocation requires the `portal`
      entitlement; a missing grant is `403 FEATURE_NOT_ENTITLED` and nothing
      persists. Evidence: `portal-auth.integration.test.ts`,
      `portal-access.integration.test.ts`.
- [x] A holder reads only their own resources through the active guardian chain;
      another Customer's or another tenant's UUID is a byte-equivalent
      `404 NOT_FOUND`. Evidence: `portal-read.integration.test.ts`,
      `portal-booking.integration.test.ts`, live-PG write-isolation cases.
- [x] Pet detail exposes only the allowlist: patient identity, `clientSummary`
      and vaccinations; `internalNotes` never appears in a response or log, and
      deferred clinical subdomains are absent. Evidence:
      `portal-read.integration.test.ts`.
- [x] A booking request persists `PENDING` and audited, creates no appointment,
      and becomes an active appointment only through the staff approval command;
      approval is idempotent and carries `PORTAL` provenance. Evidence:
      `portal-booking.integration.test.ts`,
      `booking-requests.integration.test.ts`, live-PG approval race.
- [x] A portal identity cannot transition an appointment; holder cancel and
      reschedule are `SCHEDULED`/`CONFIRMED`-only and go through the shared
      scheduling transition, availability, overlap and version predicates.
      Evidence: `portal-appointment-write.integration.test.ts`, live-PG
      reschedule and cancel races.
- [x] Profile self-service updates only phone and address, rejects email/name/
      kind/tax/foreign identifiers with `400 VALIDATION_FAILED`, and appends one
      co-committed `PORTAL` audit row. Evidence:
      `portal-profile.integration.test.ts`.
- [x] Every portal route is fenced exactly to `/portal/*` with no staff
      permission metadata and login as the only `@Public` portal route; the web
      proxy forwards only allowlisted paths and only the portal cookie.
      Evidence: `route-contract.probe.test.ts`,
      `apps/web/.../api/portal/[[...path]]/route.test.ts`.
- [x] No unused event is emitted and no cash/stock/fiscal state is touched by
      portal commands. Evidence: the portal suites' no-event/no-ledger
      assertions.

## Stories

No standalone Story file: the epic was delivered as the chained SDD change
`openspec/changes/archive/2026-09-21-epic-08/` (archived at `be2c07f`) — WU1
data/settings → WU2 identity/boundary → WU3 read/proxy → WU4 booking/profile/UI
→ WU5 hardening and documentation. The implementation is merged at `27bc04a`
(merge of PR #53), and the change's spec deltas are merged into the standing
specs: `openspec/specs/portal-management/spec.md` created, and
`openspec/specs/scheduling/spec.md` and `openspec/specs/tenant-settings/spec.md`
updated.

## Dependencies

- [[EPIC-04 Customers]] and [[EPIC-05 Veterinary Patients]] supply the Customer,
  Patient and guardian anchors.
- [[EPIC-07 Scheduling]] supplies the `Appointment` lifecycle, the shared
  availability/overlap invariants and the staff booking-decision surface.
- [[EPIC-02 RBAC Entitlements Tenant Settings]] supplies permissions, the
  `portal` entitlement, typed settings and audit.
- [[EPIC-03 Staff Shell Design System Branding]] supplies the shared resolved
  brand and semantic design tokens the portal shell reuses.

## Exit Criteria

- [x] The implementation slices WU1–WU5 are merged and the durable
      live-PostgreSQL portal write-race evidence passed (suite 40/40).
- [x] Documentation is current, with named evidence:
      `openspec/changes/archive/2026-09-21-epic-08/archive-report.md` (the
      change archived, its deltas merged into the standing specs), [[Portal]]
      (module doc), [[DEC-008]] (decision record) and this roadmap index.
- [x] The SDD change is archived at
      `openspec/changes/archive/2026-09-21-epic-08/`; its deltas are merged into
      `openspec/specs/portal-management/spec.md` (created),
      `openspec/specs/scheduling/spec.md` and
      `openspec/specs/tenant-settings/spec.md` (updated).

`status: done` means epic implementation closure only: the slices are merged,
the live-PostgreSQL write-race evidence passed, the closing documentation
exists, and the change is archived. It is **not** a production-readiness
statement — [[EPIC-20]] Production Hardening and the open Tech Debt items
remain.

Epic-level verification is the merged evidence, **not** a single epic-level
verify report: the archived `verify-report.md` is **WU1-scoped** (the WU1
re-verification, `pass_with_warnings`, 0 blockers), and WU2–WU5 acceptance is
carried by the merged CI and live-PostgreSQL baseline at `27bc04a` plus the
acceptance-criteria map above.

## Decisions / ADRs

- [[DEC-008]] records the PRD §8 deviation (first-party portal identity instead
  of external managed authentication) together with the deferrals,
  classification and rollback position. It is `proposed`: the approach is
  realized by the merged implementation, but formal acceptance is outstanding.
- [[DEC-007]] decided the availability union, portal booking, and holder
  cancel/reschedule; it also settled that staff assign the professional at
  approval.
- [[DEC-002]] keeps the portal routes unprefixed (`/portal/*`).
- [[DEC-006]] remains the open question about database-backed primary-phone
  uniqueness.
- No ADR: the epic adds no runtime service, datastore, broker, ORM, auth
  provider or design-system change and stays inside the frozen MVP architecture.

## Technical Debt

- [[TD-006]] — the portal write paths now carry real-PostgreSQL concurrency and
  isolation evidence; the broader Batch 5/RBAC live-PG gates remain open.
- [[TD-007]] — Playwright E2E remains deferred; portal UX is covered by Vitest +
  testing-library.
- [[TD-005]] — portal login shares the single-replica in-process rate limiter.
- [[TD-004]] — no self-service portal credential recovery until EPIC-17; access
  is staff-provisioned.
- [[DEC-006]] — "exactly one primary phone" is application-level and not
  sufficient under concurrency.
- [[TD-012]] — two load-sensitive web tests fail intermittently and now block
  merges under the enabled branch protection; the sightings are delivery-session
  observations, not reconstructable repository evidence.
- Merged-state limitations documented in [[Portal]]: there is no holder-facing
  profile page or client function; `bookingRequiresApproval` is registered but
  not consumed by the booking flow; species/breed names cannot be resolved
  without a holder-facing catalog read; and `INTERNAL` `DomainError` messages
  are echoed to the client by the global exception filter.
