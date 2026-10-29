---
type: architecture
status: active
updated: 2026-10-24
---

# Demo Tenant and Reproducible Seed

## Current executable implementation (DEV-001)

`pnpm db:demo` loads the root `.env`, requires development/test and refuses real
fiscal/notification providers before writing. It runs the reference seed, the
existing small base demo and commercial application commands. The actual tenant
slug is `demo`, name `Demo Veterinary Clinic`; the larger dataset and Spanish
tenant name below remain the original target, not the current fixtures.

The base demo currently contains two customers, two animals, one encounter, one
weight, a branch/professional, a fixed-date appointment and a portal holder. The
commercial extension creates four catalog items, a supplier, a received
purchase, stock movements, a completed mixed-payment sale, a draft sale, a
closed historical cash session and an open practice session. It creates no
invoices or fiscal submissions. Details and local credentials are in README.md.

Application services preserve authorization, audit and ledger transactions.
Commercial reruns serialize on a tenant-specific advisory lock and reuse the
reserved `· DEMO` names and relationships without editing confirmed records. The
base seed retains its existing password-refresh behavior. The stock projection,
cash close, payment sum, repeatability and other-tenant row counts are checked
with `pnpm test:demo` against a real local PostgreSQL.

`ENABLE_DEMO_SEED` is the implemented guard variable. The root command supplies
the explicit opt-in after checking `NODE_ENV`; the `ALLOW_DEMO_SEED` spelling in
the original recommendation below is not an executable configuration key.

## Goal

Provide realistic synthetic data for:

- development;
- automated/manual QA;
- visual regression checks;
- product demos;
- coding-agent context.

## Tenant

Default synthetic tenant:

```text
slug: demo-veterinaria
name: Veterinaria San Roque Demo
country: PY
locale: es-PY
timezone: America/Asuncion
currency: PYG
```

## Seed requirements

The seed is deterministic enough that agents/tests can rely on known fixtures.

Include synthetic examples for:

```text
owner
admin
2 veterinarians
receptionist
cashier

30+ customers
40+ patients
appointments
clinical encounters
vaccinations
catalog items
warehouses
suppliers
purchases
sales
payments
cash session examples
invoices
fiscal documents using FakeFiscalProvider
```

All names/documents/phones are fictional or generated test values.

## Environment safety

Never seed demo data automatically in production.

Production demo creation, if later desired, must require an explicit controlled
mechanism.

Recommended guard:

```text
ALLOW_DEMO_SEED=true
```

and fail when:

```text
NODE_ENV=production
```

unless a dedicated approved demo environment is being provisioned.

## Fiscal safety

Demo tenants never use real SIFEN production credentials.

Use:

```text
FakeFiscalProvider
```

or a dedicated non-production provider/test environment.

## Branding

Demo seed includes a sample `ProductBrandPreset` plus a TenantBranding override
so visual theming can be exercised continuously.

## Testing value

Critical UI/E2E flows should use known seed fixtures rather than ad-hoc manually
created records whenever practical.
