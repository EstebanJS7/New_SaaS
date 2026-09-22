---
type: module
module: portal
status: implemented
updated: 2026-09-21
---

# Module — Portal

## Responsibility

An isolated, first-party customer portal for one account holder per Customer: a
portal identity with its own credential, session, `ns_portal_session` cookie and
guard (fully separate from staff); holder-owned read projections of pets, a
pet's allowlisted clinical summary and vaccinations, and the holder's own
appointments; availability offered as a union across every in-tenant
`VETERINARIAN`; booking requests that stay pending until a staff decision;
phone/address self-service; and cancel/reschedule of the holder's own
appointment. Every route is tenant- and holder-scoped, gated on the `portal`
entitlement, and mutations are audited with a `PORTAL` actor.

## Does Not Own

- Staff authentication, sessions, RBAC, the staff shell or staff navigation.
  Portal and staff are separate security boundaries; portal routes carry no
  staff permission metadata.
- Email corrections, invitation, verification, magic-link or recovery (EPIC-17).
  The portal login id is the staff-managed `contactEmail`, and email changes
  stay staff-operated.
- Staff booking decisions (`approve`/`reject`) and the `Appointment` lifecycle,
  which belong to Scheduling. The portal submits requests and cancels or
  reschedules only through the shared scheduling invariants.
- Customer, Patient, Clinical, Branch or Membership identity (Core and the
  veterinary verticals).
- Invoices, documents, files and notifications (EPIC-14/§25, EPIC-17).

## Public Capabilities

- Portal login (`tenantSlug` + `contactEmail` + password) issuing the hardened
  portal cookie, `logout`, and a server-derived identity probe (`me`).
- Holder reads: own pets, pet detail (allowlisted `clientSummary` + vaccination
  history), own appointments, own booking requests, own profile.
- Availability as a union across every in-tenant `VETERINARIAN` for a date and
  duration.
- Booking requests: create (always pending), list, cancel.
- Appointment cancel and reschedule, restricted to `SCHEDULED`/`CONFIRMED`.
- Profile self-service: primary phone channel and active address.
- Staff portal-access administration: provision and revoke a Customer's single
  active holder.
- Staff booking-request decision surface: list, approve, reject.
- A portal-only web surface (branded shell, nav, pets, pet detail, booking,
  appointments, profile) and a strict portal web proxy.

## Main Entities

- `CustomerPortalAccess` — `tenantId`, `customerId`, `contactEmail` (the login
  id), `status` (`ACTIVE`/`REVOKED`). One active holder per Customer and per
  login email are enforced by partial unique indexes.
- `PortalCredential` — shared primary key with the access row; a **RESTRICTED**
  argon2id password hash read only by the login verification path.
- `PortalSession` — unique `tokenHash` (SHA-256 of an opaque token), rolling
  idle window, absolute ceiling, `revokedAt`; `CASCADE` from the access row.
- `PortalBookingRequest` — `tenantId`, `customerId` (the submitting owner),
  `patientId`, `status`, `startAt`/`endAt`; `(tenantId, id)` is a tenant key.
- `Appointment` provenance — `source` (`STAFF`/`PORTAL`, default `STAFF`) plus a
  nullable unique `portalBookingRequestId`.
- `AuditLog` — `PORTAL` actor type plus nullable `actorPortalAccessId`.

## State Transitions

```text
PENDING --approve (staff)--> APPROVED   (creates exactly one PORTAL appointment)
PENDING --reject  (staff)--> REJECTED
PENDING --cancel  (holder)--> CANCELLED
```

All three target states are terminal. Nothing auto-confirms: a request becomes
an active appointment only through the staff approval command. Appointment
cancel/reschedule reuse the Scheduling transition table and the
version-plus-status compare-and-set, so an illegal state returns the same
`409 CONFLICT` the staff path returns.

## Permissions

- **Portal routes declare none.** The route-contract probe pins that no
  `/portal/*` route carries `@RequirePermissions`; the `PortalAuthGuard`
  enforces the portal session and the `portal` entitlement instead.
