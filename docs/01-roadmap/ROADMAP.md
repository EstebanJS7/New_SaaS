---
type: roadmap
status: active
updated: 2026-10-22
---

# ROADMAP

| Epic    | Name                               | Status | Depends on                |
| ------- | ---------------------------------- | -----: | ------------------------- |
| EPIC-00 | Foundation                         |   done | —                         |
| EPIC-01 | Database/Auth/Tenancy              |   done | EPIC-00                   |
| EPIC-02 | RBAC/Entitlements/Tenant Settings  |   done | EPIC-01                   |
| EPIC-03 | Staff Shell/Design System/Branding |   done | EPIC-01                   |
| EPIC-04 | Customers                          |   done | EPIC-02, EPIC-03          |
| EPIC-05 | Veterinary Patients                |   done | EPIC-04                   |
| EPIC-06 | Clinical                           |   done | EPIC-05                   |
| EPIC-07 | Scheduling                         |   done | EPIC-04, EPIC-05          |
| EPIC-08 | Portal                             |   done | EPIC-04, EPIC-05, EPIC-07 |
| EPIC-09 | Catalog/Taxes                      |   done | EPIC-02                   |
| EPIC-10 | Inventory                          |   done | EPIC-09                   |
| EPIC-11 | Suppliers/Purchases                |   done | EPIC-10                   |
| EPIC-12 | POS/Payments                       |   done | EPIC-09, EPIC-10          |
| EPIC-13 | Cash                               |   done | EPIC-12                   |
| EPIC-14 | Billing                            |   done | EPIC-12                   |
| EPIC-15 | Fiscal Abstraction                 |   done | EPIC-14                   |
| EPIC-16 | SIFEN Direct                       |   done | EPIC-15                   |
| EPIC-17 | Notifications                      |   done | EPIC-07                   |
| EPIC-18 | Dashboards/Reports                 |   done | prior domains             |
| EPIC-19 | Imports                            |   done | EPIC-04, EPIC-05          |
| EPIC-20 | Production Hardening               |   done | MVP feature epics         |

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

[[EPIC-17]] Notifications closed on 2026-10-17. All five Stories are `done` and
the module is documented at `docs/05-modules/Notifications.md`. The epic
delivered the delivery aggregate and its queue contract, the fail-closed channel
boundary with real SMTP and WhatsApp adapters, the tenant-configurable
appointment reminder whose cancellation removes the pending job, the three
emitters the epic owed (`AppointmentConfirmed`, `AppointmentCancelled`,
`FiscalApproved` — the last from **both** paths that enter `APPROVED`), the
send-time content builder with its gate, the fiscal notice, and the
permission-gated read surface.

**Pushed on 2026-10-18**, and its CI receipt is still absent for a reason worth
recording: `.github/workflows/ci.yml` triggers on pushes to `main` and on pull
requests TARGETING it, so a feature branch's push produces no run at all. The
receipt arrives with the first pull request.

**What `done` does not mean**: no message has crossed a real provider. No SMTP
credentials and no WhatsApp Business account exist in this repository, so the
adapters are proven against the deterministic fake and their own unit cases, and
the live run is recorded **pending by name** in `docs/10-qa/CI-EVIDENCE.md`. No
branch of this epic has been pushed, so it has no CI receipt either; the local
gates and the fresh-PostgreSQL migration pass are the evidence. Its remaining
open item is [[TD-046]] — the attempt log the aggregate does not keep, a
recorded **decision** rather than a pending fix; [[TD-045]] and [[TD-047]] were
resolved post-closure in `fix/notif-tail-advisories`, and [[TD-004]] (password
reset) is **unblocked in principle** — email delivery now exists — while staying
`open` until it is actually implemented. `docs/05-modules/Notifications.md` is
the module document and `docs/10-qa/CI-EVIDENCE.md` carries the evidence block.

## Architecture baseline

Architecture freeze: PRD v1.3. Structural changes require an accepted ADR.

