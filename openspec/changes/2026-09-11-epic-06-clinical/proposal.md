# Proposal: EPIC-06 Comprehensive Clinical Records

## Intent

Provide auditable, tenant-scoped clinical records without losing draft work or altering closed history.

## Scope

### In Scope
- Encounters with structured content and free-form clinical notes.
- Patient treatments, vaccinations, deworming, studies, and weights.
- Versioned draft autosave; stale writes return a scoped HTTP 409.
- Immutable closed encounters and explicit, linked amendments with reason, audit, and dedicated permission.
- Staff workspace; granular authorization; tenant isolation; CONFIDENTIAL allowlisted DTOs; synthetic demo data.

### Out of Scope
- Scheduling/appointment linkage, Portal, files, reports, billing, sales, fiscal, and notifications.
- Generic EAV records, hard deletion, and Patient 360 redesign.

## Capabilities

### New Capabilities
- `clinical-management`: Tenant-scoped encounters and structured veterinary records for treatments, vaccinations, deworming, studies, and weights, with draft concurrency, immutable closure, amendments, audit, and authorization.

### Modified Capabilities
None.

## Approach

Add typed Clinical aggregates anchored to Patient identity. Reuse tenant context, `veterinary` entitlements, RBAC, transactional audit, and isolation patterns. Enforce version checks and lifecycle transitions transactionally. Deliver chained slices because the scope exceeds one 800-line review budget.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/database/prisma/schema.prisma` | Modified | Add tenant-scoped clinical aggregates and lifecycle/version fields. |
| `packages/database/src/reference-seed.ts` | Modified | Add `vet.clinical.read/update/close/amend` permissions. |
| `apps/api/src/clinical/**` | New | Clinical API, validation, DTOs, audit, and tests. |
| `apps/web/src/app/(app)/app/patients/[id]/**` | Modified | Add staff clinical entry and draft workflow. |
| `openspec/specs/clinical-management/spec.md` | New | Canonical capability specification after archive. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Concurrent writes lose history | Medium | Version guard, scoped 409, transactions, concurrency tests. |
| Clinical data leaks or crosses tenants | Medium | Server tenant authority, allowlisted DTOs, confidential-log discipline, isolation tests. |
| Comprehensive scope overloads review | High | Chained, independently verifiable delivery slices. |

## Rollback Plan

Rollback the clinical staff entry and routes while retaining additive clinical/audit data. Do not delete or mutate closed records; use amendments or a follow-up migration.

## Dependencies

- Existing Patient, RBAC, `veterinary` entitlement, tenant-context, and audit capabilities.
- No forward dependency is introduced.

## Success Criteria

- [ ] Authorized, entitled staff can manage all six clinical record types within their tenant.
- [ ] Draft conflicts return scoped 409; closed encounters cannot be edited except through audited amendments.
- [ ] Each clinical route enforces its granular permission and cross-tenant access returns 404.
- [ ] Scheduling, Portal, files, reports, and billing remain absent from the implementation.