- `portal.access.manage` — staff provisioning/revocation of portal access
  (seeded and granted to OWNER/ADMIN).
- `portal.settings.manage` — writes to the typed `portal` namespace.
- `scheduling.appointment.manage` — staff booking-request decisions, re-asserted
  in the service as defense in depth.
- The `portal` entitlement gates every `/portal/*` route **and** portal-access
  provisioning/revocation.

## API

Portal surface (unprefixed `/portal/*`, DEC-002 defers `/api/v1`):

- `POST /portal/login` (the only `@Public` portal route), `POST /portal/logout`,
  `GET /portal/me`.
- `GET /portal/pets`, `GET /portal/pets/:id`.
- `GET /portal/appointments`, `GET /portal/appointments/:id`.
- `GET /portal/availability?date&durationMinutes[&stepMinutes]`.
- `POST /portal/pets/:id/bookings`, `GET /portal/bookings`,
  `POST /portal/bookings/:id/cancel`.
- `POST /portal/appointments/:id/cancel`, `PUT /portal/appointments/:id`.
- `GET|PUT /portal/profile`.

Staff routes that stay **off** the portal surface:

- `POST /customers/:customerId/portal-access` and
  `POST /customers/:customerId/portal-access/revoke`.
- `GET /booking-requests`, `POST /booking-requests/:id/approve`,
  `POST /booking-requests/:id/reject`.

Web proxy:

- `GET|POST|PUT /api/portal/[...path]` — a method-aware allowlist that forwards
  only the shipped portal shapes, rebuilds the availability query from its three
  contract keys, rejects percent-encoded/unknown/nested non-UUID paths, and
  forwards **only** the portal cookie plus `x-request-id`. The staff cookie is
  never read, and login/logout, the deferred surfaces and the staff
  booking-status routes are deliberately not forwardable.

## Events / Jobs

- None. `AppointmentConfirmed` and `AppointmentCancelled` are intentionally not
  emitted for portal booking or approval; the request and the appointment are
  explicit application commands.

## Audit Attribution

The "field names only" rule holds for the holder's **business mutations**:
booking-request create and cancel (`portal_booking.requested` / `.cancelled`),
profile update (`portal_profile.updated`), and appointment cancel and reschedule
(`appointment.cancelled` / `appointment.rescheduled`). Each appends exactly one
`PORTAL`-attributed row (`actorPortalAccessId`, never a staff actor),
co-committed with the mutation, whose metadata carries the schema version and
changed field **names** — never a phone number, address or time value.

It does **not** hold everywhere on this surface:

- **Login** appends a `PORTAL`-attributed row on success
  (`portal.login_succeeded`) and a `PORTAL`- or `SYSTEM`-attributed row on
  failure (`portal.login_failed`). Its metadata carries the submitted **email**
  — an INTERNAL identifier value, not a field name. No credential is recorded.
- **Logout** revokes the session with **no** audit row.
- **Staff** provisioning/revocation (`portal_access.provisioned` / `.revoked`)
  and the booking decisions (`portal_booking.approved` / `.rejected`) append
  **STAFF**-attributed rows (`actorUserProfileId`), not `PORTAL` ones.
- The read endpoints and the availability read write nothing and append nothing.

## Invariants

- **Two identities, never interchangeable.** `PortalAuthGuard` (registered
  globally last) enforces only the `/portal/*` surface; the three staff guards
  symmetrically skip it. The portal guard reads only `ns_portal_session` and the
  staff chain only `ns_staff_session`, so neither cookie can authorize the
  other's routes. Resolution is authentication **then** entitlement: an
  anonymous request is always `401 UNAUTHENTICATED`; only an authenticated
  holder receives `403 FEATURE_NOT_ENTITLED`.
- **Server-derived scope.** Tenant, Customer and portal access id come only from
  the session's own access row via `RequestContextService`; a `tenantId`,
  `customerId`, contact id or address id supplied in a path, query, header or
  body is never read (and is rejected as `400 VALIDATION_FAILED` on the profile
  and booking DTOs).
