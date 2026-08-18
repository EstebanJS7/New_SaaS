---
type: prd
version: "1.3"
status: approved-baseline
vertical: veterinary
market: Paraguay
updated: 2026-08-13
---

# PRD Technical v1.3 — SaaS Core + Veterinary + Branding

This is the approved baseline for implementation.

It incorporates the OpenCode + Obsidian + Git operating model defined in
[[WORKFLOW]] and the reusable branding/theming architecture defined in
[[Branding and Theming]].

## 1. Product

Build a multi-tenant SaaS with a reusable Business Core and a Veterinary
vertical.

Initial market: Paraguay.

Defaults:

```text
locale: es-PY
timezone: America/Asuncion
currency: PYG
secondary currency support: USD
```

## 2. Architecture

```text
Next.js Staff UI + Customer Portal
              │
            HTTPS
              │
      NestJS + Fastify API
              │
   ┌──────────┼───────────┐
   │          │           │
Platform     Core     Veterinary
   │          │           │
   └──────────┼───────────┘
              │
          PostgreSQL
              │
             Redis
              │
            BullMQ
              │
            Worker
       ┌──────┼────────┐
       │      │        │
     Fiscal  Email  WhatsApp
```

MVP deployables:

```text
web
api
worker
postgres
redis
object storage
```

Use a modular monolith. Do not introduce microservices.

## 3. Stack

Frontend:

```text
Next.js
React
TypeScript strict
Tailwind CSS
shadcn/ui
TanStack Query
React Hook Form
Zod
date-fns
Lucide
FullCalendar
```

Backend:

```text
Node.js
NestJS
Fastify
Prisma
PostgreSQL
Redis
BullMQ
OpenAPI
```

Testing:

```text
Vitest
Supertest
Playwright
```

Recommended managed infrastructure for fast MVP delivery may include Supabase
Auth/PostgreSQL/Storage, while all domain/business rules still pass through the
API.

## 4. Repository

```text
apps/
  web/
  api/
  worker/

packages/
  database/
  shared/
  ui/
  config/
  eslint-config/
  typescript-config/

docs/
infrastructure/
.opencode/
```

`docs/` is the Obsidian Vault and is versioned in Git.

## 5. Core domains

```text
identity
tenancy
branches
plans/entitlements
branding
tenant-settings
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

## 6. Veterinary domains

```text
patients
species
breeds
clinical
vaccinations
deworming
treatments
studies
weights
```

Core cannot depend on Veterinary implementation details.

## 7. Multi-tenancy

Every company is a Tenant.

Every private aggregate must be scoped by tenant.

Tenant authority comes from server-side authenticated request context, never a
free-form frontend `tenantId`.

Cross-tenant UUID access returns `404`.

Isolation tests are mandatory for private aggregates.

## 8. Identity

External managed authentication is preferred for MVP.

Domain records:

```text
UserProfile
TenantMembership
Role
Permission
CustomerPortalAccess
```

Staff and Customer Portal authorization are separate security boundaries.

## 9. RBAC

Seed roles:

```text
OWNER
ADMIN
VETERINARIAN
RECEPTIONIST
CASHIER
INVENTORY_MANAGER
```

Permission naming:

```text
domain.resource.action
```

Examples:

```text
vet.clinical.create
inventory.stock.transfer
cash.close
fiscal.issue
users.manage
```

Frontend permission gates are UX only. Backend enforcement is mandatory.

## 10. Entitlements

Plan access is capability-based:

```text
entitlements.has("whatsapp")
entitlements.has("multi_branch")
```

Never hardcode `if plan === PRO`.

Initial feature codes:

```text
veterinary
inventory
purchases
sales
cash
billing
fiscal
portal
whatsapp
multi_branch
advanced_reports
custom_branding
```

## 10.1 Branding and Theming

Branding is a reusable Platform/Core capability and must not live inside the
Veterinary vertical.

The same codebase must support three visual layers:

```text
CoreDesignDefaults
      ↓
ProductBrandPreset
      ↓
