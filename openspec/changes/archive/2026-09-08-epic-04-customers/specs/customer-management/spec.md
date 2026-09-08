# customer-management Specification

## Purpose

Core tenant-scoped Customer lifecycle: individuals/companies, addresses,
contacts, and an inert PatientGuardian scaffold. Excludes portal, patient
linkage, clinical, scheduling, sales, import, files, and CRM.

## Requirements

### Requirement: Customer kind and display name

The system SHALL support Customer kind `INDIVIDUAL` or `COMPANY`. `displayName`
SHALL be required. `COMPANY` SHALL require `legalName` and `taxId`; `INDIVIDUAL`
MAY have `firstName`, `lastName`, and one national document.

#### Scenario: Create individual

- GIVEN a staff member with `customers.create`
- WHEN an `INDIVIDUAL` with `displayName` is submitted
- THEN a tenant-scoped Customer is persisted with a generated UUID

#### Scenario: Company missing required fields

- GIVEN a staff member with `customers.create`
- WHEN a `COMPANY` is submitted without `legalName` or `taxId`
- THEN the response is 400 `VALIDATION_FAILED`

### Requirement: Kind-scoped field validation

The system SHALL reject kind-mismatched fields.

#### Scenario: Individual with tax id rejected

- GIVEN a create payload with kind `INDIVIDUAL` and `taxId`
- WHEN validated
- THEN the response is 400 `VALIDATION_FAILED`

### Requirement: Soft deactivation

The system SHALL deactivate Customers via a dedicated command. Deactivated
records MUST NOT appear in default lists. Deactivation SHALL be idempotent and
auditable. Hard delete SHALL NOT be exposed.

#### Scenario: Deactivate customer

- GIVEN an active Customer
- WHEN an authorized staff member deactivates it
- THEN it is marked inactive

#### Scenario: Default list excludes inactive

- GIVEN one active and one inactive Customer
- WHEN the default list is fetched
- THEN only the active one is returned

### Requirement: Tenant-scoped addresses

Address management SHALL be gated by `customers.address.manage`. Each address
belongs to one Customer and one tenant.

#### Scenario: Add address

- GIVEN a Customer and staff with `customers.address.manage`
- WHEN a billing address is added
- THEN it is persisted with `tenantId`

#### Scenario: Cross-tenant address read

- GIVEN an address in tenant B
- WHEN staff of tenant A requests it by UUID
- THEN the response is 404 `NOT_FOUND`

### Requirement: Tenant-scoped contacts

Contact management SHALL be gated by `customers.contact.manage`. Each contact
belongs to one Customer and one tenant.

#### Scenario: Add contact

- GIVEN a Customer and staff with `customers.contact.manage`
- WHEN a phone contact is added
- THEN it is persisted with `tenantId`

### Requirement: Inert PatientGuardian scaffold

The schema MAY include a `PatientGuardian` table linking to Customer and a
future Patient, but its Patient FK, service, controller, route, portal, and UI
SHALL remain inactive.

#### Scenario: Scaffold inert

- GIVEN the database schema
- WHEN `PatientGuardian` is inspected
- THEN the table exists
- AND no code path consumes it

### Requirement: Backend permission enforcement

All mutations SHALL be gated by `customers.read`, `customers.create`,
`customers.update`, `customers.deactivate`, `customers.address.manage`, and
`customers.contact.manage`. Frontend gates are UX-only.

#### Scenario: Create without permission

- GIVEN staff without `customers.create`
- WHEN a create request is submitted
- THEN the response is 403 `FORBIDDEN`

### Requirement: Allowlisted confidential responses

Customer DTOs SHALL be allowlisted and classified CONFIDENTIAL. Logs SHALL
contain IDs only.

#### Scenario: Response leaks no internals

- GIVEN a Customer exists
- WHEN it is returned by the API
- THEN only allowlisted fields are present

### Requirement: Transactional audit

Every Customer/Address/Contact mutation SHALL append one AuditWriter row with
action, actor id, target id, requestId, and field diff using stable IDs only.

#### Scenario: Update audited

- GIVEN a successful update
- WHEN the audit log is inspected
- THEN one row exists with actor, target, and diff

### Requirement: Tenant isolation

All queries SHALL filter by server-resolved tenant context. Cross-tenant UUID
access SHALL return 404.

#### Scenario: Cross-tenant read

- GIVEN a Customer in tenant B
- WHEN staff of tenant A requests it
- THEN the response is 404 `NOT_FOUND`

### Requirement: Synthetic demo seed

Demo seed SHALL create synthetic Customers, Addresses, and Contacts without real
PII.

#### Scenario: Demo populated

- GIVEN a demo tenant
- WHEN seed runs
- THEN at least one `INDIVIDUAL`, one `COMPANY`, and linked address/contact
  exist
