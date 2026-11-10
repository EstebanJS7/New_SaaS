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
- The Agenda section has two saves. The policy form sends only `conflictPolicy`.
  The availability windows and blocks editor sends only `availability` and/or
  `blocks`, each changed list complete (the API replaces arrays whole); an
  unchanged list and `conflictPolicy` are never sent.
- Editor semantics, as the API's scheduling invariants read them
  (`apps/api/src/scheduling/appointment-invariants.ts`, `toZonedParts`,
  `isWithinAvailability`, `intersectsBlock`): `weekday` 0 is Sunday … 6
  Saturday; `startMinute`/`endMinute` are minutes past local midnight in the
  clinic timezone (`America/Asuncion`), entered as `HH:MM` with an end of
  `00:00` meaning `24:00` (1440); block `startsAt`/`endsAt` are UTC instants,
  entered and shown on the clinic wall clock through the agenda's `agenda-time`
  helpers (a nonexistent DST-gap time is refused).
- Professionals and branches come from `GET /appointments/options`
  (`scheduling.appointment.read`, held by every seeded role that holds
  `scheduling.settings.manage`): the clinic's VETERINARIAN memberships and
  branches, shared with the agenda's query cache. New rows take active branches.
  A row whose professional or branch is no longer listed shows «Profesional no
  disponible» / «Sucursal no disponible» and can still be edited or removed. If
  the stored lists are malformed or the options cannot be read, the editor does
  not offer editing.
- The web mirrors the reminder lead-hour bounds and channels of
  `@newsaas/notifications`; a web test reads that package's source to pin them.
- Browser lane: `apps/e2e/specs/tenant-settings.spec.ts` drives the four
  sections against the built apps and restores the demo tenant's settings whole
  afterwards (the namespace has no `DELETE`, so a tenant that had no row keeps
  one holding the values it was already served).

## Related Architecture

- [[Tenant Settings]]
- [[Data Classification and Retention]]
