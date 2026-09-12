# Design: EPIC-06 Comprehensive Clinical Records

## Technical Approach

Add a tenant-scoped Clinical module (`apps/api/src/clinical`) as a leaf consumer of
the existing platform seams (Context, RBAC, Audit, Entitlements), mirroring the
EPIC-05 Patients module. Persist typed clinical aggregates anchored to `Patient`;
enforce DRAFT/CLOSED lifecycle, version-guarded autosave, and linked audited
amendments transactionally. No new runtime, broker, event bus, or dependency.
`ClinicalEncounterClosed` is NOT emitted (no subscriber; unused events are banned).

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|----------|--------|----------|-----------|
| Module boundary | New `apps/api/src/clinical/**` importing Context/RBAC/Audit/Entitlements; never imported by Core/Patients | Extend `PatientsModule` | Isolates clinical scope; matches EPIC-05 leaf pattern |
| Encounter content | Explicit typed columns + `internalNotes`/`clientSummary` | Generic `content Json` / EAV | EAV/low-code engines are banned; explicit columns validate simply |
| Five subdomains | Five explicit Prisma models, patient-anchored | One polymorphic `clinical_record(kind)` | No EAV; typed minimum facts per spec |
| Amendment | Self-referential `amendsEncounterId`; amendment row is CLOSED; original never mutated | Separate amendment table; in-place edit | Reuses content columns; "new record linked to original"; preserves prior state |
| Concurrency | `version` guarded conditional `updateMany(status=DRAFT, version=N)`; `count=0` ⇒ 409 | `updatedAt` guard; SELECT-then-UPDATE | One atomic statement; no clock race (TD-011 class) |
| Immutability | Service DRAFT-only transitions + DB trigger rejecting UPDATE when `OLD.status='CLOSED'` and all DELETE | Service-only | DB enforces the spec invariant; EPIC-05 precedent |
| Idempotency | Nullable `idempotencyKey`, `@@unique([tenantId, idempotencyKey])` | None | Spec SHOULD; replay returns existing amendment |
| Entitlement | `entitlements.has(tenantId,"veterinary")` ⇒ `FEATURE_NOT_ENTITLED`; `permissionResolver` defense-in-depth | New guard | Reuses `TenantSettingsService` pattern |

## Data Flow

Autosave: `Controller (Zod) → service.updateDraft → requireTenantContext + entitlement + permission → tx{ findFirst(tenant,id) → assert DRAFT/version → updateMany(version) → audit.append(tx) } → commit → allowlisted DTO`.

Amendment: `service.amend → amend permission → tx{ lock original (tenant-scoped CLOSED) → idempotencyKey seen ⇒ return existing → create CLOSED encounter (amendsEncounterId, amendmentReason) → audit.append(tx) } → commit`.

Tenant authority comes only from `RequestContextService`; a route/body `tenantId` is never trusted. Cross-tenant UUIDs miss `findFirst` ⇒ 404 `NOT_FOUND`.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/database/prisma/schema.prisma` | Modify | `ClinicalEncounterStatus` enum + 6 tenant-scoped models |
| `packages/database/prisma/migrations/<ts>_clinical/migration.sql` | Create | Additive DDL, FKs RESTRICT, indexes, immutability trigger |
| `packages/database/src/reference-seed.ts` | Modify | Add `vet.clinical.read/update/close/amend` + role matrix |
| `packages/database/src/demo-seed.ts` | Modify | `seedDemoClinical` — synthetic encounter + one subdomain record |
| `packages/database/src/schema-clinical.test.ts` | Create | Pin tables, indexes, FKs, enum, trigger |
| `apps/api/src/clinical/**` | Create | Module, permissions, Zod, DTO, services, controllers, tests |
| `apps/api/src/app.module.ts` | Modify | Register `ClinicalModule` |
| `apps/api/src/rbac/route-contract.probe.test.ts` | Modify | Extend pinned route inventory |
| `apps/api/test/live-pg-isolation.e2e-spec.ts` | Modify | Clinical cross-tenant 404 + concurrent autosave 409 |
| `apps/web/src/app/api/clinical/[[...path]]/route.ts` | Create | Authenticated proxy (Patients pattern) |
| `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.tsx` | Create | Clinical tab UI, all states |
| `apps/web/src/app/(app)/app/patients/[id]/patient-detail.tsx` | Modify | Mount clinical workspace |

## Interfaces / Contracts

`ClinicalEncounter` fields that are non-obvious: `status DRAFT|CLOSED`, `version Int @default(1)`,
`internalNotes`/`clientSummary` (CONFIDENTIAL; only the first is staff-only),
`closedAt`/`closedByUserProfileId`, self-FK `amendsEncounterId`, `amendmentReason`,
`idempotencyKey`, `@@unique([tenantId, idempotencyKey])`, `@@index([tenantId, patientId])`,
`@@index([tenantId, status])`. `ClinicalWeight.quantity Decimal @db.Decimal(10,3) > 0`.
Five subdomains each carry `(id, tenantId, patientId, …minimum facts…)`, `@@index([tenantId, patientId])`,
RESTRICT FKs, no delete.

Routes (all `@RequirePermissions`, nested under the Patient):
`GET|POST /patients/:patientId/clinical/encounters`,
`GET|PUT /patients/:patientId/clinical/encounters/:id`,
`POST …/encounters/:id/close`, `POST …/encounters/:id/amendments`,
`GET|POST /patients/:patientId/clinical/{treatments|vaccinations|deworming|studies|weights}`,
`PUT …/{kind}/:id`.

Permissions: `vet.clinical.read|create|update|close|amend`. Staff DTO includes
`internalNotes`; `toClientSafeEncounter()` excludes it (Portal not built).

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | version 409, CLOSED 409, entitlement 403, amend permission, reason 400, exactly-one audit | Service tests, fake Prisma |
| Schema | tables/indexes/FKs/enum/trigger | `schema-clinical.test.ts` |
| Seed | permission keys/matrix, demo synthetic (no PII), idempotent rerun | seed tests |
| Integration | tenant isolation 404, allowlist DTO, route contract | in-memory DB + probe |
| Live-PG E2E | cross-tenant 404, parallel autosaves ⇒ one 409 | extend `live-pg-isolation.e2e-spec.ts` |
| UI | all states, no `internalNotes` leak | RTL component tests |

## Chained Work Units (≤ 800-line budget)

- **WU1** Data + seed: schema, migration, permissions, demo seed, schema/seed tests.
- **WU2** Service core: lifecycle, version guard, entitlement, audit, isolation + tests.
- **WU3** API: controllers, Zod/DTO allowlist, routes, client-safe projection, probe.
- **WU4** Web: proxy, API client, clinical tab, component tests.
- **H1** Hardening: live-PG concurrency/isolation evidence, root gates, docs/spec sync.

## Threat Matrix

N/A — no network routing, shell, subprocess, VCS/PR automation, executable-file
classification, or process-integration boundary.

## Migration / Rollout

Single additive migration; no backfill. Rollback removes routes/UI and keeps
additive clinical/audit data; closed rows are never deleted or mutated.

## Open Questions

- Confirm the minimal encounter set (`reasonForVisit`, `anamnesis`, `diagnosis`, `treatmentPlan`).
- Should `close` require a non-empty `clientSummary`? (default: no.)
