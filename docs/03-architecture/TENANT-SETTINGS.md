---
type: architecture
status: active
updated: 2026-08-13
---

# Tenant Settings

## Goal

Allow each tenant to configure reusable business behavior without scattering
booleans, JSON reads and product-specific conditions throughout the codebase.

## Model

Recommended persistence:

```prisma
model TenantSettingNamespace {
  id            String   @id @default(uuid()) @db.Uuid
  tenantId      String   @db.Uuid
  namespace     String
  schemaVersion Int
  data          Json
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([tenantId, namespace])
  @@index([tenantId])
  @@map("tenant_setting_namespaces")
}
```

The JSON value is **not untyped application data**.

All access goes through a code registry.

## Registry

Conceptual API:

```ts
type SettingsNamespace =
  | "scheduling"
  | "inventory"
  | "sales"
  | "cash"
  | "portal"
  | "notifications"
  | "fiscal-ui";

interface SettingsDefinition<T> {
  namespace: SettingsNamespace;
  version: number;
  schema: ZodSchema<T>;
  defaults: T;
}
```

Example:

```ts
const schedulingSettings = {
  namespace: "scheduling",
  version: 1,
  schema: z.object({
    conflictPolicy: z.enum(["ALLOW", "WARN", "BLOCK"]).default("WARN"),
    portalBookingPolicy: z
      .enum(["AUTO_CONFIRM", "REQUIRE_APPROVAL"])
      .default("REQUIRE_APPROVAL"),
    defaultAppointmentMinutes: z.number().int().min(5).max(480).default(30),
  }),
};
```

## Service

All modules use:

```ts
tenantSettings.get("scheduling", context);
tenantSettings.update("scheduling", patch, context);
```

Never:

```ts
tenant.settings["whatever"];
```

## Initial namespaces

### scheduling

```text
conflictPolicy
portalBookingPolicy
defaultAppointmentMinutes
reminder defaults
```

### inventory

```text
negativeStockPolicy
defaultWarehouse behavior
```

### sales

```text
defaultCurrency
requireCustomerForInvoice
```

### cash

```text
requireOpenSessionForCashSale
```

### portal

```text
bookingEnabled
clinicalSummaryEnabled
invoiceDocumentsEnabled
```

### notifications

```text
email reminders enabled
WhatsApp reminders enabled
timing defaults
```

## Not stored here

- credentials;
- API keys;
- certificate PINs;
- fiscal secrets;
- arbitrary CSS;
- logos/assets;
- user permissions;
- entitlements.

Branding stays in the dedicated Branding capability.

## Authorization

Settings updates require explicit domain permissions such as:

```text
settings.manage
schedule.settings.manage
inventory.settings.manage
```

## Versioning

Every namespace has `schemaVersion`.

If a settings schema changes incompatibly:

- define migration/defaulting behavior;
- preserve old data until conversion succeeds;
- test upgrades.

## Tests

Required:

- defaults when namespace row is absent;
- rejection of unknown/invalid fields;
- tenant isolation;
- permission enforcement;
- migration/version compatibility;
- no secret fields accepted.
