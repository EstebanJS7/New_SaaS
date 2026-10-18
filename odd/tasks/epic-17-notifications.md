---
feature: epic-17-notifications
epic: EPIC-17
status: in-progress
created: 2026-10-17
updated: 2026-10-17
branch: feat/epic-17-notifications
---

# EPIC-17 Notifications — ODD task tracker

## Goal

Give the platform a notification capability: a tenant-scoped delivery record,
two channels (`EMAIL`, `WHATSAPP`) behind one port, and the appointment reminder
PRD §24 requires — idempotent by a per-window dedupe key, and removed when the
appointment is cancelled.

EPIC-17 is also the epic that gives the in-process post-commit dispatcher in
`packages/shared/src/events/` its **first production producer**. The dispatcher
exists, is tested, and today has no caller: no catalog event
(`AppointmentConfirmed`, `AppointmentCancelled`, `FiscalApproved`, …) is emitted
by any service.

## TDD resolution

- Mode: **off**. Authoritative source: `openspec/config.yaml` sets
  `strict_tdd: false` and `rules.apply.tdd: false`.

## The maintainer's four decisions (accepted 2026-10-16 — not re-asked)

1. **Entitlements**: email is **ungated**; WhatsApp sits behind the existing
   `whatsapp` feature code, already seeded in
   `packages/database/src/reference-seed.ts` and mapped to the starter plan.
   **No thirteenth code** — PRD §10 fixes the twelve. → [[DEC-058]]
2. **Scope**: this epic publishes the three emitters that exist in **zero**
   files today — `AppointmentConfirmed`, `AppointmentCancelled`,
   `FiscalApproved`. That crosses EPIC-07's (scheduling) and EPIC-16's (fiscal)
   surfaces, and is declared here as **boundary debt**, not hidden. →
   [[DEC-059]]
3. **Reminder**: 24 h before the appointment, configurable per tenant through a
   typed `notifications` settings namespace with a 24 h default. A **BullMQ
   delayed job**, idempotent by a dedupe key per (appointment, channel, window),
   and **cancelling the appointment removes the pending job** — PRD §24's one
   hard requirement. → [[DEC-060]]
4. **Channels**: one port with a **deterministic fake** and the real adapters
   behind it, fail-closed in production exactly like `FISCAL_PROVIDER`. The
   email library's choice is architectural and needs an **ADR** (the [[ADR-006]]
   precedent). With no operator credentials, the live run is recorded **PENDING
   and by name**. → [[DEC-061]]

## Work units

- [x] **WU-A — the epic file, the stories and the four decisions.**
      Documentation only, no source. Deliverables:
      `docs/01-roadmap/EPIC-17-Notifications.md`,
      `docs/02-stories/NOTIF-001..005`, `DEC-058..061`, and the ROADMAP row.
      Evidence: commit `3dd0212` (12 files, +2187/−24) on
      `feat/epic-17-notifications`; review `review-1cc8cd36147161da`,
      `risk_level: low`, `non_executable_only`, no lenses required, `approved`
      and acknowledged, authority burned. `pnpm format-check` green **after**
      the last edit.
- [x] **WU-B — the aggregate and the queue contract.** The tenant-scoped table
      (status, attempts, dedupe key, `scheduled_at`), its migration, the
      lifecycle guard, the queue name and the deterministic job identity.
      Mirrors `apps/worker/src/fiscal-submission/`. → [[NOTIF-001]] Evidence:
      commits `9b321cf` (the unit) and `12cf12c` (the review correction); review
      `review-2ab7f3074e541ccd`, medium tier, one lens (`review-reliability`),
      consent relayed and granted, **R3-001 CRITICAL** found and corrected then
      validated, advisories R3-002/R3-003, `approved` + acknowledged, authority
      burned. Gates: `@newsaas/notifications` 14 cases, the database schema gate
      18 cases, and `pnpm db:live-verify`'s 28 live cases on PostgreSQL 16. Two
      shape changes, both recorded in the Story rather than absorbed: the
      payload-refs column was dropped (no consumer) and the worker consumer
      moved to [[NOTIF-002]]. The review also exposed **[[TD-039]]**, a
      production blocker in the closed fiscal epic, which is out of this unit's
      scope and recorded instead of fixed here.
