# Tenant Branding Specification

## Purpose

Persist tenant-specific v1 branding overrides (`primary`, `accent`, `radius`,
`defaultAppearance`) and resolve them safely across public endpoint and server
layout, preserving the approved layering.

## Non-goals

Logo/favicon/assets, object storage, custom domains, fonts, dark recoloring,
arbitrary CSS/JS, full-shell preview, generic tenant-settings namespace, PRD
edits.

## Data classification

`tenantId`, `slug`, `updatedBy`, and audit reason are INTERNAL. `primary`,
`accent`, `radius`, and `defaultAppearance` are PUBLIC.

## Requirements

### Requirement: Tenant-scoped v1 branding persistence

SHALL store one `TenantBranding` row per tenant with v1 overrides only
(`primary`, `accent`, `radius`, `defaultAppearance`). Unknown keys or invalid
formats SHALL be rejected.

#### Scenario: Valid v1 override persists

- GIVEN a tenant with no branding row
- WHEN staff send `{ schemaVersion: 1, primary: "#0ea5e9", radius: "0.5rem" }`
- THEN the row is created and reads return merged

#### Scenario: Unknown key rejected

- GIVEN staff with manage permission
- WHEN a payload includes `fontHeading: "Inter"`
- THEN the write is rejected with `BRAND_OVERRIDE_UNKNOWN_KEY`

### Requirement: Authorized private branding management

Mutations SHALL require `branding.settings.manage` permission AND
`custom_branding` entitlement. Reads SHALL require auth and active membership.

#### Scenario: Owner updates branding

- GIVEN an OWNER with `custom_branding` entitlement
- WHEN they submit a valid v1 override
- THEN the mutation succeeds

#### Scenario: Missing permission denied

- GIVEN a VETERINARIAN without `branding.settings.manage`
- WHEN they attempt to update branding
- THEN the response is 403 `FORBIDDEN`

#### Scenario: Missing entitlement denied

- GIVEN an ADMIN without `custom_branding` grant
- WHEN they attempt to update branding
- THEN the response is 403 `FEATURE_NOT_ENTITLED`

#### Scenario: Cross-tenant update blocked

- GIVEN an OWNER of Tenant A in Tenant B context
- WHEN they submit an update pointing at Tenant A
- THEN the request applies only to Tenant B or is rejected

### Requirement: Audit and tenant isolation

Every successful write and reset SHALL create an `AuditLog` row with actor,
tenant, timestamp, reason, and schema version. Reset SHALL be idempotent.

#### Scenario: Update produces audit trail

- GIVEN an authorized update with reason "Rebrand"
- WHEN the write commits
- THEN an audit row exists with actor, tenant, reason, and `schemaVersion: 1`

### Requirement: Public safe branding resolution

The system SHALL expose `GET /api/v1/public/tenants/:slug/branding` returning an
allowlisted v1 DTO (`primary`, `accent`, `radius`, `defaultAppearance`, product
display name). It SHALL NOT expose internal keys or billing data.

#### Scenario: Public endpoint returns safe DTO

- GIVEN a tenant with slug "clinica" and persisted primary override
- WHEN an unauthenticated caller fetches the endpoint
- THEN the response is 200 with only allowed v1 fields

#### Scenario: Unknown slug returns 404

- GIVEN no tenant with slug "missing"
- WHEN the public endpoint is called
- THEN the response is 404

### Requirement: Server-side brand resolution

The root server layout SHALL merge
`CoreDesignDefaults → ProductBrandPreset → TenantBranding` and emit CSS
variables in a `<style>` tag server-side.

#### Scenario: Tenant override renders server-side

- GIVEN a tenant with persisted `accent: "#f43f5e"`
- WHEN a staff page is server-rendered
- THEN the `<style>` tag contains the tenant accent value

#### Scenario: No override falls back to preset

- GIVEN a tenant with no branding row
- WHEN a staff page is server-rendered
- THEN the `<style>` tag contains the active product preset values

### Requirement: Local bounded preview and appearance preference

The `/app/settings/branding` page SHALL apply preview changes only to a local
sample card until Save or Reset. It SHALL respect `defaultAppearance` only when
no valid local preference exists; valid `"light"` or `"dark"` localStorage
preference wins.

#### Scenario: Preview stays local

- GIVEN a staff member changes the primary color in the form
- WHEN they have not clicked Save
- THEN only the bounded preview card reflects the new color

#### Scenario: Local appearance wins

- GIVEN a tenant with `defaultAppearance: "dark"` and browser localStorage
  `"light"`
- WHEN the settings page mounts
- THEN the preview and shell render in light mode
