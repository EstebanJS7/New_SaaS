# Archive Report: EPIC-02 — RBAC Enforcement / Entitlements / Tenant Settings

**Change**: epic-02-rbac-settings **Archived**: 2026-08-26 **Status**:
archived-with-verification-waiver **Mode**: openspec (filesystem)

## Verification State

**This change was archived WITHOUT fresh post-implementation verification
evidence.**

The maintainer explicitly instructed: no tests, lint, format, typecheck, build,
preflight, migrations, or any verification command be run before or during
archive. Fresh verification evidence is therefore STALE or absent.

### Waived Gates

| Gate                                                         | State            | Evidence                                                                     | Notes                                                                                                                                                                          |
| ------------------------------------------------------------ | ---------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root quality gates (lint/format-check/typecheck/test/build)  | **NOT EXECUTED** | Task 5.5 recorded results from prior apply session; maintainer waived re-run | Results may not reflect current tree state                                                                                                                                     |
| `pnpm services:up && pnpm preflight`                         | **NOT EXECUTED** | Task 5.5 recorded prior result; maintainer waived re-run                     | Local service health unconfirmed at archive time                                                                                                                               |
| Fresh-PostgreSQL migration deployment                        | **UNPROVEN**     | No CI migration job evidence available at archive time                       | Migration exists in code; deployment against clean PG16 unverified                                                                                                             |
| TD-006: live concurrency / transaction rollback evidence     | **OPEN**         | In-memory fake limitation documented honestly in tasks.md (C2) and design.md | FOR UPDATE lock + effective-holdership predicate tested in-memory only; real concurrent-transaction proof deferred to TD-006                                                   |
| TD-006: transactional-audit atomicity (audit-in-tx rollback) | **OPEN**         | Documented in tasks.md (F6) as fake-unproven property                        | AuditWriter joins caller's $transaction; rollback semantics tested in-memory only                                                                                              |
| Settings concurrent partial-write isolation                  | **OPEN**         | Review WARNING recorded in Remaining Open Items                              | `TenantSettingsService.update` uses read/merge/upsert; disjoint concurrent updates can lose sibling fields. Must be assessed before production; not remediated in this archive |
| `verify-report.md`                                           | **NOT CREATED**  | No verification phase was executed                                           | Archive proceeds under maintainer override                                                                                                                                     |

### What IS Evidenced

- All 35 implementation tasks marked complete in `tasks.md` (source of truth for
  completion visibility).
- Tasks 5.5 recorded prior gate results: lint exit 0 (12 packages), format-check
  exit 0, typecheck exit 0, test exit 0 (API 36 files / 249 tests, database 6
  files / 67 tests, shared 3 files / 16 tests, worker 2 files / 12 tests, web 10
  files / 32 tests, ui 6 files / 36 tests), build exit 0 (8 packages),
  `git diff --check` exit 0, `pnpm services:up && pnpm preflight` exit 0.
- Cross-tenant isolation test coverage extended for RBAC and settings.
- Route-contract probe test covers full API route inventory.
- Seed double-run probe verified.
- DEC-003 accepted, PRD untouched.

### Remaining Open Items

1. **Fresh verification required before production deployment**: root quality
   gates must be re-run against current tree state.
2. **Migration deployment against clean PostgreSQL must be proven**: no CI
   migration job evidence available.
3. **TD-006 concurrency evidence**: live concurrent-transaction rollback and
   transactional-audit atomicity are documented limitations, not proven
   properties. Must be addressed before production concurrency is trusted.
4. **No verify-report.md**: the verification phase was skipped per maintainer
   instruction. A formal verify phase should be run before any release gate.
5. **Review WARNING — settings concurrent partial writes**:
   `TenantSettingsService.update` reads the current row, merges the partial
   patch in memory, then upserts the full merged document. Two concurrent
   partial patches to the same `(tenantId, namespace)` row can overwrite each
   other's disjoint fields because the merge is not performed against a locked,
   consistent snapshot. This is not remediated in this archive and must be
   assessed before production (e.g., optimistic locking or a per-field merge
   strategy).

## Archive Contents

- `proposal.md` — scope, approach, rollback plan, risks
- `specs/rbac-enforcement/spec.md` — deny-by-default contract, guard semantics,
  effective-permissions endpoint
- `specs/rbac-administration/spec.md` — catalog, permission-set updates,
  membership assignment, audit
- `specs/entitlements-enforcement/spec.md` — capability gate on settings write
  path
- `specs/tenant-settings/spec.md` — storage, registry, service API, secrets
  rejection
- `design.md` — technical decisions D1–D8, data flow, file changes, threat
  matrix
- `tasks.md` — 35/35 tasks complete, traceability matrix, execution notes
- `explore.md` — pre-proposal exploration

## Specs Synced

| Domain                   | Action  | Details                                      |
| ------------------------ | ------- | -------------------------------------------- |
| rbac-enforcement         | Created | 5 requirements, 9 scenarios — new main spec  |
| rbac-administration      | Created | 5 requirements, 12 scenarios — new main spec |
| entitlements-enforcement | Created | 3 requirements, 4 scenarios — new main spec  |
| tenant-settings          | Created | 5 requirements, 10 scenarios — new main spec |

## Source of Truth Updated

The following main specs now reflect the new behavior:

- `openspec/specs/rbac-enforcement/spec.md`
- `openspec/specs/rbac-administration/spec.md`
- `openspec/specs/entitlements-enforcement/spec.md`
- `openspec/specs/tenant-settings/spec.md`

## PRD Status

PRD text is untouched. DEC-003
(`docs/07-decisions/DEC-003-rbac-role-mapping-overrides.md`) documents the
per-tenant override architecture as a `prd_change_required: true` accepted
decision; the PRD itself was not modified per governance rules.

## Mechanical Copy Verification

- Delta specs → main specs: `diff` verified byte-identical (4/4 domains).
- Change folder → archive: `diff -r` verified byte-identical against pre-move
  snapshot.
- Archive move: `git mv` succeeded; source directory confirmed removed.
