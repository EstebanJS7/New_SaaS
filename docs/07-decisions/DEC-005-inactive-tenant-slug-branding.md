---
id: DEC-005
type: decision
title: Enforce inactive tenant slugs on the public branding endpoint
status: accepted
related_epics:
  - EPIC-03
related_decisions:
  - DEC-004
created: 2026-09-10
updated: 2026-09-11
---

# DEC-005 — Enforce inactive tenant slugs on the public branding endpoint

## Context

`openspec/changes/2026-09-08-dec-004-branding-expansion/specs/portal-brand-resolution/spec.md`
requires: "The endpoint MUST resolve the tenant from the slug. Unknown or
inactive slugs MUST return `404 NOT_FOUND`."

Verified reality:

- The public endpoint `GET /api/v1/public/tenants/:slug/branding`
  (`apps/api/src/branding/public-branding.controller.ts`) resolves the tenant by
  `slug` and returns `404` when the row does not exist.
- The `Tenant` model (`packages/database/prisma/schema.prisma`) has no
  active/disabled/suspended state. Its fields are `id`, `slug`, `name`,
  `createdAt`, `updatedAt`, and relations only.
- There is therefore no data-model representation of an "inactive" slug, and no
  executable way to distinguish an inactive tenant from an active one. The
  inactive-slug half of the requirement is currently unrepresentable.

DEC-004 did not authorize changing the Tenant lifecycle model, and adding an
active flag would be a product/tenancy decision (it affects authorization,
portal access, and potentially every Core/Veterinary query), not a branding
implementation detail. The verification of DEC-004 accordingly leaves the
inactive-slug criterion unresolved rather than inventing a field.

## Options

1. **Add a tenant lifecycle state (recommended).** Introduce an explicit
   `status`/`lifecycleState` on `Tenant` (for example `ACTIVE`/`SUSPENDED`),
   with a migration, defaults, and a typed transition command. The public
   branding endpoint returns `404` for any non-active state. This is a tenancy
   Core capability, owned by EPIC-01/tenancy, and would be consumed by the
   branding endpoint rather than defined inside Branding.
2. **Soft-link to membership/entitlement state.** Treat "inactive" as "no active
   membership or entitlement". This conflates tenancy lifecycle with
   billing/authorization and is rejected: a tenant can legitimately have no
   active membership yet still be publicly resolvable.
3. **Remove the inactive-slug requirement.** Amend the DEC-004 spec wording to
   "unknown slug returns `404`" only. This weakens the approved requirement and
   must be an explicit product decision, not an implementation shortcut.
4. **Derive inactivity from an external system/deletion marker.** Out of scope
   for the MVP and introduces a second source of truth.

## Impact

- Option 1 adds one nullable/defaulted column plus a migration and a small
  tenancy surface; branding then has a trivial additional check. No branding
  schema change.
- Options 2–4 either weaken the requirement or hide the gap.
- Until a decision is accepted, the DEC-004 inactive-slug closure criterion
  remains **unresolved**; "unknown slug → 404" is implemented and tested.

## Recommendation

Accept Option 1 as a tenancy Core change (EPIC-01) before claiming the DEC-004
inactive-slug criterion. Keep the existing unknown-slug behavior and tests as
the compatible, safe subset in the meantime.

## Approval and Governance

Option 1 was formally approved on 2026-09-11. It authorizes the bounded product
decision only. Because `TenantStatus` changes the reusable Core tenancy model
and is expected to be consumed across features, an ADR is required and must be
accepted before implementation; this Decision does not replace that
architectural record.

## Non-Goals

- This proposal does not change the `Tenant` model by itself.
- It does not weaken unknown-slug `404` behavior.
- It does not define suspension semantics for memberships, portal access, or
  fiscal behavior; those belong to the accepting tenancy Story.

## Related

- [[DEC-004]]
- [[Branding]]
- `openspec/changes/2026-09-08-dec-004-branding-expansion/specs/portal-brand-resolution/spec.md`
