---
id: NOTIF-001
type: story
title: The notification aggregate and the queue contract
epic: EPIC-17
status: done
priority: high
depends_on: []
prd_sections:
  - "24"
  - "39"
  - "41"
permissions: []
branch:
created: 2026-10-17
updated: 2026-10-17
---

# NOTIF-001 — The notification aggregate and the queue contract

## Objective

Persist what a notification _is_ before any channel can send one: a
tenant-scoped delivery record with an explicit lifecycle, a dedupe key that
makes a repeated intent idempotent, a `scheduled_at` that makes a delayed
reminder cancellable, and a queue contract whose job identity is deterministic —
so the path that cancels an appointment can find and remove the pending job.

Everything this epic does afterwards hangs on this aggregate. It is deliberately
the epic's first work unit.

## Context

No notification delivery record exists anywhere in `apps` or `packages` today:
no table, no service, no queue, no template. This Story creates the persistence
and the queue contract, and nothing else — it sends no message and exposes no
route.

The pattern to copy is proven twice and is named in the ROADMAP as the shape:
`apps/worker/src/fiscal-submission/` and
`apps/worker/src/branding-reset-cleanup/` — a BullMQ consumer, a handler, and a
reconciliation sweep. This Story mirrors the first.

`docs/03-architecture/INTERNAL-EVENTS.md` is what selects BullMQ here rather
than the in-process dispatcher: a notification needs an **external network
call**, **retry**, **delayed execution** and **durable asynchronous
processing**. That is all four of the conditions it lists.

## In Scope

- The `notification_delivery` table and its migration.
- The lifecycle: named statuses, a transition guard, and the write paths that
  respect it.
- The dedupe key and its uniqueness constraint.
- `scheduled_at`, and the delayed-job contract that reads it: the delay is
  derived from the row's own instant and clamped at zero, so a caller cannot
  send a reminder early and cannot pass a negative delay.
- The queue name, the job name, the job payload shape (stable IDs only), the
  deterministic job identity, the retry budget and the backoff.
- Tenant-scoped persistence with its isolation coverage.

The worker consumer and the delivery handler left this Story for [[NOTIF-002]],
with the reason recorded there: a claim whose only next step is a send has
nowhere to go, so the handler lands beside the channel boundary instead of
wedging the row or inventing a failure. The queue CONTRACT it consumes is
unchanged by the move.

## Out of Scope

- Any channel, adapter or message content — [[NOTIF-002]].
- The reminder's schedule, its settings namespace, its cancellation path, and
  the three emitters — [[NOTIF-003]].
- Any HTTP route, any permission, any UI — [[NOTIF-004]].
- A manual re-drive of a `FAILED` delivery. BullMQ's attempts and backoff carry
  the automatic path; an operator-triggered re-drive needs a primitive this
  Story does not have. Recorded as a known limitation, and the fiscal epic's
  [[TD-029]] is the precedent for not inventing one locally.
- A reconciliation sweep. Unlike a fiscal submission, a notification has no
  remote state to reconcile; a delivery that exhausts its attempts is `FAILED`
  and the record says so.
- Payload content, templates or tenant-editable copy.
- A generic `PATCH status=…` route — never, per `ENGINEERING-RULES.md`'s
  explicit-state-transition rule.

## Acceptance Criteria

- [x] `notification_delivery` is tenant-scoped: every read and write is
      tenant-predicated, a foreign or unknown UUID is indistinguishable from an
      absent one at any surface that later consumes it, and the ownership key
      `@@unique([tenantId, id])` exists. Evidence: the model's key, the RESTRICT
      tenant FK, the live unknown-tenant rejection, and
      `schema-clinical.test.ts`'s ownership-key inventory moving 29 → 30.
- [x] The dedupe key is unique per tenant, and inserting a second row for the
      same key is refused by the database rather than by application
      cooperation. Evidence: the migration's PARTIAL
      `UNIQUE (tenant_id,     dedupe_key) WHERE status <> 'CANCELLED'` — the
      `invoice`/`fiscal_document` precedent — plus the live cases proving a
      second LIVE delivery is refused, a `CANCELLED` one releases its key, and
      the same key is free in another tenant.
