---
id: TD-010
type: tech-debt
title: Remediate tenant-settings concurrent partial writes
status: open
severity: medium
related_epics:
  - EPIC-02
related_stories: []
created: 2026-09-11
updated: 2026-09-11
---

# TD-010 — Remediate tenant-settings concurrent partial writes

## Context

The EPIC-02 archive
(`openspec/changes/archive/2026-08-26-epic-02-rbac-settings/archive-report.md`)
carried an unresolved review WARNING that was not tracked as Tech Debt:

> `TenantSettingsService.update` reads the current row, merges the partial patch
> in memory, then upserts the full merged document. Two concurrent partial
> patches to the same `(tenantId, namespace)` row can overwrite each other's
> disjoint fields because the merge is not performed against a locked,
> consistent snapshot.

Per DOCUMENTATION-RULES, a recorded WARNING must be tracked as debt or
explicitly closed. This record formalizes the deferral instead of letting the
warning dissolve when EPIC-02 is marked `done`. No remediation is implemented
here; this is an evidence/debt record only.

This record is part of the EPIC-02–04 closure reconciliation against canonical
CI run `34605178149` at `c9cff613` (see `docs/10-qa/CI-EVIDENCE.md`). The debt
is preserved by that closure, not dissolved.

## Debt

`TenantSettingsService.update` uses a read → in-memory merge → upsert pattern.
Because the merge is not performed against a locked, consistent snapshot, two
concurrent partial updates to the same `(tenantId, namespace)` row can each read
the pre-update document and then write back a merged document that omits the
other's disjoint fields. The last write wins for the whole namespace document,
so a sibling field can be silently lost.

The property is a data-integrity concern for tenant configuration: a lost update
is not visible as an error and is not self-healing.

## Why It Is Safe to Defer

- Every settings write is server-side validated by the typed namespace registry
  before the upsert; an unknown or invalid payload cannot corrupt the document.
- Settings are admin-scoped and low-frequency in the current MVP, with no
  production tenants or concurrent administrators yet.
- No ledger, cash, stock, fiscal, or clinical invariant depends on settings.
- The affected path is bounded to one service method and one
  `(tenantId, namespace)` row, so the blast radius is contained.

## Risk

Medium likelihood under real concurrent administration, moderate impact:

- A concurrent save can silently drop a sibling field within the same namespace,
  leaving staff with an unexpected configuration state.
- The loss is not reported to either caller and does not fail any current gate,
  so it would only surface through user report or a future consistency check.

No security or tenancy invariant is weakened; tenant scoping is enforced on the
read and the upsert.

## Evidence Gate

Resolution requires live concurrency/optimistic-lock proof that concurrent
partial writes cannot lose disjoint fields:

1. a test (or executable harness) that issues two or more concurrent partial
   updates to the same `(tenantId, namespace)` row and proves the final document
   contains every field written by every successful update; and
2. either an optimistic-lock/versioned-write implementation with a
   rejected-write path for a stale snapshot, or a server-side per-field merge
   that is proven to converge under interleaving.

The proof must run against the same persistence used in production (PostgreSQL),
not an in-memory fake that cannot express interleaving.

## Proposed Resolution

1. Add a version/snapshot guard to the settings row (optimistic locking) or move
   the merge server-side into a single atomic statement.
2. Return a stable domain error on a lost-update conflict so callers can retry
   with fresh state rather than silently overwriting.
3. Add the concurrency proof described in the Evidence Gate to the API test
   suite and, where feasible, the live-PostgreSQL CI job.
4. Close this record with a link to the resolving commit or PR.

## Trigger / Target

Before any production onboarding that exposes multi-administrator settings
editing, and before EPIC-20 hardening closes. Re-entry when the settings write
path is next modified for another reason.

## Verification After Resolution

- [ ] Concurrent partial settings updates cannot lose disjoint sibling fields
      (PostgreSQL-backed proof).
- [ ] A stale-snapshot write is rejected with a stable domain error, or the
      server-side merge is proven to converge under interleaving.
- [ ] Focused concurrency coverage is added to the test suite and passes in CI.
- [ ] This record is closed with a link to the resolving commit.
