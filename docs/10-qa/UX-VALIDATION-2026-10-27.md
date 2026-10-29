---
type: qa
status: active
related_stories: [UX-002, UX-003]
updated: 2026-10-28
---

# Staff workflow validation — 2026-10-27

## Runtime

Docker Compose was started with the existing PostgreSQL/Redis/MinIO volumes.
Docker CLI access required execution outside the sandbox; the engine was
available. Starting `pnpm dev` from this checkout resolved the older English
preview. The shell/dashboard show Spanish and `Gs. 185.000`.

Global Node 22.14.0 has `tz=2024b` and reports September 2026 Asunción as
GMT-04. The official portable Node 22.23.4 archive was SHA-256 verified:
`tz=2026e`, native ABI 127 and the correct GMT-03 offset. This process-local
runtime starts API, worker and web with the existing native dependencies. Node
24's ABI 137 could not load the existing libxmljs2 binary; that attempted stack
was stopped. The global Node installation was not changed. See [[TD-064]].

## Automated evidence

- API: 25/25 patient lookup/read HTTP cases passed with the real Fastify guard
  chain over synthetic in-memory data. Covers both permissions, entitlement,
  tenant filtering, allowlists, strict body, limits, duplicate IDs, inactive
  history, identical foreign/unknown 404s and search-log privacy.
- Web: 54/54 agenda/selector/BFF cases passed using Node 22.23.4. Existing tests
  were synchronized to Spanish, named selection and confirmation dialogs;
  service-span, optimistic-version and conflict assertions were retained.
- API/web TypeScript and targeted ESLint passed. Web production build and
  verify-build-output.mjs passed; git diff --check passed with existing LF/CRLF
  warnings only. The development stack was restarted afterward. The broader
  environment debt remains open in TD-064.

## Browser evidence

- Real demo session: `Bob` found Bobby; `Ana` found Bobby and Michi with primary
  guardian Ana García through the new PostgreSQL query.
- Tab reached the native radio results and Space selected Bobby. Missing dates
  produced a linked error and moved focus to the start field. Late-arriving
  options keep explicit empty branch/professional choices.
