# portal-management Specification

## Purpose

An isolated first-party customer portal for a single account holder per
Customer. A portal session grants the holder access only to their own pets and
an allowlisted clinical projection, lets them request appointments that staff
must approve, and lets them self-serve phone and address profile fields. Portal
and staff authorization are separate security boundaries.

Excluded and explicitly deferred: shared caregiver/adult access, email
invitation/verification/magic-link/recovery, notifications, invoices, documents,
files, service selection, and automatic booking confirmation. Staff own all
email corrections.

## Requirements

### Requirement: First-party, Customer-linked portal identity

A portal identity SHALL be a first-party credential distinct from staff
identity, SHALL link to exactly one in-tenant Customer, and SHALL use its own
credential and session records and its own session cookie name. The system SHALL
allow at most one active portal holder per Customer. Portal access SHALL be
provisioned and revoked by staff; self-service signup and email-based invitation
MUST NOT exist.

#### Scenario: Staff provisions portal access

- GIVEN staff with the portal access-management permission and an in-tenant
  Customer
- WHEN they provision portal access
- THEN one portal holder linked to that Customer is created and can authenticate
- AND no email is sent

#### Scenario: Second holder for the same Customer rejected

- GIVEN an active portal holder for a Customer
- WHEN a second portal holder is provisioned for that Customer
- THEN the response is 409 `CONFLICT` and nothing persists

#### Scenario: Cross-tenant Customer rejected

- GIVEN a Customer owned by another tenant
- WHEN staff provision portal access for it
- THEN the response is 404 `NOT_FOUND` and nothing persists

### Requirement: Separate portal security boundary

Portal routes SHALL be served by portal-only controllers guarded by a portal
session guard and portal policy; a staff session MUST NOT authorize a portal
route, and a portal session MUST NOT authorize a staff route. Portal requests
without a valid portal session SHALL return 401 `UNAUTHENTICATED`. Portal and
staff MUST NOT share a session cookie or accept each other's credentials.

#### Scenario: Anonymous portal request

- GIVEN no portal session
- WHEN any portal route is called
- THEN the response is 401 `UNAUTHENTICATED`

#### Scenario: Staff session cannot open portal routes

- GIVEN only a valid staff session
- WHEN a portal route is called
- THEN the response is 401 `UNAUTHENTICATED`

#### Scenario: Portal session cannot open staff routes

- GIVEN only a valid portal session
- WHEN a staff route is called
- THEN the response is 401 `UNAUTHENTICATED`

### Requirement: Portal entitlement gate

Every portal route and portal access provisioning SHALL require the tenant's
`portal` entitlement; when it is absent the response SHALL be 403
`FEATURE_NOT_ENTITLED` and nothing SHALL persist.

#### Scenario: Missing entitlement

- GIVEN a tenant without the `portal` grant
- WHEN any portal route is called
- THEN the response is 403 `FEATURE_NOT_ENTITLED`

#### Scenario: Granted entitlement

- GIVEN a tenant holding an explicit `portal` grant
- WHEN an authorized portal route is called
- THEN it is served normally

### Requirement: Holder-owned resource isolation

Portal reads and writes SHALL resolve tenant and holder from the authenticated
server-side portal context; `tenantId` or `customerId` from the request MUST NOT
be trusted. A holder SHALL access only resources reachable from their own
Customer through the guardian/pet ownership chain. Any UUID that is not
holder-owned, including any cross-tenant UUID, SHALL return a byte-equivalent
404 `NOT_FOUND`.

#### Scenario: Own pet

- GIVEN a holder-owned Patient
- WHEN the holder requests it
- THEN the response is 200 with the allowlisted projection

#### Scenario: Another Customer's pet in the same tenant

- GIVEN a Patient owned by a different Customer of the same tenant
- WHEN the holder requests it by UUID
- THEN the response is 404 `NOT_FOUND`

#### Scenario: Cross-tenant resource

- GIVEN a Patient or appointment owned by another tenant
- WHEN the holder requests it by UUID
- THEN the response is 404 `NOT_FOUND`

### Requirement: Allowlisted clinical projection

