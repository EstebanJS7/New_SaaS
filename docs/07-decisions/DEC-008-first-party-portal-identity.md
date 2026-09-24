---
id: DEC-008
type: decision
title: Provide portal identity first-party, deviating from PRD §8
status: accepted
date: 2026-09-21
related_epics:
  - EPIC-08
related_decisions:
  - DEC-002
  - DEC-007
related_stories: []
prd_change_required: false
---

# DEC-008 — Provide portal identity first-party, deviating from PRD §8

## Context

PRD §8 (Identity) states two things:

> External managed authentication is preferred for MVP.

> Staff and Customer Portal authorization are separate security boundaries.

EPIC-08 had to give an account holder a way to reach their own pets, request
appointments and update phone/address details. The epic's exploration evaluated
three identity mechanisms and the proposal recorded the chosen one as a
deliberate deviation to be turned into a Decision:

> First-party, Customer-linked portal identity with a separate portal session,
> cookie, guard, and policy; record the PRD §8 deviation as a Decision.

Verified reality at the time of the decision, and still true at the merge commit
`27bc04a`:

- Staff authentication is already first-party: an argon2id credential
  (`user_credential`) plus an `ns_staff_session` cookie and a global
  `AuthGuard`. No external managed authentication provider exists anywhere in
  the stack.
- No email or notification capability exists (EPIC-17 is unshipped), so any
  magic-link, invitation, verification or recovery flow is **blocked**, not just
  deferred.
- The architecture freeze (AGENTS.md "Complexity budget") requires an **ADR**
  before introducing a new authentication provider or strategy.
- The portal needed to ship without an ADR gate and without a blocked upstream
  epic, and had to keep staff and portal as separate authorization boundaries
  (the second sentence of §8, which this decision honours rather than deviates
  from).

## Question

How should the customer portal identity be provided for EPIC-08, given PRD §8's
preference for external managed authentication?

## Options

### Option A — First-party, Customer-linked identity (implemented)

Extend the inert `CustomerPortalAccess` scaffold with a Customer link and give
it a dedicated `PortalCredential` (argon2id, shared primary key), a
`PortalSession` table and an `ns_portal_session` cookie, a separate
`PortalAuthGuard`, and `/portal/*` controllers that share no session, cookie,
guard or permission metadata with staff. Access is staff-provisioned; there is
no self-service signup and no email dependency.

Benefits: consistent with the shipped first-party staff auth; no new
provider/ADR; no email dependency; the staff/portal boundary is explicit; reuses
the proven session, tenancy, entitlement and audit seams.

Costs: deviates from §8's stated preference; no self-service signup or email
recovery until EPIC-17 (the same gap already tracked for staff as [[TD-004]]).

### Option B — Magic-link / OTP email access

Passwordless access by an emailed link or code.

Benefits: no stored portal credential; a better guardian UX.

Costs: **blocked**. No email/notification capability exists (EPIC-17), and no
recovery precedent exists. Adopting it would pull EPIC-17 into EPIC-08 and still
leave a first-party credential model to build later.

### Option C — External managed auth provider

Delegate portal identity to a managed provider.

Benefits: aligns with §8's stated preference; offloads credential lifecycle.

Costs: requires an ADR before implementation (new authentication
strategy/provider), adds a runtime dependency, is inconsistent with the shipped
staff auth, and has a larger blast radius and cost than the MVP needs.

## Recommendation

Option A. It is the only option that delivers portal access now without an ADR
gate or a blocked upstream epic, and it keeps the staff/portal security
boundaries explicit instead of sharing controllers — which AGENTS.md and PRD
§8/§29 forbid. The §8 preference is recorded here as a proposed deviation rather
than silently ignored, mirroring [[DEC-002]] for the staff session.

## Impact

### Product

The holder gets a real portal without waiting on EPIC-17 or an external
provider. There is no self-service signup: staff provision access and set the
initial credential, and a lost credential has no self-service recovery path
until EPIC-17 lands. Invoices/documents remain out of reach because their
upstream epics (EPIC-14/§25) do not exist.

### Architecture

No new runtime, datastore, broker or dependency. The portal is a parallel
instance of the existing first-party pattern (credential, session, cookie,
guard), not a new pattern. The highest-severity risk — a portal identity that
weakens the staff boundary — is addressed structurally: `PortalAuthGuard` is a
global guard that enforces only `/portal/*`, the staff guards symmetrically skip
that surface, and each side reads only its own cookie.

### Database/API

An additive migration only: new tables (`portal_credential`, `portal_session`,
`portal_booking_request`), a Customer link and partial unique active-holder
indexes on `customer_portal_access`, `Appointment.source` (default `STAFF`) plus
a nullable unique `portalBookingRequestId`, and `AuditActorType.PORTAL` plus
`AuditLog.actorPortalAccessId`. Existing rows are unaffected.

### Delivery

The epic shipped as a chained feature-branch sequence (WU1 data/settings → WU2
identity/boundary → WU3 read/proxy → WU4 booking/profile/UI → WU5
hardening/docs), merged at `27bc04a`. The portal write paths carry durable
live-PostgreSQL concurrency and isolation evidence.

