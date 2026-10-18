---
id: NOTIF-004
type: story
title: The transactional surface and the permissions family
epic: EPIC-17
status: done
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
  bounded page, and one delivery with its attempt summary ([[TD-046]]).
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

- [x] The list is tenant-scoped and **bounded**: the contract carries a page
      limit, the default is small, an oversized request is refused or clamped,
      and the query orders deterministically. [[TD-026]] is not worsened.
- [x] Filters are allowlisted (status, channel, and the source reference), an
      unknown filter value is refused, and no filter accepts a `tenantId`.
- [x] A single delivery is readable by its identifier within the caller's
      tenant; a foreign or unknown identifier returns a byte-equivalent
      `404 NOT_FOUND` and reveals nothing about the other tenant's record.
- [x] The attempt **summary** is readable for one delivery: how many attempts
      ran, when the last one ran, and its bounded reason code and message -
      ordered and bounded like the rest of the read. **Amended by the maintainer
      on 2026-10-17.** This criterion first read "the attempt history is
      readable for one delivery, ordered, and bounded", which the aggregate this
      Story reads **does not model**: [[NOTIF-001]] keeps a summary, because
      retrying is BullMQ's own retry rather than a domain transition, and there
      is no attempt table and no audit row per try. Serving a history would need
      a new table, a migration and a decision about storing the provider's raw
      error - RESTRICTED material this epic has kept out of every stored field,
      DTO and log line. Given the choice between opening that scope inside a
      read Story and recording it, the maintainer amended the criterion, and the
      missing log is [[TD-046]] with its options and real costs.
- [x] **No contact datum and no message content appear in any response**: the
      DTO is an allowlist, and an assertion proves the response body has no
      recipient address, no phone number and no message body.
- [x] No Prisma model is returned: the response is an explicit DTO.
- [x] Every route enforces `notifications.delivery.read`, the service re-asserts
      it as defense in depth, and a request without the key is refused.
- [x] The route-contract probe pins the new route with its permission key and
      its deny-by-default behavior.
- [x] The staff surface renders loading, empty, error, success and
      permission-denied states, and a failed delivery shows its sanitized reason
      code rather than a raw provider message.
- [x] Every reusable component in the surface consumes semantic branding tokens;
      no project-specific color, radius or font literal enters a shared
      component.
- [x] Tenant isolation is enforced when applicable. Evidence: the
      byte-equivalent foreign/unknown `404` cases and the live-PostgreSQL block.
- [x] Backend authorization is enforced when applicable. Evidence: the
      deny-by-default route pin and the permission sweep.
- [x] Required loading/error/empty/success UX exists. Evidence: the surface's
      own state cases.
- [x] Required audit exists. Evidence: not applicable — reads are not audited,
      and PRD §27 does not list a notification delivery among the critical
      audited actions.
