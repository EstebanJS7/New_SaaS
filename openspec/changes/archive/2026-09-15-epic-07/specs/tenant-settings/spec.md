# Delta for tenant-settings

## MODIFIED Requirements

### Requirement: Typed code registry with schema versions

Every consumable namespace SHALL be registered in code with a zod schema, a
numeric `schemaVersion`, and complete defaults; service calls with an
unregistered namespace SHALL fail with `NOT_FOUND`. Writes SHALL persist the
registry's current `schemaVersion` on the row. v1 SHALL register exactly two
reference namespaces: `sales` (`defaultCurrency`, `requireCustomerForInvoice`)
per `docs/03-architecture/TENANT-SETTINGS.md`, and `scheduling`
(`conflictPolicy` defaulting to `REJECT`, per-professional-and-branch
availability windows, and one-off blocks) consumed by the `scheduling`
capability. (Previously: v1 registered exactly one reference namespace,
`sales`.)

#### Scenario: Unregistered namespace rejected

- GIVEN a call to get or update the namespace `"nope"`
- WHEN the service executes
- THEN it raises `NOT_FOUND` without touching storage

#### Scenario: Written rows carry the registry version

- GIVEN a successful write to a registered namespace at registry version N
- WHEN the stored row is inspected
- THEN its `schemaVersion` equals N

#### Scenario: Scheduling defaults returned when absent

- GIVEN a tenant with no stored `scheduling` row
- WHEN the `scheduling` namespace is read
- THEN `conflictPolicy` is `REJECT` and availability and blocks are empty

#### Scenario: Invalid scheduling value rejected

- GIVEN a `scheduling` patch setting `conflictPolicy` to an unsupported value
- WHEN the update executes
- THEN the response is 400 `VALIDATION_FAILED` and stored values are unchanged

### Requirement: Authenticated reads, permission-gated writes

Settings reads SHALL require authentication and an active tenant context only;
the tenant SHALL be resolved from the authenticated request context and there
SHALL be no `tenantId` selector. Settings writes SHALL additionally require the
namespace's catalog permission key following the `<domain>.settings.manage`
convention — `sales.settings.manage` for `sales` and
`scheduling.settings.manage` for `scheduling` — seeded into the permission
catalog and granted to OWNER and ADMIN in the reference matrix. Requests lacking
the key SHALL receive 403 `FORBIDDEN`. (Previously: only the `sales` namespace
and `sales.settings.manage` were governed.)

#### Scenario: Read allowed, write denied without key

- GIVEN an authenticated member whose active role lacks `sales.settings.manage`
- WHEN reading `sales` settings then attempting a write
- THEN the read returns 200 while the write returns 403 `FORBIDDEN`

#### Scenario: Anonymous read rejected

- GIVEN no session
- WHEN any settings route is called
- THEN the response is 401 `UNAUTHENTICATED`

#### Scenario: Scheduling write requires its own key

- GIVEN an authenticated member whose active role lacks
  `scheduling.settings.manage`
- WHEN they attempt to update `scheduling` availability, blocks, or policy
- THEN the response is 403 `FORBIDDEN` and nothing is persisted
