---
id: DEC-040
type: decision
title: Billing permissions, role matrix and entitlement gate (EPIC-14)
status: proposed
date: 2026-10-01
related_epics:
  - "EPIC-14"
related_decisions:
  - "DEC-016"
  - "DEC-026"
  - "DEC-034"
related_stories:
  - "BILL-002"
  - "BILL-003"
prd_change_required: false
---

# DEC-040 — Billing permissions, role matrix and entitlement gate (EPIC-14)

## Context

Every protected route needs a granular permission, and the seeded catalog is
counted by a pinned probe. EPIC-14 introduces the first Billing surface, and two
already-seeded artifacts collide with it in a way that must be resolved
explicitly rather than by convenience.

Verified current state in this repository (2026-10-01):

- `PERMISSION_SEEDS` holds **52** entries and the seed-count probe pins exactly
  that volume (`packages/database/src/reference-seed.test.ts:743`,
  `permissions: 52`). The key pattern is `^[a-z]+(?:\.[a-z_]+){1,2}$`
  (`reference-seed.ts:20`), so both `billing.read` and `billing.invoice.read`
  are well formed.
- `fiscal.invoice.issue` ("Issue fiscal invoices") has been seeded since EPIC-01
  and is granted to `OWNER`, `ADMIN` and `CASHIER`
  (`reference-seed.ts:115,201,255,340`). **No route consumes it.**
- The seeded family convention is domain-prefixed and mirrors the module
  directory: `sales.read/create/update/cancel/complete` for
  `apps/api/src/sales`,
  `cash.read/register.create/session.open/movement.create/session.close` for
  `apps/api/src/cash`, `purchases.*` for `apps/api/src/purchases`.
- `billing` and `fiscal` are both in the twelve `FEATURE_CODE_SEEDS`
  (`reference-seed.ts:387-388`) and both are mapped to the single inert
  `STARTER_PLAN_SEED`. Being mapped to a plan grants nothing; only explicit
  `tenant_entitlement` rows do.
- `EntitlementsService.has(tenantId, featureCode)` is the shipped gate
  (`apps/api/src/entitlements/entitlements.service.ts`), and [[DEC-026]] plus
  [[DEC-034]] established the read-wide / write-to-owning-roles matrix and
  per-surface entitlement gating.
- `apps/api/src/rbac/route-contract.probe.test.ts` pins the route inventory and
  each route's required permission, so a new route and its key must land in the
  same slice.

## Question

Which permission keys does EPIC-14 add or consume, which roles hold them, which
entitlement gates the Billing surface, and what does the pre-existing
`fiscal.invoice.issue` key gate?

## Options

### Option A — A `billing` family plus the `billing` entitlement (recommended)

Add four keys — `billing.read`, `billing.create`, `billing.confirm`,
`billing.cancel` — moving the seeded catalog 52 → 56. No `billing.update` key is
added, because [[DEC-038]] makes an invoice immutable from creation and the
Billing API therefore has no edit route to protect. All six roles hold
`billing.read`; `OWNER`, `ADMIN` and `CASHIER` hold the three write keys,
following the [[DEC-016]]/[[DEC-026]] shape. The Billing routes are gated on the
`billing` feature code through `EntitlementsService.has`, exactly as `sales`
gates sales and `cash` gates cash. The pre-existing `fiscal.invoice.issue` is
left untouched, consumed by no EPIC-14 route and reserved for the fiscal
issuance surface in [[EPIC-15]] gated on the `fiscal` feature code.

Benefits: the family matches the module directory and the shipped convention;
the key stays available for per-route pinning in the route-contract probe; and
the fiscal issuance capability keeps a single, unambiguous owner instead of
being consumed by Billing confirm.

Costs: four keys and their matrix rows move a pinned count, and the maintainer
must confirm that `fiscal.invoice.issue` is indeed an EPIC-15 key, because its
name is compatible with either reading. If draft editing is ever required, a
fifth `billing.update` key is an additive seed change.

### Option B — Consume `fiscal.invoice.issue` for the confirm command

Reuse the already-seeded key as the Billing confirm permission and add fewer new
keys.

Benefits: no new key for confirm and no count change for that one operation.

Costs: it fuses two different capabilities — drafting/confirming a business
invoice and issuing a fiscal document — so [[EPIC-15]] could no longer gate
fiscal issuance independently, and a tenant could not delegate draft preparation
to a role that may not issue fiscal documents. It also leaves the `fiscal`
feature code without a route family to gate.

### Option C — No entitlement gate on Billing

Ship the keys and matrix, but leave the routes ungated like the catalog,
inventory and purchases surfaces of [[DEC-016]].

Costs: `billing` is already a seeded feature code with a plan mapping, so an
ungated Billing surface while `sales` and `cash` are gated would be internally
inconsistent, and a plan could not withhold invoicing.

## Recommendation

Option A. It follows the shipped convention exactly and keeps the two
capabilities separate. Option B is rejected on capability boundaries, not on
convenience: `fiscal.invoice.issue` names fiscal issuance, and the `fiscal`
feature code exists for the same reason. If the maintainer intends
`fiscal.invoice.issue` to mean "confirm a business invoice", that intent must be
recorded here explicitly, because then the fiscal issuance key for [[EPIC-15]]
has to be redefined before that epic starts.

## Impact

### Product

Staff with invoice permissions see and operate the Billing surface; a tenant
without the `billing` capability gets a stable `403` and a hidden module. The UI
gate is UX only; the backend permission and entitlement checks remain mandatory.

### Architecture

No new authorization model, runtime or dependency. One more frozen permission
contract joins the existing ones, and the entitlement check stays an explicit
`EntitlementsService.has` call.

### Database/API

Four keys are seeded into `PERMISSION_SEEDS` and wired into
`ROLE_PERMISSION_MATRIX`; the seed-count probe's `permissions: 52` becomes `56`
in the same work unit. Every Billing route enforces authentication, server-side
tenant context, the permission, the `billing` entitlement and resource ownership
before data access.

### Delivery

BILL-002 owns `billing.read` and `billing.create`; BILL-003 owns
`billing.confirm` and `billing.cancel`; BILL-004 consumes all four as UX gates
only. The seed-count and route-contract probes move with each slice, never in a
follow-up.

## Decision

_Pending. Proposed to the maintainer on 2026-10-01; Option A is recommended._

## PRD Update

No PRD change is required. PRD §9 fixes the read-wide / write-owning permission
shape and PRD §10 already lists `billing` and `fiscal` as initial feature codes;
this record only allocates keys and roles inside that intent. The open question
of what `fiscal.invoice.issue` gates is answered here by naming its owner, not
by editing the PRD.
