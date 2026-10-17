---
id: NOTIF-004
type: story
title: The transactional surface and the permissions family
epic: EPIC-17
status: planned
priority: medium
depends_on:
  - NOTIF-001
  - NOTIF-003
prd_sections:
  - "24"
  - "27"
  - "28"
  - "41"
permissions:
  - notifications.delivery.read
branch:
created: 2026-10-17
updated: 2026-10-17
---

# NOTIF-004 — The transactional surface and the permissions family

## Objective

Make a delivery's outcome observable to the tenant: which notifications were
intended, on which channel, in which state, and — when one failed — why. Plus
the `notifications.*` permission family that guards it.

## Context

- [[NOTIF-001]] creates the record, [[NOTIF-002]] sends through the port and
  [[NOTIF-003]] schedules the reminder. None of them exposes anything.
- `ENGINEERING-RULES.md`: backend authorization is mandatory, portal and staff
  policies are separate, business logic belongs in services rather than
  controllers, and Prisma models are never returned directly from a public API.
- `ENGINEERING-RULES.md` also requires backend validation and explicit state
  transitions. This Story adds **no** transition: it reads, and the only
  transitions in this epic were already named by [[NOTIF-001]] and
  [[NOTIF-003]].
- [[TD-026]] records unbounded list endpoints as open debt. A new list surface
  must not worsen it, so this one is bounded by contract from the start.
- PRD §41: the recipient's contact datum is **RESTRICTED**. A read surface is
  exactly where such a field leaks by accident, so its absence is asserted
  rather than assumed.

## In Scope

- The tenant-scoped read contract over deliveries: list with filters and a
  bounded page, and one delivery with its attempt history.
- DTOs, allowlisted, with no contact datum and no message content.
- The `notifications.delivery.read` permission, its seed row and its route pin.
- Tenant isolation and byte-equivalent cross-tenant `404`s.
- The staff surface: the list view with its loading, empty, error, success and
  permission-denied states, consuming semantic branding tokens.
- The RBAC route-contract probe entry for the new route.

## Out of Scope

- **A `notifications.delivery.manage` key.** No command exists to guard:
  [[NOTIF-001]] deliberately excludes a manual re-drive, and this epic adds no
  other delivery transition from the surface. Seeding a key with nothing behind
  it would be a permission nobody can enforce. The family is therefore
  `notifications.delivery.read` + `notifications.settings.manage`
  ([[NOTIF-003]]), and the missing re-drive is a recorded limitation, not a
  permission.
- Any write, retry, cancel or delete from the surface.
- Resending a message, editing a message, or previewing a message body.
- Embedding a delivery status into the appointment or invoice detail screens.
  That would widen the EPIC-07/EPIC-16 crossing beyond emitter-only boundary
  debt ([[DEC-059]]) and is a separate unit if it is wanted.
- A portal surface. The customer sees their appointments and documents, not the
  tenant's delivery log.
- Reports or analytics over deliveries — [[EPIC-18]].

## Acceptance Criteria

- [ ] The list is tenant-scoped and **bounded**: the contract carries a page
      limit, the default is small, an oversized request is refused or clamped,
      and the query orders deterministically. [[TD-026]] is not worsened.
- [ ] Filters are allowlisted (status, channel, and the source reference), an
      unknown filter value is refused, and no filter accepts a `tenantId`.
- [ ] A single delivery is readable by its identifier within the caller's
      tenant; a foreign or unknown identifier returns a byte-equivalent
      `404 NOT_FOUND` and reveals nothing about the other tenant's record.
- [ ] The attempt history is readable for one delivery, ordered, and bounded.
- [ ] **No contact datum and no message content appear in any response**: the
      DTO is an allowlist, and an assertion proves the response body has no
      recipient address, no phone number and no message body.
- [ ] No Prisma model is returned: the response is an explicit DTO.
- [ ] Every route enforces `notifications.delivery.read`, the service re-asserts
      it as defense in depth, and a request without the key is refused.
- [ ] The route-contract probe pins the new route with its permission key and
      its deny-by-default behavior.
- [ ] The staff surface renders loading, empty, error, success and
      permission-denied states, and a failed delivery shows its sanitized reason
      code rather than a raw provider message.
- [ ] Every reusable component in the surface consumes semantic branding tokens;
      no project-specific color, radius or font literal enters a shared
      component.
- [ ] Tenant isolation is enforced when applicable. Evidence: the
      byte-equivalent foreign/unknown `404` cases and the live-PostgreSQL block.
- [ ] Backend authorization is enforced when applicable. Evidence: the
      deny-by-default route pin and the permission sweep.
- [ ] Required loading/error/empty/success UX exists. Evidence: the surface's
      own state cases.
- [ ] Required audit exists. Evidence: not applicable — reads are not audited,
      and PRD §27 does not list a notification delivery among the critical
      audited actions.
- [ ] Tests required by the Story pass.

## Domain Invariants

- A read never mutates a delivery.
- The surface is tenant-scoped from the server-side request context; no request
  input can select a tenant.
- Nothing RESTRICTED is serialized. The read boundary is allowlist-shaped.
- No staff policy is shared with a portal policy.

## API

### Added

```text
GET /notifications/deliveries            (bounded list, allowlisted filters)
GET /notifications/deliveries/:id        (one delivery with its attempt history)
```

### Changed

```text
None yet
```

A generic status-update route is never added: `ENGINEERING-RULES.md` forbids it,
and the epic's transitions are commands, not patches.

## Database

### Migration

```text
Planned: one additive migration seeding the notifications.delivery.read permission key
```

Additive, and it alters no existing row.

### Models/Tables

- No new model. Reads over `notification_delivery` from [[NOTIF-001]].
- Permission seed catalog — the `notifications.delivery.read` key and its role
  matrix row, completing the `notifications.*` family.

## UI

- One staff view over the tenant's deliveries: a bounded list with status and
  channel, filters, and one delivery's history.
- Semantic tokens only; no Veterinary brand literal and no tenant-specific CSS
  in a reusable component.
- Loading, empty, error, success and permission-denied states are required, not
  optional.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- The bounded list: default bound, refusal or clamp of an oversized request, and
  deterministic ordering.
- Filter allowlisting, including the refusal of a `tenantId` filter.
- Byte-equivalent cross-tenant `404`s for the single read.
- The RESTRICTED-absence assertion over the serialized response.
- The deny-by-default route pin for `notifications.delivery.read`.
- The surface's five states.

## Known Limitations

- **A `FAILED` delivery is visible but not fixable from the surface**: there is
  no re-drive command, so an operator can diagnose a failure and not retry it.
  This is the same shape as the fiscal epic recording its own re-drive as
  [[TD-029]] rather than inventing a primitive.
- No delivery status inside the appointment or invoice detail screens; the list
  is the only surface, and the crossing stays emitter-only.

## Technical Debt

- None yet; anything raised by the implementation is recorded here and triaged
  at [[NOTIF-005]].

## Decisions / ADRs

- [[DEC-058]] — the entitlement decision this surface does not contradict: the
  read route is permission-gated, not feature-gated, and it exposes no WhatsApp
  content.
- [[DEC-059]] — the boundary-debt boundary this Story respects by not embedding
  into the closed epics' screens.
- No new ADR: this Story adds a read contract, one permission and one view.

## Files / Modules

- `apps/api/src/notifications/` — the read service, its DTOs and its controller.
- `apps/web/` — the staff view and its query hooks.
- `packages/database/src/reference-seed.ts` — the permission key.
- `docs/05-modules/RBAC.md` and the route-contract probe — the new pin.

## Completion Notes

_Status must remain non-done until all required gates pass._
