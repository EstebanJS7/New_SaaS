# Design: EPIC-08 — Portal

## Technical Approach

Build a separate first-party portal boundary: a Customer-linked holder with its
own credential, session, `ns_portal_session` cookie, guard, and `/portal/*`
controllers. Staff keep email and all booking/approval authority. Pending
requests live outside the overlap ledger and promote to an `Appointment` only
via an audited, idempotent staff command.

## Architecture Decisions

| #   | Decision               | Choice / rationale                                                                                                                                                                                                                                                                            |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Identity               | Extend `CustomerPortalAccess` with composite tenant FK `(tenantId, customerId)` + partial unique active `(tenant_id, customer_id)`. Add `PortalCredential` (shared PK, argon2id) and `PortalSession` (unique `token_hash`, TTLs, `revokedAt`). External provider = ADR; magic-link = EPIC-17. |
| D2  | Guard isolation        | `isPortalSurfacePath` in shared `route-contract.ts`; staff guards skip `/portal/*`. New global `PortalAuthGuard` enforces only that surface with the portal cookie only. Per-controller `@Public` fails: staff guards run first.                                                              |
| D3  | Pending booking        | New `PortalBookingRequest` (`PENDING/APPROVED/REJECTED/CANCELLED`); create validates ownership + ordered range only. Overlap reads `appointment` alone, so pending cannot consume capacity.                                                                                                   |
| D4  | Provenance/idempotency | `Appointment.source` enum `STAFF\|PORTAL` default `STAFF` + nullable unique `(tenantId, portalBookingRequestId)`; repeated approval resolves to the existing row.                                                                                                                             |
| D5  | Audit actor            | Add `PORTAL` to `AuditActorType`; nullable `actorPortalAccessId` FK on `AuditLog`, selected when set. Metadata-only cannot distinguish portal origin.                                                                                                                                         |
| D6  | Settings               | Register `portal` namespace `{ bookingRequiresApproval: boolean }` default `true`, `requiresFeature: "portal"`, key `portal.settings.manage`; seed `portal.access.manage`, granted OWNER/ADMIN.                                                                                               |
| D7  | Route prefix           | Unprefixed `/portal/*` (DEC-002 defers `/api/v1`). Staff admin off it: `POST /customers/:customerId/portal-access[/revoke]`, `GET /booking-requests`, `POST /booking-requests/:id/approve\|reject`.                                                                                           |
| D8  | Email + profile        | Login id = staff-managed `contactEmail`; no portal email field/route. Profile updates only primary `PHONE` contact + active `CustomerAddress`; strict zod rejects email/name/kind/taxId/foreign ids.                                                                                          |