The portal SHALL expose only an allowlisted projection of a holder-owned pet:
patient identity, species/breed, clinical `clientSummary`, and vaccination
history. `internalNotes` and any other clinical free text MUST NOT appear in any
portal response, log, or UI. Invoices, documents, files, studies, treatments,
deworming, and weights MUST NOT be exposed in this epic.

#### Scenario: Pet detail is allowlisted

- GIVEN a holder-owned Patient with clinical records
- WHEN the holder requests the pet detail
- THEN only allowlisted fields are present and no `internalNotes` is returned

#### Scenario: Internal notes never leak

- GIVEN a clinical encounter with `internalNotes` for the holder's pet
- WHEN any portal response or log is inspected
- THEN `internalNotes` is absent and logs carry stable IDs only

#### Scenario: Non-allowlisted clinical kind not exposed

- GIVEN a holder-owned treatment or study record
- WHEN the holder requests it through the portal
- THEN the response is 404 `NOT_FOUND`

### Requirement: Portal appointments read and booking requests

A holder SHALL read only appointments for holder-owned pets. A booking request
SHALL be creatable only for a holder-owned pet and SHALL remain pending; it MUST
NOT become an active appointment until an authorized staff approval command
promotes it. Portal identities MUST NOT confirm, reschedule, cancel, or
transition any appointment, and MUST NOT select a service.

#### Scenario: Read own appointment

- GIVEN an appointment for a holder-owned pet
- WHEN the holder requests it
- THEN the response is 200 with the allowlisted projection

#### Scenario: Booking request stays pending

- GIVEN a holder-owned pet and a valid requested time
- WHEN the holder submits a booking request
- THEN it persists pending and audited, is not an active `SCHEDULED`
  appointment, and requires staff approval

#### Scenario: Portal cannot transition an appointment

- GIVEN any appointment
- WHEN a portal identity attempts confirm, reschedule, or cancel
- THEN the response is 403 `FORBIDDEN` and the state is unchanged

#### Scenario: Service selection rejected

- GIVEN a booking request containing a service or Catalog field
- WHEN it is validated
- THEN the response is 400 `VALIDATION_FAILED` and nothing persists

#### Scenario: Booking for a non-owned pet

- GIVEN a Patient that is not holder-owned
- WHEN the holder submits a booking request for it
- THEN the response is 404 `NOT_FOUND` and nothing persists

### Requirement: Phone and address profile self-service

A holder SHALL update only phone and address profile fields for their own
Customer. A payload containing email, name, kind, tax data, or another
Customer's identifiers MUST be rejected with 400 `VALIDATION_FAILED` and persist
nothing. Successful updates SHALL be validated, tenant-scoped, and audited.

#### Scenario: Update phone and address

- GIVEN a holder and valid phone/address values
- WHEN they submit a profile update
- THEN the values persist for their own Customer and one audit row is appended

#### Scenario: Email or out-of-scope field rejected

- GIVEN a profile payload containing an email or name change
- WHEN it is validated
- THEN the response is 400 `VALIDATION_FAILED` and stored values are unchanged

#### Scenario: Client-supplied profile target identifiers rejected

- GIVEN a holder and a payload, query or header carrying another Customer's
  identifiers (`customerId`, `tenantId`, a contact or address id, or
  `x-tenant-id`/`x-customer-id`)
- WHEN they submit a profile read or update
- THEN the response is 400 `VALIDATION_FAILED`, nothing persists, and no audit
  row is appended

Rationale: the profile routes are self-only — they carry no target id and always
operate on the holder's own session Customer — so a foreign target is not
expressible and there is no resource to answer `404` about. Rejecting the
identifiers is the fail-closed equivalent of the cross-tenant protection.

### Requirement: Staff-operated email corrections

Email SHALL remain staff-owned: the portal MUST NOT expose an email-change
operation or DTO field, and email corrections SHALL remain available only
through the staff Customer flow. Email verification, invitation, magic-link, and
recovery flows MUST NOT ship in this epic.

#### Scenario: Portal email change is unavailable

