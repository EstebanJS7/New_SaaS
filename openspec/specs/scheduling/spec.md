# scheduling Specification

## Purpose

Staff-only, tenant- and branch-scoped appointment scheduling for the veterinary
vertical. An `Appointment` is assigned to an in-tenant `TenantMembership` whose
role is `VETERINARIAN`, linked to an in-tenant Patient, and scheduled inside the
professional's availability for the selected branch. Availability windows and
one-off blocks live in the typed `scheduling` settings namespace; overlaps are
governed by a configurable tenant conflict policy that returns `409 CONFLICT`.

Excluded from this capability: the customer-facing Portal API and UI, which are
owned by `portal-management` (this capability adds only the staff approval path
for Portal-originated booking requests), recurring appointments/blocks,
reminders, internal appointment events, service labels, Catalog linkage, a
separate practitioner entity, branch administration, and clinical-encounter
linkage. These MUST remain deferred and no unused internal events SHALL be
emitted.

## Requirements

### Requirement: Appointment scope and assignment

Every `Appointment` SHALL belong to exactly one tenant, SHALL be scoped to one
`Branch` of that tenant, and SHALL reference an in-tenant Patient. The assigned
professional SHALL be an in-tenant `TenantMembership` whose role is
`VETERINARIAN`; no separate practitioner entity SHALL be introduced. Start and
end times SHALL be persisted in UTC. The appointment boundary MUST NOT expose a
user-facing service or Catalog field.

#### Scenario: Create a valid appointment

- GIVEN staff with `scheduling.appointment.manage`, an in-tenant Branch, an
  in-tenant Patient, and an in-tenant `VETERINARIAN` membership
- WHEN they create an appointment with a valid start/end range
- THEN it persists tenant- and branch-scoped in UTC with status `SCHEDULED`

#### Scenario: Non-VETERINARIAN professional rejected

- GIVEN a membership whose role is not `VETERINARIAN`
- WHEN it is used as the appointment professional
- THEN the response is 400 `VALIDATION_FAILED` and nothing persists

#### Scenario: Cross-tenant reference rejected

- GIVEN a Patient, Branch, or membership owned by another tenant
- WHEN tenant A staff reference it in a create
- THEN the response is 404 `NOT_FOUND` and nothing persists

#### Scenario: Invalid time range rejected

- GIVEN a submission whose end is not after its start
- WHEN it is validated
- THEN the response is 400 `VALIDATION_FAILED` and nothing persists

### Requirement: Explicit lifecycle transitions

An appointment SHALL move only through explicit command transitions between the
states `SCHEDULED`, `CONFIRMED`, `ARRIVED`, `IN_PROGRESS`, `COMPLETED`,
`CANCELLED`, and `NO_SHOW`. `COMPLETED`, `CANCELLED`, and `NO_SHOW` SHALL be
terminal. Illegal transitions MUST be rejected with 409 `CONFLICT` leaving the
state unchanged; there SHALL be no generic status-update operation.

| From          | Allowed to                        |
| ------------- | --------------------------------- |
| `SCHEDULED`   | `CONFIRMED`, `CANCELLED`          |
| `CONFIRMED`   | `ARRIVED`, `CANCELLED`, `NO_SHOW` |
| `ARRIVED`     | `IN_PROGRESS`, `NO_SHOW`          |
| `IN_PROGRESS` | `COMPLETED`                       |

#### Scenario: Confirm a scheduled appointment

- GIVEN a `SCHEDULED` appointment and staff with
  `scheduling.appointment.transition`
- WHEN the confirm command runs
- THEN the state becomes `CONFIRMED` and the transition is audited

#### Scenario: Illegal transition rejected

- GIVEN a `COMPLETED` appointment
- WHEN any further transition is attempted
- THEN the response is 409 `CONFLICT` and the stored state is unchanged

### Requirement: Configurable overlap policy

The system SHALL read the overlap policy from the typed `scheduling`
`conflictPolicy` setting (`REJECT` by default, or `ALLOW`). Two appointments for
the same professional whose time ranges intersect SHALL be treated as
overlapping. Under `REJECT`, a conflicting create or reschedule MUST persist
nothing and return 409 `CONFLICT`; under `ALLOW`, the overlap is persisted.
Conflict detection SHALL hold under concurrent requests so no two active
appointments for the same professional overlap.

#### Scenario: Overlap rejected by default

- GIVEN `conflictPolicy` is `REJECT` and an active appointment for a
  professional
- WHEN another appointment for the same professional overlaps it
- THEN the response is 409 `CONFLICT` and nothing persists

#### Scenario: Overlap allowed by policy

- GIVEN `conflictPolicy` is `ALLOW`
- WHEN an overlapping appointment is submitted
- THEN it persists and both appointments remain active

#### Scenario: Concurrent overlap race

- GIVEN `conflictPolicy` is `REJECT` and two concurrent overlapping requests for
  the same professional
