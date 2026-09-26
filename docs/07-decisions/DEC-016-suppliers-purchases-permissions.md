---
id: DEC-016
type: decision
title:
  Suppliers/purchases permission keys, role matrix and entitlement gating
  (EPIC-11)
status: accepted
date: 2026-09-26
related_epics:
  - "EPIC-11"
related_stories:
  - "SUP-001"
  - "PUR-001"
  - "PUR-002"
  - "PUR-003"
prd_change_required: false
---

# DEC-016 — Suppliers/purchases permission keys, role matrix and entitlement gating (EPIC-11)

## Context

Every protected operation needs a granular permission, and the two new domains
need keys, a seeded role matrix and a decision about whether the already-seeded
`purchases` entitlement gates the surface. [[SUP-001 Supplier foundation]],
[[PUR-001 Purchase draft]], [[PUR-002 Purchase receiving]] and [[PUR-003 Staff
purchases surface]] all record this as an open question.

Verified current state in this repository (2026-09-26):

- Permission keys must match `PERMISSION_KEY_PATTERN =
  /^[a-z]+(?:\.[a-z_]+){1,2}$/` (`packages/database/src/reference-seed.ts:20`).
  Each module declares its keys in a frozen `as const` contract
  (`apps/api/src/catalog/catalog.permissions.ts`,
  `apps/api/src/inventory/inventory.permissions.ts`), and no such contract exists
  for suppliers or purchases today.
