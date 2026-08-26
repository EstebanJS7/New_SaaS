# Delta for tenant-settings

## ADDED Requirements

### Requirement: Namespaced tenant-scoped settings storage

A new `TenantSettingNamespace` table SHALL store settings rows keyed by a unique
`(tenantId, namespace)` pair with `schemaVersion Int` and `data Json`, added via
an additive, reversible migration. Settings SHALL be resolved strictly from the
authenticated request context; there SHALL be no `tenantId` selector and no
cross-tenant-addressable settings resource. A caller always reads or writes
within their own tenant scope.

#### Scenario: One row per tenant and namespace

- GIVEN a tenant writing the same namespace twice
- WHEN the second write completes
- THEN exactly one row exists for `(tenantId, namespace)` holding the latest
  values

#### Scenario: Other tenants' rows are invisible

- GIVEN a settings row of tenant B
- WHEN an authenticated member of tenant A reads the same namespace
- THEN the response is resolved within A's tenant scope (defaults if no row
  exists), no data from B is returned or modified, and B's row id is never
  addressable

### Requirement: Typed code registry with schema versions

Every consumable namespace SHALL be registered in code with a zod schema, a
numeric `schemaVersion`, and complete defaults; service calls with an
unregistered namespace SHALL fail with `NOT_FOUND`. Writes SHALL persist the
registry's current `schemaVersion` on the row. v1 SHALL register exactly one
reference namespace, `sales` (`defaultCurrency`, `requireCustomerForInvoice`),
per `docs/03-architecture/TENANT-SETTINGS.md`.

#### Scenario: Unregistered namespace rejected

- GIVEN a call to get or update the namespace `"nope"`
- WHEN the service executes
- THEN it raises `NOT_FOUND` without touching storage

#### Scenario: Written rows carry the registry version

- GIVEN a successful write to a registered namespace at registry version N
- WHEN the stored row is inspected
- THEN its `schemaVersion` equals N

### Requirement: Strict validated get/set service API

All settings access SHALL go through the typed `TenantSettingsService`
(`get(namespace)` / `update(namespace, patch)`); modules SHALL NOT read raw JSON
from tenant records. `get` SHALL return defaults merged with stored values when
no row exists. `update` SHALL validate the patch against the closed namespace
schema: unknown fields are rejected with `VALIDATION_FAILED`; wrong-typed values
are rejected with `VALIDATION_FAILED`; valid partial patches merge over current
values leaving other fields intact.

#### Scenario: Defaults returned when absent

- GIVEN a tenant with no stored row for a registered namespace
- WHEN the namespace is read
- THEN the response equals the registry defaults

#### Scenario: Unknown field rejected

- GIVEN a patch containing a key outside the schema
- WHEN the update executes
- THEN the response is 400 `VALIDATION_FAILED` and nothing is persisted

#### Scenario: Wrong-typed value rejected

- GIVEN a patch assigning a string where the schema requires a boolean
- WHEN the update executes
- THEN the response is 400 `VALIDATION_FAILED` and stored values are unchanged

#### Scenario: Partial patch preserves sibling fields

- GIVEN stored values for two schema fields
- WHEN a patch updates only the first
- THEN the second keeps its stored value

### Requirement: Authenticated reads, permission-gated writes

Settings reads SHALL require authentication and an active tenant context only;
the tenant SHALL be resolved from the authenticated request context and there
SHALL be no `tenantId` selector. Settings writes SHALL additionally require the
catalog permission key `sales.settings.manage` (following the
`<domain>.settings.manage` convention), seeded into the permission catalog and
granted to OWNER and ADMIN in the reference matrix. Requests lacking it SHALL
receive 403 `FORBIDDEN`.

#### Scenario: Read allowed, write denied without key

- GIVEN an authenticated member whose active role lacks `sales.settings.manage`
- WHEN reading `sales` settings then attempting a write
- THEN the read returns 200 while the write returns 403 `FORBIDDEN`

#### Scenario: Anonymous read rejected

- GIVEN no session
- WHEN any settings route is called
- THEN the response is 401 `UNAUTHENTICATED`

### Requirement: No secrets or excluded material

Namespace schemas SHALL be closed and exhaustive, making credential-shaped or
out-of-contract fields unpersistable. Tenant settings SHALL never hold secrets,
branding assets/tokens, user permissions, or entitlements — those remain in
their dedicated capabilities per `TENANT-SETTINGS.md`.

#### Scenario: Secret-shaped payload rejected

- GIVEN a patch containing `{ "apiKey": "..." }` for any namespace
- WHEN the update executes
- THEN the response is 400 `VALIDATION_FAILED` and no such value is persisted
