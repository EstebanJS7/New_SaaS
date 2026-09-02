# Proposal: EPIC-04 Customers

## Intent

Deliver the reusable, tenant-scoped Customer Core needed before Patients, while
keeping customer data confidential, auditable, and independently manageable by
staff.

## Scope

### In Scope

- A feature-gate-free `Customer` aggregate with `INDIVIDUAL`/`COMPANY` kind,
  required `displayName`, conditional personal/company validation, and soft
  deactivation.
- Tenant-scoped Address and Contact child entities; inert `PatientGuardian`
  persistence scaffold only.
- Staff API/UI CRUD, backend permission enforcement, allowlisted DTOs,
  transactional audit, tenant-isolation coverage, demo seed, navigation, and web
  proxy routes.

### Out of Scope

- Portal, CustomerPortalAccess linkage, Patients, clinical, scheduling, sales,
  import, file upload, CRM, and PRD edits.

## Capabilities

### New Capabilities

- `customer-management`: Tenant-scoped customer, address, and contact lifecycle
  with staff access, auditability, and deactivation.

### Modified Capabilities

- `rbac-administration`: Seed Customer permissions and the approved baseline
  role matrix.

## Approach

Add the Core models and additive migration, then mirror established tenant-safe
repository, request-context, permission-guard, audit, DTO, proxy, and
semantic-navigation patterns. Customer fields are CONFIDENTIAL; audit metadata
uses stable IDs only. `PatientGuardian` remains schema-only: no Patient model,
FK activation, service, controller, portal, or UI linkage.

## Affected Areas

| Area                                                  | Impact   | Description                                             |
| ----------------------------------------------------- | -------- | ------------------------------------------------------- |
| `packages/database/prisma/schema.prisma`              | Modified | Customer, Address, Contact, and inert guardian scaffold |
| `packages/database/src/{reference-seed,demo-seed}.ts` | Modified | Permissions, role baseline, synthetic demo data         |
| `apps/api/src/customers/**`                           | New      | Tenant-safe staff API, validation, DTOs, audit          |
| `apps/web/src/app/(app)/app/customers/**`             | New      | Staff list, detail, create/edit states                  |
| `apps/web/src/app/api/customers/**`                   | New      | Authenticated API proxies                               |
| `apps/web/src/components/shell/nav-sidebar.tsx`       | Modified | Customers destination                                   |

## Decisions

- No `customers` entitlement/feature code; access is permission-based.
- Permissions: `customers.read/create/update/deactivate`,
  `customers.address.manage`, `customers.contact.manage`.
- **Confirmed baseline:** OWNER/ADMIN all; RECEPTIONIST read/create/update plus
  address/contact management; VETERINARIAN read only; other roles none. Tenant
  overrides remain available through accepted DEC-003.
- Delivery is a feature-branch chain: schema/seed, API domain, API boundary,
  then web; each slice targets no more than 400 changed lines. Consolidated
  hardening follows EPIC-03 Phase B and this change.

## Risks

| Risk                                     | Likelihood | Mitigation                                |
| ---------------------------------------- | ---------- | ----------------------------------------- |
| PII exposure in logs/audit               | Med        | DTO allowlists; ID-only audit metadata    |
| Inert scaffold drifts                    | Med        | Pin schema-only boundaries in tests/specs |
| Inherited live-PG isolation gap (TD-006) | Med        | Include in consolidated hardening gate    |

## Rollback Plan

Revert individual chained slices. Before production migration, roll back the
additive migration only if no Customer data exists; otherwise disable routes/UI
and retain records for audit and referential integrity.

## Dependencies

- EPIC-02 RBAC and EPIC-03 Phase B conventions; DEC-003 tenant-effective
  permissions.

## Success Criteria

- [ ] Staff can manage only their tenant's Customers, Addresses, and Contacts
      according to backend-enforced permissions.
- [ ] Customer data is allowlisted, CONFIDENTIAL, audited on mutations, and
      soft-deactivated only.
- [ ] Inert guardian scaffold has no Patient or portal behavior.
- [ ] Delivery is reviewable through <=400-line chained slices, followed by
      combined hardening.
