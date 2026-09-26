---
type: roadmap
status: active
updated: 2026-09-25
---

# ROADMAP

| Epic    | Name                               |      Status | Depends on                |
| ------- | ---------------------------------- | ----------: | ------------------------- |
| EPIC-00 | Foundation                         |        done | —                         |
| EPIC-01 | Database/Auth/Tenancy              |        done | EPIC-00                   |
| EPIC-02 | RBAC/Entitlements/Tenant Settings  |        done | EPIC-01                   |
| EPIC-03 | Staff Shell/Design System/Branding |        done | EPIC-01                   |
| EPIC-04 | Customers                          |        done | EPIC-02, EPIC-03          |
| EPIC-05 | Veterinary Patients                |        done | EPIC-04                   |
| EPIC-06 | Clinical                           |        done | EPIC-05                   |
| EPIC-07 | Scheduling                         |        done | EPIC-04, EPIC-05          |
| EPIC-08 | Portal                             |        done | EPIC-04, EPIC-05, EPIC-07 |
| EPIC-09 | Catalog/Taxes                      |        done | EPIC-02                   |
| EPIC-10 | Inventory                          | in-progress | EPIC-09                   |
| EPIC-11 | Suppliers/Purchases                |     planned | EPIC-10                   |
| EPIC-12 | POS/Payments                       |     planned | EPIC-09, EPIC-10          |
| EPIC-13 | Cash                               |     planned | EPIC-12                   |
| EPIC-14 | Billing                            |     planned | EPIC-12                   |
| EPIC-15 | Fiscal Abstraction                 |     planned | EPIC-14                   |
| EPIC-16 | Fiscal Third-party Adapter         |     planned | EPIC-15                   |
| EPIC-17 | Notifications                      |     planned | EPIC-07                   |
| EPIC-18 | Dashboards/Reports                 |     planned | prior domains             |
| EPIC-19 | Imports                            |     planned | EPIC-04, EPIC-05          |
| EPIC-20 | Production Hardening               |     planned | MVP feature epics         |

Update this table when Epic status changes.

EPIC-02, EPIC-03, and EPIC-04 moved to `done` on 2026-09-11 by evidence-based
closure against CI run `34605178149` at `c9cff613` (criterion-to-evidence maps
plus preserved open/accepted debt). EPIC-06 Clinical moved to `done` on
2026-09-13 by evidence-based closure against CI run
[`34793644348`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34793644348)
at `ff786138` (archived EPIC-06 verification report plus preserved open debt).
`done` means epic implementation closure only: it is **not** a
production-readiness statement. [[EPIC-20]] Production Hardening and the open
Tech Debt items remain. [[EPIC-07]] Scheduling moved to `done` on 2026-09-15
after SDD verification and archive; its durable live-PostgreSQL overlap race
passed. [[EPIC-08]] Portal moved to `done` on 2026-09-21 after its chained
implementation merged at `27bc04a` and the portal write paths passed their
durable live-PostgreSQL concurrency/isolation race (suite 40/40); its SDD change
is archived at `openspec/changes/archive/2026-09-21-epic-08/` and its spec
deltas are merged into the standing `portal-management` (created), `scheduling`
and `tenant-settings` specs. The last acceptance item, the holder profile page,
merged as PR #55 at `c9959db`, where the epic's final local closure gate run is
recorded in `docs/10-qa/CI-EVIDENCE.md`.

Individual Stories live in `../02-stories/`.

[[EPIC-09]] Catalog/Taxes moved to `done` on 2026-09-25, merged as PR #64
(`feat/epic-09-catalog-taxes`, merge commit `aa75945`) with CI run
[36194111568](https://github.com/EstebanJS7/New_SaaS/actions/runs/36194111568)
green on both required checks. `done` means epic implementation closure only:
the live-PostgreSQL suite reported 47/47 including the EPIC-09 catalog
application-path block, and the seed idempotency probe returned identical counts
with `taxRates: 3`. It is **never** production readiness: [[EPIC-20]] Production
Hardening and the open Tech Debt items ([[TD-013]], [[TD-014]], [[TD-015]],
[[TD-007]]) remain.

[[EPIC-10]] Inventory moved to `in-progress` on 2026-09-25 when its W1 data
foundation landed: the `tracks_stock` catalog dimension, the `stock_movement`
ledger and `stock_balance` projection, the additive migration
`20260925000003_inventory` and the two `inventory.stock.*` permissions. On the
same day W2 delivered the adjustment surface
(`POST /inventory/stock/adjustments` plus the balance and movement reads) and W3
closed the ledger's live-PostgreSQL evidence locally: the migration is applied
to a local PostgreSQL 16.13 database, `db:live-verify` passes, and the live
suite is 52/52, including the `EPIC-10 inventory application-path isolation`
block whose `BLOCK` race first exposed a real lost update — fixed by a
per-`(tenant, item)` advisory lock — and now proves exactly one output admitted
with the projection equal to the ledger's signed sum. The epic record moved to
`review` with [[Inventory]] and [[TD-016]] written, **not** `done`: the work is
not committed, pushed or merged, so the row stays `in-progress` here until
delivery.

## Architecture baseline

Architecture freeze: PRD v1.3. Structural changes require an accepted ADR.
