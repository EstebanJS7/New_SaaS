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
- [ ] **WU-C — the channel port.** `EMAIL` and `WHATSAPP` behind one boundary, a
      deterministic fake, the real adapters, fail-closed production selection,
      and the recipient's contact data classified **RESTRICTED**. The email
      library's ADR is this unit's gate. **It also owns the worker consumer and
      the delivery handler**, which moved from WU-B because a claim with nothing
      to send cannot be a unit. → [[NOTIF-002]]
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
  `fiscal-submit:<id>`. The notification id is now hyphenated; [[TD-039]]
  records that **the fiscal one was not fixed and is a production blocker**,
  because its shape is pinned by a test that asserts it against a mocked
  `Queue`.

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

## Operational notes

- The branch was created **before the first edit**.
- `format-check` runs **after the last edit**, never before.
- The review route is: inspect → START through the CLI with `--consent=relay`
  (the facade answers `consent-binding-stale` without showing the envelope) →
  the lens → `acknowledge-approved`.
- New dependencies require the ADR that justifies them.
