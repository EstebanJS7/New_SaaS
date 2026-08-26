# Delta for entitlements-enforcement

## ADDED Requirements

### Requirement: Capability gate on the tenant-settings write path

The FIRST production enforcement call site of `EntitlementsService.has()` SHALL
be the tenant-settings write path. A registered namespace definition MAY declare
a required feature code; before applying any settings write to such a namespace,
the service SHALL evaluate `has(tenantId, featureCode)`. Denial SHALL return
HTTP 403 with a single stable envelope code `FEATURE_NOT_ENTITLED` added to the
frozen, append-only error registry via its documented evolution procedure
(existing codes untouched). The v1 `sales` reference namespace SHALL declare the
`sales` feature code.

#### Scenario: Write without grant denied

- GIVEN a tenant with NO explicit `sales` entitlement row
- WHEN a permitted administrator writes `sales` namespace settings
- THEN the response is 403 with envelope code `FEATURE_NOT_ENTITLED` and no
  settings row is created or changed

#### Scenario: Write with explicit grant allowed

- GIVEN a tenant holding an explicit `tenant_entitlement` row for `sales`
- WHEN a permitted administrator writes `sales` namespace settings
- THEN the write is applied and readable afterwards

### Requirement: Zero automatic grants preserved

Plan→capability mappings alone SHALL continue to grant nothing. Entitlement
checks pass ONLY when an explicit grant row exists for the tenant (created via
ops/demo-seed paths); no code path in this epic creates grants as a side effect
of plans, settings, or RBAC administration.

#### Scenario: Starter plan mapping grants nothing

- GIVEN a tenant whose plan maps all twelve feature codes but holds no explicit
  grant rows
- WHEN `has(tenantId, "sales")` is evaluated and a gated settings write is
  attempted
- THEN both report denial — false from the boundary and 403 from the endpoint

### Requirement: Read path not capability-gated

Settings READS SHALL require authentication and an active tenant context only;
they SHALL NOT evaluate entitlements. Gating applies exclusively to writes.

#### Scenario: Non-entitled tenant reads defaults

- GIVEN a tenant without the `sales` grant
- WHEN an authenticated member reads `sales` namespace settings
- THEN the response is 200 with registry defaults
