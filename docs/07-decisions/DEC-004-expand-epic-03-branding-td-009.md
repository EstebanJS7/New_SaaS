---
id: DEC-004
type: decision
title: Expand EPIC-03 Branding scope to resolve TD-009
status: accepted
date: 2026-09-08
updated: 2026-09-08
related_epics:
  - EPIC-03
related_stories:
  - BRAND-004
  - BRAND-005
  - BRAND-006
related_tech_debt:
  - TD-009
prd_change_required: false
approved_option: A
---

# DEC-004 — Expand EPIC-03 Branding scope to resolve TD-009

## Context

EPIC-03 shipped scalar branding, `ResolvedBrand`, and a safe public DTO. TD-009
deferred controlled logo/favicon uploads, portal consumption, and `system`
appearance. This proposal authorizes planning, not implementation or TD closure.

## Scope

- Tenant-scoped `BrandingAsset` upload, replacement, and delivery.
- Portal layouts consume the resolved public brand contract.
- `system` appearance via `prefers-color-scheme`: local → tenant → system →
  Core.

## Non-goals

- Arbitrary CSS/JS, remote fonts, custom domains, CMS, or component forks.
- Veterinary behavior in Core branding.
- Changing TD-009 before delivery verification.

## Constraints

Keep `CoreDesignDefaults → ProductBrandPreset → TenantBranding → ResolvedBrand`.
Shared UI uses semantic tokens; presets are code-owned; tenant overrides remain
schema-validated, entitled, audited, and tenant-scoped. Portal and staff routes
remain separate; public responses stay allowlisted PUBLIC fields only.

## Options Considered

### A — Implement the three items as one controlled Branding increment (recommended)

One asset contract for staff and portal; reuse the resolver.

### B — Implement only uploads and defer portal/system again

Rejected: leaves the contract gap and OS-preference UX unresolved.

### C — Add a portal-specific theme or arbitrary asset URLs

Rejected: duplicates resolution and bypasses controlled files.

## Impact and Risks

| Area                | Impact / control                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Tenancy             | Server context scopes writes; cross-tenant access is `404`.                                                                     |
| Security/files      | Object storage, opaque keys, strict PNG/WebP/ICO limits, no executable uploads; SVG needs approval; revise URLs on replacement. |
| Authorization/audit | Manage permission + `custom_branding`; audit each mutation.                                                                     |
| Portal boundary     | Consume only public DTO; expose no staff session, private config, or keys.                                                      |
| Risk                | Medium: storage/cache/browser complexity; stage rollout and retain preset fallback.                                             |

## Acceptance Criteria and Verification

- [ ] Allowed entitled uploads work; invalid, oversized, executable, and
      cross-tenant requests fail safely.
- [ ] Staff and portal render matching resolved identities; DTO URLs expose no
      keys.
- [ ] `system` follows OS preference and documented precedence.
- [ ] Tests prove validation, authorization, audit, isolation, DTO safety,
      fallback, and appearance behavior; quality gates and portal E2E pass.

## Rollout

Migrate additively behind the entitlement, pilot entitled tenants, and retain
preset fallbacks. Roll back by disabling the entitlement and reads; retain
asset/audit records. Close TD-009 only after verification with delivery
reference.

## Recommendation

Approve Option A. It preserves Core/vertical and public/private boundaries. The
PRD already contains this scope.

## Decision

**Accepted on 2026-09-08.** Option A is approved: implement controlled tenant
logo/favicon uploads, portal resolved-brand consumption, and `system` appearance
mode as one controlled Branding increment. TD-009 moves from `accepted` to
`scheduled`; EPIC-03 is reopened for this approved scope expansion.
Implementation and TD closure require delivery verification and are not claimed
by this decision.
