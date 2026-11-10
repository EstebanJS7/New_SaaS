# `@newsaas/e2e` — the browser lane

A **runnable test target, not a deployable service**. It deploys nothing, ships
nothing, and runs in CI and on a developer's machine only.

## Why it exists

Every other suite in this repository reads code or drives one layer. This one
drives a **browser** against the **built** apps, which is the only way to catch
the class of defect this session kept finding by hand: a page that does not
exist, a proxy that answers 500, a form that renders and does not submit. Three
of those were found by a human looking or by a hand-run `curl`, and none by a
test.

## Running it

```bash
docker compose up -d          # PostgreSQL and Redis
pnpm install
pnpm build                    # the lane drives the BUILT apps, not the dev servers
DATABASE_URL=postgresql://newsaas:newsaas@localhost:5432/newsaas \
  pnpm --filter @newsaas/e2e e2e
```

The lane migrates and seeds the database itself (`global-setup.ts`), starts the
API and the web app itself (`webServer`), and reuses them if you already have
them running locally.

A failing run writes a trace; `pnpm --filter @newsaas/e2e e2e:report` opens it.

## What each spec needs

| spec                                                      | needs                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `staff-sign-in`, `portal-sign-in`                         | PostgreSQL, Redis, the built API and web                                             |
| `staff-recovery`                                          | the same, plus the **worker** (it mints the token at send time) and an **SMTP sink** |
| `staff-team`                                              | the same as `staff-recovery`: the invitation's activation link leaves by mail        |
| `payment-detail`, `sale-reversal`, `recoverable-attempts` | PostgreSQL, Redis, the built API and web                                             |
| `branch-stock`                                            | PostgreSQL, Redis, the built API and web                                             |
| `branch-reports`                                          | PostgreSQL, Redis, the built API and web                                             |
| `electronic-credit-note`                                  | the same, plus the **worker** as fiscal pipeline, object storage and `DTE_XSD_DIR`   |
| `kude-delivery`                                           | the same as `electronic-credit-note`, plus the **SMTP sink**: one worker does both   |
| `tenant-settings`                                         | PostgreSQL, Redis, the built API and web                                             |

The recovery spec starts the worker itself and listens on port 2526 as a minimal
SMTP server, because there is no other place the link exists: the channel fake
never logs a recipient, the delivery row does not hold the message, and a
plaintext token is never stored. It also runs the real `nodemailer` adapter.

**Every run uses a fresh recoverable identity.** A staff recovery delivery is
deduped per `(profileId, hour)`, the delivery table refuses a DELETE by design,
and a profile can never be erased once it has acted. The config therefore sets
`DEMO_RECOVERABLE_EMAIL` to a new address per run, which is a new profile id,
which is a new dedupe key — and nothing is deleted, because the identities
earlier runs used are history.