- WHEN both are submitted
- THEN at most one persists and the other returns 409 `CONFLICT`

### Requirement: Availability and one-off blocks

Professional-and-branch availability windows and one-off blocks SHALL be stored
in the typed `scheduling` settings namespace. Creating or rescheduling an
appointment outside the professional's configured availability for the branch,
or inside an active one-off block, MUST persist nothing and return 409
`CONFLICT`. Availability and blocks SHALL NOT recur.

#### Scenario: Outside availability rejected

- GIVEN a professional with availability for the branch on certain weekdays
- WHEN an appointment is created outside those windows
- THEN the response is 409 `CONFLICT` and nothing persists

#### Scenario: Inside one-off block rejected

- GIVEN an active one-off block covering a time range
- WHEN an appointment is created inside that range for the blocked professional
- THEN the response is 409 `CONFLICT` and nothing persists

### Requirement: Free-slot availability read

The scheduling module SHALL expose a read-only availability query returning the
free slots for one professional, branch and local date. Every offered slot MUST
be a slot `POST /appointments` accepts under the same tenant, anchor,
availability, block and overlap rules; the converse MUST NOT be claimed, and the
cases where the read hides a bookable slot SHALL be documented in the module
that implements it. The read SHALL reuse the write path's predicates instead of
re-deriving them, SHALL NOT write anything, and SHALL take the tenant only from
the authenticated request context.

#### Scenario: Offered slots are bookable

- GIVEN a professional with configuration availability windows and no
  conflicting appointment
- WHEN the availability query runs for that professional, branch and date
- THEN every returned slot is accepted by the create command

#### Scenario: Taken and blocked time is withheld

- GIVEN an active appointment, an `ARRIVED` appointment, an `IN_PROGRESS`
  appointment or a one-off block covering a candidate
- WHEN the availability query runs
- THEN that candidate is absent from the result and the write path refuses it

#### Scenario: The read is one-way

- GIVEN a tenant whose `conflictPolicy` is `ALLOW` and an already overlapping
  appointment
- WHEN the availability query runs
- THEN the overlapping slot is withheld even though the write path would accept
  it, and that strict-subset behaviour is documented

#### Scenario: Read-only and tenant-scoped

- GIVEN a branch or professional from another tenant
- WHEN the availability query runs
- THEN the response is the byte-equivalent `404 NOT_FOUND` and no appointment,
  booking request or audit row is written

#### Scenario: Local date boundaries hold across a clock transition

- GIVEN a local date that contains a spring-forward gap or a fall-back fold
- WHEN the availability query runs for that date
- THEN no slot is offered at a local time that does not exist, an ambiguous
  local time is offered at most once, and every offered slot is accepted by the
  create command

### Requirement: Granular authorization

Every scheduling route SHALL enforce a granular permission —
`scheduling.appointment.read`, `scheduling.appointment.manage` (create and
reschedule), and `scheduling.appointment.transition` (lifecycle commands) —
resolved from the authenticated request context. Frontend checks are UX-only.
Availability and block writes SHALL require the `scheduling.settings.manage` key
defined by the `tenant-settings` capability. The staff approval of a
Portal-originated booking request SHALL require `scheduling.appointment.manage`;
no Portal identity SHALL satisfy any `scheduling.appointment.*` permission.
(Previously: permissions covered only staff create/reschedule and lifecycle
commands; Portal-originated approval was not defined.)

#### Scenario: Missing permission

- GIVEN authenticated staff without the required `scheduling.appointment.*`
  permission
- WHEN the route is called
- THEN the response is 403 `FORBIDDEN` and nothing persists

#### Scenario: Anonymous request rejected

- GIVEN no session
- WHEN any scheduling route is called
- THEN the response is 401 `UNAUTHENTICATED`

#### Scenario: Approval requires the manage permission

- GIVEN authenticated staff lacking `scheduling.appointment.manage`
- WHEN they attempt to approve a Portal-originated booking request
- THEN the response is 403 `FORBIDDEN` and nothing changes

### Requirement: Portal-originated booking requests

A booking request originating from the Portal SHALL be persisted only for a
holder-owned Patient and SHALL remain pending. It MUST NOT create or occupy an
active `SCHEDULED` appointment and SHALL NOT be treated as an active appointment
for overlap detection. It SHALL become an active appointment only through an
explicit, audited staff approval command that is idempotent for a repeated
request; rejection or cancellation of a request SHALL leave no active
appointment. Appointment provenance SHALL record that the request came from the
Portal. No `AppointmentConfirmed` or `AppointmentCancelled` event SHALL be
emitted.

#### Scenario: Pending request does not activate

- GIVEN a Portal holder-owned Patient and a valid requested time
- WHEN a booking request is submitted
- THEN it persists pending and audited, no active appointment exists, and the
  overlap policy is not evaluated against active appointments

#### Scenario: Staff approval promotes the request

