---
type: module
module: customers
status: active
updated: 2026-09-07
---

# Module — Customers (Core)

## Responsibility

Tenant-scoped customer directory shared by all verticals. Stores individuals and
companies, their addresses and contact channels, and an inert `PatientGuardian`
scaffold for the future Patient domain.

## Does Not Own

- Veterinary clinical records, vaccinations, or treatments.
- Portal self-registration.
- Sales, billing, or fiscal behavior.
- Patient management (the `PatientGuardian` scaffold has no `patient_id` FK,
  service, controller, route, or UI).

## Main Concepts

```text
Customer
CustomerAddress
CustomerContact
PatientGuardian (inert scaffold)
```

## Customer Kind

```text
INDIVIDUAL — firstName, lastName, documentNumber
COMPANY    — legalName, taxId
```

Both kinds share `displayName`, tenant scope, addresses, and contacts. The API
rejects kind-mismatched fields.

## Permissions

```text
customers.read
customers.create
customers.update
customers.deactivate
customers.address.manage
customers.contact.manage
```

Reference-seed role matrix:

| Role              | Permissions                                          |
| ----------------- | ---------------------------------------------------- |
| OWNER             | all six                                              |
| ADMIN             | all six                                              |
| RECEPTIONIST      | read, create, update, address.manage, contact.manage |
| VETERINARIAN      | read only                                            |
| CASHIER           | none                                                 |
| INVENTORY_MANAGER | none                                                 |

## API

```text
GET    /customers
POST   /customers
GET    /customers/:id
PUT    /customers/:id
POST   /customers/:id/deactivate

GET    /customers/:customerId/addresses
POST   /customers/:customerId/addresses
GET    /customers/:customerId/addresses/:id
PUT    /customers/:customerId/addresses/:id
POST   /customers/:customerId/addresses/:id/deactivate

GET    /customers/:customerId/contacts
POST   /customers/:customerId/contacts
GET    /customers/:customerId/contacts/:id
PUT    /customers/:customerId/contacts/:id
POST   /customers/:customerId/contacts/:id/deactivate
```

Web proxy route:

```text
/api/customers/[[...path]]
```

## Data Classification

`displayName`, `legalName`, `taxId`, `firstName`, `lastName`, and
`documentNumber` are **CONFIDENTIAL**. Logs and audit metadata carry IDs and
field names only; values are never logged.

## Invariants

- Every customer, address, and contact row is tenant-scoped.
- Database lookups filter by `id` **and** server-derived `tenantId` (and
  `customerId` for children); cross-tenant UUID access returns `404`
  byte-equivalent to a nonexistent ID.
- Default `GET /customers` returns active rows only.
- Deactivate is a soft-delete command (`isActive = false`), idempotent, and
  audited.
- There is no hard-delete endpoint.
- Audit co-commits one `audit_log` row per mutation inside the same transaction.
- Audit metadata contains only `schemaVersion`, `changedFields`, and stable IDs;
  no free-text reasons or CONFIDENTIAL values are logged.
- `PatientGuardian` is schema-only: no application code imports, creates, reads,
  updates, or deletes it.

## Implementation

- `packages/database/prisma/schema.prisma` — models, enums, indexes.
- `packages/database/prisma/migrations/20260826150100_customers/migration.sql` —
  additive CREATE TABLE statements.
- `apps/api/src/customers/*` — service, controllers, Zod schemas, DTOs, tests.
- `apps/web/src/app/(app)/app/customers/*` — staff list, detail, create, edit
  UI.
- `apps/web/src/app/api/customers/[[...path]]/route.ts` — Next.js proxy.

## Known limitations / blockers

- Playwright E2E coverage for Customer CRUD/navigation is **explicitly
  blocked**: Playwright is not installed or configured in the repository. The
  Vitest suite covers unit, integration, proxy, and UI 403 UX paths; a future
  change that adds Playwright should implement the CRUD/navigation E2E scenario
  before removing this note.
- Live application-path HTTP tenant isolation has been executed against a real
  PostgreSQL database in CI. GitHub Actions run
  [`34183380781`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34183380781)
  for commit `853f13099cedcedf51b9e4c76126ed5f841efcca` reported the live-PG
  suite `apps/api/test/live-pg-isolation.e2e-spec.ts` as 5/5 passed. The harness
  boots the real `AppModule` with the real `PrismaService` against a disposable
  PostgreSQL database, applies migrations and reference seeds, creates the
  fixture tenants, users, and memberships directly through `PrismaService`, and
  uses Supertest over an explicitly bound NestJS/Fastify listener to prove
  byte-equivalent `404 NOT_FOUND` for cross-tenant Customer/Address/Contact
  mutations. The suite is skipped automatically when
  `DATABASE_URL_TEST`/`DATABASE_URL` are absent.

## Related

- [[Data Classification and Retention]]
- [[Reversals and Corrections]]
- [[Audit and Entitlements]]
- [[TD-006]]
