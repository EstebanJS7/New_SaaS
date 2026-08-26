---
id: DEC-003
type: decision
title:
  RBAC role→permission mapping becomes per-tenant overrides over an immutable
  platform baseline
status: accepted
date: 2026-08-25
related_epics:
  - EPIC-02
related_stories:
  - epic-02-rbac-settings (Batch A corrective work)
prd_change_required: true
---

# DEC-003 — RBAC role→permission mapping: per-tenant overrides over an immutable platform baseline

## Context

Batch A of `epic-02-rbac-settings` initially shipped role→permission mapping as
GLOBAL mutable rows: the seeded `role_permission` table was directly rewritten
by `PUT /rbac/roles/:code/permissions`. The adversarial security review rejected
this as **CRITICAL-1**: any tenant administrator holding
`users.membership.manage` could rewrite ANY role's mapping — rows shared by
every tenant. Two concrete attack classes followed:

1. **Self-escalation / lateral escalation** — a tenant admin grants extra keys
   to their own role by editing a shared row.
2. **Cross-tenant OWNER lockout** — a tenant admin strips keys from a role that
   other tenants' owners hold, degrading THEIR authority without ever touching
   their tenants.

The maintainer reviewed the findings and **authorized Option A on 2026-08-25**:
keep roles and the permission catalog global and seed-owned; introduce a
per-tenant override layer; re-target the administration API at that layer. This
record captures that authorization. The PRD itself is NOT edited by this
decision (`prd_change_required: true` flags the §9-extension wording for the
next approved PRD revision).

## Question

Where does tenant-configurable role→permission mapping live in a multi-tenant
SaaS whose roles are global reference data?

## Options

### Option A — Per-tenant override layer over an immutable baseline (ACCEPTED)

`tenant_role_permission_override(tenant_id, role_id, permission_key, granted)`
stores per-tenant verdicts. Effective set of (tenant T, role R):

```text
(role_permission baseline ∪ overrides(T,R) granted=true)
− overrides(T,R) granted=false
```

Administration writes are scoped exclusively by the server-resolved tenant
context; cross-tenant writes are structurally inexpressible (no route input
influences scope). Enforcement merges baseline + overrides once per request.

### Option B — Tenant-scoped copies of full mappings

Every tenant gets its own complete role_permission set, materialized from the
seed on first use. Full flexibility, but duplicates reference data per tenant,
complicates seed evolution (what happens to copied rows when the baseline
changes?), and buries the platform intent under per-tenant noise.

### Option C — Keep global mutable mappings with stricter guards

Retain the shipped design and add permission gates/audit around it. Rejected by
review: no gate changes the fact that one tenant's write mutates another
tenant's authority — the blast radius stays cross-tenant by construction.

## Decision

Option A is ACCEPTED (maintainer authorization, 2026-08-25). Concretely:

- Migration `20260825000001_rbac_tenant_role_permission_overrides` adds
  `tenant_role_permission_override` with UNIQUE(tenant_id, role_id,
  permission_key), index (tenant_id, role_id), RESTRICT FKs to tenant and the
  GLOBAL role rows.
- `PermissionResolver` computes effective sets as baseline ∪ grants − denials
  per request (single resolution pattern, still no cache).
- `GET /rbac/roles` returns EFFECTIVE sets for the caller's tenant.
- `PUT /rbac/roles/:code/permissions` replaces the caller's TENANT override set
  for the role (diff against baseline materialized as granted=true/false
  verdicts), audited as `rbac.role_permissions_overridden` with sorted effective
  before/after diffs.