- GIVEN a pending Portal booking request and authorized staff
- WHEN the approval command runs
- THEN one active appointment is created with Portal provenance and the approval
  is audited

#### Scenario: Repeated approval is idempotent

- GIVEN an already-approved Portal booking request
- WHEN the approval command runs again
- THEN no second active appointment is created

#### Scenario: Portal identity cannot approve

- GIVEN a Portal identity and a pending booking request
- WHEN it attempts the staff approval command
- THEN the response is 403 `FORBIDDEN` and nothing changes

#### Scenario: Non-owned Patient rejected

- GIVEN a Patient that is not owned by the requesting Portal holder
- WHEN a booking request is submitted for it
- THEN the response is 404 `NOT_FOUND` and nothing persists

### Requirement: Tenant isolation

All scheduling reads and writes SHALL use the server-resolved tenant context;
`tenantId` from the request MUST NOT be trusted. An appointment or referenced
Patient/Branch/membership UUID from another tenant SHALL return a
byte-equivalent 404 `NOT_FOUND` and persist nothing.

#### Scenario: Cross-tenant access

- GIVEN an appointment in tenant B
- WHEN tenant A staff request it by UUID
- THEN the response is 404 `NOT_FOUND`

### Requirement: Confidential allowlisted API and transactional audit

Appointment DTOs SHALL be allowlisted and classified CONFIDENTIAL; Prisma models
MUST NOT be returned, and appointment details MUST NOT be logged. Every create,
reschedule, transition, availability, and block mutation SHALL append exactly
one AuditWriter row co-committed in the same transaction, carrying action, actor
id, target id, requestId, and field diff using stable IDs only. No
`AppointmentConfirmed` or `AppointmentCancelled` event SHALL be emitted.

#### Scenario: Response leaks no internals

- GIVEN an appointment exists
- WHEN the staff API returns it
- THEN only allowlisted fields are present and no service/Catalog field exists

#### Scenario: Transition audited atomically

- GIVEN an authorized transition
- WHEN the audit log is inspected
- THEN exactly one co-committed row records the actor, target, and transition

### Requirement: Staff agenda

The staff agenda SHALL offer day, week, month, and list views over the tenant's
branch-scoped appointments, with time-range creation, drag/resize rescheduling,
and filters by branch, professional, and status. It SHALL render loading, empty,
error, success, and permission-denied states; use semantic design tokens only;
and be reachable from the authenticated staff shell through an authenticated
proxy. When a branch and a professional are selected, the day and week views
SHALL shade that pair's configured availability windows (the non-working
complement) and one-off blocks as a DISPLAY-ONLY overlay that never constrains
selection or dragging. A settings read that fails, or returns a namespace that
does not match the settings contract, SHALL be surfaced as a non-blocking
warning and SHALL NOT be rendered as an unrestricted pair. It MUST NOT expose
Portal booking, recurrence, or service-label controls.

#### Scenario: Authorized staff workflow

- GIVEN authorized staff with the scheduling permissions
- WHEN they open the agenda
- THEN day/week/month/list views, time-range create, drag/resize, and
  branch/professional/status filters work with their UI states

#### Scenario: Permission-denied state

- GIVEN staff lacking the scheduling read permission
- WHEN they open the agenda
- THEN a permission-denied state renders without appointment data

#### Scenario: Availability overlay for a selected pair

- GIVEN a branch and a professional are selected and the pair has configured
  availability windows and one-off blocks
- WHEN the day or week view renders
- THEN the complement of the pair's windows for each weekday and the pair's
  blocks are shaded, without constraining selection or dragging

#### Scenario: No overlay without a selected pair

- GIVEN no branch or no professional is selected
- WHEN the day or week view renders
- THEN no availability shading is shown and a hint asks staff to pick a branch
  and a professional

#### Scenario: Unrestricted pair shades nothing

- GIVEN a selected pair with no availability windows at all
- WHEN the day or week view renders
- THEN nothing is shaded, because the write path treats that pair as
  unrestricted

#### Scenario: Unknown availability is never shown as unrestricted

- GIVEN a branch and a professional are selected
- WHEN the `scheduling` settings read fails or returns a namespace that does not
  match the settings contract
- THEN the day or week view shades nothing, shows a non-blocking warning that
  the pair's availability could not be loaded, and the agenda stays fully usable

#### Scenario: Malformed settings namespace fails closed

- GIVEN the settings read returns a namespace with a malformed entry
- WHEN the overlay would be built
- THEN the whole namespace is rejected (no partial overlay) and the same
  non-blocking warning is shown

### Requirement: Synthetic demo data

Demo seed SHALL create synthetic branch-scoped appointments assigned to a
`VETERINARIAN` membership without real PII.

#### Scenario: Demo populated

- GIVEN a demo tenant with Branches, Patients, and a `VETERINARIAN` membership
- WHEN the demo seed runs
- THEN at least one appointment exists for that tenant
