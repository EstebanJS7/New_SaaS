# Archive Report: EPIC-04 — Customers (Core)

**Change**: `2026-09-08-epic-04-customers` **Archived**: 2026-09-08 **Mode**:
openspec (filesystem) **Status**: archived — verified (`pass_with_warnings`, 0
blockers)

This archive report is **additive**: it back-fills a missing record for an
already-archived, verified change. It does not rewrite `verify-report.md`,
`apply-progress.md`, `tasks.md`, `design.md`, `proposal.md`, or the delta specs.

## Verification State

| Dimension              | State                                                          | Evidence                                                                                            |
| ---------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Archived verification  | `pass_with_warnings`                                           | `verify-report.md`: 0 blockers, 13/13 requirements, 19/19 scenarios, 1 warning ([[TD-007]]).        |
| Tasks                  | 24/24 complete                                                 | `tasks.md` (task 5.4 is an accepted deferral, not implemented).                                     |
| Live-PG HTTP isolation | PASS                                                           | `Database migrations` job, live-PG suite 6/6 (Customer/Address/Contact + tenant-relative Branding). |
| Accepted warning       | Playwright Customer CRUD/navigation E2E deferred to [[TD-007]] | `verify-report.md` WARNING section.                                                                 |

### Dated superseding context (2026-09-11)

`verify-report.md` recorded CI run `34183380781` at `853f1309`. For the
root-gate count and live-PG dimensions, those figures are superseded by the
canonical EPIC-02–04 closure baseline — CI run
[`34605178149`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34605178149)
at `c9cff6131b6036849d0899a5735e6a2a6a3be5fd` (lint 14/14, format-check,
typecheck 14/14, test 15/15 → 640 passed / 6 skipped, build 9/9; live-PG 6/6).
The archived `verify-report.md` bytes are preserved as the 2026-09-08 record.

## Remaining Open Items

1. [[TD-007]] — Playwright Customer CRUD/navigation E2E is accepted-deferred;
   Playwright is not installed or configured and is not claimed implemented.
2. [[TD-006]] — the broader Batch 5 cross-tenant suite and RBAC
   concurrency/audit-rollback proofs still run only over the in-memory Prisma
   boundary.
3. No production-readiness claim: [[EPIC-20]] Production Hardening and the open
   debt above remain.

## Archive Contents

- `proposal.md` — scope, approach, rollback plan
- `specs/customer-management/spec.md` — tenant-scoped Customer/Address/Contact,
  soft deactivation, allowlisted DTOs, audit
- `specs/rbac-administration/spec.md` — permission baseline consumed by the
  Customer surface
- `design.md` — technical decisions and file changes
- `tasks.md` — 24/24 tasks complete
- `apply-progress.md` — C1–C4 corrective delivery-evidence slices
- `verify-report.md` — archived verification (`pass_with_warnings`)

## Specs Synced

| Domain              | Action  | Details                                                    |
| ------------------- | ------- | ---------------------------------------------------------- |
| customer-management | Created | Main spec at `openspec/specs/customer-management/spec.md`. |

## PRD Status

PRD is untouched. No `customers` entitlement or feature code was introduced;
access is permission-based per the approved scope.

## Mechanical Copy Verification

Archived on 2026-09-08 (`docs(EPIC-04): archive customers change`). Archive move
and delta-spec content were recorded at that time; this back-fill adds no
mutation to archived bytes.
