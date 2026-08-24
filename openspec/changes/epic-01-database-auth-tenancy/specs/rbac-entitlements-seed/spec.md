# Delta for rbac-entitlements-seed

## ADDED Requirements

### Requirement: Idempotent reference seed

Reference data SHALL be seeded idempotently: the six PRD §9 roles (OWNER, ADMIN,
VETERINARIAN, RECEPTIONIST, CASHIER, INVENTORY_MANAGER),
`domain.resource.action` permission records, and the twelve §10 feature codes.
Re-running the seed SHALL NOT duplicate rows or alter existing identities.

#### Scenario: Seed rerun safe

- GIVEN the reference seed has already run
- WHEN it executes again
- THEN role, permission, and feature-code counts are unchanged with no
  duplicates

#### Scenario: Permission key convention

- GIVEN the seeded permission records
- WHEN their keys are validated
- THEN every key matches the `domain.resource.action` pattern

### Requirement: Minimal entitlements boundary

The system SHALL support boolean capability grants per tenant (flat grant
records over seeded feature codes) and a typed `has(tenantId, featureCode)`
boundary sufficient for future gating (e.g. branding Phase B). Callers SHALL
consult the boundary instead of hardcoding plan comparisons.

#### Scenario: Grant checked through boundary

- GIVEN a tenant holding the `custom_branding` grant
- WHEN `has(tenant, "custom_branding")` is evaluated
- THEN it returns true, and ungranted known codes return false

#### Scenario: Unknown feature code

- GIVEN a code not present among seeded feature codes
- WHEN `has()` is evaluated
- THEN it returns false without throwing

### Requirement: Guarded demo tenant seed

Creation of the synthetic demo tenant SHALL reuse the existing demo-seed guard
(explicit opt-in flag) and SHALL refuse to run in production (PRD §42).

#### Scenario: Demo seed opt-in only

- GIVEN the demo-seed flag is unset
- WHEN the demo seed command runs
- THEN it exits without creating any tenant

#### Scenario: Production refused

- GIVEN a production environment with the demo flag enabled
- WHEN the demo seed command runs
- THEN it aborts with an explicit refusal and creates nothing

### Requirement: RBAC scope fence

This epic SHALL seed Role/Permission records only: no role-management UI or CRUD
API, and no permission-enforcement matrix beyond the authentication route guard.
Policy evaluation belongs to EPIC-02.

#### Scenario: No role administration surface

- GIVEN the deployed API and web app
- WHEN routes and pages are enumerated
- THEN none create, edit, list, assign, or remove Roles/Permissions

#### Scenario: Records exist inertly

- GIVEN seeded roles and permissions
- WHEN the system authorizes requests
- THEN decisions rely only on authentication and membership, not per-permission
  checks