- NEW last-manager rule: removing `users.membership.manage` from a role is
  rejected `409 CONFLICT` when the commanded post-write state would leave zero
  ACTIVE members in the tenant whose role EFFECTIVELY holds that key, checked
  inside the same transaction under the shared `SELECT ... FOR UPDATE`
  tenant-wide active-membership lock protocol (review CRITICAL-2). All active
  membership rows are locked deterministically because a tenant override can
  make a non-admin role an effective manager. AMENDED 2026-08-26 (re-judge
  composition-gap fix): the predicate is EFFECTIVE-HOLDERSHIP over ALL active
  members — never administrator-class seat counting, which cannot see override
  denials and let an override strip + self-demotion compose into a locked-out
  tenant. Both administration flows now share one implementation
  (`apps/api/src/rbac/manage-holdership.ts`).
- Audit appends moved INSIDE the mutation transactions so mutation-without-
  audit is structurally impossible (review WARNING-1).

## Platform-baseline / tenant-sandbox split (rationale)

The split keeps the reusable Core honest:

- **Platform baseline** (`role`, `permission`, `role_permission`) remains
  CODE-owned seed data. It expresses what the PRODUCT means by "OWNER", "ADMIN",
  "VETERINARIAN" — identical for every tenant, evolvable only through seed/code
  review. New products/verticals can ship different baselines without touching
  tenant data.
- **Tenant sandbox** (`tenant_role_permission_override`) is DATA-owned per
  tenant. Tenants adapt roles to their reality (grant scheduling rights to a
  vet, deny fiscal issuing to a cashier) without negotiating product code
  changes and without any ability to reach another tenant's rows.

Because the sandbox stores DELTAS (verdicts), not copies, baseline evolution
flows through automatically wherever a tenant has not spoken — and a tenant's
spoken verdicts survive seed reruns by construction.

## Threat discussion

### Resolved by this architecture

- **CRITICAL-1 (cross-tenant mapping rewrite)**: eliminated. No global mutable
  mapping surface exists; every write carries the server-resolved tenant scope.

### Accepted residual risks

1. **Self-promotion within a tenant (ACCEPTED RISK).** A holder of
   `users.membership.manage` can assign ANY role — including OWNER — within
   their OWN tenant, and can grant themselves additional keys via the override
   API. This is inherent to delegating membership administration; mitigations:
   - the shared effective-holdership invariant used by both assignment and
     override paths blocks the stranding failure modes (409 CONFLICT paths);
   - every mutation emits exactly one audit row inside its transaction
     (`rbac.membership_role_assigned`, `rbac.role_permissions_overridden`) with
     actor, request id, and before/after diffs;
   - acceptance deferred to eventual product policy (e.g., requiring OWNER
     confirmation for OWNER-grants or restricting who may hold
     `users.membership.manage`). Not enforced in EPIC-02; recorded here so the
     risk is visible, not hidden.

2. **In-memory test fake cannot prove lock interleaving (TD-006).**
   `SELECT ... FOR UPDATE` serialization is documented in code and exercised for
   WHICH rows are read, but interleaving semantics require the live-PG isolation
   run tracked by [[TD-006]] — now explicitly extended to cover these raw-SQL
   lock paths.

## Impact

### Product

No change to approved MVP scope: the six fixed roles and seed-owned catalog
stand. Tenant-side mapping configurability was already the authorized §9
extension; this decision relocates WHERE it lives. PRD text untouched pending
the next approved revision.

### Architecture

One additive table + resolver merge step; no new runtime, store, or transport.
Complexity budget untouched. Guard chain order unchanged.

### Database/API

New table `tenant_role_permission_override`; `PUT /rbac/roles/:code/permissions`
semantics re-targeted to tenant overrides; audit action renamed
`rbac.role_permissions_replaced` → `rbac.role_permissions_overridden`. GETs gain
tenant-effective semantics. Assignment endpoint unchanged apart from the FOR
UPDATE locking and in-transaction audit.

### Delivery

Batch A corrected before review sign-off; spec delta wording updated in place
with scenario IDs stable.

## PRD Update

None applied. `prd_change_required: true`: the next approved PRD revision should
describe §9 mapping configurability as tenant-local overrides over a seed-owned
baseline (this document is the authoritative description until then).