## Decision

**Proposed; not yet formally accepted.** The first-party approach below is
already realized by the merged implementation at `27bc04a`, but no acceptance is
recorded in the repository, so this record does not claim a decision the
repository cannot show. Formal acceptance is outstanding.

The approach realized by the merged implementation is:

1. **First-party, Customer-linked identity.** A portal holder is a first-party
   credential distinct from staff, linked to exactly one in-tenant Customer. It
   has its own `portal_credential` (argon2id, shared PK), its own
   `portal_session`, its own `ns_portal_session` cookie and its own
   `PortalAuthGuard`. Portal and staff share no session cookie and cannot accept
   each other's credentials.
2. **Staff-provisioned, no self-service signup.** Staff with
   `portal.access.manage` provision and revoke access; provisioning requires the
   `portal` entitlement. At most one active holder per Customer and per login
   email is enforced by partial unique indexes. Revocation sweeps the holder's
   live sessions and retains all historical rows.
3. **Login id is the staff-managed `contactEmail`.** Scoped by the tenant slug
   the holder presents; the resolved session, not the slug, is the authority for
   tenant and Customer. Email corrections stay staff-operated; there is no
   portal email field or route.
4. **Classification.** Portal projections are allowlisted and **CONFIDENTIAL**:
   no `tenantId`/`customerId` echo, no `internalNotes` or staff clinical free
   text, no appointment provenance or staff attribution. The credential hash is
   **RESTRICTED** and never leaves the login path. Logs carry stable IDs only.
   Business mutations (booking, profile, appointment) record field **names** in
   audit metadata, never values; the login trail is the exception, carrying the
   submitted email identifier, and logout appends no audit row (see [[Portal]] →
   "Audit Attribution").
5. **Deferrals (recorded, not implemented).** Invoices and documents (blocked on
   EPIC-14/§25); email invitation/verification/magic-link/recovery and
   notifications (EPIC-17); shared caregiver/adult access; service selection
   (Catalog, EPIC-09); and automatic booking confirmation. A request stays
   pending until an authorized staff approval command promotes it.
6. **Rollback.** The migration is additive; access is stopped by disabling the
   `portal` entitlement/routes and revoking portal sessions, while audited
   records are retained. No destructive down-migration is required.

## Approval and Governance

**Accepted 2026-09-22 by the maintainer**, who reviewed the record and accepted
the deviation explicitly. The approval is recorded here because the repository
cannot carry a separate sign-off artifact, and an accepted decision whose
approval lives only in a conversation is indistinguishable from an unapproved
one.

What the acceptance authorizes: shipping the portal on first-party identity —
session cookies issued and validated by the application, the portal's own login
identifier and its separation from the staff boundary — while PRD §8's
preference for an external managed authentication provider stays unmet. It does
not authorize any other divergence from §8: staff and Customer Portal
authorization remain separate security boundaries, and nothing here permits
sharing controllers or weakening a role check between them.

The deviation was already realized by the implementation merged at `27bc04a`;
this acceptance records the decision rather than the code's existence.

No ADR is required by this record: it adds no runtime service, datastore, queue,
ORM, authentication provider or design-system change and stays inside the frozen
MVP architecture. Moving the portal to an external managed provider later would
require an ADR and would supersede this record.

## Non-Goals

- Self-service signup, invitation, email verification, magic-link or recovery
  (EPIC-17).
- Portal invoices, documents or files (EPIC-14/§25).
- Shared adult/caregiver access or multi-holder access per Customer.
- Service selection or automatic booking confirmation.
- Any change to the staff authentication mechanism.

## Open Questions

The epic's design recorded two open questions. Both were resolved by the merged
implementation, so neither is left open by this record — they are recorded here
for traceability:

1. **Portal login id: staff-managed `contactEmail` + `tenantSlug` versus a
   dedicated username column.** Resolved in favour of `contactEmail`: it is the
   login id, matched case-insensitively and backed by the partial unique index
   on `(tenant_id, lower(contact_email)) WHERE status = 'ACTIVE'`. No username
   column was added.
2. **Booking professional assignment: an optional `professionalMembershipId` on
   the request versus staff-assigned at approval.** Resolved in favour of staff
   assignment at approval (also decided in [[DEC-007]]): the booking request
   carries neither branch nor professional (the body is `.strict()`), and staff
   choose both when approving.

One adjacent question remains genuinely open and is **not** decided here:
whether "exactly one primary phone per Customer" should be enforced by the
database rather than by the portal profile service's application-level demotion.
It is tracked as [[DEC-006]].

## PRD Update

No PRD change is made by this record. PRD §8's "External managed authentication
is preferred for MVP" remains the stated intent, and this record documents the
accepted, implemented deviation for the customer portal. The second half of §8 —
that staff and Customer Portal authorization are separate security boundaries —
is honoured, not deviated from. If the portal later moves to an external
provider, an ADR must be accepted and PRD §8 revisited at that time.

## Related

- [[DEC-002]]
- [[DEC-006]]
- [[DEC-007]]
- [[Portal]]
- `openspec/changes/archive/2026-09-21-epic-08/{proposal,design,tasks}.md`
