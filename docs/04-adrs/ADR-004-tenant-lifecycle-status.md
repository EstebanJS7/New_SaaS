---
id: ADR-004
type: adr
title: Tenant Lifecycle Status (additive TenantStatus enum)
status: accepted
date: 2026-09-11
owner: engineering
supersedes: []
superseded_by: null
related_epics:
  - EPIC-01
  - EPIC-03
related_decisions:
  - DEC-005
  - DEC-004
related_change:
  - openspec/changes/2026-09-08-dec-004-branding-expansion
approval_record:
  decision_proposal: DEC-005
  decision_status: accepted
  decision_approved_option: "Option 1 — additive TenantStatus"
  decision_approval_date: 2026-09-11
  adr_gate_authority: DEC-005 explicit non-replacement clause
  adr_acceptance_basis:
    user approval recorded for DEC-005 Option 1; ADR-004 records the
    architectural decision required by the Decision and by the Complexity Budget
    rule for reusable Core tenancy changes
---

# ADR-004 — Tenant Lifecycle Status (additive `TenantStatus` enum)

## Decision Summary

Add an additive `TenantStatus` enum on the Core `Tenant` aggregate with two
values: `ACTIVE` (default) and `SUSPENDED`. The public branding endpoint
`GET /api/v1/public/tenants/:slug/branding` MUST return the **identical**
`404 NOT_FOUND` envelope for a SUSPENDED tenant and for an unknown slug. Nothing
else changes.

| Surface                              | This ADR              | Explicitly out of scope |
| ------------------------------------ | --------------------- | ----------------------- |
| `Tenant` schema + additive migration | Enum + default column | —                       |
| Public branding 404 envelope         | SUSPENDED ≡ unknown   | —                       |
| Suspension / reactivation commands   | None                  | Future ADR / Story      |
| `TenantActiveGuard`                  | Untouched             | —                       |
| `TenantMembership.status`            | Untouched             | —                       |
| Entitlements / RBAC                  | Untouched             | —                       |
| Portal / staff auth                  | Untouched             | —                       |
| Fiscal / billing / cash              | Untouched             | —                       |
| Cache keys / DTOs / public allowlist | Untouched             | —                       |
| PRD                                  | Untouched             | —                       |

## Context

DEC-005 records that the `portal-brand-resolution` requirement "Unknown or
inactive slugs MUST return `404 NOT_FOUND`" was only half-implementable:
`Tenant` had no field for an inactive tenant, so the inactive half was
unrepresentable. DEC-005 Option 1 was **accepted on 2026-09-11**: introduce an
explicit `status` on `Tenant` as a tenancy Core change owned by EPIC-01,
consumed by the public branding endpoint. The Decision's "Approval and
Governance" section states that an ADR is required because the change modifies
the reusable Core tenancy model; the Decision does **not** replace that
architectural record.

## Why an ADR is Required

`TenantStatus` is a Core tenancy surface expected to be consumed across features
(login, membership resolver, fiscal emission, portal). The architecture freeze
and the Complexity Budget rule require an accepted ADR before introducing a
reusable Core change that crosses domain boundaries. A Decision alone is
insufficient because:

- a Decision is product/implementation-specific (ADR vs Decision rule);
- the change adds a new enum on the central `Tenant` table;
- SUSPENDED ≡ unknown at the public surface is a contract-level claim, not a
  feature toggle.

## Decision

**D1 — Additive `TenantStatus` enum on `Tenant`.**

```prisma
enum TenantStatus {
  ACTIVE
  SUSPENDED
  @@map("tenant_status")
}

model Tenant {
  // ...existing fields unchanged
  status TenantStatus @default(ACTIVE) @map("status")
}
```

**D2 — Identical 404 envelope.** `PublicBrandingController` selects `status`
alongside `id` on the existing `findUnique({where:{slug}})` and short-circuits
to the same `DomainError("NOT_FOUND", "Tenant not found.")` emitted for a
missing slug. No new error code, no new log signal, no timing-oracle
differentiation.

**D3 — No suspension command ships in this ADR.** This ADR defines the column
and the read-time check. It does **not** ship a suspend / reactivate endpoint,
service, audit action, UI, worker, or internal event. Until a future Story does
so, `SUSPENDED` is set only by an explicit operator SQL migration.

**D4 — Read-only consumer surface.** The only consumer in this ADR is the public
branding controller. No other module may branch on `tenant.status` until a Story
owning the corresponding invariant is accepted.

## Why the Migration Is Additive