- Calendar/list/request labels resolved names through bounded identity reads.
- A confirmation started on Volver; Shift+Tab reached confirm, Tab returned to
  Volver, and Escape restored the trigger on a fresh opening. No rejection was
  submitted. This is keyboard evidence, not a full screen-reader/WCAG audit.
  Reference:
  [WAI-ARIA dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
- The agenda link opened Bobby's staff record and existing draft. Clinical
  closure confirmation was opened and cancelled; no clinical text changed.
- POS search/local cart review found a grouped-prefill ambiguity and corrected
  it: API reference `120000.00` now enters the field as `120000,00`, while the
  read-only amount is `Gs. 120.000`. The cart was cleared; no sale/payment was
  recorded in this manual review.

## Follow-up — 2026-10-28

After the maintainer requested continuation, targeted verification passed
131/131 cases across seven web suites: locale 17, cart 14, payments 15, clinical
workspace 31, agenda 42, selector 4 and patient proxy 8. This is a new web run;
the 25 API cases above remain the 2026-10-27 evidence.

Save-before-close exposed a stale version in the clinical close command
immediately after a successful save. The authoritative response now
synchronously updates the encounter ref before the chained command. The test
asserts PUT version 1 followed by close version 2. Conflicted saves and edits
arriving mid-save preserve local text and issue no close. Cancelling clinical or
payment confirmation issues no corresponding command; failed payment completion
keeps the modal/error visible.

Strict local parsing covers grouped prices, fractional quantities, invalid
formats and values above JavaScript's safe-integer limit. Payment sum assertions
retain exact decimal arithmetic and the six approved methods.

Web TypeScript and targeted ESLint passed. Production build compiled, generated
28 static pages and passed `verify-build-output.mjs`. The initial sandbox build
hit EPERM creating a `.next` directory; the rerun outside the sandbox succeeded.
`git diff --check` passed (existing LF/CRLF warnings only). Docker services were
restarted using their existing volumes and all three reported healthy.

## Pending

UX-002 remains in progress: full browser mutation journeys against the running
API/database and screen-reader review are not inferred from component/proxy
tests.

## Browser mutation journeys — 2026-10-28

The maintainer authorized completing the local journeys. Existing demo records
were used; no external payment processor or real clinical information was used.
The generated records remain as auditable demo evidence, without deletion.

- Agenda: searched Ana, selected Michi, checked missing/invalid form feedback,
  created 28 October 16:00–16:30 and explicitly confirmed it. Confirmation
  starts on Volver; Shift+Tab cycles to confirm. The visible patient link opens
  Michi.
- Clinical: opened the new draft `e9fd87bb`, entered explicitly synthetic text,
  opened closure, cancelled with Escape and observed focus return and preserved
  text. Then saved/closed successfully against the API/PG. The resulting entry
  is Cerrada and offers explicit linked amendment rather than editing.
- POS: added the demo consultation, entered grouped `120.000`, created draft
  `eff169fa` and observed the authoritative Gs. 120.000 total. `119.999` blocked
  review; correcting the amount enabled it. Cancel preserved payment; explicit
  QR confirmation completed the local sale. QR here records a payment method; it
  does not contact an external payment processor.
- Found and fixed FullCalendar's missing named-timezone implementation: a 16:00
  appointment appeared at 19:00 in the grid while the list showed 16:00. A local
  Intl adapter now uses the existing tenant conversion helpers, without adding
  dependencies. The browser grid and list both show 16:00–16:30 afterward.
  Reference:
  [FullCalendar named zones and UTC coercion](https://fullcalendar-site.pages.dev/docs/timeZone).
- FullCalendar regression uses a real Calendar instance: rendering preserves
  UTC, local rescheduling yields the correct UTC instant, and historical offset
  plus seconds/milliseconds are covered. 44/44 timezone/agenda tests passed;
  typecheck and targeted ESLint passed.
- Production build after these browser fixes passed, including all 28 generated
  pages and `verify-build-output.mjs`. API, worker and the built web were
  started afterward for local review; no commit or push was made.
- Corrected raw API quantity `1.000` in POS review to local display `1`.
- Environment interruption: PostgreSQL was initially stopped and backend startup
  failed. Restored containers, then restarted API before resuming. Errors from
  that outage are not reported as successful workflow evidence.

Known limits: full screen-reader audit remains outstanding. Login text remains
English, native datetime picker appearance follows the browser locale, and
professionals still display shortened IDs; these were observed, not claimed as
fully polished. No claim is made for Portal localization or external payments.

## Access localization and professional names — 2026-10-28

- Spanish login, recovery and reset: labels, pending state, conditional recovery
  acceptance, uniform credential/token refusal and rate-limit feedback.
- Errors/successes use alert/status regions; login errors describe both fields;
  reset length/mismatch errors describe the relevant field and set aria-invalid.
  Headings and aria-busy states are present. These are semantic/component
  checks, not spoken-output or screen-reader certification.
- DEC-082: existing agenda options select and project membershipId/displayName
  only. Selectors and list use the name; IDs still drive commands and filtering.
- Targeted web verification: 64/64 (43 agenda, 7 login, 6 recovery, 8 reset).
  API: 45/45 service and 18/18 HTTP integration cases. The first HTTP run failed
  with sandbox EACCES to its test port; unsandboxed rerun passed, including
  tenant isolation and allowlisted professional identity.
- API/web typecheck, targeted ESLint and both builds passed. Web generated all
  28 pages and passed verify-build-output.mjs. No migration, commit or push.
- New visual/screen-reader verification is pending: Computer Use reported "Local
  browser use is disabled in Work settings". The user was given the documented
  browser-settings link and Computer Use setup guidance. No browser restriction
  was bypassed and no new visual result is inferred from tests.

## Resumed visual verification — 2026-10-28

The integrated browser became available again. A temporary connection failure
(`browser.user is unavailable`) was resolved by resetting the tool session; no
app security setting was bypassed and no application code changed here.

- Login observed in Spanish with separate heading, labeled fields and disabled
  empty submit. Enter submitted synthetic invalid credentials. Uniform Spanish
  refusal appeared; password was empty afterward and described by login-problem.
- Recovery link opened its Spanish form. Entered a synthetic address and
  observed the submit affordance enabled, then returned by keyboard without
  sending email.
- Reset page without a token showed the Spanish missing-link state and a working
  return-to-login link. No credential reset was performed.
- Existing demo owner logged in with Enter. Agenda showed Demo Veterinarian in
  filter, create and approval controls and both appointment list rows. Selecting
  the professional filter preserved the expected appointments and human names.
- Opened request rejection confirmation only: initial focus Volver; Shift+Tab
  moved to confirm, Tab wrapped back, Escape closed it and restored the
  rejection trigger. The pending request was preserved; no
  approval/rejection/create was submitted during this review.
- Screenshots: ux002-acceso-espanol.png and ux002-profesionales-validados.png in
  the task's visualization directory. The reviewed tab remains open for the
  user.

The visual blocker for these changes is resolved. This validates the current
rendered interface, accessible DOM names/descriptions and keyboard behavior; it
does not certify spoken announcements or a full screen-reader/WCAG audit.
Earlier recorded automated/build results remain dated evidence, not a new run.

## Clinical form and closure follow-up — 2026-10-28

Scope: UX-002 presentation and navigation protections over existing clinical
commands; no new API, migration or clinical-to-appointment/sale linkage.

- Targeted Vitest: 53/53 (37 clinical workspace, 10 patient detail, 6 overview).
  Six added regressions cover spaces/StrictMode autosave, oversized fields,
  explicit retry after failed save, pending navigation/switch protection and
  exit cancellation, closure review content, and persisted read-only closed
  content. Existing conflict, permission and save-before-close tests remain
  passing.
- Targeted ESLint and web typecheck passed. Final production build and output
  verification passed, including a keyboard-focusable scrollable summary for
  longer clinical text. Existing Next.js ESLint-plugin/project-reference
  warnings remain informational.
- Real demo browser: created encounter `dafb5bd5` on Michi, entered explicitly
  synthetic reason/history/diagnosis/client summary, observed autosave version 1
  -> 2 and all-changes-saved state, reviewed closure, cycled focus through
  buttons, cancelled with Escape and observed focus return to the trigger.
  Reopened review, confirmed close and observed CLOSED/read-only content.
- Navigated back to Agenda/List, observed Michi and Demo Veterinarian, opened
  Manage then the patient link, and observed the persisted closed consultation.
  No appointment transition, sale, payment, amendment or Portal change was made.
- Evidence in the session visualization directory: `clinical-close-review.png`
  and `clinical-closed-record.png`. Screenshots contain synthetic demo content.

Limits: no full screen-reader/spoken-output audit. Back/Forward and arbitrary
programmatic routing protection remains [[TD-065]]; links and native unload are
covered. The clinical DTO cannot establish appointment/professional ownership,
so only the existing patient-based navigation is claimed. Clinical closure does
not complete an appointment or generate a sale.

## TD-065 — same-document draft recovery (2026-10-28)

44 clinical tests and 16 detail/overview tests passed (60 total for this scope).
Seven new recovery cases cover route remount, selection, failed saves, version
drift, denied fresh read, remotely closed records, late save with a newer local
edit and memory isolation/expiry/clear. TypeScript and targeted ESLint passed.

One brief browser journey: on Michi created synthetic draft `49cdc81f`, entered
an oversized 10,800-character diagnosis (invalid, so no successful autosave),
used Back to the list and Forward to the patient, observed automatic draft
selection and the entire text plus validation state, corrected the field and
explicitly saved. Screenshot: `td065-draft-recovered.png`. This is recovery, not
cancellation of browser traversal; no history state is patched. See TD-065 for
ten-minute, same-document memory limits. Earlier loss-of-history-navigation
notes are historical.

## UX-006 — persistent care links (2026-10-28)

Approved DEC-083 / PRD §13.1: explicit appointment-to-encounter and
encounter-to-sale associations. Existing independent operations remain valid.

- Real PostgreSQL integration: **9/9**, using a uniquely named disposable
  database with all migrations applied. Tests exercise tenant/patient isolation,
  permission and entitlement denials, unknown/foreign 404, concurrent idempotent
  retry, incompatible-origin 409, many encounters/sales, single sale origin,
  atomic audit rollback, composite FKs, immutable links and closed-record
  preservation. RequestContext and AuditWriter are real; the permission resolver
  and entitlement decisions are controlled substitutes. Main local `newsaas`
  received only the additive migration, with no reset or data deletion.
- Web directed set: **80/80** (45 clinical workspace, 5 POS recovery, 6
  association confirmations, 5 appointment context, 19 clinical proxy). Final
  re-run: **12/12** association/context cases, adding explicit click before
  service suggestion. These runs overlap and must not be summed. UI tests use
  synthetic responses; proxy tests validate method/path boundaries.
- API clinical regression: **26/26** service, **10/10** HTTP. HTTP initially hit
  sandbox EACCES binding ports; the permitted run outside the sandbox passed.
- Prisma generation/database build, API/web types, targeted ESLint, API build,
  web production build and its output verification passed. Existing
  informational Next TypeScript-reference and ESLint-plugin warnings remain.

No new browser round or end-to-end financial transaction was performed in this
stage, following the user's preference for bounded checks. This is not a claim
of visual/screen-reader certification. The appointment service is suggested only
on click from currently loaded active catalog data; billing customer and payment
remain explicit. Linking never completes appointments, closes encounters,
changes sale state or creates stock/cash/payment movements. Failed linking
preserves the existing encounter/sale so the association can be retried without
recreating it.

Runtime note: a sandboxed dev restart could not reach Docker PostgreSQL (P1001).
Docker services were healthy; the permitted host-process restart was used
instead. This was an execution-environment limitation, with no credential/schema
change.

Final host restart: API health and web health proxy returned HTTP 200; worker
connected to Redis.

## UX-007 — staff session expiry / context recovery (2026-10-28)

Scope: staff frontend composition over existing session and authorization APIs.
No cookie policy, backend authentication strategy, permission, financial command
or schema change. QueryClient is allocated per provider mount.

Directed cases cover safe local destinations/UUID context (external, Portal,
API, traversal and injected query rejection); overwritten middleware header;
query/mutation 401 interruption; 403/404/500/network distinctions; Portal
separation; focused notice; saved encounter/sale return references; native full
document navigation after successful login; authorized clinical selection and no
automatic create/save/replay. Existing uncertain-POS recovery remains covered.

The initial run exposed a missing header test double, an obsolete English
Dashboard expectation (current UI is Panel), and a malformed accented string in
the new login test/copy. These were corrected, not suppressed. Lint also
required typed request inspection, Error rejection objects and control-character
handling outside a regular expression. Re-runs cover the corrected cases.

No browser session was expired and no real payment/clinical command was
executed. The browser round was deliberately omitted per the agreed bounded
verification. The return destination is not an authorization grant: all returned
data is read again through existing tenant/permission checks. Fresh document
navigation drops old query/draft memory; no sensitive recovery data is written
to browser storage.

Final UX-007 evidence: 106 distinct scoped cases passed across directed runs (47
clinical, 5 POS recovery, 12 middleware, 13 safe return paths, 7 session
boundary, 8 login form, 10 staff layout, 4 document navigation). Auth/layout/
navigation final re-run was 22/22; clinical return final re-run was 2/2 with 45
other cases intentionally skipped after their earlier passing execution. These
runs overlap and are not additive. Web typecheck, targeted ESLint, production
build and build-output verification passed. A final build includes the corrected
Spanish login notice; its server artifact contains no replacement characters.
Existing informational Next project-reference/plugin warnings remain.

Runtime smoke: API health and web health proxy returned 200; worker connected to
Redis. An unauthenticated HTTP request to a synthetic patient/encounter URL
returned 307 to staff login, preserving UUID context and discarding the extra
notes query key. No browser, credentials or clinical mutation were used.

## UX-008 — server patient search and pagination (2026-10-28)

Scope: patient list only. The legacy GET and agenda lookup stay compatible; no
sale/payment/clinical command, migration or dependency changed.

- Real PostgreSQL: 7/7 cases in a disposable database, with all migrations and
  the actual search service. Fixtures cover two tenants, 22 own active patients,
  two inactive, four foreign, primary/secondary guardians and inactive customer
  data. Validates bounded pages, exact counts, matching, ordering, out-of-range
  handling, tenant isolation, response allowlist and customer-read suppression.
  Permission and entitlement decisions are controlled substitutes here; Prisma
  queries/transactions, constraints, data and results are real.
- HTTP: 18/18 existing lookup cases plus 14/14 new search boundary cases. These
  boot the application guard chain over the HTTP harness. The new service read
  is substituted to isolate authentication, patients.read, patient-only access,
  strict body validation and query/log privacy; real query behavior is covered
  separately in PostgreSQL. No skipped PG cases are claimed as executed tests.
- UI/proxy initial directed run: 24/24 (11 list, 9 patient proxy, 4 agenda
  selector). Final list re-run includes a Spanish retry/no internal-error leak
  regression. List tests cover actual server-request body/page metadata,
  lifecycle/order resets, stale response protection, search context on remount,
  expiry/new-client clearing, permission hints, empty and validation states.

Tests use synthetic data/responses. No browser round, real patient mutation,
financial command or production service was used. Context restoration was
validated as a same-document component remount with the same QueryClient, not as
an observed browser Back/Forward session. The temporary PostgreSQL test database
was dropped by the runner; the local demo database was not reset or seeded.

Final directed list tests: 12/12. After using skipToken for the non-fetching
context observer, the 3 context/retry cases passed again without missing-queryFn
warnings; 9 previously passing cases were intentionally skipped in that re-run.
Final scoped lint and API/web typechecks passed. API build passed. The distinct
case count is 64 across runs: 7 PostgreSQL, 14 new HTTP, 18 lookup HTTP, 12
list, 9 proxy and 4 agenda selector. Overlapping re-runs must not be added to
this count.

Final web production build and build-output verifier passed. Existing
informational Next TypeScript-reference and ESLint-plugin warnings remain; no
new blocker.

Runtime smoke after restart: API health 200, web health proxy 200, worker connected
to Redis, and POST /patients/search without a session returned 401. No browser,
credentials, patient data or mutating command was used for this check.
