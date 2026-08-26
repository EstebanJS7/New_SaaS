# Delta for rbac-enforcement

## ADDED Requirements

### Requirement: Deny-by-default route authorization contract

The API SHALL enforce a global `PermissionGuard` as the third guard chain link.
Every route SHALL fall into exactly one of three declared states: public
(`@Public`), permission-protected (declares one or more catalog keys via a
`@RequirePermissions` decorator), or authenticated-only (declares an explicit
empty requirement). A private route with NO declaration metadata SHALL be
rejected with `FORBIDDEN` (envelope code from the frozen registry) before its
handler executes. A route-contract probe test SHALL enumerate all registered
routes and fail the build when any route violates this contract.

#### Scenario: Undeclared private route denied at runtime

- GIVEN a controller route that is neither `@Public` nor decorated with
  permission requirements
- WHEN an authenticated user with an active membership calls it
- THEN the response is 403 with envelope code `FORBIDDEN` and the handler body
  never executes

#### Scenario: Route-contract probe blocks undeclared routes

- GIVEN the full route inventory of the API
- WHEN the route-contract probe test runs
- THEN every route resolves to public, permission-protected, or
  authenticated-only, and any undeclared private route fails the suite naming
  the offending route

### Requirement: Decorator semantics — conjunction of keys

`@RequirePermissions` SHALL accept one or more catalog permission keys. When
multiple keys are declared, the guard SHALL require ALL of them (logical AND).
No OR/disjunctive variant is shipped in this epic; a route needing alternatives
SHALL split into distinct routes instead.

#### Scenario: Single key gates route

- GIVEN a route declaring `vet.clinical.create`
- WHEN a member whose active role lacks that key calls it
- THEN the response is 403 `FORBIDDEN`

#### Scenario: Multiple keys mean ALL

- GIVEN a route declaring two keys
- WHEN a member holds the first but not the second
- THEN the response is 403 `FORBIDDEN` despite satisfying one key

### Requirement: Guard chain position and fail-closed evaluation

The `PermissionGuard` SHALL execute strictly after `AuthGuard` and
`TenantActiveGuard` (order pinned by module import order and asserted by a
wiring test, per the tenancy precedent). If authentication or tenant/membership
context is missing when the guard evaluates, it SHALL fail closed — it MUST
NEVER allow a request through due to absent upstream context.

#### Scenario: Wire order is pinned

- GIVEN the application module source
- WHEN the guard wiring test runs
- THEN `AuthGuard`, `TenantActiveGuard`, `PermissionGuard` appear in that exact
  APP_GUARD registration order

#### Scenario: Missing upstream context fails closed

- GIVEN a request reaching the guard without resolved membership context
- WHEN the guard evaluates the route
- THEN the request is rejected (`UNAUTHENTICATED`/`FORBIDDEN`) and never reaches
  the handler

### Requirement: No code-level superuser bypass

The enforcement path SHALL contain NO hardcoded role, role-code, or profile
bypass. Elevation comes exclusively from `RolePermission` data. The seeded ADMIN
role passes protected routes only because the reference seed grants it every
catalog key as data rows; removing a mapping row removes that ability.

#### Scenario: ADMIN authority is data, not code

- GIVEN the ADMIN role mapping minus one previously granted key
- WHEN an ADMIN member calls a route requiring exactly that key
- THEN the response is 403 `FORBIDDEN`

### Requirement: Effective-permissions endpoint

The API SHALL expose `GET /memberships/me/permissions` returning the stable DTO
`{ "permissions": string[] }` — the catalog keys resolved server-side from the
ACTIVE membership's role. The route SHALL be authenticated and tenant-scoped,
declared authenticated-only (explicit empty requirement, which the
deny-by-default contract counts as declared).

#### Scenario: Keys reflect active tenant membership

- GIVEN a user with memberships in two tenants holding different roles
- WHEN effective permissions are requested under each active tenant context
- THEN each response lists exactly the keys of the role in the active tenant

#### Scenario: Anonymous access rejected

- GIVEN no session
- WHEN the endpoint is called
- THEN the response is 401 `UNAUTHENTICATED`