- [x] **WU-C — the channel port.** `EMAIL` and `WHATSAPP` behind one boundary, a
      deterministic fake, the real adapters, fail-closed production selection,
      and the recipient's contact data classified **RESTRICTED**. →
      [[NOTIF-002]] **WU-C1 landed** (`c283d92`): [[ADR-011]] accepted
      (nodemailer `^10.1.2` over SMTP, proven clean by `pnpm audit`), plus the
      port, the fake, both adapters, the selection and the ADR's guardrail 7 as
      a test — 40 new cases. Review `review-02c5036e0cf9a762` (medium, one
      lens): **approved on the first pass**, five non-blocking advisories →
      [[TD-040]]. **WU-C2 landed**: the recipient reader over `CustomerContact`,
      the WhatsApp entitlement gate, the content seam (still failing closed
      until WU-D), the handler with its claim compare-and-swap, the consumer,
      the worker wiring and the env contract — 39 new cases. A missing
      `provider_reference` column was found while building it and added by
      migration `20261017000002`. Story `done`; the live send run stays pending
      by name at [[NOTIF-005]].
- [~] **WU-D — the appointment reminder.** The schema-bound job, the typed
  `notifications` settings namespace, the idempotency key, and the cancellation
  path that removes a pending reminder — which needs decision 2's emitters. →
  [[NOTIF-003]] **WU-D1 landed**: `reminder.policy.ts` (the pure policy: bounds,
  window, dedupe key, scheduled instant), the `notifications` settings namespace
  with no `requiresFeature`, the seeded `notifications.settings.manage` key, and
  the `TENANT-SETTINGS.md` drift fixes. Review `review-1e2d96c3a65e27b4`
  (medium, one lens): **approved on the first pass**, one SUGGESTION →
  [[TD-043]] (the lead time's ceiling is not validated). **WU-D2 (the three
  emitters, the scheduler and the send-time gate, which also closes TD-043) and
  WU-D3 (the real content builder) remain.**
