---
id: DEC-026
type: decision
title: Sales permission keys, role matrix and the entitlement gate (EPIC-12)
status: accepted
date: 2026-09-27
related_epics:
  - "EPIC-12"
related_decisions:
  - "DEC-016"
related_stories:
  - "POS-001"
  - "POS-002"
  - "POS-003"
  - "POS-004"
prd_change_required: false
---

# DEC-026 — Sales permission keys, role matrix and the entitlement gate (EPIC-12)

## Context

Every protected operation needs a granular permission, and EPIC-12 introduces
the first Core surface that is also an entitlement capability. [[DEC-016]] fixed
the EPIC-11 shape — read keys for all six roles, write keys for the owning
roles, and no entitlement gate because catalog, inventory and purchases are
ungated Core capabilities. EPIC-12 must decide its `sales.*` and cash keys,
their role matrix, and whether the already-seeded `sales` feature code gates the
surface. POS-001 through POS-004 record the gap.

Verified current state in this repository (2026-09-27):

- `PERMISSION_SEEDS` holds **43** entries and the seed-count probe pins exactly
  that volume (`packages/database/src/reference-seed.test.ts:607`,
  `permissions: 43`). `PERMISSION_KEY_PATTERN = /^[a-z]+(?:\.[a-z_]+){1,2}$/`
  (`reference-seed.ts:20`) and `ROLE_PERMISSION_MATRIX` spans the six role codes
  `OWNER, ADMIN, VETERINARIAN, RECEPTIONIST, CASHIER, INVENTORY_MANAGER`.
- The relevant keys already exist: `sales.settings.manage`
  (`reference-seed.ts:94`) and `cash.session.close` (`reference-seed.ts:87`),
  both seeded since EPIC-01 and consumed by no route. The `sales` and `cash`
  feature codes are both in the twelve `FEATURE_CODE_SEEDS`, and the `sales`
  settings namespace already declares `requiresFeature: "sales"`
  (`apps/api/src/settings/registry.ts:54-74`).
- `EntitlementsService.has(tenantId, featureCode)` is a direct
  `tenant_entitlement` grant query; unknown-but-well-formed codes answer `false`
  without throwing (`apps/api/src/entitlements/entitlements.service.ts`).
- `apps/api/src/rbac/route-contract.probe.test.ts` pins the route inventory and
  per-route permission maps, so a new route and its key must be added together.

## Question

Which `sales.*` and cash keys exist, which roles hold them, and does the `sales`
entitlement gate the surface the way the catalog, inventory and purchases
surfaces are deliberately left ungated?

## Options

### Option A — Seven keys, owning-role writes, entitlement-gated on `sales` (recommended)

Seven new keys: `sales.read`, `sales.create`, `sales.update`, `sales.cancel`,
`sales.complete`, `cash.read` and `cash.session.open`, seeded into
`PERMISSION_SEEDS` and wired into `ROLE_PERMISSION_MATRIX`, moving the seeded
count 43 -> 50 with the seed-count probe and the route-contract probe reconciled
in the same slice. All six roles hold the two read keys (`sales.read`,
`cash.read`), and `OWNER`, `ADMIN` and `CASHIER` hold the five write keys
(`sales.create`, `sales.update`, `sales.cancel`, `sales.complete`,
`cash.session.open`) — the [[DEC-016]] shape of read-wide, write to the owning
roles. The already-seeded `cash.session.close` stays reserved for EPIC-13 and is
consumed by no EPIC-12 route. Unlike the ungated Core precedent of [[DEC-016]],
this surface **is** gated on the `sales` entitlement through
`EntitlementsService.has`, so a tenant without the capability gets a stable
`403` and the UI hides the module. The UI gate is UX only; the backend
permission and entitlement checks stay mandatory.

Benefits: it reuses the shipped read-wide/write-owning matrix shape, and it
activates the `sales` capability consistently with the already-shipped `sales`
settings namespace, which already requires that same feature code for a settings
write.

Costs: it is the first epic to gate a Core surface, so it adds a second
authorization concept (entitlement) beside the permission check on the same
production routes, and the seed-count and route-contract probes must move in the
same slice or CI fails by design.

### Option B — Same keys and matrix, no entitlement gate (mirror [[DEC-016]] exactly)

Seed the seven keys and the matrix but leave the routes ungated, as catalog,
inventory and purchases are.

Benefits: one authorization concept everywhere, and it is the most recent Core
precedent.

Costs: the `sales` feature code and the `sales` settings namespace already treat
sales as a capability, so ungating the routes while the settings write requires
the feature would be internally inconsistent, and a plan could not withhold POS.

### Option C — Finer-grained keys

Split keys further, for example a separate cash-session read key or a
`sales.complete` versus `sales.checkout` distinction.

Rejected for now: it multiplies `PERMISSION_SEEDS` churn, matrix rows and
route-contract pins without a requirement that needs the separation. A real
requirement can add a key later as an additive seed change.

## Recommendation