- [x] The status set is explicit and the guard is enforced: an illegal edge
      changes nothing and is refused by name; a terminal status is terminal.
      Evidence: `notification_delivery_transition_guard` and its live cases in
      `pnpm db:live-verify`, the SQL-text schema gate, and the TypeScript
      mirror's own cases. `SENT`/`CANCELLED` are frozen by a second trigger, and
      `FAILED` is deliberately settled-but-writable-in-place.
- [x] Cancellation is admissible from every non-terminal, non-sending status,
      which is what makes [[NOTIF-003]]'s requirement implementable; once a
      delivery is `SENDING` the guard refuses to cancel it, and that refusal is
      tested rather than assumed. Evidence: the `SENDING -> CANCELLED` rejection
      case, live and in the schema gate.
- [x] `scheduled_at` is persisted in UTC, and its delayed-job contract derives
      the delay from the row's own instant and clamps a past one to "due now"
      rather than a negative delay. Evidence: `notificationDeliveryJobOptions`
      and its cases. The ENQUEUE itself has no caller until [[NOTIF-003]]'s
      reminder, which is the first producer.
- [x] The job identity is deterministic and derived from a stable identifier, so
      a second enqueue of the same intent dedupes in the queue and the
      cancelling path can address exactly the pending job. Evidence:
      `notificationDeliveryJobId`, its determinism case, and the partial unique
      index agreeing with it on what "the same intent" means.
- [x] The job payload carries stable identifiers only: no recipient contact
      datum, no message body, no aggregate dump. Evidence: the payload-shape
      case and the model's absent payload and contact columns, which the schema
      gate asserts.
- [x] Retry is bounded and exponential, and the database row — not the queue's
      failed set — is the record of failure. Evidence: the options' attempts and
      backoff, `removeOnFail: false`, and the row's `attempt_count` /
      `last_error_code` / `last_error_message`.
- [x] The worker consumer moved to [[NOTIF-002]] with the delivery handler, for
      the reason recorded in its In Scope. Evidence: this Story's In Scope and
      [[NOTIF-002]]'s.
- [x] Tenant isolation is enforced when applicable. Evidence: the tenant FK and
      the tenant-ownership key over the new aggregate, plus the live cases in
      `pnpm db:live-verify` and 43 further cases run directly against a freshly
      migrated PostgreSQL 16 while this unit was built.
- [x] Backend authorization is enforced when applicable. Evidence: not
      applicable in this Story — no route is added; [[NOTIF-004]] owns the
      surface and its permissions.
- [x] Required loading/error/empty/success UX exists. Evidence: not applicable
      in this Story — no UI.
- [x] Required audit exists. Evidence: not applicable — PRD §27's list of
      critical audited actions does not include a notification delivery, and the
      delivery record is its own trace. This is stated rather than left silent
      so the omission reads as a decision.
- [x] Tests required by the Story pass. Evidence: `@newsaas/notifications` 13
      cases (lifecycle + queue contract), `@newsaas/database` 18 schema-gate
      cases, and the `pnpm db:live-verify` block — all green on PostgreSQL 16
      against a freshly migrated database.

## Domain Invariants

- One logical notification intent produces at most one delivery row per (dedupe
  key), per tenant.
- A status only moves along the guard's edges; no code path writes a status
  outside the guard.
- A `SENT` or `CANCELLED` delivery is never re-sent and never re-scheduled.
- The record holds references, never content: recipient contact data lives
  behind the channel boundary ([[NOTIF-002]]) and is classified **RESTRICTED**.

## API

### Added

```text
None yet
```

### Changed

```text
None yet
```

## Database

### Migration

```text
Planned: one additive migration creating notification_delivery
```

Additive only: it creates one table with its enum, its constraints and its
indexes, and it rewrites no existing migration and alters no existing table. The
timestamp and directory name are assigned when the Story opens against the then
current `packages/database/prisma/migrations/` order.

### Models/Tables