[[EPIC-17]] Notifications moved to `in-progress` on 2026-10-17. WU-A is the epic
file, five Stories and four Decisions, and it carries no source: the epic
existed only as a row in the table above. The four accepted Decisions are
[[DEC-058]] (email ungated, WhatsApp behind the existing `whatsapp` code, no
thirteenth feature code), [[DEC-059]] (this epic publishes
`AppointmentConfirmed`, `AppointmentCancelled` and `FiscalApproved`, declaring
the EPIC-07 and EPIC-16 crossings as **boundary debt**), [[DEC-060]] (the
reminder fires 24 h before, configurable per tenant, idempotent by a dedupe key
per (appointment, channel, window), and cancelling the appointment removes the
pending job) and [[DEC-061]] (one channel port, a deterministic fake, real
adapters behind it, fail-closed selection like `FISCAL_PROVIDER`, and the live
run recorded **pending** because no operator credentials exist). The three
emitters appear in no file today, so this epic gives
`packages/shared/src/events/` its first production producer, and the email
library's choice is an ADR gate on [[NOTIF-002]]. [[TD-004]] stays blocked on
[[NOTIF-002]]. This is a kickoff record, **never** a readiness claim.

[[EPIC-16]] SIFEN Direct moved to `done` on 2026-10-15 after its Stories closed
with the required CI checks green. The kickoff and the decisions were PR #104,
FISC-007 PR #105, FISC-008 PR #106, FISC-009 PR #107, FISC-011 PRs #108 and
#112, FISC-010 PR #111, FISC-012 PR #113, FISC-015 PR #114, FISC-016 PR #115,
FISC-013's runbook and KuDE PRs #117 and #119, and the five units that closed
the findings the epic's own reviews raised — TD-033's two items and TD-034
through TD-037 — as PRs #116, #118 and #120 through #123. The merged tree
carries **43 migrations** and a green
`pnpm test`/`typecheck`/`lint`/`build`/`format-check` set (database 491, fiscal
762, API 1214 with the live-PostgreSQL spec's **266 cases**, worker 163, web
1087), and `SIFEN-BASELINE.md` grew §24–§26 as the epic's protocol constants
earned their citations. **The certification run has not been performed.** It is
an operator act against the DNIT's own environment and needs the habilitación, a
certificate from a real PSC and the production CSC issued at the emitter's
`ingreso`, so `docs/10-qa/CI-EVIDENCE.md` records the matrix as **pending** and
the epic's limitation list names what it leaves unrun. This is an epic-closure
record, **never** a SIFEN-readiness claim.

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

[[EPIC-18]] Dashboards/Reports moved to `done` on 2026-10-19, by evidence-based
closure against a **local** gate run rather than CI: the branch was never
pushed, and `.github/workflows/ci.yml` triggers on pushes to `main` and on pull
requests targeting it, so a feature branch produces no run. The receipt arrives
with the first pull request. The closure evidence is the block in
`docs/10-qa/CI-EVIDENCE.md`: format, lint, typecheck, build and the full test
set green (api **1634**, web **1282**, database 549, worker 245, notifications
84, fiscal 788, shared 23 and the rest), the live-PostgreSQL lane at **266/266**
over **50 migrations**, and the applied catalog at **64 permissions**.

`done` means epic implementation closure only: twelve report views over PRD §31,
a CSV export, a dashboard, and the clinical entry surface the veterinary due
reports depend on. It is **never** production readiness. **No spec in `apps/e2e`
has ever executed** — the environment has no Docker, so four specs are written,
statically valid and unrun, and that is the epic's largest unproven surface. No
native review verdict exists either: the receipt-driven review facade projects
working-tree changes and this epic commits every work unit, so `start` requires
a lineage that is never created (recorded in `CI-EVIDENCE.md`, and not worked
around). Two independent adversarial verifications stand in its place, and they
found **two blocking defects the gates were green on** — the `Date.UTC`
two-digit-year hole and the browser-zone date conversion — plus three more found
by self-review. [[TD-051]] through [[TD-056]] remain open or accepted, and
[[EPIC-19]] Imports and [[EPIC-20]] Production Hardening are untouched.