Option A. The matrix follows the shipped [[DEC-016]] precedent exactly, and the
entitlement question is decided by the existing repository state rather than by
preference: `sales` is already a seeded feature code and the `sales` settings
namespace already requires it, so this is the first epic to gate a Core surface.
That is stated here plainly rather than presented as the established Core rule;
Option B remains the catalog/inventory/purchases behaviour and Option C adds
churn without a requirement. In every option the UI gate is UX only and the
backend checks remain mandatory.

## Impact

### Product

Staff see sale and cash surfaces according to their role, and a tenant without
the `sales` capability gets a stable `403` and a hidden module. No plan-level
withholding existed for sales before this record.

### Architecture

No new runtime, datastore, queue, dependency or API protocol. A frozen
permission contract joins the existing ones, and the entitlement check is an
explicit service call rather than a generic decorator, matching the shipped
`EntitlementsService.has` boundary.

### Database/API

Seven keys are seeded in `PERMISSION_SEEDS` and wired into the role matrix; the
seed-count probe's `permissions: 43` becomes `50`, and the route-contract probe
gains the new routes and their pinned keys. Every route enforces authentication,
server-side tenant context, the permission, the `sales` entitlement and resource
ownership before data access.

### Delivery

POS-001 owns `sales.read`, `sales.create` and `sales.update`; POS-002 owns
`cash.read` and `cash.session.open`; POS-003 owns `sales.complete`; POS-004
consumes the keys as UX gates only. The seed-count and route-contract probe
updates ship in the same work units as the keys, never in a follow-up.

## Decision

Accepted on 2026-09-27 by the maintainer. Option A is the decision: seven new
keys — `sales.read`, `sales.create`, `sales.update`, `sales.cancel`,
`sales.complete`, `cash.read` and `cash.session.open` — are seeded into
`PERMISSION_SEEDS` and wired into `ROLE_PERMISSION_MATRIX`, moving the seeded
count 43 -> 50 with the seed-count probe and the route-contract probe reconciled
in the same slice; all six roles hold the two read keys, and `OWNER`, `ADMIN`
and `CASHIER` hold the five write keys (the [[DEC-016]] precedent shape:
read-wide, write to the owning roles); the already-seeded `cash.session.close`
stays reserved for EPIC-13 and is consumed by no EPIC-12 route; unlike the
ungated Core precedent of [[DEC-016]], this surface **is** gated on the `sales`
entitlement through `EntitlementsService.has` — it is already a seeded feature
code and is already required by the existing `sales` settings namespace — so a
tenant without the capability gets a stable `403` and the UI hides the module;
and the UI gate is UX only while the backend permission and entitlement checks
stay mandatory. This is the first epic to gate a Core surface, chosen because
`sales` is already modelled as a capability rather than because the Core rule
changed.

The other options stay recorded above as what was considered; acceptance selects
Option A only.

POS-001, POS-002, POS-003 and POS-004 own their respective keys, and the
seed-count and route-contract probes move with them.

## PRD Update

No PRD change is required. PRD §9 already fixes the read-wide/write-owning
permission shape and PRD §10 already lists `sales` and `cash` as initial feature
codes with `entitlements.has(...)` as the gating mechanism; this record applies
that existing intent to a new surface and, for the first time, activates the
already-seeded `sales` capability. It adds no product scope and the engineering
rules forbid editing the PRD to normalize an implementation detail, so no PRD
edit is proposed here.

## Subsequent scope note

**2026-09-29, after this record's acceptance.** The maintainer clarified three
points about the slice that implements this decision. This note extends the
accepted decision and does not rewrite it: the accepted `## Decision` text, its
seven-key set and its 43 -> 50 count stay recorded as decided, and the
clarifications below are what the implementing slices follow from this date.

- **`cash.register.create` is an eighth key.** The cash slice needs a minimal
  `POST /cash/registers`; without it no tenant could create a `CashRegister`, so
  the chain "OPEN session -> CASH sale" that [[DEC-020]] requires was
  unreachable. The key is seeded into `PERMISSION_SEEDS` and wired into
  `ROLE_PERMISSION_MATRIX` for `OWNER`, `ADMIN` and `CASHIER`, following the
  same read-wide/write-to-the-owning-roles shape as the other write keys.
- **The seeded count moves on this schedule.** 43 -> 47 with POS-001's four
  `sales.*` keys (`sales.read`, `sales.create`, `sales.update`, `sales.cancel`),
  47 -> 50 with POS-002's `cash.read`, `cash.register.create` and
  `cash.session.open`, and 50 -> 51 with POS-003's `sales.complete`. The epic
  total is therefore 43 -> 51 rather than this record's 43 -> 50, and the
  seed-count probe is reconciled in the same work unit as each key set.
- **The cash surface is gated on the `cash` capability, not on `sales`.** `cash`
  is its own seeded feature code in PRD §10, exactly as `sales` gates the sale
  surface, so each surface is gated on its own capability through
  `EntitlementsService.has`. The sale routes stay gated on `sales`; only the
  cash routes change to `cash`. The UI gate remains UX only and the backend
  permission and entitlement checks remain mandatory.