- [x] Tests required by the Story pass.

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
GET /notifications/deliveries/:id        (one delivery and its attempt summary)
```

Two deviations from what this Story first declared, both stated rather than
absorbed:

- the single read returns the attempt **summary** the aggregate holds, not a
  history (see the open AC above);
- the list's filter set is exactly `status`, `channel`, `sourceType`, `sourceId`
  and `limit`, all closed, and **none of them is a tenant selector** — the
  tenant comes from the request context on every path.

### Changed

```text
None yet
```

A generic status-update route is never added: `ENGINEERING-RULES.md` forbids it,
and the epic's transitions are commands, not patches.

## Database

### Migration

```text
None.
```

**Corrected during implementation**: the key is REFERENCE DATA, not a migration.
Permission keys live in the seed-owned catalog (`reference-seed.ts`) and are
applied by the existing seeder, exactly like `notifications.settings.manage` in
[[NOTIF-003]]. Declaring a migration here described a mechanism this codebase
does not use for permissions.

### Models/Tables

- No new model. Reads over `notification_delivery` from [[NOTIF-001]].
- Permission seed catalog — the `notifications.delivery.read` key and its role
  matrix row, completing the `notifications.*` family.

## UI

- One staff view over the tenant's deliveries: a bounded list with status and
  channel, filters, the source reference, and one delivery's attempt summary.
- Semantic tokens only; no Veterinary brand literal and no tenant-specific CSS
  in a reusable component.
- Loading, empty, error, success and permission-denied states are required, not
  optional.

## Implementation Summary

WU-E is implemented, with one Acceptance Criterion open by decision rather than
by omission.

**The read contract** is two GET routes over `notification_delivery`:
`GET /notifications/deliveries` (bounded, allowlisted filters) and
`GET /notifications/deliveries/:id`. The list's query is a **closed** zod schema
— `status`, `channel`, `sourceType`, `sourceId`, `limit` — so an unknown key is
refused rather than ignored, `limit` is bounded at 1..100 with a default of 50,
and an oversized value is refused rather than silently clamped. The order is
deterministic (`scheduledAt` descending, then `id`), so a page is a page.

**The projection is an allowlist.** The service selects a named column set and
maps each row into an explicit DTO; nothing serializes a Prisma model, and the
recipient is a **reference** (`recipientId`), never the contact datum the
channel boundary resolves at send time. Message content cannot leak because it
is never stored ([[NOTIF-003]] builds it at send time).

**The permission** is `notifications.delivery.read`, seeded for all six roles —
the same reach every other `*.read` key has — and asserted twice: by the route's
decorator and again in the service, which resolves the caller's effective keys.

**There is no command route, and its absence is the design.** This epic adds no
delivery transition from the surface and `ENGINEERING-RULES.md` forbids a
generic status patch, so the family has a read key and deliberately **no**
`delivery.manage` key: a permission guarding a command nobody can call is one no
operator can be denied by. The suite proves the absence.

**The surface** is one staff view plus a read-only BFF. The list renders five
distinct states — loading, permission-denied, error, empty, content — and a
denial is its own state, never a retryable error. A failed delivery shows its
recorded, already-bounded reason instead of a raw provider message.

## Verification

## Verification

```text
pnpm format-check                   clean
pnpm lint                           22/22 packages
pnpm typecheck                      22/22 packages
pnpm build                          13/13 packages
@newsaas/api test                   1269 passed (91 files)
@newsaas/web test                   1100 passed (101 files)
@newsaas/database test              512 passed
@newsaas/notifications test         81 passed
```

## Tests Added

```text
apps/api/src/notifications/notification-delivery.service.test.ts   11 cases
apps/api/src/notifications/notification-delivery.read.integration.test.ts  10 cases
apps/web/src/app/(app)/app/notifications/notifications-surface.test.tsx     6 cases
apps/web/src/app/api/notifications/[[...path]]/route.test.ts                7 cases
```

- The bounded list: the default bound and the requested bound, asserted **on the
  arguments the service passes to Prisma**, plus the deterministic order; the
  oversized and non-integer refusals at the schema.
- Filter allowlisting: the source reference reaches the predicate, an unknown
  key is refused, an unknown status, channel or source type is refused, and a
  `sourceId` that is not a whole uuid is refused (a prefix search would be an
  unbounded scan dressed as a filter).
- Byte-equivalent cross-tenant `404`s for the single read, through the shared
  `expectCrossTenant404` fence, with the foreign delivery's ids in the
  forbidden-identifier list.
- The source-reference filter does **not** widen the tenant predicate: the same
  appointment id seeded in two tenants returns only the caller's row.
- The RESTRICTED-absence assertion: a row carrying `messageBody` and
  `contactValue` is mapped, and neither value appears in the serialized
  response; the exposed key set is asserted exactly.
- The permission: a caller without the key is refused `403` on both routes, and
  the service refuses it too.
- The deny-by-default route pin for `notifications.delivery.read`, and the
  absence of a command route on the surface.
- The surface's five states, and the BFF's own allowlist, 401 and pass-through.

**One limit of the evidence, stated rather than implied**: the in-memory Prisma
harness applies the predicate but not `take`/`orderBy`, so the bound and the
ordering are proven on the service's arguments, not end to end. The tenant
predicate, the permission chain, the query refusals and the response shape ARE
proven over real HTTP.

## Known Limitations

- **No attempt history exists to read** (the open AC above). What the surface
  can show is the aggregate's summary: how many attempts, when the last one ran,
  and its bounded reason code. An operator diagnosing a repeated failure sees
  the LAST outcome, not the sequence.
- **The surface does not embed into the appointment or invoice screens**: a
  delivery is reachable only from the notifications list. [[DEC-059]] declares
  that crossing boundary debt rather than opening it here.
- **Nothing in the surface is audited**, and that is correct rather than
  missing: PRD §27 does not list a delivery read among the critical audited
  actions.
- **A `FAILED` delivery is visible but not fixable from the surface**: there is
  no re-drive command, so an operator can diagnose a failure and not retry it.
  This is the same shape as the fiscal epic recording its own re-drive as
  [[TD-029]] rather than inventing a primitive.
- No delivery status inside the appointment or invoice detail screens; the list
  is the only surface, and the crossing stays emitter-only.

## Technical Debt

- [[TD-046]] — **the attempt log this Story cannot serve**: a real gap in the
  read surface, raised by implementing it and recorded with its options and
  costs.
- [[TD-047]] — **the two advisories `review-a12969035780ff93` left**, with
  readings: the BFF answers `404` for an unlisted query key where the API
  answers `400`, and the detail read has no denial state of its own. Both
  non-blocking; the review approved this candidate on the first pass.

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

**Status stays `in-progress` for exactly one reason**: the attempt-history AC is
open, and it is open because answering it changes scope.

**The decision, taken.** The attempt-history criterion is **amended** rather
than implemented, and the missing log is [[TD-046]], where the options, their
real costs and the classification consequence are recorded. The maintainer's
reasoning, in short: the aggregate a previous Story already reviewed chose a
summary; retrying is BullMQ's retry rather than a domain transition; and an
attempt table would be a second home for the same truth, where the count and the
last outcome could disagree. Opening a RESTRICTED storage question inside a read
Story would have been scope taken rather than granted.

Every criterion in this Story is therefore satisfied, and this Story is `done`.

**Reviewed.** `review-a12969035780ff93` closed **approved on the first pass** —
one lens (`review-reliability`), medium tier, 23 files, 1993 changed lines, no
correction transition offered — and the acknowledgement burned its authority.
Its two advisories are [[TD-047]].

**A correction made while implementing**: this Story declared "one additive
migration" for the permission key. Permission keys are seed-owned reference data
in this codebase, applied by the existing seeder, so no migration is involved —
the Database section above records the correction instead of leaving a plan that
does not match the mechanism.
