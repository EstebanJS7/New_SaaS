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
- [ ] **WU-D — the appointment reminder.** The schema-bound job, the typed
      `notifications` settings namespace, the idempotency key, and the
      cancellation path that removes a pending reminder — which needs decision
      2's emitters. → [[NOTIF-003]]
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

## Operational notes

- The branch was created **before the first edit**.
- `format-check` runs **after the last edit**, never before.
- The review route is: inspect → START through the CLI with `--consent=relay`
  (the facade answers `consent-binding-stale` without showing the envelope) →
  the lens → `acknowledge-approved`.
- New dependencies require the ADR that justifies them.