- `NotificationDelivery` (table `notification_delivery`) — the tenant-scoped
  record: `channel`, `status`, `dedupe_key`, `scheduled_at`, `attempt_count`,
  `last_attempt_at`, `last_error_code`, `last_error_message`, the source
  reference (a stable type + id pair, e.g. an appointment or a fiscal document),
  the recipient reference (an identifier the channel boundary resolves to
  RESTRICTED contact data — never the datum itself), terminal timestamps, and
  `created_at` / `updated_at`.

| Guarantee              | Planned shape                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| Tenant scope           | RESTRICT tenant FK plus an `@@unique([tenantId, id])` ownership key                              |
| Idempotent intent      | `UNIQUE (tenant_id, dedupe_key)`, or a partial variant when a cancelled row must release its key |
| Explicit lifecycle     | An enum plus a guard; a CHECK or trigger rejects an out-of-band status write                     |
| Cancellable reminder   | `scheduled_at` NOT NULL for a scheduled delivery, and a terminal `CANCELLED`                     |
| No secrets in payloads | Column set only; no content, no contact datum                                                    |
| Durable failure record | `attempt_count`, `last_attempt_at`, bounded `last_error_code` / `last_error_message`             |

## Queue

```text
Queue:  notification-delivery
Job:    deliver
Job id: deterministic, derived from the delivery's stable identity
Payload: { notificationDeliveryId, tenantId } — stable ids only
Retry:  bounded attempts with exponential backoff
```

The reasoning mirrors `packages/fiscal/src/fiscal-submission.queue.ts`
([[DEC-049]]): the deterministic job identity makes queue dedupe and the
database's uniqueness constraint agree on what "the same logical request" means,
and `removeOnFail` stays false so a human inspecting the queue sees the attempt
the database already recorded.

## UI

- None. This Story adds no surface.
- If any UI is added later in this epic, it must consume semantic branding
  tokens rather than project-specific literals.

## Implementation Summary

Implemented as EPIC-17 WU-B. Ships the aggregate, its lifecycle and the queue
contract; ships **no** sender, no producer call site and no route.

- **The table** `notification_delivery` with four enum types, the RESTRICT
  tenant FK, the tenant-ownership key, the partial unique index on
  `(tenant_id, dedupe_key) WHERE status <> 'CANCELLED'` and five indexes.
- **Four database guards** rather than one: the transition guard (status edges,
  `attempt_count` monotonicity, and the claim's lease never cleared and never
  rewound), `no_delete`, `identity_immutable` over ten columns, and
  `terminal_immutable` freezing exactly `SENT` and `CANCELLED`.
- **The contract** in the new `@newsaas/notifications` package: the status
  union, the `NotificationDeliveryTransitionError`, the TypeScript mirror of the
  guard, the queue name, the job name, the deterministic job identity, the
  bounded exponential retry and the delay derivation.
- **No payload column.** The written plan listed "sanitized payload refs"; the
  smallest compatible implementation drops it, because the message is built at
  send time from the authoritative rows the source names ([[NOTIF-003]]'s own
  requirement) and a stored snapshot could only go stale. A column with no
  consumer is an abstraction to delete, not to add.
- **`cancellation_reason` was added**, which the written plan did not name: a
  cancelled delivery has to explain itself, and the biconditional CHECK makes
  that structural rather than conventional — the same shape Billing uses for a
  cancelled invoice.

One deliberate deviation from the written plan is recorded in In Scope: the
worker consumer and the handler moved to [[NOTIF-002]], because a claim with
nothing to send cannot be a unit.

## Verification

