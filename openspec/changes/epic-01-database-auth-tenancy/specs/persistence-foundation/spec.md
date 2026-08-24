# Delta for persistence-foundation

## ADDED Requirements

### Requirement: Prisma client lifecycle

The system SHALL run exactly one Prisma client instance per API process,
connected before serving requests and disconnected during graceful shutdown.
Modules SHALL obtain the client via dependency injection and SHALL NOT construct
their own instances.

#### Scenario: Single shared instance

- GIVEN the API application is bootstrapped
- WHEN two different services request the database client
- THEN both receive the same instance (one connection pool)

#### Scenario: Graceful shutdown disconnects

- GIVEN the API is running with open database connections
- WHEN the process shuts down gracefully
- THEN the Prisma client disconnects before exit

### Requirement: Migrations gate in CI

The CI pipeline SHALL apply all committed migrations to a fresh PostgreSQL
database as a required quality gate. A failing or incomplete migration SHALL
turn the gate red.

#### Scenario: Clean apply on fresh database

- GIVEN an empty PostgreSQL instance
- WHEN the CI migration step runs
- THEN every committed migration applies in order without error

#### Scenario: Broken migration fails the gate

- GIVEN a committed migration that errors mid-apply
- WHEN the CI gate runs
- THEN the pipeline fails and no later stage ships

### Requirement: Schema data conventions

The schema SHALL use UUID public identifiers, persist timestamps in UTC, and
declare monetary or precision-sensitive values as NUMERIC fixed-point columns.
Floating point types SHALL NOT be used for such values.

#### Scenario: Conventions hold on new tables

- GIVEN a migration introducing a new table
- WHEN the schema is inspected by convention checks
- THEN public IDs are UUID, timestamps are UTC, and money-like columns are
  NUMERIC

#### Scenario: Floating point money rejected

- GIVEN a change declaring a monetary column as a floating point type
- WHEN schema convention checks run
- THEN the change is rejected

### Requirement: EPIC-01 schema inventory

The schema SHALL contain tenant-scoped staff identity tables (`UserProfile`,
`UserCredentials`, `StaffSession`, `TenantMembership`), RBAC and entitlement
records (`Role`, `Permission`, `FeatureCode`, `TenantEntitlement`), and
`AuditLog`. Per maintainer decisions, `Branch` and `CustomerPortalAccess` SHALL
exist as schema-only scaffolding: no endpoint or service mutates them in this
epic.

#### Scenario: Schema-only surfaces stay inert

- GIVEN `Branch` and `CustomerPortalAccess` exist in the schema
- WHEN the API surface is enumerated
- THEN no route or service creates, reads, updates, or deletes them

#### Scenario: Staff identity tables are tenant-scoped

- GIVEN the staff identity tables exist
- WHEN their ownership model is inspected
- THEN tenant scoping follows the multi-tenancy rules (see tenancy-core)

### Requirement: Append-only audit scaffolding

The system SHALL provide an append-only `AuditLog` table and an audit writer
boundary. Records carry actor, action, target, and timestamp; no application
path SHALL update or delete audit rows.

#### Scenario: Audit record written and readable

- GIVEN a caller invokes the audit writer with actor, action, and target
- WHEN the record persists
- THEN it is retrievable with actor, action, target, and timestamp intact

#### Scenario: No mutation path

- GIVEN the audit table contains records
- WHEN the writer boundary is exercised by tests
- THEN no exposed operation modifies or removes audit rows