- **Byte-equivalent 404.** Every non-owned, cross-tenant or unknown reference
  returns one shared `NOT_FOUND` shape (`portal-holder-scope.ts`), so a holder
  cannot probe for the existence of another Customer's or tenant's resources.
- **One active holder per Customer and per login email.** Both are enforced by
  partial unique indexes; a concurrent provision maps `P2002` to the matching
  `409 CONFLICT` rather than a `500`.
- **Booking stays pending; approval is idempotent.** A request never occupies
  the overlap ledger (overlap reads `appointment` only). Approval runs the
  shared creation invariants (anchors, availability/blocks, advisory lock and
  overlap under `REJECT`) and the `(tenantId, portalBookingRequestId)` unique
  makes a repeated approval resolve to the existing `PORTAL` appointment.
- **Reschedule is version-guarded.** Cancel consults the shared transition
  table; reschedule calls the shared availability, block, advisory-lock/overlap
  and version-plus-status helpers, so a stale version or a lost race is the
  staff `409` and persists nothing.
- **Audit-or-nothing on business mutations.** The holder's booking, profile and
  appointment mutations append exactly one co-committed `PORTAL` audit row with
  stable IDs and field names only; see "Audit Attribution" for the auth, logout,
  staff and read paths where that rule does not apply.
- **Availability is a one-way contract.** Every offered slot is a slot the write
  path accepts for some in-tenant `VETERINARIAN`; the converse deliberately does
  not hold. The union offers strictly less in four documented cases: (1) it
  excludes any active overlap even under `conflictPolicy: ALLOW`, where the
  write path permits the double booking; (2) it tiles a single global grid
  anchored at the earliest contributing range, so a window whose first start
  falls off that grid is not guaranteed to be offered at that minute; (3) for a
  professional with windows, only branches where it has windows are evaluated,
  so a window-less branch the write path treats as unrestricted is not offered;
  (4) a one-off block on any of a window-less professional's block branches
  withholds the slot, because the holder picks no branch. A non-existent local
  minute (DST gap) yields no slot at all.
- **Ownership asymmetry (load-bearing).** A booking **request** is scoped by the
  row's own stored `(tenantId, customerId)`: it is the holder's own submission,
  so it stays visible and cancellable after the guardian link to its pet is
  revoked. An **appointment** is scoped through the holder's **active** guardian
  chain: it stops being actionable as soon as that link is revoked. The two
  rules are deliberately different and must not be "unified".
- **Primary-phone convention is application-level.** `customer_contact` has no
  partial unique index for primacy, so the profile upsert writes the primary
  phone and demotes the holder's other `PHONE` rows in the same transaction.
  This is correct for a single writer but not sufficient under concurrency — see
  [[DEC-006]].

## Data Classification

- Pet, clinical, appointment, availability, booking and profile payloads are
  **CONFIDENTIAL**. They are returned through explicit allowlists that never
  echo `tenantId`/`customerId`, never expose `internalNotes` or the staff
  clinical free text, and never expose appointment provenance
  (`source`/`portalBookingRequestId`), the assigned professional, the branch or
  a staff actor. Logs carry stable IDs only.
- `portal_credential.password_hash` is **RESTRICTED** and never leaves the login
  verification path.
- The login `email` recorded in audit metadata is **INTERNAL** identifier data,
  never a credential.

## Known Limitations / Residual Risks

- **Contact details cannot be removed from the portal.** Clearing a field sends
  an absent key, and the API treats absent as "leave untouched", so the cleared
  value is kept and restored on the next read. The form states this plainly
  instead of implying removal. Lifting it needs an explicit clear operation in
  the API with its own mutation and audit contract.
- **Only the most recently updated active address is written.** The profile
  update targets the holder's most recently updated active address, so a holder
  with several addresses cannot choose between them from the portal.
- **The form's `maxLength` is a convenience, not the contract.** The server is
  the authority; the client mirrors the API's per-field limits and re-checks
  every one in validation, because `maxLength` alone would not stop an
  over-length value.
