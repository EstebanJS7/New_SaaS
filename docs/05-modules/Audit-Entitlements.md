---
type: module
module: audit-entitlements
status: implemented
updated: 2026-08-24
---

# Module — Audit & Entitlements

## Responsibility

Append-only audit scaffolding and the typed boolean entitlements boundary used
by future gating decisions.

## Does Not Own

- Policy evaluation (EPIC-02 consumes `has()` for permission gating).
- Plan/subscription billing semantics.
- Any HTTP surface (no controller ships in this epic).

## Public Capabilities

Application-level contracts only:

```text
AuditWriter.append(entry)              // the ONLY sanctioned audit_log writer
EntitlementsService.has(tenantId, featureCode): Promise<boolean>
```

## Main Entities

```text
AuditLog          (append-only; INDEX(tenant_id, created_at DESC))
FeatureCode       (12 MVP codes, code UNIQUE)
Plan / PlanCapability  (inert starter plan maps all codes; mapping ≠ grant)
TenantEntitlement (UNIQUE(tenant_id, feature_code_id) — the only grant)
```

## Audit Contract

- `append()` validates the entry (`action` in `"domain.event"` form, UUID
  fields, JSON-safe sanitized metadata), fills `actor_type` (STAFF when
  attributed, SYSTEM otherwise; caller may override) and stamps `requestId` from
  RequestContextService — callers cannot spoof correlation.
- Append-only BY CONSTRUCTION: no update/delete/list methods exist on the
  service; immutability is pinned by runtime-enumeration and type-level tests.
- Fail-closed ("audit-or-nothing"): an append failure fails the operation.
- Shipped emitters: `auth.login_succeeded`, `auth.login_failed`. Failed attempts
  are attributed STAFF when the email exists, SYSTEM otherwise; `metadata.email`
  is the only identifier recorded (INTERNAL classification). Rate-limited
  attempts are NOT audited (audit-table flood defense).

## Entitlements Contract

- `has()` is a DIRECT query over `tenant_entitlement` joined to `feature_code`;
  unknown-but-well-formed codes return false WITHOUT throwing; malformed
  arguments throw VALIDATION_FAILED.
- Override precedence per schema: explicit grants decide. The starter plan maps
  every feature code via `plan_capability` yet grants NOTHING — a tenant without
  `tenant_entitlement` rows has zero capabilities.
- No UI, no caching this epic.

## Seeds

- Reference seed (`db:seed`) upserts roles/permissions/feature codes/plan by
  natural keys; rerun is a no-op (CI double-run count probe).
- Demo seed reuses the EPIC-00 guarded CLI convention
  (`.opencode/commands/demo-seed.ts` → `@newsaas/database`): disabled unless
  `ENABLE_DEMO_SEED=true`, REFUSED outside development/test (unset NODE_ENV
  counts as production). Creates one demo tenant + owner account with ACTIVE
  OWNER membership and EXPLICIT grants for every seeded feature code,
  idempotently.

## Invariants

- Confirmed audit rows are immutable; corrections would be compensating events,
  never edits.
- CONFIDENTIAL/RESTRICTED material never enters metadata (classification rules;
  leak-scan tests pin credential-free trails).
- Callers consult `has()` instead of hardcoding plan comparisons.

## Related Stories

- [[EPIC-01]] DAT-005/DAT-006 (Slices S5–S6).