The kickoff record, retained as history:

[[EPIC-18]] Dashboards/Reports moved to `in-progress` on 2026-10-19. The epic
existed only as a row in the table above: no epic file, no Stories, and no
reporting code, permission, route or CSV path anywhere in the repository. The
kickoff is the epic file, nine Stories and five accepted Decisions — [[DEC-062]]
(no feature-code gate, a `reports.read`/`reports.export` family, and one
aggregation path shared by the dashboard and the reports), [[DEC-063]] (periods
resolved in `TENANT_TIME_ZONE` with five presets and a 366-day bounded range),
[[DEC-064]] (`sale.completed_at`, `purchase.received_at` and
`cash_session.closed_at` become the reporting truth), [[DEC-065]] (a per-item
`catalog_item.low_stock_threshold` and a staff-entered clinical `next_due_at`)
and [[DEC-066]] (CSV is synchronous and bounded, not queued).

Exploring the schema rather than the PRD is what shaped the kickoff: PRD §31
asks for eleven reports and **three of them had no data source**. `sale`,
`purchase` and `cash_session` carried a terminal status and no instant, so
"sales by period" could not distinguish a draft from revenue; no table anywhere
held a low-stock threshold; and `clinical_vaccination` and `clinical_deworming`
stored only `administered_at`, making "upcoming" and "overdue" incomputable.
[[REP-001]] is therefore the epic's first Story, and it touches five
already-`done` epics' write paths — [[DEC-064]] and [[DEC-065]] declare those
crossings instead of smuggling them in as report plumbing. This is a kickoff
record, **never** a readiness claim.