TenantBranding overrides
```

Purpose:

- a future product built for another industry can have a different default
  visual identity without forking shared UI;
- a SaaS tenant can optionally customize approved aspects of its identity;
- staff UI and customer portal resolve the same tenant brand by default.

### ProductBrandPreset

A product/deployment preset lives in versioned code/config and defines the
default identity for that SaaS product.

Example presets:

```text
core-default
veterinary-default
future-dental-default
future-workshop-default
```

It may define:

```text
productName
shortName
logoLight
logoDark
favicon
semantic color tokens
radius scale
font heading/body from allowlist
default appearance
optional login/portal visual assets
```

A new product preset MUST NOT require editing generic Button/Card/Table/Form
components.

### TenantBranding

Runtime overrides are stored per tenant and may include:

```text
displayName
logoLightAssetKey
logoDarkAssetKey
faviconAssetKey
primary
primaryForeground
secondary
secondaryForeground
accent
accentForeground
background
foreground
card
cardForeground
muted
mutedForeground
border
ring
radius
fontHeading
fontBody
defaultAppearance
```

Do not persist arbitrary CSS.

Validate values through a strict `BrandThemeSchema`.

Fonts must be selected from an approved allowlist/bundled font set.

### Resolution

```ts
resolvedBrand = mergeBrand(
  coreDesignDefaults,
  productBrandPreset,
  tenantBrandingOverrides
);
```

Tenant overrides win only for permitted properties.

### CSS implementation

shadcn/Tailwind reusable components consume semantic CSS variables.

No reusable component may contain literals such as:

```text
bg-blue-600
text-emerald-700
#12AB34
```

when the literal represents product branding.

Use semantic tokens such as:

```text
bg-primary
text-primary-foreground
bg-background
text-foreground
border-border
ring-ring
```

### Branding assets

Branding assets differ from private clinical files.

Approved logo/favicon assets may be served publicly through controlled object
storage/CDN because they may be required before authentication.

Requirements:

- validated MIME/size;
- generated storage keys;
- no executable uploads;
- asset replacement invalidates/revisions cached URLs;
- no arbitrary HTML/SVG script execution.

SVG may be disallowed initially or sanitized through an explicitly approved
pipeline. PNG/WebP are sufficient for MVP logos.

### White-label entitlement

Tenant custom branding may be gated with:

```text
custom_branding
```

The product-level preset is always available and is not a tenant entitlement.

### Branding settings UI

Staff route:

```text
/app/settings/branding
```

MVP editor:

- upload light/dark logo;
- upload favicon;
- choose primary/accent colors;
- choose approved font pair;
- choose radius preset;
- choose default light/dark/system appearance;
- live preview;
- reset to product defaults.

Changes must be previewable before save.

### API

Authenticated:

```text
GET   /api/v1/branding/current
GET   /api/v1/settings/branding
PATCH /api/v1/settings/branding
POST  /api/v1/settings/branding/assets
POST  /api/v1/settings/branding/reset
```

Public tenant-context endpoint when a tenant slug/host is known:

```text
GET /api/v1/public/tenants/:slug/branding
```

It must expose only safe visual configuration, never tenant-private data.

### Data model

Recommended:

```prisma
model TenantBranding {
  id                String   @id @default(uuid()) @db.Uuid
  tenantId          String   @unique @db.Uuid
  displayName       String?
  logoLightAssetKey String?
  logoDarkAssetKey  String?
  faviconAssetKey   String?
  theme             Json
  updatedBy         String?  @db.Uuid
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@map("tenant_branding")
}
```

`theme` is JSON only because it is constrained by a versioned application
schema; it is not a generic arbitrary settings bag.

Persist a `themeSchemaVersion` if required when the contract evolves.

### Security / tenancy

Only authorized staff can change branding.

Suggested permission:

```text
settings.branding.manage
```

Public branding lookup resolves a tenant from a trusted slug/host mapping and
returns an allowlisted DTO.

No secret or organization-private fields are returned.

### Future custom domains

Prepare brand resolution so the tenant can eventually be resolved from:

```text
tenant slug
subdomain
custom domain
```

Custom-domain provisioning/TLS is not required for MVP.

## 11. Customer

Customer represents a person/company receiving or purchasing services.

A Customer may be linked to multiple Patients through `PatientGuardian`.

Patient may have multiple guardians; only one active PRIMARY guardian.

## 12. Patient 360

Primary veterinary workspace.

Header:

- photo;
- name;
- species/breed;
- sex/age;
- current weight;
- primary guardian;
- alerts.

Tabs:

```text
Summary
History
Vaccines
Treatments
Deworming
Studies
Weights
Files
Billing
```

Primary actions must be accessible without navigating away.

## 13. Clinical

ClinicalEncounter states:

```text
DRAFT
CLOSED
```

DRAFT is editable and autosaved.

CLOSED is immutable by default.

Amendments require explicit permission and audit.

Separate:

```text
internalNotes
clientSummary
```

Portal never exposes internalNotes.

## 14. Scheduling

Agenda must provide:

- day/week/month/list views;
- drag and drop;
- resize;
- time-range creation;
- branch/professional/status/service filters;
- working hours;
- schedule blocks;
- conflict validation;
- responsive mobile behavior.

Appointment states:

```text
SCHEDULED
CONFIRMED
ARRIVED
IN_PROGRESS
COMPLETED
CANCELLED
NO_SHOW
```

Transitions use explicit backend operations.

Portal can request appointments.

Default booking policy:

```text
REQUIRE_APPROVAL
```

## 15. Catalog and taxes

Catalog item types:

```text
PRODUCT
SERVICE
MEDICATION
SUPPLY
```

Physical items may track stock.

Tax rates are data/configuration, not hardcoded invoice logic.

Paraguay seed:

```text
EXEMPT 0%
IVA_5  5%
IVA_10 10%
```

Authorized users select the applicable rate.

## 16. Inventory

Use stock ledger.

`StockMovement` is auditable source of truth.

`StockBalance` may be maintained transactionally as a projection.

Movement conventions:

- inputs positive;
- outputs negative;
- confirmed movements immutable;
- corrections use compensating movements.

Transfers create `TRANSFER_OUT` + `TRANSFER_IN` atomically.

Default negative stock policy:

```text
BLOCK
```

## 17. Purchases

Purchase states:

```text
DRAFT
RECEIVED
CANCELLED
```

Receiving is an explicit command and atomically:

- validates DRAFT;
- creates stock movements;
- updates balances;
- marks RECEIVED;
- writes audit.

## 18. Sales and POS

Sale is separate from Invoice.

Sale states:

```text
DRAFT
COMPLETED
CANCELLED
```

Complete Sale atomically:

- validates totals;
- validates payments;
- validates stock;
- creates stock movements;
- updates stock balances;
- creates cash movements for CASH payments;
- marks completed;
- audits.

Must be idempotent.

POS optimized for keyboard, barcode scanner, touch and tablet.

## 19. Payments

Support multiple payments per sale:

```text
CASH
CARD
BANK_TRANSFER
QR
CHECK
OTHER
```

Invoice and Payment are separate concepts.

## 20. Cash

Entities:

```text
CashRegister
CashSession
CashMovement
```

Only one OPEN session per register.

Cash movements:

```text
SALE
REFUND
INCOME
EXPENSE
WITHDRAWAL
DEPOSIT
ADJUSTMENT
```

Confirmed movements are immutable.

Close computes expected amount on server and compares with counted amount.

Difference is stored/audited.

## 21. Billing

Invoice states:

```text
DRAFT
CONFIRMED
CANCELLED
```

Invoice items are immutable snapshots of description, quantity, unit price, tax
and totals.

Invoice numbering uses a transactional sequence, never `MAX()+1`.

Invoice is distinct from fiscal status.

## 22. Fiscal boundary

Fiscal is a reusable Core domain.

Providers:

```text
THIRD_PARTY       MVP
SIFEN_DIRECT      future
FAKE              tests/dev
```

Billing imports a Fiscal application interface, never a concrete provider.

`FiscalDocument` stores:

- provider;
- external ID;
- state;
- CDC when available;
- XML/KuDE storage refs;
- request/response snapshots with sensitive data sanitized;
- attempts/errors;
- timestamps.

Fiscal submission is queued.

Use idempotency.

Transient errors retry with bounded exponential backoff.

Functional/schema/config rejections do not retry forever.

## 23. Paraguay / SIFEN implementation rule

Direct SIFEN implementation is intentionally deferred behind the provider
boundary.

Before implementing `SifenDirectFiscalProvider`, revalidate current official
DNIT:

- Manual Técnico;
- XSD;
- XML structures;
- Notas Técnicas;
- test guide;
- environment/certification requirements.

Do not implement protocol details from memory.

See [[SIFEN]].

## 24. Notifications

Channels:

```text
EMAIL
WHATSAPP
```

MVP WhatsApp is transactional only.

Appointment reminders must be idempotent and cancelled if the appointment is
cancelled.

## 25. Files

Clinical files are private.

Allowed initial types:

```text
PDF
JPG
JPEG
PNG
WEBP
```

Default max: 10 MB.

Store binary content in object storage, not PostgreSQL.

Use short-lived signed URLs.

## 26. Portal

Portal routes are separate from staff routes.

Portal authorization chain for a Patient:

```text
UserProfile
→ CustomerPortalAccess
→ Customer
→ PatientGuardian
→ Patient
```

Portal capabilities include:

- own pets;
- allowed clinical summary;
- vaccines;
- appointments;
- booking;
- invoices/documents;
- profile.

## 27. Audit

Audit critical actions including:

- role changes;
- clinical close/amend;
- stock adjustments/transfers;
- purchase receive;
- sale complete/cancel;
- cash open/close/manual movement;
- invoice confirm/cancel;
- fiscal configure/retry/cancel;
- support access.

Audit logs are append-only from normal application behavior.

## 28. API

Base:

```text
/api/v1
```

Use response DTOs; never return raw Prisma models.

Stable error shape:

```json
{
  "error": {
    "code": "PATIENT_NOT_FOUND",
    "message": "Paciente no encontrado",
    "requestId": "..."
  }
}
```

Use explicit transition endpoints for important state changes.

## 29. Security

Required:

- strict server-side authentication/authorization;
- tenant-safe repository/data access;
- portal/staff separation;
- secure session cookies;
- controlled CORS;
- CSP/HSTS/security headers;
- rate limits for sensitive endpoints;
- secret manager/environment secrets;
- private storage;
- sanitized structured logs;
- no production stack traces.

## 30. Observability and recovery

Structured logs with request ID.

Health:

```text
/health/live
/health/ready
```

Production database:

- automatic backups;
- PITR preferred;
- initial RPO target <= 24h;
- recovery must be tested.

## 31. Reports MVP

Core:

- sales by period;
- payment methods;
- cash close/movements;
- stock;
- low stock;
- purchases;
- sales by product/service.

Veterinary:

- consultations;
- upcoming/overdue vaccines;
- upcoming deworming;
- new patients.

Initial export: CSV.

## 32. Import

MVP imports:

- Customers CSV/XLSX;
- Patients CSV/XLSX.

Large imports run asynchronously.

Must provide validation, preview and result summary.

## 33. Engineering priorities

```text
data integrity
tenant isolation
clinical usability
daily workflow speed
fiscal correctness
auditability
UX
performance
extensibility
features
```

## 34. Implementation order

```text
EPIC-00 Foundation
EPIC-01 Database/Auth/Tenancy
EPIC-02 RBAC/Entitlements
EPIC-03 Staff Shell/Design System/Branding
EPIC-04 Customers
EPIC-05 Veterinary Patients
EPIC-06 Clinical
EPIC-07 Scheduling
EPIC-08 Portal
EPIC-09 Catalog/Taxes
EPIC-10 Inventory
EPIC-11 Suppliers/Purchases
EPIC-12 POS/Payments
EPIC-13 Cash
EPIC-14 Billing
EPIC-15 Fiscal Abstraction
EPIC-16 Fiscal Third-party Adapter
EPIC-17 Notifications
EPIC-18 Dashboards/Reports
EPIC-19 Imports
EPIC-20 Production Hardening
```

## 35. Documentation operating model

This PRD is stored in the repository intentionally.

Implementation work must be represented by Story files.

Architecture changes require ADRs.

Scope changes require an explicit accepted Decision/user instruction.

Technical shortcuts that do not violate acceptance must be recorded as Tech
Debt.

See:

- [[WORKFLOW]]
- [[Engineering Rules]]
- [[Documentation Rules]]
- [[ROADMAP]]

## 36. MVP acceptance journey

The initial product is operational when this journey can complete:

```text
register organization
→ create branch
→ invite staff
→ open cash
→ create customer
→ create patient
→ book appointment
→ patient arrives
→ clinical consultation
→ add service/product
→ complete sale
→ mixed payment
→ stock updated
→ create invoice
→ fiscal submission queued
→ fiscal approval
→ KuDE available
→ notification
→ close cash
→ customer portal login
→ customer sees pet and allowed documents
```

## 37. Non-goals

See [[MVP Scope]].

Anything outside approved scope must not be implemented merely because the agent
considers it useful.

## 38. Typed Tenant Settings

Tenant behavior that varies by company is managed through a reusable
`TenantSettingsService`.

Persistence uses namespaced/versioned JSON validated by code schemas.

Conceptual model:

```text
TenantSettingNamespace
  tenantId
  namespace
  schemaVersion
  data