```text
Local gates (green):
  pnpm format-check                      All matched files use Prettier code style
  pnpm lint                              21/21 tasks successful
  pnpm typecheck                         21/21 tasks successful
  pnpm build                             13/13 tasks successful
  pnpm test                              all suites green:
    @newsaas/notifications               2 files, 13 tests
    @newsaas/database                    27 files, 509 tests (was 491; +18)
    @newsaas/fiscal 787, shared 16, secret-store 50, worker 164,
    web 1087, ui 36, api 1214 passed | 266 skipped (no DATABASE_URL_TEST)

Live PostgreSQL 16 (real, on a disposable cluster in this session):
  prisma migrate deploy                  all 44 migrations applied to a fresh DB
  pnpm db:live-verify                    PASSED, including the new block
    "notification delivery lifecycle guard passed (28 cases)"
  direct guard cases                    43/43 PASS (assignments S1..S8), 0 FAIL
  API live-PG isolation suite           265 passed | 1 failed, and the single
                                        failure REPRODUCES with this migration
                                        removed, so it is pre-existing and not
                                        this unit's (see Known Limitations)
  psql/pg_isready                        PostgreSQL 16.13

Review (RDD, medium tier, one lens):
  lineage                                review-2ab7f3074e541ccd
  base tree                              ff562cbd (the WU-A commit)
  reviewed candidate tree                69129354 -> corrected b15f7da0
  consent                                relayed, granted by the maintainer
  lens                                   review-reliability
  R3-001                                 CRITICAL, inferential, introduced
                                         -> corrected, then validated
  advisories                             R3-002, R3-003 (WARNING, informational)
  outcome                                approved, acknowledged, authority burned
```

Not run, and why: no CI run yet (the branch is local and unpushed).

### The review's CRITICAL, and how it was verified

**R3-001 (reliability, CRITICAL)** found that `notificationDeliveryJobId`
returned `notification-deliver:<id>`, and that `queue.add` would throw before
any delivery was enqueued.

**Measured, not reasoned about.** Against `bullmq@5.81.3` with a real Redis:
`Custom Id cannot contain :` for `notification-deliver:abc` and for
`fiscal-submit:abc`; `a:b:c` is accepted only because it splits into exactly
three segments (the repeatable-jobs carve-out); `notification-deliver-abc` is
accepted. The rule lives in `bullmq/dist/cjs/classes/job.js`, which carries the
comment _"TODO: replace this check in next breaking check with include(':')"_.

The correction changed the separator to a hyphen, recorded why it must stay one,
and replaced the literal assertion with a shape assertion across several inputs
— because **a stubbed `Queue` cannot reach the rule**, which is exactly why the
previous literal pinned the bug instead of failing. The corrected candidate was
then validated by an independent read-only validator run:
`original_criteria.passed: true`, `correction_regression.passed: true`.

## Tests Added

- `packages/notifications/src/notification-delivery.lifecycle.test.ts` — 7
  cases: the six statuses, every allowed edge, every refused non-edge including
  the tempting ones, the same-status lease refresh against the frozen statuses,
  the settled/frozen distinction, and the named stable error.
- `packages/notifications/src/notification-delivery.queue.test.ts` — 6 cases:
  the names and retry budget, the deterministic identity, the derived delay, the
  clamp, `removeOnComplete`/`removeOnFail`, and the payload's stable-ids-only
  shape.
- `packages/database/src/schema-notification-delivery.test.ts` — 18 cases over
  the migration SQL and the schema document: additivity, the four
  `CREATE TYPE`s, the UTC timestamps, the RESTRICT FK, the partial index, both
  directions of the three biconditionals, the failure-reason coherence, the
  frozen set, `NO DELETE`, the ten immutable columns, the guard's exact edges
  and non-edges, the lease clauses, and the model's absent payload and contact
  columns.
- `packages/database/scripts/live-migration-verify.ts` — a 28-case block that
  runs in CI via `pnpm db:live-verify`, asserted against real PostgreSQL rather
  than against the SQL text.
- `packages/database/src/schema-clinical.test.ts` — the ownership-key inventory
  moved 29 → 30, with `NotificationDelivery` named in its comment.

## Known Limitations

- No manual re-drive of a `FAILED` delivery. The row is deliberately NOT frozen,
  so an approved re-drive is an added guard edge plus a change to that trigger,
  as a decision rather than an accident.
- No reconciliation sweep, because there is no remote state to reconcile.
- The cancellation path is implemented in [[NOTIF-003]]; this Story only makes
  it addressable.
- The delayed-job contract has no caller until [[NOTIF-003]]'s reminder.
- **One pre-existing local live-PG failure, measured rather than assumed**: the
  fiscal timbrado-range validity case fails in this environment with
  `expected error to be instance of Rollback`. It was reproduced with this
  migration moved out of `prisma/migrations/`, giving an identical
  `265 passed | 1 failed`, so it is not this unit's. CI on `main` is green for
  the same suite, so the difference is environmental and its cause is
  unidentified here.