The worker's environment is the complete set a real adapter needs
(`NOTIFICATION_EMAIL_ENV_VARS`): `EMAIL_PROVIDER=smtp`, `SMTP_HOST`,
`SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and
`NOTIFICATION_EMAIL_FROM`. The channel module refuses a boot when any of them is
missing, which is the right rule and which the lane had to learn one variable at
a time.

### The sales specs prepare through the BFF

The demo seed creates no catalog item, no stock and no cash register, so
`payment-detail`, `sale-reversal` and `recoverable-attempts` create what they
sell the way a clinic would — a catalog item, a received purchase, a register —
through the same `/api/...` proxy the browser uses (`support/staff.ts`). Names
carry a per-run tag, and counts are taken per item, so the history earlier runs
left behind never changes an assertion.

A cash payment and a cash refund need **exactly one** open session at the sale's
branch. The helper closes extra open sessions it finds, and
`recoverable-attempts` leaves exactly the one it opened.

`recoverable-attempts` loses an answer for real: `page.route` lets the command
reach the API, which commits it, and drops the connection before the page sees
the response.

`branch-stock` (MB-003) needs a second active branch for its purchase, filter
and transfer steps, and the sales specs need exactly one. It creates its own
`Sucursal stock e2e <tag>` branch, assigns the demo owner there, and in a
`finally` restores the owner's assignment and deactivates the branch; an active
branch with that prefix left by an interrupted run is deactivated first.

`branch-reports` (MB-004) needs a second branch with history. It creates its own
`Sucursal informes e2e <tag>` branch, assigns the demo owner there, and
deactivates it (restoring the owner's assignment) before the run ends; an active
branch with that prefix left by an interrupted run is deactivated first. Because
deactivated branches stay in the reports' branch filter, the lane cannot show
the "one branch, no filter" state; the web component test covers it.

`staff-team` invites a new address each run, for the reason the recovery
identity is fresh.

`tenant-settings` (CFG-001) edits the demo tenant's `sales`, `portal`,
`notifications` and `scheduling` settings through «Configuración › General»,
which every other spec shares: the sales flows read `requireCustomerForInvoice`,
the agenda and branch flows book under the conflict policy, availability and
blocks. It reads all four namespaces through the BFF before changing anything
and, in a `finally`, writes each back whole and asserts the read equals what it
found. There is no `DELETE` for a namespace, so a tenant that had no stored row
ends with one holding exactly the values it was already served. Lead hours,
weekday, times and the block's date vary per run; the browser runs in
`America/Los_Angeles` to prove minutes and block instants follow the clinic's
zone. A block is placed in December, when Paraguay is at UTC-03 under both the
old and the current tz rules.

### The fiscal specs share their setup

`electronic-credit-note` (NCE-001) and `kude-delivery` (FISC-021) configure the
tenant through «Configuración fiscal», sell, confirm and issue an invoice, and
wait for the worker to approve it with the same helpers
(`support/fiscal-issuance.ts`). The worker runs the fake SIFEN provider in the
TEST environment and signs the DE, so the lane needs the official XSDs
(`pnpm --filter @newsaas/fiscal fetch:dte-schemas`, then `DTE_XSD_DIR`) and the
object storage the signed XML and the KuDE are written to.

`kude-delivery` starts **one** worker with the fiscal variables and the mail
variables together (`startMailWorker(FISCAL_WORKER_ENV)`): `FiscalApproved` is
dispatched in-process, so the approval notice is scheduled by the worker that
approved the document, and two consumers of the fiscal queue would race for it.
The customer gets a per-run EMAIL contact, the notice's recipient. The spec
reads the raw message the sink captured and decodes the attachment
(`support/mime.ts`) to compare it byte for byte with what the KuDE route serves.
It does not decode the QR: no QR decoder is a dependency, so the image is
checked to be an SVG, and the text placeholder to be absent.

## What it does NOT prove

- **It is not the gate.** A browser test is slower and flakier than a unit test.
  The fast suites stay the primary evidence, and this lane is deliberately
  excluded from `pnpm test` — its script is `e2e` so turbo's root `test` task
  cannot pick it up and make the whole gate require a live stack.
- **It covers a handful of flows, not the product.** What is not in a spec is
  not checked.
- **Its selectors are a contract.** `data-testid` and visible text; a spec that
  breaks because copy changed is a spec telling you copy changed.

## Local environment note

Chromium needs `libasound.so.2`. Where it is missing and there is no root:

```bash
mkdir -p /tmp/pwlibs && cd /tmp/pwlibs
apt-get download libasound2t64 && dpkg-deb -x libasound2t64_*.deb ./extracted
export LD_LIBRARY_PATH=/tmp/pwlibs/extracted/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
```

CI (`ubuntu-latest`) installs it properly with
`npx playwright install --with-deps chromium`.

## Specialized clinical forms — isolated lane (UX-021)

Run from the repository root with installed dependencies, local Chrome and
Docker images postgres:16-alpine and redis:7-alpine already present:

    node scripts/verify-clinical-browser.mjs

Or use the package script e2e:clinical. No dependency installation is performed.
This dedicated lane NEVER loads .env or the broad demo seed. It creates its own
loopback PostgreSQL/Redis containers with tmpfs, a guarded disposable database,
synthetic staff/reader permissions and patients, isolated API/web builds and new
ports. It never reuses development HTTP servers. Containers are stopped on
normal success/failure; a force-killed runner requires removing only its named
test containers (the runner prints its artifact directory). No financial
operations, worker, mail or external provider is exercised; providers remain
fake.

clinical.playwright.config.ts and clinical-specs/ are independent from the main
specs/ lane. The config rejects a non-disposable or mismatched DB environment.
The lane enters through login → Home → Patients → patient detail using real
sidebar links (native mobile menu at 390 px). A DOM marker checks that these
links preserve the document required by temporary clinical recovery. TD-067
records the navigation diagnosis and bounded loading-boundary mitigation; this
is not certification of every staff destination. The runner starts compiled
applications, forwards real staff cookies through the BFF and checks persisted
rows/audit in real PG. A transport failure is injected only AFTER the real
create response/commit. CAS races inject a real second PUT between pre-read and
confirm. Viewports are desktop 1440x1000 and mobile 390x844, using Windows
Chrome headless in America/Los_Angeles to verify Paraguay instants. This is not
iOS/Android hardware, Safari/Firefox or screen-reader certification.

Artifacts/logs/screenshots live under the printed temporary directory; never
commit them. All content/identities are synthetic. Screenshots are CONFIDENTIAL
by clinical association; failed traces can contain disposable session cookies
and must be treated as RESTRICTED until test infrastructure is removed. No
storageState containing sessions is saved. See
docs/10-qa/UX-021-VALIDATION-2026-10-30.md.

UX-023 extends this same lane to 17 cases: correction reasons, per-record
before/after history for all three types at desktop/mobile sizes, and a clinical
reader without vet.clinical.history_read denied both the entry and actual API.
The writer has the specific history permission. Reference permissions are
compiled from current source into Temp rather than reusing or replacing dev
dist. Six new history screenshots were inspected; see
docs/10-qa/UX-023-VALIDATION-2026-10-30.md for separate simulated, PostgreSQL,
browser and visual evidence, including the initially failed integration.

UX-024 adds eight durable-draft cases (25 total): manual save/reload for all
three types, lost create responses recovered with their frozen command/key, an
uncertain correction blocked after reload, and confirmed-weight GET-only
recovery after a failed projection. Current full runs reproduced TD-067 before
these cases; a scoped result must not be reported as a full-lane pass.

For an explicitly scoped diagnosis, the same isolated runner accepts only:

    node scripts/verify-clinical-browser.mjs --grep "manual draft|lost durable|uncertain durable|durable receipt"

This preserves real login/links, retries=0, permissions and the original config.
Always record the selection, failures/not-run counts and separate evidence in
docs/10-qa/UX-024-VALIDATION-2026-10-31.md. It does not resolve navigation debt.

UX-025 closes that observed blocker with removal of the redundant global Next
loading boundary and two independent complete passes. The clinical config now
includes staff-navigation.spec.ts: 26 tests total, with 50 fresh browser
contexts inside the navigation test, real logins/links and a same-document
marker. Its first patient read is held until the client loading message is
visible. No retries, forced refreshes or alternative navigation are used.
Scheduler metadata attaches only on failure; traces remain synthetic/RESTRICTED
in Temp. See docs/10-qa/UX-025-VALIDATION-2026-10-31.md for the failed baseline
and limits.