- `PERMISSION_SEEDS` currently holds **34** entries and `ROLE_PERMISSION_MATRIX`
  spans the six `ROLE_SEEDS` codes `OWNER, ADMIN, VETERINARIAN, RECEPTIONIST,
  CASHIER, INVENTORY_MANAGER`. The seed-count probe pins the exact volumes in
  `packages/database/src/reference-seed.test.ts:517-538` (test "writes the
  expected row volumes"), and `apps/api/src/rbac/route-contract.probe.test.ts`
  pins the route inventory and per-route permission maps.
- The shipped role precedent: `catalog.read` and `inventory.stock.read` are held
  by **all six** roles; `catalog.create|update|deactivate` and
  `inventory.stock.adjust` are held by `OWNER, ADMIN, INVENTORY_MANAGER` only.
- There is **no generic entitlement decorator**. `EntitlementsService.has(tenantId,
  featureCode)` is called explicitly inside services, and the `purchases` feature
  code already exists in `FEATURE_CODE_SEEDS`
  (`packages/database/src/reference-seed.ts`, 12 feature codes) and is granted per
  tenant through `tenant_entitlement` rows.
- `apps/api/src/catalog/catalog.module.ts` and
  `apps/api/src/inventory/inventory.module.ts` state explicitly that they have no
  entitlement gate because they are Core capabilities, not Veterinary features.

## Question

Which `suppliers.*` and `purchases.*` keys exist, which roles hold them, and does
the `purchases` entitlement gate the surface the way the inventory routes are
deliberately ungated?

## Options

### Option A — Permission-only, no entitlement gate, mirroring the Core precedent (recommended)

Keys: `suppliers.read`, `suppliers.create`, `suppliers.update`,
`suppliers.deactivate`, `purchases.read`, `purchases.create`, `purchases.update`,
`purchases.cancel` and `purchases.receive`. Matrix: all six roles hold
`suppliers.read` and `purchases.read`; `OWNER`, `ADMIN` and `INVENTORY_MANAGER`
hold every write key; `VETERINARIAN`, `RECEPTIONIST` and `CASHIER` are read-only.
No entitlement gate, exactly as the catalog and inventory Core modules declare.
The seed count moves **34 → 43** and the seed-count probe plus the route-contract
probe must be reconciled.

Benefits: it is the shipped precedent for a Core capability (read-wide keys for
all six roles, write keys for the owning roles), it needs no new concept, and it
keeps suppliers and purchases usable on every plan as the PRD's Core domains.

Costs: adding nine keys forces a coordinated update of `PERMISSION_SEEDS`, the
matrix, the seed-count probe and the route-contract probe in the same slice, so a
partial seed change fails CI by design.

### Option B — Gate the surface on the already-seeded `purchases` feature code

Call `EntitlementsService.has(tenantId, "purchases")` inside the services, with
the same keys and matrix as A, making purchases a plan capability.

Benefits: the feature code, its plan mapping and its per-tenant grants already
exist, so gating costs no seed change and no migration, and it would let a plan
withhold purchasing without touching permissions.

Costs: it makes a Core domain conditional on commercial configuration, which is
the opposite of the catalog/inventory precedent, and it adds a second
authorization concept to reason about on top of the mandatory permission check.

### Option C — Finer-grained keys

Separate keys for facts that a read key currently bundles — for example a distinct
cost-visibility key, or line-level keys.

Rejected for now: it multiplies `PERMISSION_SEEDS` churn, matrix rows and
route-contract pins without a requirement that needs the separation. A real
requirement can add a key later as an additive seed change, which is cheaper than
removing one.

## Recommendation

Option A. The shipped precedent is explicit — `catalog.read` and
`inventory.stock.read` for all six roles, write keys for `OWNER`/`ADMIN`/
`INVENTORY_MANAGER` — and both Core modules deliberately declare no entitlement
gate, so an entitlement-gated suppliers/purchases surface would be the outlier.
Option C is rejected on churn, and Option B is deferred rather than rejected: it
can be adopted later with no migration because the `purchases` feature code is
already seeded and granted per tenant. In every option the UI gate is UX only —
the backend permission check remains mandatory and must reject with `403` before
any data access.

## Impact

### Product

Staff see supplier and purchase surfaces according to their role, with the
front-desk, veterinary and cash roles reading and the owning roles writing. No
plan-level withholding is introduced.

### Architecture

No new runtime, datastore, queue, dependency or API protocol. Two frozen
permission contracts join the catalog and inventory ones, and the Core modules
stay ungated.

### Database/API

Nine new keys are seeded in `PERMISSION_SEEDS` and wired into
`ROLE_PERMISSION_MATRIX`; the seed-count probe's `permissions: 34` becomes `43`
and the derived role-permission pair count grows with the matrix. The
route-contract probe gains the new routes and their permission pins. Every
protected route enforces authentication, server-side tenant context, the
permission and resource ownership.

### Delivery

[[SUP-001 Supplier foundation]] owns the `suppliers.*` keys and the supplier
module; [[PUR-001 Purchase draft]] and [[PUR-002 Purchase receiving]] own the
`purchases.*` keys; [[PUR-003 Staff purchases surface]] consumes them as UX gates
only. The seed-count and route-contract probe updates ship in the same work units
as the keys, never in a follow-up.

## Decision

Accepted on 2026-09-26 by the maintainer. Option A is the decision: the keys are
`suppliers.read`, `suppliers.create`, `suppliers.update`, `suppliers.deactivate`,
`purchases.read`, `purchases.create`, `purchases.update`, `purchases.cancel` and
`purchases.receive`; all six roles hold `suppliers.read` and `purchases.read`,
`OWNER`, `ADMIN` and `INVENTORY_MANAGER` hold every write key, and
`VETERINARIAN`, `RECEPTIONIST` and `CASHIER` are read-only; there is no
entitlement gate, exactly as the catalog and inventory Core modules declare; and
the seed count moves **34 → 43**, with the seed-count probe and the
route-contract probe reconciled in the same slice.

The other options stay recorded above as what was considered; acceptance selects
Option A only.

[[SUP-001 Supplier foundation]] owns the implementation slice for the
`suppliers.*` keys and the supplier module, [[PUR-001 Purchase draft]] and
[[PUR-002 Purchase receiving]] own the `purchases.*` keys, and [[PUR-003 Staff
purchases surface]] consumes them as UX gates only; the seed-count and
route-contract probe updates ship in the same work units as the keys, never in a
follow-up.

## PRD Update

No PRD change is required. PRD §9 already establishes permission keys and PRD §10
already lists `purchases` as a capability; this record applies existing intent to
two planned Core domains and chooses not to activate the already-seeded
entitlement. None of the options extends approved scope, and the engineering
rules forbid editing the PRD to normalize an implementation detail, so no PRD
edit is proposed here.
