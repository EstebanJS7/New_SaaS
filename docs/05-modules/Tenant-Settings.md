---
type: module
module: tenant-settings
status: planned
updated: 2026-11-10
---

# Module — Tenant Settings

## Responsibility

Provide validated, versioned, tenant-scoped configuration for reusable
behavioral settings.

## Does Not Own

- secrets;
- branding assets/tokens;
- entitlements;
- permissions;
- fiscal credentials.

## Planned Capabilities

```text
get typed namespace
update typed namespace
return defaults when absent
validate schema/version
audit configuration changes when required
```

## Initial Namespaces

See [[Tenant Settings]].

## Security

- tenant scoped;
- backend-only write validation;
- explicit permissions;
- no unknown settings keys;
- no secret values.

## Staff Web Surface

- `/api/settings/:namespace` (web BFF) proxies `GET`/`PUT` for exactly `sales`,
  `scheduling`, `portal` and `notifications`; any other namespace is `404`
  without an upstream call, extra segments `404`, encoded segments `400`.
- «Configuración › General» (`/app/settings/general`, [[CFG-001]]) shows one
  section per namespace and saves a partial patch with only the changed keys.
  Sections are offered by the namespace's permission and, for `sales` and
  `portal`, its feature, when the caller's claims are known (UX only; the shell
  does not load them yet, so every section shows and the API refuses).
- The Agenda section edits only `conflictPolicy`; availability windows and
  blocks are never sent from it.
- The web mirrors the reminder lead-hour bounds and channels of
  `@newsaas/notifications`; a web test reads that package's source to pin them.

## Related Architecture

- [[Tenant Settings]]
- [[Data Classification and Retention]]