## Data Flow

    Portal UI ──/api/portal proxy──► /portal/* ──PortalAuthGuard──► holder context
    Staff ──► /appointments | /booking-requests | /customers/:id/portal-access
    overlap reads `appointment` only; pending request ──approve──► appointment(source=PORTAL)

## File Changes

| File                                                                                              | Action        | Description                                                                 |
| ------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------- |
| `packages/database/prisma/schema.prisma` + `migrations/20260916000001_portal/`                    | Modify/Create | Portal models, `Appointment.source`, audit `PORTAL` actor; additive SQL.    |
| `packages/database/src/{audit-log,reference-seed,demo-seed}.ts`                                   | Modify        | Actor union/derivation; permissions/grants; holder + pending fixture.       |
| `apps/api/src/portal/**`                                                                          | Create        | Auth/session/guard/service, DTOs, controllers, audit.                       |
| `apps/api/src/rbac/route-contract.ts` + `route-contract.probe.test.ts`                            | Modify        | `isPortalSurfacePath`; pinned inventory + surface fence.                    |
| `apps/api/src/{auth,tenancy,rbac}/*.guard.ts`                                                     | Modify        | Skip portal surface.                                                        |
| `apps/api/src/settings/registry.ts`, `scheduling/**`, `customers/**`                              | Modify        | `portal` namespace; booking approve/reject; portal-access provision/revoke. |
| `apps/api/src/app.module.ts`                                                                      | Modify        | Register `PortalModule`.                                                    |
| `apps/web/src/app/api/portal/[[...path]]/route.ts`, `(portal)/[slug]/**`, `lib/session-cookie.ts` | Create/Modify | Portal-only proxy, pages + states, `PORTAL_SESSION_COOKIE`.                 |

## Interfaces / Contracts

```ts
isPortalSurfacePath(path): boolean; // "/portal" || startsWith("/portal/")
setPortalIdentity({ tenantId; customerId; portalAccessId }): void;
requirePortalCustomerId(): string;
PortalProfileUpdate = { phone?: string; address?: AddressFields }; // .strict()
```

Rejections: 401 `UNAUTHENTICATED`, 403 `FEATURE_NOT_ENTITLED`, 403 `FORBIDDEN`
(portal identity on a staff command), 400 `VALIDATION_FAILED` (service/Catalog
field, email/name, bad range), 404 `NOT_FOUND` (non-owned/cross-tenant/unknown/
deferred), 409 `CONFLICT` (second active holder), 429 `RATE_LIMITED` (login).

## Testing Strategy

| Layer          | What                                                                                                              | Approach                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Unit           | Guard skip, context setters, DTO allowlist (no `internalNotes`), strict zod, actor derivation                     | Vitest                          |
| Integration    | Cross-401, entitlement 403, foreign 404, service/email 400, deferred 404                                          | supertest                       |
| Live-PG        | Byte-equivalent 404, second-holder 409, repeated-approval idempotent, pending absent from overlap, revocation 401 | `live-pg-isolation.e2e-spec.ts` |
| Web / Contract | Proxy allowlist + portal-cookie-only; page states; pinned inventory + exemption                                   | Vitest / probe                  |

## Threat Matrix

Routing/guard-boundary design (`references/threat-matrix.md` absent; rows
derived).

| Boundary                     | App. | Safe / failure behavior                                 | RED test                      |
| ---------------------------- | ---- | ------------------------------------------------------- | ----------------------------- |
| Staff↔portal confusion       | Yes  | Each cookie ignored by the other chain; both 401        | cross-401 ×3                  |
| Skip overreach               | Yes  | `/portal/*` only; staff admin stays DECLARED            | probe: staff admin not exempt |
| Client-supplied tenant/owner | Yes  | Resolved server-side; foreign UUID → 404                | live-PG 404                   |
| Proxy smuggling              | Yes  | Allowlist + UUID shape + `%` reject; portal cookie only | proxy unit                    |
| Email creep                  | Yes  | No email field/route                                    | integration 404               |
| Shell/subprocess/VCS/PR      | N/A  | none                                                    | —                             |

## Migration / Rollout

Additive migration: new tables, nullable columns, `ADD VALUE 'PORTAL'`, indexes;
existing rows unaffected (`source` defaults `STAFF`). Rollback: revoke `portal`
entitlement + sessions; retain audited rows.

## Work-Unit Boundaries

1. **WU1** Data + settings (schema, audit actor, seeds, namespace, demo).
2. **WU2** Identity + guard (credential/session, `PortalAuthGuard`, skip
   predicate, provisioning/revocation, isolation).
3. **WU3** Read surface (pets/clinical/vaccinations/appointments + proxy).
4. **WU4** Booking + profile + UI (request, approval, profile, pages/states).
5. **WU5** Hardening + docs (live-PG evidence, probe pin, gates, docs).

## Resolved Questions

Both questions below were open at design time. They are resolved by the merged
implementation at `27bc04a` and recorded in [[DEC-008]] ("Open Questions") and
[[DEC-007]]; they are kept here, checked, for traceability rather than left
open.

- [x] Portal login id: the staff-managed `contactEmail` + `tenantSlug` was
      chosen; no dedicated username column was added. The id is matched
      case-insensitively and backed by the partial unique index on
      `(tenant_id, lower(contact_email)) WHERE status = 'ACTIVE'`.
- [x] Portal booking professional: staff assign the professional at approval,
      per [[DEC-007]]. The booking request body carries neither branch nor
      professional (it is `.strict()`); staff choose both when approving.