| Property              | Guarantee                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| Nullability           | `NOT NULL DEFAULT 'ACTIVE'`; existing rows backfill in the same statement.                               |
| Enum type             | Postgres `CREATE TYPE tenant_status AS ENUM ('ACTIVE','SUSPENDED')`; additive.                           |
| Locking               | Brief `ACCESS EXCLUSIVE` on `tenant` only; no FK rebuild.                                                |
| Indexes               | None added — the existing unique index on `slug` already serves the lookup.                              |
| Read path             | One extra column on the existing `findUnique`. No new repository.                                        |
| Write path            | No new write; the column defaults.                                                                       |
| Down-compatibility    | `ACTIVE`-defaulted; callers ignoring the column see identical pre-migration behavior.                    |
| Application unchanged | Only the public controller gains one equality check; no DTO, signature, or cache-key change.             |
| Other modules         | No schema change; no guard / membership / entitlement change.                                            |
| Reversibility         | Drop column + enum; no data loss because no row is rewritten and no invariant depends on the new column. |

## Alternatives Considered

- **Soft-link to `TenantMembership.status` / `TenantEntitlement`** — rejected by
  DEC-005 Option 2: a tenant can legitimately have no active membership yet be
  publicly resolvable; conflates lifecycle with auth.
- **Drop the inactive-slug requirement from the spec** — rejected by DEC-005
  Option 3: weakens approved scope; must be a separate product decision, not an
  implementation shortcut.
- **Ship a `suspend` command in the same change** — rejected here: suspension
  semantics affect authorization, audit, login, fiscal, and portal; they belong
  in a separate Story with its own ADR-class record.
- **Boolean `isActive` instead of enum** — rejected: hides future values
  (`ARCHIVED`, `PENDING_KYC`); the existing "evolve additively only" pattern is
  already pinned for `TenantMembershipStatus`, `CustomerKind`,
  `BrandingAssetKind`.

## Non-Goals (explicit)

This ADR does NOT introduce, modify, or authorize: any suspension / reactivation
command; any change to `TenantActiveGuard`, `TenantMembershipRepository`,
`RequestContextService`, `AuthGuard`, `PermissionGuard`, or other guard /
middleware / interceptor; any change to `TenantMembership.status`, role mapping,
or entitlement evaluation; any change to portal / staff authentication, session
handling, or route authorization; any change to fiscal, billing, cash, payments,
or inventory behavior; any change to `PublicBrandingDto`, the private
`BrandingResponse`, the `assertPublicBrandingDto` allowlist, or any
`BrandingCache` key; any PRD, scope, or roadmap change. Any of the above
requires a separate Decision or ADR.

## Migration / Rollout

1. **Schema-only additive migration** — create enum, add `status` column with
   `DEFAULT 'ACTIVE' NOT NULL`, backfill existing rows in the same statement.
2. **Read-time check** — `PublicBrandingController` selects `id` and `status`;
   non-`ACTIVE` → existing `NOT_FOUND` envelope.
3. **Tests** — RED cases proving the identical 404 envelope for unknown and
   SUSPENDED slugs; no private fields, no status-leak signal; existing
   unknown-slug cases remain green.
4. **No env flag, no entitlement** — the surface is public and the change is
   read-only; rollout is the migration deploy.
5. **Rollback** — drop column + enum; no application code that ignores
   `tenant.status` is affected.

## Guardrails

- ADR-001 Core/Vertical boundary: only EPIC-01 tenancy Core may branch on
  `TenantStatus` until a consuming Story is accepted.
- ADR-002 Branding layering: the public surface is the sole consumer in this ADR
  and must keep SUSPENDED and unknown indistinguishable.
- DEC-005 governance clause: any future expansion of `TenantStatus` consumers is
  a separate architectural record.
- No silent PRD change; PRD is untouched.
- Any future `SUSPENDED` producer MUST define authorization, audit,
  internal-event, and fiscal-emission behavior in its own change artifact.

## References

- [[DEC-005]] — Enforce inactive tenant slugs on the public branding endpoint
  (accepted 2026-09-11, Option 1)
- [[DEC-004]] — Expand EPIC-03 Branding scope to resolve TD-009
- [[ADR-001]] — Modular Monolith
- [[ADR-002]] — Branding Theme Layering
- [[ADR-003]] — Minimal Internal Application Events
- `apps/api/src/branding/public-branding.controller.ts` — sole consumer in this
  ADR; only the `status` equality check is added
- `packages/database/prisma/schema.prisma` — additive column + enum
- `openspec/changes/2026-09-08-dec-004-branding-expansion/specs/portal-brand-resolution/spec.md`
  — the requirement this ADR makes representable
