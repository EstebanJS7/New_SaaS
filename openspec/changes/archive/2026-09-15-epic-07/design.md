# Design: EPIC-07 — Staff Scheduling

## Technical Approach

Add a tenant/branch-scoped `Appointment` aggregate in `apps/api/src/scheduling`,
reusing existing seams: `RequestContextService` tenancy, `@RequirePermissions` +
service re-check, `AuditWriter.append(input, tx)` co-commit, allowlisted
CONFIDENTIAL DTOs, composite tenant FKs. Availability, blocks and
`conflictPolicy` live in the typed `scheduling` settings namespace. Chained
slices: WU1 persistence → WU2 service → WU3 API → WU4 agenda.

## Architecture Decisions

| Decision                   | Choice                                                                                                                                                                                                                  | Rejected                                         | Rationale                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Boundary / Patient linkage | Scheduling sits beside `clinical`; `Appointment` anchors Patient, Branch, Membership via composite `(tenant_id, x_id)` FKs.                                                                                             | New practitioner entity; Core import of Patient. | Spec mandates an in-tenant Patient and VETERINARIAN membership.                                 |
| Availability vs policy     | Availability/block violations always `409`, independent of `conflictPolicy`; no availability rows for a (professional, branch) means unrestricted.                                                                      | Policy governing availability.                   | Both spec requirements are unconditional.                                                       |
| Concurrency                | Under `REJECT`, `pg_advisory_xact_lock(hashtextextended(tenantId:membershipId))` wraps overlap-check and insert; transitions use `status` predicates, reschedule adds `version`; write conflicts map to `409` (TD-011). | `btree_gist` EXCLUDE constraint.                 | EXCLUDE cannot coexist with the `ALLOW` policy.                                                 |
| Timezone                   | Persist `TIMESTAMPTZ(3)`; availability is local `weekday`+`startMinute`/`endMinute`, converted with `Intl` and shared `TENANT_TIMEZONE="America/Asuncion"`.                                                             | Per-tenant timezone column now.                  | PRD fixes one timezone; per-tenant is additive later.                                           |
| Permission matrix          | Add `.read`, `.transition`, `scheduling.settings.manage` beside `.manage`. OWNER/ADMIN all four; RECEPTIONIST read+manage+transition; VETERINARIAN read+transition.                                                     | Single `.manage` key.                            | Spec requires distinct read/manage/transition/settings keys.                                    |
| Settings write auth        | `PUT /settings/:namespace` is authenticated-only; the service enforces the registry `requiredPermissionKey`; a test iterates the registry.                                                                              | Static decorator.                                | A decorator cannot express a per-namespace key; sales is unaffected.                            |
| Lifecycle API              | Six named commands (`confirm`, `arrive`, `start`, `complete`, `cancel`, `no-show`); reschedule only from `SCHEDULED`/`CONFIRMED`; terminal rows immutable.                                                              | `PATCH status` / single `/transition`.           | Governance prefers named commands; illegal edges → `409`.                                       |
| Clinical seam              | Defer `ClinicalEncounter.appointmentId`.                                                                                                                                                                                | Adding the FK now.                               | Spec excludes clinical linkage; `Appointment @@unique([tenantId, id])` keeps it additive later. |
| Agenda options             | `GET /appointments/options` returns tenant branches + VETERINARIAN memberships.                                                                                                                                         | New branch-admin surface.                        | Filters need options; branch admin is out of scope.                                             |

## Data Flow

    Agenda ── /api/{scheduling,settings} proxy ── AppointmentService(tx)
       │   advisory lock + TenantSettings(scheduling ns)   │
       └────────────── AuditWriter(tx) ────────────────────┘

## File Changes

