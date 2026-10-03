---
type: roadmap
status: active
updated: 2026-09-27
---

# ROADMAP

| Epic    | Name                               |  Status | Depends on                |
| ------- | ---------------------------------- | ------: | ------------------------- |
| EPIC-00 | Foundation                         |    done | —                         |
| EPIC-01 | Database/Auth/Tenancy              |    done | EPIC-00                   |
| EPIC-02 | RBAC/Entitlements/Tenant Settings  |    done | EPIC-01                   |
| EPIC-03 | Staff Shell/Design System/Branding |    done | EPIC-01                   |
| EPIC-04 | Customers                          |    done | EPIC-02, EPIC-03          |
| EPIC-05 | Veterinary Patients                |    done | EPIC-04                   |
| EPIC-06 | Clinical                           |    done | EPIC-05                   |
| EPIC-07 | Scheduling                         |    done | EPIC-04, EPIC-05          |
| EPIC-08 | Portal                             |    done | EPIC-04, EPIC-05, EPIC-07 |
| EPIC-09 | Catalog/Taxes                      |    done | EPIC-02                   |
| EPIC-10 | Inventory                          |    done | EPIC-09                   |
| EPIC-11 | Suppliers/Purchases                |    done | EPIC-10                   |
| EPIC-12 | POS/Payments                       |    done | EPIC-09, EPIC-10          |
| EPIC-13 | Cash                               |    done | EPIC-12                   |
| EPIC-14 | Billing                            |    done | EPIC-12                   |
| EPIC-15 | Fiscal Abstraction                 |    done | EPIC-14                   |
| EPIC-16 | Fiscal Third-party Adapter         | planned | EPIC-15                   |
| EPIC-17 | Notifications                      | planned | EPIC-07                   |
| EPIC-18 | Dashboards/Reports                 | planned | prior domains             |
| EPIC-19 | Imports                            | planned | EPIC-04, EPIC-05          |
| EPIC-20 | Production Hardening               | planned | MVP feature epics         |

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

[[EPIC-10]] Inventory moved to `done` on 2026-09-25, merged as PR #66
(`feat/epic-10-inventory`, merge commit `ee558a7`) with CI run
[36249268114](https://github.com/EstebanJS7/New_SaaS/actions/runs/36249268114)
green on both required checks. `done` means epic implementation closure only:
the live-PostgreSQL suite is 52/52, including the
`EPIC-10 inventory application-path isolation` block whose `BLOCK` race first
exposed a real lost update — fixed by a per-`(tenant, item)` advisory lock — and
now proves exactly one output admitted with the projection equal to the ledger's
signed sum. It is **never** production readiness: [[EPIC-20]] Production
Hardening and the open Tech Debt items ([[TD-016]], [[TD-007]]) remain.

[[EPIC-11]] Suppliers/Purchases moved to `done` on 2026-09-27, after its four
stories merged with the required CI checks green: SUP-001 as PR #68 (merge
commit `baa66ca`), PUR-001 as PR #70 (`f214003`, CI run `36277429018`), PUR-002
as PR #71 (`8862050`, CI run `36293559990`) and PUR-003 as PR #73 (`e12ac1f`, CI
run `36305211468`). `done` means epic implementation closure only: the
live-PostgreSQL suite is machine-verified in CI's `Database migrations` job on
every pull request (71 cases, including the EPIC-11 supplier, purchase-draft and
purchase-receiving blocks), and the delivery receipts are recorded in
`docs/10-qa/CI-EVIDENCE.md`. It is **never** production readiness: [[EPIC-20]]
Production Hardening and the open Tech Debt items remain, [[TD-013]] stays open
now that its trigger has fired, and [[TD-016]] stays open although the receiving
writer complies with its protocol.

## Architecture baseline

Architecture freeze: PRD v1.3. Structural changes require an accepted ADR.