[[EPIC-19]] Imports moved to `done` on 2026-10-22, merged-ready as PR #146 with
the required checks green on run
[`39774118687`](https://github.com/EstebanJS7/New_SaaS/actions/runs/39774118687):
`Database migrations`, `Lint, Typecheck, Test, Build`, `DTE XSD validation` and
the **browser lane at 22 passed / 1 skipped**. This closure has a real CI
receipt, unlike [[EPIC-18]]'s: the epic's own surface had to run in a browser
before it could claim anything. The full record is the EPIC-19 block in
`docs/10-qa/CI-EVIDENCE.md`.

`done` means epic implementation closure only: CSV imports for customers and
patients, asynchronous, with validation, preview and a per-row result summary.
It is **never** production readiness. **XLSX is not implemented** — PRD §32 says
"CSV/XLSX" and [[DEC-068]] records the deviation rather than editing the PRD
([[TD-057]]). **The uploaded artefact's retention has no approved policy behind
it** ([[TD-058]]), and the worker's terminal path does not delete the file; the
API commands and the TTL sweep do. And [[TD-060]] means the browser lane cannot
run an import end to end: the environment has no shared object storage, so the
full-flow test exists and skips with the reason named, while a second test
proves the half the lane can reach — the multipart proxy, the surface, the
queue, the claim and the worker's boot. Four iterations of that lane each
produced a real finding rather than a selector fix, which is recorded rather
than smoothed over.

[[EPIC-20]] Production Hardening moved to `in-progress` on 2026-10-22. The epic
existed only as a row in the table above. The kickoff is the epic file, seven
Stories and five accepted Decisions — [[DEC-074]] (which half of PRD §29/§30 is
code in this repository and which is an operational runbook, and that the
restore must be _executed_ rather than promised), [[DEC-075]] (CSP with a
per-request nonce on `script-src` and `style-src`, no `unsafe-inline`),
[[DEC-076]] (the rate limit budget moves to Redis as one atomic sliding window
and degrades open to the in-process window when Redis is unavailable),
[[DEC-077]] (shared object storage joins the environment contract in compose
_and_ CI) and [[DEC-078]] (report performance becomes a seeded dataset plus a
declared budget, gated on the query plan as well as the clock).

Exploring the code rather than the PRD reshaped the plan twice. **Two of PRD
§29's bullets were already satisfied** and the epic's job there is to prove and
record them, not to rewrite them: CORS is an exact-match allowlist with
deny-by-default `403` and a real integration test, and the global exception
filter returns a generic message for every 5xx so no stack trace can reach a
client. And the login failure budget turned out to cover **four** paths — staff
login, staff password recovery, portal login and portal password recovery —
rather than the one [[TD-005]] names, which is the argument for fixing it at the
service seam.

This is a kickoff record, **never** a readiness claim. The epic's closure is the
first in this chain that can state more than "implementation closure" about PRD
§29, because every control it adds has a test that fails when the control is
removed; about PRD §30 it will state something narrower, because the backup
schedule and the PITR window are hosting configuration that this repository can
only require and rehearse.

[[EPIC-20]] Production Hardening moved to `done` on 2026-10-22 and was **merged
as PR #148** (merge commit `182c64b`) with all four required checks green on the
pull request and again on `main` after the merge, run
[`40046359303`](https://github.com/EstebanJS7/New_SaaS/actions/runs/40046359303):
`Database migrations`, `Lint, Typecheck, Test, Build`, `DTE XSD validation` and
the **browser lane at 23 passed / 0 skipped**. The pull-request receipt was run
[`39804810183`](https://github.com/EstebanJS7/New_SaaS/actions/runs/39804810183).
The full record is the EPIC-20 block in `docs/10-qa/CI-EVIDENCE.md`.

Seven Stories, six Decisions ([[DEC-074]] through [[DEC-079]]) and nine Tech
Debt items resolved with executed evidence. The epic is the first in this chain
whose closure rests on a green browser lane, and that is exactly what turned two
of its claims from implemented into proven: the import that **skipped** at
[[EPIC-19]]'s closure ran here (`imports.spec.ts:176`, 6.4s) because object
storage became part of the environment contract, and the live-PostgreSQL suite
passed **266/266** on a CI runner at UTC while the same suite passes at
`America/Asuncion` locally.

`done` means epic implementation closure: PRD §29 is satisfied by controls that
each have a test which fails when the control is removed — a CSP with a
per-request nonce and no `unsafe-inline` anywhere, CORS and the absence of stack
traces recorded as already-satisfied rather than rewritten, and a login failure
budget that is genuinely shared across replicas instead of documented as
single-replica. PRD §30's first half was already code and is proven; its second
half was **rehearsed**, not promised: a restore drill that recovered to an
instant before a write and found it absent, and to an instant after it and found
it present.

It is **not** a production-readiness statement, and this epic is where that
sentence finally has a shorter gap behind it. Production readiness needs three
things this repository cannot supply from here: a hosting provider that honours
the backup schedule, retention, PITR window and RPO the runbook specifies
([[DEC-074]]); a user-facing latency target for reports, which does not exist in
the PRD and whose measured value today is ~4,081 ms for a month of sales
([[TD-063]]); and a report cap that is not held down by a driver's statement
shape ([[TD-062]], [[DEC-079]]).

Three defects are worth naming because they were invisible to a green suite and
only a real engine could show them. The completed-sales cap of 20,000 was
**unreachable**: the relation load binds one parameter per parent row, so
PostgreSQL refused at about 16,383 and the documented refusal was dead code — a
large period returned an HTTP 500 instead of the sentence telling the user to
narrow it. Report latency had never been measured and is four times the budget
it was first measured against. And the MinIO image the epic added **does not
exist** on Docker Hub any more, which failed the browser job on the first CI run
of this very pull request.

The open debt remains open with its trigger intact: [[TD-020]] and [[TD-058]]
need an approved retention policy before any destructive cleanup, [[TD-026]] is
a public response-shape change that needs its own Decision, [[TD-051]] is
trigger-driven, and [[TD-061]], [[TD-062]] and [[TD-063]] are the three this
epic created.