- **Species/breed names are unresolved.** The pet projection returns
  `speciesId`/`breedId` as stable ids and there is no holder-facing catalog
  route, so `pet-facts.ts` intentionally renders nothing for them rather than a
  raw UUID or an invented fixture.
- **`bookingRequiresApproval` is registered but not consumed.** The typed
  `portal` namespace validates and stores the boolean (default `true`), but the
  booking flow always requires staff approval; no code path reads the setting
  yet.
- **`INTERNAL` `DomainError` messages reach the client.** The global exception
  filter echoes `DomainError.message` verbatim for every code, so the portal
  integrity-breach messages (for example "Appointment references a patient that
  cannot be resolved.") are returned in the 500 body. They carry no identifiers,
  and the sanitized generic copy applies only to non-`DomainError` throws.
- **No E2E gate.** Portal UX is covered by Vitest + testing-library only
  ([[TD-007]]); the web Vitest config raises no hook/test timeout, so component
  suites that boot under full-repo parallel load are timing-sensitive.
- **Single-replica rate limiter.** Portal login shares the in-process limiter
  with a namespaced key ([[TD-005]]).

## Verification

- `apps/api/src/portal/portal-auth.integration.test.ts` and
  `portal-access.integration.test.ts` — cross-cookie `401`, entitlement `403`,
  one-active-holder/email `409`, foreign-Customer `404`, revocation sweep.
- `apps/api/src/portal/portal-read.integration.test.ts` — allowlisted pet/pet
  detail/appointment projections, `internalNotes` absence in body and logs,
  byte-equivalent `404`, malformed-id `400`.
- `apps/api/src/portal/portal-availability.integration.test.ts` — union
  semantics, write-path agreement in both directions, the conservative
  behaviours, and the sanitized 500 body.
- `apps/api/src/portal/portal-booking.integration.test.ts` and
  `portal-booking-read.integration.test.ts` — pending creation, owner-scoped
  cancel, no-appointment/no-ledger proof, and the integrity-breach 500.
- `apps/api/src/portal/portal-profile.integration.test.ts` — strict allowlist,
  identity-hint rejection, sibling demotion, and audit co-commit.
- `apps/api/src/portal/portal-appointment-write.integration.test.ts` — cancel
  and reschedule state/version rules, ownership re-validation, byte-equivalent
  `404`, and audit rollback.
- `apps/api/src/scheduling/booking-requests.integration.test.ts` — the staff
  decision surface, idempotent approval and provenance.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the pinned `/portal/*`
  inventory, the staff-metadata-free fence, and login as the only `@Public`
  portal route.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — "EPIC-08 portal identity
  application-path isolation" and "EPIC-08 WU5 portal write concurrency and
  isolation": real PostgreSQL 16, deterministic barriers, one approval winner,
  one reschedule winner, one cancel winner, byte-equivalent foreign `404` and
  the revoked-guardian `404`.
- `apps/web/src/app/api/portal/[[...path]]/route.test.ts` — proxy allowlist,
  query policy and portal-cookie-only forwarding; the portal component suites
  cover the UI states (`profile/portal-profile.test.tsx` for the profile read
  and write form); `portal-no-staff-imports.test.ts` enforces no staff chrome.
- WU5 durable run (2026-09-21): full live-PG suite **40/40 passed** at `27bc04a`
  (merge of PR #53), including the portal write-race block, in the
  `Database migrations` job's fresh PG16 container.

## Related Stories

- EPIC-08 change (archived): `openspec/changes/archive/2026-09-21-epic-08/`. Its
  spec deltas are merged into the standing specs — `portal-management` created;
  `scheduling` and `tenant-settings` updated.

## Related ADRs

- [[ADR-001 Modular Monolith]]

## Related Decisions

- [[DEC-002]] (unprefixed `/portal/*`), [[DEC-006]] (primary-phone uniqueness),
  [[DEC-007]] (availability union, portal booking, cancel/reschedule),
  [[DEC-008]] (first-party portal identity — the PRD §8 deviation).