```

Initial namespaces:

```text
scheduling
inventory
sales
cash
portal
notifications
fiscal-ui
```

Rules:

- unknown keys rejected;
- server-side validation mandatory;
- defaults defined in code;
- access only through typed service;
- no secrets;
- Branding remains separate;
- permission required for writes.

See [[Tenant Settings]].

## 39. Internal Application Events

The modular monolith may emit minimal post-commit events for decoupled
reactions.

Initial catalog only when needed:

```text
AppointmentConfirmed
AppointmentCancelled
ClinicalEncounterClosed
SaleCompleted
InvoiceConfirmed
FiscalApproved
FiscalRejected
```

Events do not replace synchronous transactions.

Example:

```text
Complete Sale transaction
→ commit stock/cash/sale
→ SaleCompleted
→ post-commit notification/projection
```

Do not introduce a distributed broker/general event bus for MVP.

See [[Internal Events]] and [[ADR-003 Minimal Internal Application Events]].

## 40. Reversals and Corrections

Completed/confirmed operational records are corrected through explicit
reversal/amendment operations.

Financial/inventory reversals must:

```text
preserve original record
create compensating record(s)
link original ↔ reversal
require reason
record actor/time
be idempotent
be audited
```

Core cases:

```text
Sale cancellation/reversal
Payment refund/reversal
Cash compensating movement
Purchase reversal
Invoice cancellation
Fiscal provider-specific cancellation/event
```

Clinical corrections continue to use audited amendments, not destructive edits.

See [[Reversals and Corrections]].

## 41. Data Classification and Retention

Engineering classification:

```text
PUBLIC
INTERNAL
CONFIDENTIAL
RESTRICTED
```

Customer, appointment, clinical, invoice/payment and related operational data
are generally CONFIDENTIAL.

Credentials, tokens, private keys, certificate PINs and fiscal secrets are
RESTRICTED and should normally live in secret management rather than application
tables.

MVP must not implement automatic destructive retention for clinical, fiscal,
confirmed financial, ledger or audit data before an explicit approved
policy/legal review.

Production data must never be copied into demo/development environments.

See [[Data Classification and Retention]].

## 42. Demo Tenant

Maintain a reproducible synthetic demo tenant/seed.

Purpose:

```text
development
QA
visual testing
E2E
product demonstrations
coding-agent context
```

Default demo:

```text
Veterinaria San Roque Demo
es-PY
America/Asuncion
PYG
```

Demo must include representative Core + Veterinary data and exercise Branding.

Demo fiscal behavior uses FakeFiscalProvider/non-production services only.

Demo seed must be guarded from accidental production execution.

See [[Demo Tenant and Reproducible Seed]].

## 43. Complexity Budget / Architecture Freeze

The MVP architecture is frozen after PRD v1.3.

An accepted ADR is required before introducing:

```text
new runtime/deployable service
new database technology
new queue/broker technology
new ORM
new authentication strategy/provider
new global frontend state library
new API protocol such as GraphQL
general-purpose WebSocket infrastructure
generic abstraction consumed across 3+ domains
general cross-domain event bus
replacement design-system foundation
second CSS framework
micro-frontends
additional cache/data store
```

A proposal must demonstrate a concrete product/engineering requirement that the
current architecture cannot meet cleanly.

"More scalable", "cleaner" or "best practice" alone are not sufficient reasons.

This rule applies to coding agents and human contributors.

## 44. Architecture Freeze Status

With v1.3, the MVP architecture baseline is considered ready for implementation.

Further design work should be driven by:

```text
failing acceptance criteria
measured performance
security finding
regulatory requirement
real implementation constraint
validated product requirement
```

not speculative future needs.

Implementation should begin with `EPIC-00` / focused `FOUND-*` Stories.