| File                                                                                                                             | Action        | Description                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| `packages/database/prisma/schema.prisma`                                                                                         | Modify        | `Appointment` + `AppointmentStatus`; composite uniques on `Branch`, `TenantMembership`.          |
| `packages/database/prisma/migrations/20260915000001_scheduling/migration.sql`                                                    | Create        | Tables, composite FKs, indexes, `end_at > start_at` CHECK, DELETE-rejecting trigger.             |
| `packages/database/src/{reference-seed,demo-seed}.ts`                                                                            | Modify        | Scheduling permission keys/role matrix; synthetic Branch, VETERINARIAN membership, appointments. |
| `apps/api/src/scheduling/**`                                                                                                     | Create        | Service, transitions, time/availability math, permissions, DTO, zod, controller, tests.          |
| `apps/api/src/settings/{registry,tenant-settings.service,settings.controller}.ts`                                                | Modify        | Namespace definition, tx read + `changedFields` audit, namespace-driven write auth.              |
| `apps/api/src/app.module.ts`, `rbac/route-contract.probe.test.ts`, `test/live-pg-isolation.e2e-spec.ts`                          | Modify        | Registration, route inventory, race/isolation evidence.                                          |
| `apps/web/src/app/(app)/app/agenda/**`, `components/shell/nav-sidebar.tsx`, `app/api/{scheduling,settings}/[[...path]]/route.ts` | Create/Modify | Agenda views, availability editor, proxies, nav entry.                                           |

## Interfaces / Contracts

Routes: `GET/POST /appointments`, `GET /appointments/options`,
`GET /appointments/:id`, `PUT /appointments/:id` (`{startAt, endAt, version}`),
`POST /appointments/:id/{confirm,arrive,start,complete,cancel,no-show}`.

```ts
// settings/registry.ts — local wall-clock availability (blocks mirror it with startsAt/endsAt UTC)
availability: z.array(z.object({
  membershipId: z.string().uuid(), branchId: z.string().uuid(),
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
}).strict()),
```

Appointment DTO allowlist:
`id, tenantId, branchId, patientId, professionalMembershipId, status, startAt, endAt, version, createdAt, updatedAt`
— no service/Catalog field, no events emitted.

## Testing Strategy

| Layer       | What to Test                                                                                                            | Approach                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Unit        | Transition edges; timezone/DST math; availability/block containment; settings defaults/rejection; DTO allowlist         | Vitest table-driven                             |
| Integration | 401/403/404/409/400 envelopes, cross-tenant 404, one co-committed audit row, route inventory, namespace settings writes | supertest + in-memory DB                        |
| Live-PG     | Concurrent overlap race, isolation                                                                                      | `pnpm services:up && pnpm preflight`            |
| Web         | Agenda UI states, permission-denied, proxy allowlist                                                                    | Vitest + testing-library (E2E deferred, TD-007) |

## Threat Matrix

| Threat                                              | Applicable | Expected safe behaviour                                 | RED test                        |
| --------------------------------------------------- | ---------- | ------------------------------------------------------- | ------------------------------- |
| Cross-tenant UUID reference                         | Applicable | Byte-equivalent `404 NOT_FOUND`, nothing persisted      | isolation probe                 |
| Concurrent overlapping booking                      | Applicable | At most one persists; other `409 CONFLICT`              | live-PG race                    |
| Illegal/terminal transition                         | Applicable | `409 CONFLICT`, state unchanged                         | service test                    |
| Missing permission / anonymous / internals leaked   | Applicable | `403 FORBIDDEN` / `401 UNAUTHENTICATED`; allowlist only | HTTP integration + DTO key test |
| Shell/subprocess/VCS/executable/process integration | N/A        | No such boundary exists here                            | —                               |

## Migration / Rollout

Additive migration, no backfill. Rollback: restore the prior build and remove
the Agenda routes; records are removed only via a separately reviewed migration
after export.

## Open Questions

- [ ] Should `VETERINARIAN` also receive `scheduling.appointment.manage`, or
      only read/transition?
- [ ] Confirm reschedule from `ARRIVED` is intentionally rejected (proposed:
      yes).