- **The review's two advisories are unaddressed and non-blocking** (WARNING,
  `informational`), and their claim text was not captured — the published
  closure lists ids and coordinates. Recorded by coordinate with an explicit
  READING in the Technical Debt section below, so nobody mistakes a reading for
  the finding.

## Technical Debt

- **[[TD-039]] — raised by this unit's review, and it is not this unit's.**
  `fiscalSubmissionJobId` in `packages/fiscal/src/fiscal-submission.queue.ts`
  returns `fiscal-submit:<id>`, the same two-segment shape BullMQ refuses, so
  the fiscal producer's enqueue would throw in production. Its unit test asserts
  that literal against a mocked `Queue`, which is why CI is green. Recorded,
  measured and named rather than fixed inside this candidate, because the file
  is outside this unit's reviewed scope.
- **R3-002** — lens `reliability`, `migration.sql:247-256` (the transition
  guard's edge list), WARNING, `informational`. Claim text not captured. **A
  reading of that coordinate, marked as a reading**: `CANCELLED` is the only
  status that releases the dedupe key and `FAILED` has no outgoing edge, so a
  failed delivery keeps its key and its intent is unresolvable for that window
  by anything but an operator — which is the re-drive this Story deliberately
  did not build. If that is the finding, the decision to record is _which_ of
  the two should release the key.
- **R3-003** — lens `reliability`, `migration.sql:123-124`
  (`notification_delivery_sent_reason_check`), WARNING, `informational`. Claim
  text not captured. **A reading of that coordinate, marked as a reading**: the
  CHECK forces `last_error_code` to be NULL on entry to `SENT` but says nothing
  about `last_error_message`, so a `SENT` row can keep a stale message that then
  reads as a current error. If that is the finding, the fix is to extend the
  biconditional to the message column, in the one migration that owns this
  table.
- Triaged at [[NOTIF-005]] together with anything the later units raise.

## Decisions / ADRs

- [[DEC-060]] — the reminder's policy, its dedupe key and its cancellation
  requirement shape this aggregate's `scheduled_at` and status set.
- [[DEC-061]] — the channel boundary. This Story must not resolve contact data;
  it stores a reference only.
- No new ADR: BullMQ is the approved queue technology and this adds no runtime,
  broker or ORM.

## Files / Modules

- `packages/database/prisma/schema.prisma` — four enums, `NotificationDelivery`,
  and the `Tenant` back-reference.
- `packages/database/prisma/migrations/20261017000001_notif_001_notification_delivery/migration.sql`.
- `packages/database/src/schema-notification-delivery.test.ts`.
- `packages/database/src/schema-clinical.test.ts` — the inventory count.
- `packages/database/scripts/live-migration-verify.ts` — the CI-wired live
  block.
- `packages/notifications/` — new package: `package.json`, `tsconfig.json`,
  `eslint.config.js`, `src/index.ts`, `src/notification-delivery.lifecycle.ts`,
  `src/notification-delivery.queue.ts` and their tests.
- `pnpm-lock.yaml` — the new workspace importer.

## Completion Notes

Done on 2026-10-17 with the gates above green, and with the review closed:
`review-2ab7f3074e541ccd`, approved, acknowledged, authority burned.

Two acceptance criteria changed shape while the unit was built, both recorded
rather than silently absorbed: the worker consumer moved to [[NOTIF-002]], and
the "payload refs" column was dropped as an abstraction with no consumer.

The review earned its keep three times over on a unit that looked finished:
**R3-001** was a real CRITICAL — a BullMQ-refused job id that no local gate
could reach, and that the test suite had _pinned_ rather than caught; and the
same review exposed **[[TD-039]]**, the identical defect on the fiscal producer,
which is a production blocker in a closed epic. The two remaining advisories are
recorded by coordinate, with their readings explicitly marked as readings.

The commits are `9b321cf` (the unit) and `12cf12c` (the correction); the review
receipts are in `odd/tasks/epic-17-notifications.md`.