- GIVEN an authenticated holder
- WHEN any portal email-change route is called
- THEN the response is 404 `NOT_FOUND` and no email field is accepted or
  returned

#### Scenario: Staff can still correct email

- GIVEN staff with the Customer update permission
- WHEN they correct a Customer email through the staff flow
- THEN the change persists and is audited

### Requirement: Confidential allowlisted responses and safe logging

Portal DTOs SHALL be allowlisted and classified CONFIDENTIAL; Prisma models MUST
NOT be returned, and portal responses MUST NOT include staff-only fields.
CONFIDENTIAL or RESTRICTED payloads MUST NOT be logged; logs SHALL carry stable
IDs only.

#### Scenario: Response leaks no internals

- GIVEN a portal resource exists
- WHEN the portal API returns it
- THEN only allowlisted fields are present

#### Scenario: Logs carry IDs only

- GIVEN any portal request
- WHEN application logs are inspected
- THEN they contain stable IDs and no CONFIDENTIAL or RESTRICTED payload

### Requirement: Portal transactional audit

Every portal mutation (profile update, booking request) and every staff action
on portal access (provision, revoke, booking approval) SHALL append exactly one
AuditWriter row co-committed in the same transaction, carrying action, actor
identity (portal holder or staff), target, requestId, and field diff using
stable IDs only. Audit records SHALL distinguish portal-originated from
staff-originated actions.

#### Scenario: Profile update audited atomically

- GIVEN a successful portal profile update
- WHEN the audit log is inspected
- THEN exactly one co-committed row records the portal actor, target, and diff

#### Scenario: Booking provenance audited

- GIVEN a portal booking request and its staff approval
- WHEN the audit log is inspected
- THEN both the request and the approval rows exist and mark portal provenance

### Requirement: Revocation and session invalidation

Revoking portal access SHALL invalidate that holder's active portal sessions;
subsequent requests SHALL return 401 `UNAUTHENTICATED`. Revocation SHALL be
audited and MUST NOT delete historical audited records.

#### Scenario: Revocation ends access

- GIVEN an active holder session
- WHEN staff revoke the holder's portal access
- THEN the next portal request returns 401 `UNAUTHENTICATED` and the revocation
  is audited

### Requirement: Portal UI and proxy

Portal pages SHALL be reachable under the tenant-slug portal route with loading,
empty, error, success, and access-denied states; SHALL use semantic design
tokens and the shared resolved brand; and MUST NOT render staff navigation. The
portal proxy SHALL forward only allowlisted portal paths using the portal cookie
and MUST reject unknown paths and query parameters.

#### Scenario: Authorized workflow

- GIVEN an authorized holder
- WHEN they use pets, pet detail, appointments, booking, and profile pages
- THEN each renders its loading, empty, error, success, and denied states

#### Scenario: Denied state

- GIVEN a holder lacking access to a resource
- WHEN the page loads
- THEN an access-denied state renders without the protected data

#### Scenario: Proxy rejects unknown requests

- GIVEN the portal proxy
- WHEN an unknown path or query parameter is requested
- THEN it is rejected and no staff cookie is ever forwarded

### Requirement: Explicit deferrals and no unused events

This capability MUST NOT implement shared caregiver/adult access, email
invitation/verification/recovery, notifications, invoices, documents, files,
service selection, or automatic booking confirmation. No unused internal event
SHALL be emitted for portal actions.

#### Scenario: Deferred surface absent

- GIVEN the portal API
- WHEN an invoice, document, file, or notification route is called
- THEN the response is 404 `NOT_FOUND`

#### Scenario: No appointment event emitted

- GIVEN any portal booking request or approval
- WHEN the system state is inspected
- THEN no `AppointmentConfirmed` or `AppointmentCancelled` event was emitted

### Requirement: Synthetic demo data

Demo seed SHALL create a synthetic portal holder linked to a demo Customer and a
synthetic pending booking fixture without real PII.

#### Scenario: Demo populated

- GIVEN a demo tenant with a Customer and Patient
- WHEN the demo seed runs
- THEN a portal holder and a pending booking request exist for that tenant
