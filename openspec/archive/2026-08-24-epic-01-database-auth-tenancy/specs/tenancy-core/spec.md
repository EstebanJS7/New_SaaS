# Delta for tenancy-core

## ADDED Requirements

### Requirement: Server-authoritative tenant resolution

The effective tenant SHALL derive exclusively from the authenticated request
context's session membership. Tenant identifiers arriving via request body,
query string, or custom headers SHALL never be trusted as authority.

#### Scenario: Client-supplied tenant hint ignored

- GIVEN a staff user whose session binds to Tenant A
- WHEN the request carries a body/query/header claiming Tenant B
- THEN all server-side scoping still resolves to Tenant A

#### Scenario: No membership, no tenant authority

- GIVEN an authenticated staff session without an active tenant membership
- WHEN a private tenant-scoped operation is requested
- THEN it is rejected 403 with a stable forbidden code in the error envelope

### Requirement: Cross-tenant access returns 404

Accessing another tenant's resource by identifier SHALL return 404 with the
error envelope — indistinguishable from a nonexistent resource — and never 403,
which would confirm existence.

#### Scenario: Foreign resource masked as missing

- GIVEN a resource owned by Tenant B and an authenticated user of Tenant A
- WHEN the user requests that resource UUID
- THEN the response is 404 with the error envelope

#### Scenario: Nonexistent versus foreign indistinguishable

- GIVEN the same protected route
- WHEN responses for a nonexistent UUID and a foreign-tenant UUID are compared
- THEN both are 404 with equivalent bodies

### Requirement: Tenant-safe repository pattern

Data access for private aggregates SHALL go through tenant-scoped
repositories/application services that apply the tenant predicate implicitly
from request context. At least one real aggregate shipped in this epic
(`TenantMembership`) SHALL demonstrate the pattern.

#### Scenario: Implicit tenant scoping

- GIVEN rows belonging to Tenants A and B
- WHEN Tenant A's context queries the demonstrated aggregate
- THEN only Tenant A rows are observable without hand-written filters at call
  sites

#### Scenario: Cross-tenant write prevented

- GIVEN Tenant A's request context
- WHEN a write targets a record owned by Tenant B
- THEN the operation fails as not found rather than crossing the boundary

### Requirement: Mandatory isolation tests

Every private aggregate shipped by this epic SHALL have automated API-level
isolation tests proving cross-tenant denial, executed by the CI gate.

#### Scenario: Isolation suite per aggregate

- GIVEN the shipped private aggregates
- WHEN the integration suite runs in CI
- THEN each aggregate has a passing cross-tenant 404 case

#### Scenario: Regression caught

- GIVEN a change removes tenant scoping from a data-access query
- WHEN CI runs
- THEN the corresponding isolation test fails and blocks merge

### Requirement: No self-service tenant creation

Tenants SHALL be created only through ops/seed paths. No public or unprivileged
endpoint SHALL create tenants.

#### Scenario: Registration endpoint absent

- GIVEN the deployed API
- WHEN a request attempts organization signup against any tenant-creation route
- THEN no such public route exists (404 envelope)