- [~] **WU-D (cont.) — WU-D2 landed**: `AppointmentConfirmed` and
  `AppointmentCancelled` published post-commit by the Scheduling service (the
  platform's first production publisher), the in-process dispatcher as an
  `@Global` provider, the reminder scheduler (one intent per configured channel,
  dedupe-keyed, delayed job, per-VALUE WhatsApp gate) and its cancellation (CAS
  to CANCELLED then remove the pending job), the BullMQ producer with `cancel`,
  and [[TD-043]] closed. The **Core/Veterinary boundary** was met head-on: the
  recipient is a Veterinary fact, so Core declares the port, the Patients module
  implements it and the composition root binds them — the boundary suite caught
  the first version, which read the aggregate directly — and the in-memory
  Prisma harness now models the aggregate, its uniqueness included. **Still
  pending in WU-D**: the real content builder with its send-time appointment
  gate (WU-D3) and `FiscalApproved`, which is deliberately deferred to WU-D3
  because INTERNAL-EVENTS forbids publishing an event with no subscriber — the
  fiscal notice is that subscriber, and it lands with it.
- [ ] **WU-E — the transactional surface and the permissions family.** The
      delivery record's status and history for the tenant, and the
      `notifications.*` permission family. → [[NOTIF-004]]
- [ ] **WU-F — the closure.** Module doc, CI evidence, changelog, roadmap,
      advisory triage — the EPIC-16 pattern, recording the operator blockers as
      **pending rather than absent**. → [[NOTIF-005]]

## Blockers to keep visible

- TD-004 (password reset) stays **blocked until WU-C lands**; it is this epic's
  external acceptance case for email delivery.
- The production adapters stay **unproven until an operator supplies
  credentials** (an SMTP or provider key; a WhatsApp Business account).
- The epic **cannot add a thirteenth feature code** without a PRD change.
- The production of the three events crosses two closed epics' surfaces, and
  that crossing is declared in the epic file as boundary debt.

## Found while reading the code (carried into the artifacts)

- **BullMQ refuses a custom job id containing `:`** unless it splits into
  exactly three segments. Measured against `bullmq@5.81.3` with a real Redis,
  and it cost this epic one CRITICAL: the boundary had copied
  `fiscal-submit:<id>`. The notification id is now hyphenated, and [[TD-039]] —
  the same defect on the fiscal producer, where it was a production blocker
  because a mocked `Queue` pinned the wrong literal — is **`resolved`** on
  `fix/td-039-fiscal-job-id-colon`, proven against a real Redis
  (`Custom Id cannot contain :` for the old separator, `ADDED` for the new one).

- **The dispatcher is in-process**, so a reaction only sees an event published
  by its own deployable: the appointment reactions belong in `api`, the
  post-approval one in `worker`. Recorded in [[DEC-059]] and in the epic.
- **`APPROVED` has two writers** — `FiscalSubmissionHandler.persistResult` and
  `fiscal-recovery.service.ts` — so `FiscalApproved` must be published from both
  or from one shared helper, or the sweep's approvals are silently lost.
- **`docs/03-architecture/TENANT-SETTINGS.md` had drifted**: it says
  `PUT /settings/:namespace` declares `sales.settings.manage`, while the
  controller is authenticated-only at the route layer and the per-namespace key
  is enforced inside `TenantSettingsService`. The new namespace's extension is
  clean because of that. The correction is part of [[NOTIF-003]].
- **`FISCAL_PROVIDER`'s production rule is about absence, not about the fake**:
  an absent value is refused in production, an unknown value is refused by name,
  and the fake stays selectable on purpose for the documented demo path.
  [[DEC-061]] adopts that rule rather than a stricter paraphrase of it.

## TD-039 — resolved, off this epic's branch

`fix/td-039-fiscal-job-id-colon`, stacked on this epic's branch because the TD
record was created here. One separator (`fiscal-submit-<documentId>`), the two
asserted literals, a new id-shape case, and the doc correction in
`docs/05-modules/Fiscal.md`, the changelog and the EPIC-15 record. Verified with
a real Redis through the producer's own options function; fiscal suite 787
→ 788.

Commit `8561af0`; review `review-757b99b67c3e5197` — medium tier, one lens
(`review-reliability`), consent relayed and granted, **approved with no findings
on the first pass**, acknowledged, authority burned.

## ADR-011 — accepted, and the dependency measured

`nodemailer` `^10.1.2` over SMTP (MIT-0, **zero transitive dependencies**, pure
JS), accepted by the maintainer on 2026-10-17. The advisory record decided the
ADR's shape rather than blocking it: **25 advisories, 10 published since
2026-09-01**, including a **cross-tenant SMTP credential disclosure** through a
process-global transport — so the guardrails (per-send transport, no tenant
string in a transport option, file/URL access off, one validated recipient, the
library imported by one file) are the decision, not a footnote. Measured after
installing: `pnpm audit` reports **0 advisories contributed by nodemailer**, and
the package's own types mean no `@types` dependency.

## Branches — each unit on its own branch

```text
main                            2d51bb6   baseline
feat/epic-17-notifications      eb7cfdc   WU-A + WU-B + their reviews
fix/td-039-fiscal-job-id-colon  c6acccf   TD-039 (stacked)
feat/notif-002-wu-c1            c283d92   WU-C1 (stacked; retarget its base
                                           once TD-039 merges)
```

WU-C1 was committed onto the TD-039 branch by mistake, and the pointers were
corrected **before** the review: `fix/td-039` was moved back to its own receipt
commit and WU-C1 got its own branch, so no unit's PR carries another's work.

## TD-040 and TD-041 — resolved (2026-10-17)

`fix/notif-review-advisories`, one unit for both books of advisories because
they cover the same Story. Eight findings addressed, each with a case that fails
without the fix; the two real ones were an unguarded transport `close()` and the
gate phase leaving no trace on the row. One case in TD-040 was caught by its own
new guard: the walked root is `src/`, not the package root.

## TD-042 — the advisories the advisory fix produced (2026-10-17)

The fix unit for TD-040/TD-041 was itself reviewed (`review-15bb8c29f08b5a2f`)
and approved, and raised four more advisories — two of which are **defects in
the fix**: a `try/catch` around an async `close()` that caught nothing (while
its own comment claimed otherwise), and a `settleFailure` called from inside the
new gates' `try`, which would have RETRIED a delivery that faithfully failed
non-retryably. Both fixed, with the other two leniencies (`Number("1e3")`, a
non-http scheme). The lesson is recorded in [[TD-042]]: review the fix as its
own candidate, and distrust a comment that asserts a guarantee the code does not
provide.

## The advisory fix, reviewed — one CRITICAL, refuted on behaviour and fixed on shape

`review-6352b1dea9a6addf` closed `correction_required` on a CRITICAL
(`R3-decide-retryable-branch`) alleging that the retryable gate branch could
return a non-decision and settle a delivery twice. **Measured, not argued**: the
callee is `Promise<never>` and always throws, so no value reaches the `in`
check, and the existing case asserts the rejection. The SHAPE was worth fixing —
a `return` of a never-returning action read as a value flowing back to two
reviewers — so the call is now an awaited statement with an explicit unreachable
throw, and the doubted path is pinned by a case (exactly two writes, neither
setting `FAILED`). Correction `fe92bec`; approved and acknowledged; one
advisory, `R3-gate-throw-unproved`, recorded in [[TD-042]].

## The WU-D2 review escalated (first time this session)

`review-5898fbf624566375` (high risk, FOUR lenses: risk/resilience/readability/
reliability) closed `correction_required` on two CRITICALs, both real in shape.
The correction was written, **rejected by the targeted validator** with three
legitimate findings — one of them a regression the correction itself introduced
— and the lineage then **escalated and stopped** (`native_stop_required`), which
is terminal and needs the maintainer. The three findings are fixed in a
follow-up unit (a total cancellation helper that never throws and reports the
error's NAME, plus an appointment re-read before and after the enqueue). The fix
unit has no review of its own yet: the stopped lineage cannot host one.

## The fix's review: approved, after two more CRITICALs

`review-27c3b70cd8046dfd` (medium, one lens) reviewed the FIX in a fresh
transaction and closed `correction_required` on two deterministic CRITICALs,
both about the helper the first correction introduced: the removal depended on
winning the CAS (breaking the compensation exactly where the row is already
cancelled), and the row write and the removal shared one try. Both fixed — the
halves are independent and total now — the correction passed the targeted
validator on both criteria, and the review is **approved and acknowledged,
authority burned**. One validator follow-up (a stale comment on `onCancelled`)
is corrected in the record commit.

## WU-D3, first half: the content builder and the send-time gate

[[NOTIF-003]]'s failing seam is now a real builder that reads the delivery's
SOURCE at send time and gates on it: `CONFIRMED`/`ARRIVED` for an appointment
(DEC-060's invariant, and what closes the residual interleaving window),
`APPROVED` for a fiscal document (PRD §36). It renders in the tenant's timezone
in 24 hours, and it reads **no Veterinary aggregate** — the message names the
branch and the instant, not the patient, and that limitation is recorded.
**Pending in WU-D3**: `FiscalApproved` from both worker write paths and its
subscriber.

## WU-D3's first half: approved, three advisories to TD-044

`review-0c34f0614742a5a3` (medium, one lens) **approved the content builder on
the first pass**, no correction. Three non-blocking advisories → [[TD-044]]: the
`hour12: false` resolution (MEASURED, does not reproduce on Node 24 / es-PY, but
locale-dependent — `hourCycle: "h23"` is the unambiguous form), a fail-open
ternary that would route a third source type into the fiscal branch, and a
redundant conditional assertion. The first two are folded into the rest of
WU-D3.

## WU-D3 complete

The content builder (first half) and the fiscal notice with its emitters (second
half) both landed. `FiscalApproved` is published from BOTH paths into `APPROVED`
through one shared emitter, which is what DEC-059 demanded; the notice's
subscriber lives in the worker because that is where the event is published; the
producer's transport moved into the package because ONE queue has two producers;
and [[TD-044]] is closed.

## WU-D3 reviewed: one CRITICAL, real, and it retired a declared limitation

`review-a8f4b7d2bd6a83b4` closed correction_required on ONE CRITICAL: on a
dedupe-key conflict both schedulers returned without enqueueing, so a first
enqueue that failed stranded the delivery permanently. Fixed in both
(`ensureIntent` returns the created id or the pending holder of the key, and the
caller enqueues either way), validated, and **approved + acknowledged, authority
burned**. The fix also retires the "lost enqueue" limitation this epic declared
for the reminder. Two advisories plus the validator's observation → [[TD-045]],
with their coordinates honestly recorded as not captured. One process slip: a
STATUS call after the burn, which the contract forbids — it failed safely and
mutated nothing.

## Operational notes

- The branch was created **before the first edit**.
- `format-check` runs **after the last edit**, never before.
- The review route is: inspect → START through the CLI with `--consent=relay`
  (the facade answers `consent-binding-stale` without showing the envelope) →
  the lens → `acknowledge-approved`.
- New dependencies require the ADR that justifies them.
