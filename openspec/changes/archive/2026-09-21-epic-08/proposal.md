# Proposal: EPIC-08 — Portal

## Intent

Deliver a portal for an account holder to view their pets and care information,
request appointments, and update phone and address details without staff access.

## Scope

### In Scope

- First-party, Customer-linked portal identity with a separate portal session,
  cookie, guard, and policy; record the PRD §8 deviation as a Decision.
- One account holder per Customer; own-pet access and allowlisted
  `clientSummary` and vaccination history only.
- Portal appointment read and booking requests pending staff approval.
- Self-service profile updates for phone and address only; updates are validated
  and audited. Email corrections remain staff-operated.
- Typed `portal` settings, entitlement enforcement, isolation, UI states, and
  focused tests.

### Out of Scope

- Shared adult/caregiver access, automatic booking confirmation, service
  selection, invoices, documents, or files.
- Self-service email changes, email verification, invitation, recovery,
  delivery, and notifications; defer these to EPIC-17. Email corrections remain
  staff-operated until then.

## Capabilities

### New Capabilities

- `portal-management`: Isolated identity, own-pet projections, appointment
  requests, and audited phone/address self-service; email corrections are
  staff-operated.

### Modified Capabilities

- `scheduling`: Accept portal-originated booking requests under approval policy.
- `tenant-settings`: Register and validate the `portal` namespace.

## Approach

Extend `CustomerPortalAccess` with a Customer link and dedicated portal
credential/session records. Keep portal routes, cookies, and DTOs separate from
staff; resolve tenant and ownership server-side. Restrict profile DTOs and
commands to phone/address; use explicit clinical allowlists and an auditable
booking-approval command.

## Affected Areas

| Area                                     | Impact   | Description                              |
| ---------------------------------------- | -------- | ---------------------------------------- |
| `packages/database/prisma/schema.prisma` | Modified | Identity/session and booking provenance. |
| `apps/api/src/portal/**`                 | New      | Auth, policy, API, DTOs, audit.          |
| `apps/api/src/settings/registry.ts`      | Modified | Typed portal settings.                   |
| `apps/web/src/app/(portal)/[slug]/**`    | Modified | Portal pages.                            |
| `docs/07-decisions/`                     | New      | First-party portal identity Decision.    |

## Risks

| Risk                                         | Likelihood | Mitigation                                                                 |
| -------------------------------------------- | ---------- | -------------------------------------------------------------------------- |
| Staff/portal boundary bypass                 | Med        | Separate boundary and isolation tests.                                     |
| Clinical-data leakage                        | Med        | Allowlist only; never expose/log `internalNotes`.                          |
| Email-change request bypasses staff workflow | Low        | Exclude email from portal DTOs and commands; retain staff correction flow. |
| Oversized review                             | High       | Plan chained work units within the 800-line budget.                        |

## Rollback Plan

Deploy additive migration changes only. Disable portal entitlement/routes and
revoke portal sessions to stop access; retain audited records.

## Dependencies

- EPIC-04/05/06/07 seams; portal entitlement and audit.
- EPIC-14/§25 for invoices/documents.

## Success Criteria

- [ ] Portal users access only their tenant's authorized pets and allowlisted
      data.
- [ ] Portal booking remains pending until an authorized staff approval command.
- [ ] Phone/address updates audit successfully; portal email changes are
      rejected and remain staff-operated.
- [ ] Portal and staff sessions cannot authorize each other's routes.
