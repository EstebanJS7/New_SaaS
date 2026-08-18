---
type: architecture
status: active
updated: 2026-08-13
---

# Architecture Overview

## Runtime

```text
Browser
  │
  ▼
Next.js
  │
  ▼
NestJS + Fastify
  │
  ├── PostgreSQL
  ├── Redis/BullMQ
  └── Object Storage

Worker
  ├── Fiscal provider
  ├── Email
  ├── WhatsApp
  └── Imports
```

## Boundaries

### Platform

Identity, tenancy, branches, RBAC, entitlements and Branding/Theming.

### Core Business

Customers, Scheduling, Catalog, Taxes, Inventory, Suppliers, Purchases, Sales,
Payments, Cash, Billing, Fiscal, Notifications, Files, Audit, Reporting.

### Veterinary

Patients, Clinical, Vaccinations, Deworming, Treatments, Studies, Weights.

## Dependency direction

```text
Veterinary ─────► Core contracts
Core ───────────X Veterinary implementation
Billing ────────► Fiscal application boundary
Fiscal domain ──► Provider interface
Provider adapter ► external service
```

## Architecture record

Important changes require an ADR under `../04-adrs/`.

UI branding follows [[Branding and Theming]] and
[[ADR-002 Branding Theme Layering]].
