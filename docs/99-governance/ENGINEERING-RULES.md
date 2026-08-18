---
type: governance
status: active
owner: engineering
updated: 2026-08-13
---

# Engineering Rules

## Architecture baseline

The system is:

- multi-tenant SaaS;
- modular monolith;
- reusable business Core;
- Veterinary vertical;
- asynchronous worker for external/slow operations.

Deployables for MVP:

```text
web
api
worker
postgres
redis
object-storage
```

Do not introduce microservices without an accepted ADR.

## Stack

Frontend:

- Next.js
- React
- TypeScript strict
- Tailwind CSS
- shadcn/ui
- TanStack Query
- React Hook Form
- Zod
- FullCalendar

Backend:

- Node.js
- NestJS
- Fastify adapter
- Prisma
- PostgreSQL
- Redis
- BullMQ

Tests:

- Vitest
- Supertest
- Playwright

## Design system / branding

UI styling follows three layers:

```text
CoreDesignDefaults
→ ProductBrandPreset
→ TenantBranding overrides
```

All shared UI must consume semantic tokens through CSS variables.

Examples:

```text
--background
--foreground
--card
--primary
--primary-foreground
--secondary
--accent
--muted
--border
--ring
--radius
```

Do not accept arbitrary CSS from tenants. Persist only schema-validated branding
values and approved asset references.

See [[Branding and Theming]].

## Core vs Vertical

Core:

```text
identity
tenancy
branches
entitlements
customers
scheduling
catalog
taxes
inventory
suppliers
purchases
sales
payments
cash
billing
fiscal
notifications
files
audit
reporting
```

Veterinary:

```text
patients
clinical
vaccinations
deworming
treatments
studies
weights
```

Rule:

> Core modules never import Veterinary repositories/services/entities.

## Data integrity

Use UUIDs for public/domain IDs.

Use UTC for persisted timestamps and convert using tenant timezone at
boundaries.

Use Decimal/NUMERIC for money.

Use database transactions for multi-record invariants.

Do not use `MAX(sequence)+1` for fiscal/business sequences.

## Multi-tenancy

Every private table/aggregate is tenant scoped unless explicitly global.

The backend request context is the authority for tenant identity.

Cross-tenant UUID access returns `404`.

Every private aggregate requires isolation tests.

## Ledgers

Inventory:

- `StockMovement` is auditable source of truth.
- `StockBalance` may be a transactional projection/cache.
- Corrections use compensating movements.

Cash:

- `CashMovement` is immutable once confirmed.
- Cash close uses server-computed expected amount.
- Corrections use explicit movements.

## Explicit state transitions

Prefer command endpoints:

```text
POST /purchases/:id/receive
POST /sales/:id/complete
POST /cash/sessions/:id/close
POST /invoices/:id/confirm
POST /encounters/:id/close
```

Avoid generic `PATCH status=...` when transition has business logic.

## External calls

Never hold a database transaction open while waiting on:

- fiscal providers;
- email;
- WhatsApp;
- external storage processing.

Persist intent/state, commit, enqueue, process asynchronously.

## Security

Backend authorization is mandatory.

Portal and staff policies are separate.

Secrets never live in Git or plaintext application records.

Private files use signed URLs.

Sanitize logs and error tracking.

## Definition of Done

A feature requiring persistence/API/UI is not done until applicable items exist:

- schema/migration;
- backend validation;
- tenant isolation;
- authorization;
- business invariant tests;
- API + response DTO;
- frontend;
- loading/empty/error/success states;
- audit when required;
- documentation;
- lint/typecheck/tests green.

See [[WORKFLOW]].

## Internal Events

Internal events are allowed only for decoupled reactions that do not belong
inside the authoritative transaction.

Examples:

```text
AppointmentConfirmed
ClinicalEncounterClosed
SaleCompleted
InvoiceConfirmed
FiscalApproved
```

Transactional invariants remain explicit.

Example:

```text
CompleteSale
  → validate
  → stock movements
  → stock balances
  → cash movement
  → mark completed
  → commit
  → emit SaleCompleted
```

Possible post-commit handlers:

```text
SaleCompleted
  → analytics projection
  → notification
  → optional invoice workflow trigger
```

Do not use events to hide business dependencies.

See [[Internal Events]].

## Tenant Settings

Use a typed namespace registry.

Modules do not read arbitrary JSON from Tenant directly.

Each namespace defines:

```text
schema
schemaVersion
defaults
authorization policy
```

General settings do not contain secrets or Branding assets/tokens.

See [[Tenant Settings]].

## Reversal Policy

Confirmed financial/inventory operations are corrected through explicit
reversals/compensating records.

Every reversal must retain:

```text
original operation ID
reversal operation ID
reason
actor
timestamp
audit trail
```

A reversal endpoint must be idempotent.

See [[Reversals and Corrections]].

## Data Classification

New sensitive fields must be classified as:

```text
PUBLIC
INTERNAL
CONFIDENTIAL
RESTRICTED
```

Do not log full CONFIDENTIAL/RESTRICTED objects.

No automatic destructive deletion of clinical/fiscal/audit records in MVP
without an approved retention policy.

See [[Data Classification and Retention]].

## Complexity Budget

The current MVP stack is frozen.

An accepted ADR is required before introducing a new deployable runtime,
database technology, broker/queue, ORM, auth strategy, global state framework,
general event bus, alternate API protocol, micro-frontend architecture, or
replacement design-system foundation.

Architecture is not improved merely by adding layers.
