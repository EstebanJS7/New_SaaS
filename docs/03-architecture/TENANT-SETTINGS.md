---
type: architecture
status: implemented
updated: 2026-08-26
---

# Tenant Settings

## Goal

Allow each tenant to configure reusable business behavior without scattering
booleans, JSON reads and product-specific conditions throughout the codebase.

## Model

Implemented persistence:

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
  @@map("tenant_setting_namespace")
}
```

The JSON value is **not untyped application data**.

All access goes through the code registry in
`apps/api/src/settings/registry.ts`.

## Registry

Backend-owned definitions live in `apps/api/src/settings/registry.ts` (NOT
`packages/shared`). Each definition carries:

```ts
interface SettingsDefinition<T> {
  namespace: SettingsNamespace;
  version: number;
  schema: z.AnyZodObject; // closed .strict() object
  defaults: T;
  requiresFeature?: string; // entitlement gate, optional
  requiredPermissionKey: string; // RBAC key for writes
}
```

Registry additions are validated at module load time against the seed-owned
permission and feature-code catalogs.

## Shipped v1 namespace

### sales

```ts
{
  namespace: "sales",
  version: 1,
  schema: z.object({
    defaultCurrency: z.string().regex(/^[A-Z]{3}$/),
    requireCustomerForInvoice: z.boolean(),
  }).strict(),
  defaults: {
    defaultCurrency: "PYG",
    requireCustomerForInvoice: false,
  },
  requiresFeature: "sales",
  requiredPermissionKey: "sales.settings.manage",
}
```

## Service API

```ts
await tenantSettings.get("sales");
await tenantSettings.update("sales", { requireCustomerForInvoice: true });
```

- `get` returns `defaults ⊕ stored`, with stored values defensively re-parsed
  through the schema.
- `update` validates the patch against the closed schema, merges it with the
  current row, and writes one row per `(tenantId, namespace)`.

Never:

```ts
tenant.settings["whatever"];
```

## HTTP Surface

- `GET /settings/:namespace` — authenticated-only (`@RequirePermissions()`);
  tenant is resolved from the request context; there is no `tenantId` selector.
  Reads never evaluate entitlements.
- `PUT /settings/:namespace` — declares `sales.settings.manage` and re-asserts
  `definition.requiredPermissionKey` inside the service as defense-in-depth. The
  namespace is scoped to the caller's tenant; there is no cross-tenant-
  addressable settings resource.

## Authorization and Entitlement Gate

Update flow order (design D5):

1. Registry lookup — unknown namespace ⇒ `NOT_FOUND`.
2. Entitlement check — when `requiresFeature` is set,
   `EntitlementsService.has()` must be true; false ⇒ `FEATURE_NOT_ENTITLED`
   before any persistence.
3. Schema validation — unknown field, wrong type, or secret-shaped field ⇒
   `VALIDATION_FAILED`, nothing persisted.
4. Upsert merged values stamped with registry `schemaVersion`.

Reads skip step 2. No code path in this epic creates entitlement grants.

## Audit

Every successful `update` emits one audit row:

| Action                       | Metadata                     |
| ---------------------------- | ---------------------------- |
| `settings.namespace_updated` | `{namespace, schemaVersion}` |

The row is appended inside the same `$transaction` as the upsert.

## Expansion Convention

Adding a new namespace requires:

1. A registry entry in `apps/api/src/settings/registry.ts`.
2. A seeded permission key (`PERMISSION_SEEDS`) named
   `<domain>.settings.manage`.
3. `@RequirePermissions("<domain>.settings.manage")` on the `PUT` controller.
4. A union-sync test proving the permission key and optional feature code exist
   in the seed catalogs.

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

## Versioning

Every namespace has `schemaVersion`.

If a settings schema changes incompatibly:

- define migration/defaulting behavior;
- preserve old data until conversion succeeds;
- test upgrades.

## Data Classification

- `TenantSettingNamespace.data` is **INTERNAL** tenant configuration.
- No secret fields are accepted by the closed schemas.
- Rows are tenant-scoped; there is no cross-tenant-addressable settings resource
  — a caller always reads or writes within their own tenant scope.

## Tests

Shipped coverage:

- defaults when namespace row is absent;
- rejection of unknown/invalid fields and secret-shaped payloads;
- tenant isolation (no cross-tenant-addressable resource);
- permission enforcement (read allowed, write denied without key);
- migration/version compatibility;
- entitlement gate (write denied without grant, allowed with explicit grant,
  starter plan grants nothing);
- audit row per successful update.

## Known Limitations

- v1 ships exactly one namespace (`sales`). Additional namespaces follow the
  expansion convention above.
- Tenant-isolation suites for settings run over the in-memory Prisma boundary;
  live-PostgreSQL evidence is tracked by [[TD-006]].

## Related Stories

- [[EPIC-02]] RBAC Enforcement / Entitlements / Tenant Settings (Batch B).
