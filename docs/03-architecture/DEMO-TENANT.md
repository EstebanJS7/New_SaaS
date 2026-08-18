---
type: architecture
status: active
updated: 2026-08-13
---

# Demo Tenant and Reproducible Seed

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
