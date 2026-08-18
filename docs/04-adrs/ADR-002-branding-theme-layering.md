---
id: ADR-002
type: adr
title: Branding Theme Layering
status: accepted
date: 2026-08-13
supersedes: []
superseded_by:
related_epics:
  - EPIC-03
---

# ADR-002 — Branding Theme Layering

## Context

The first product is Veterinary SaaS, but the business Core and UI should later
support other verticals. The SaaS may also offer tenant-specific logos and
visual identity.

Forking the frontend or duplicating components per product would create
maintenance cost and make agent-generated changes diverge. Allowing arbitrary
CSS would create security and support risks.

## Decision

Use a layered branding model:

```text
CoreDesignDefaults
→ ProductBrandPreset
→ TenantBranding overrides
```

Reusable components consume semantic CSS tokens.

Product presets are versioned code/config.

Tenant overrides are persisted, schema validated and limited to approved
tokens/assets.

No arbitrary tenant CSS or JavaScript is accepted.

## Alternatives Considered

### Fork frontend per vertical

Rejected because components and fixes would diverge.

### Store complete custom CSS per tenant

Rejected due to XSS/security, upgrade compatibility and supportability concerns.

### Only one global theme

Rejected because it does not support future product identities or tenant
white-labeling.

## Consequences

Positive:

- one component system;
- multiple product identities;
- optional tenant white-labeling;
- safer upgrades;
- consistent staff and portal brand;
- low coupling to Veterinary.

Negative:

- theme schema must be maintained/versioned;
- components must consistently use semantic tokens;
- highly bespoke tenant designs remain intentionally unsupported.

## Guardrails

- Branding remains a Platform/Core capability.
- Tenant branding is validated and tenant scoped.
- Shared UI components cannot hardcode product-brand colors.
- Product-level presets do not require an Entitlement; tenant overrides may.
- Custom domains are a separate future concern.
