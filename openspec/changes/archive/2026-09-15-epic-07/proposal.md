# Proposal: EPIC-07 — Staff Scheduling

## Intent

Give veterinary staff a tenant-safe agenda to create and manage branch-scoped
appointments, availability, and conflicts without advancing Portal or Catalog
scope.

## Scope

### In Scope

- Tenant- and branch-scoped appointments assigned to an in-tenant
  `TenantMembership` with the `VETERINARIAN` role; no practitioner entity.
- Staff agenda with day/week/month/list views, time-range creation, drag/resize,
  filters, explicit lifecycle transitions, and confidential allowlisted
  responses.
- Per-professional, per-branch working availability and one-off blocks through
  typed `scheduling` settings; typed `scheduling.conflictPolicy` returns
  `409 CONFLICT` for rejected overlaps.

### Out of Scope

- Portal appointment requests or approval flows (EPIC-08).
- Catalog service relations and free-text service labels (EPIC-09); no
  user-facing service field is added. The appointment boundary remains
  extensible for a future Catalog relation.
- Recurring blocks/appointments, reminders, and unused internal appointment
  events.
- A new practitioner entity, branch administration, or a clinical-encounter
  linkage.

## Capabilities

### New Capabilities

- `scheduling`: Staff appointment lifecycle, agenda, availability,
  branch/professional assignment, and conflict handling.

### Modified Capabilities

- `tenant-settings`: Register and govern the typed, tenant-scoped `scheduling`
  namespace and its write permission.

## Approach

Add an `Appointment` aggregate and explicit command endpoints in a Scheduling
module. Reuse server-resolved tenant context, `TenantMembership`, RBAC, typed
settings, transactional audit, and tenant-isolation patterns. Persist UTC times,
apply branch/professional availability and conflict policy during transactional
create/reschedule operations, then expose the staff agenda through the
authenticated web proxy. Deliver in reviewable slices.

## Affected Areas

| Area                                      | Impact   | Description                                                           |
| ----------------------------------------- | -------- | --------------------------------------------------------------------- |
| `packages/database/prisma/schema.prisma`  | Modified | Appointment data, tenant/branch/membership relations, lifecycle.      |
| `apps/api/src/scheduling/**`              | New      | Commands, validation, authorization, conflict handling, audit, tests. |
| `apps/api/src/settings/registry.ts`       | Modified | Typed `scheduling` settings definition.                               |
| `packages/database/src/reference-seed.ts` | Modified | Scheduling settings permission and role grants.                       |
| `apps/web/src/app/(app)/app/agenda/**`    | New      | Staff agenda and authenticated scheduling proxy.                      |

## Risks

| Risk                               | Likelihood | Mitigation                                                           |
| ---------------------------------- | ---------- | -------------------------------------------------------------------- |
| Concurrent overlapping bookings    | Medium     | Transactional validation, database-safe guard, and `409` race tests. |
| Timezone/DST errors                | Medium     | Persist UTC; convert only at tenant-timezone boundaries.             |
| Agenda scope exceeds review budget | High       | Chained, independently reversible delivery slices.                   |

## Rollback Plan

Restore the prior application build and remove the Agenda entry/routes. Keep
additive appointment/settings records intact; remove persisted data only through
a separately reviewed migration after export, never by destructive rollback.

## Dependencies

- Existing tenancy, RBAC, audit, branch, patient/customer, and tenant-settings
  capabilities.

## Success Criteria

- [ ] Authorized staff can manage appointments and availability only in their
      tenant and branch.
- [ ] Only VETERINARIAN memberships are assignable; rejected overlaps return
      `409 CONFLICT` per tenant policy.
- [ ] Agenda supports the specified staff workflow with loading, empty, error,
      and permission-denied states.
- [ ] Isolation, authorization, lifecycle, audit, settings, and conflict tests
      pass.