[[EPIC-15]] Fiscal Abstraction moved to `done` on 2026-10-03 after its five
Stories closed with the required CI checks green. The kickoff and Decisions were
PR #96, FISC-002 PRs #97 and #98, FISC-003 PR #99, FISC-004 PR #100, the TD-028
recovery sweep PR #101, FISC-005a PR #102 (run `37150885463`, live-PostgreSQL
203 cases) and FISC-005b PR #103 (run `37155574081`, live-PostgreSQL **213
passed (213)**). The merged tree carries **32 migrations**, a seeded catalog of
57 permissions and 193 role grants, and a green `pnpm test`/`typecheck`/`lint`/
`build`/`format-check` set. EPIC-15 delivered the reusable Core Fiscal boundary
and deliberately stopped before any real provider: [[EPIC-16]] owns the
production adapter, and `SIFEN_DIRECT`, XAdES signing and KuDE rendering were
never implemented from memory (PRD §23). No `fiscal-ui` settings namespace
ships, no retry route ships ([[TD-029]]), and the portal fiscal document surface
stays deferred ([[TD-022]]). This is an epic-closure record, **never** a
production readiness claim.

[[EPIC-14]] Billing moved to `done` on 2026-10-02 after its four implementation
Stories merged with the required CI checks green: the scope and Decisions as PR
#86 (`15dc434`), BILL-001 as PR #87 (`fc60d11`, run `36885623341`), BILL-002 as
PR #89 (`c52b175`, run `36911300059`), BILL-003 as PR #91 (`558fe0b`, run
`36956634087`) and BILL-004 as PR #93 (`90ccec1`, run `37023527813`), with their
closures as PR #88, #90, #92 and #94. `done` means epic implementation closure
only: the local gates passed (database 18 files / 403 tests, API 77 files / 1173
tests with the live-PostgreSQL spec included, web 90 files / 1052 tests), the
API live-PostgreSQL suite grew from 142 to **153 cases** including two FORCED
concurrency overlaps, and the applied schema reports **29 migrations** with a
`permission` count of **56**. It is **never** production readiness: [[EPIC-20]]
Production Hardening and the open Tech Debt items remain, and one review of the
BILL-004 slice is **escalated rather than closed**, so that candidate carries no
verdict and the fail-closed path applies.

[[EPIC-13]] Cash moved to `done` on 2026-10-01, merged as PR #84
(`feat/epic-13-cash-data-foundation`, merge commit `5058d59`) with CI run
[`36800148919`](https://github.com/EstebanJS7/New_SaaS/actions/runs/36800148919)
green on both required checks. `done` means epic implementation closure only:
the local gates passed (database 17 files / 361 tests, API 76 files / 1107
tests, web 81 files / 940 tests), the API live-PostgreSQL suite grew from 99 to
**119 cases** including the movement-command and session-close blocks, and the
applied schema reports 27 migrations, a `permission` count of 52 and the cash
CHECKs, triggers and close columns. It is **never** production readiness:
[[EPIC-20]] Production Hardening and the open Tech Debt items remain, and a
completed sale still cannot be reversed or refunded until [[TD-018]] lands.

[[EPIC-12]] POS/Payments moved to `done` on 2026-09-29 after its five Stories
merged with the required CI checks green: the scope and Decisions as PR #76
(`14f23bc`), POS-001 as PR #77 (`6ef1896`, run `36513245839`), POS-002 as PR #78
(`0d583e6`, run `36521067733`), POS-003 as PR #80 (`dc7c429`, run `36592652167`)
and POS-004 as PR #82 (`62002d8`, run `36625254435`), with their closures as PR
#79 and PR #81. Every Story closed on the local gates plus a merged CI receipt,
and the suite grew to 99 live-PostgreSQL cases running in CI. `done` means epic
implementation closure only: it is **not** a production-readiness statement. The
open debt ([[TD-016]], [[TD-017]], [[TD-018]], [[TD-019]], [[TD-020]],
[[TD-021]]) and [[EPIC-20]] Production Hardening remain, and a completed sale
still cannot be reversed or refunded until the slice [[TD-018]] tracks lands.
