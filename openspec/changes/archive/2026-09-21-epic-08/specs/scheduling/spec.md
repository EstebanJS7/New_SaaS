# Delta for scheduling

## ADDED Requirements

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

## MODIFIED Requirements

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
