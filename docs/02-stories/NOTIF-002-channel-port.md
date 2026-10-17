---
id: NOTIF-002
type: story
title: The channel port
epic: EPIC-17
status: done
priority: high
depends_on:
  - NOTIF-001
prd_sections:
  - "10"
  - "24"
  - "41"
permissions: []
branch:
created: 2026-10-17
updated: 2026-10-17
---

# NOTIF-002 — The channel port

## Objective

Put `EMAIL` and `WHATSAPP` behind **one** boundary, with a deterministic fake
that carries the tests and the real adapters behind it, selected fail-closed in
production. The epic's channels are a provider concern, not two modules: a
second `notifications` domain would be a second module for one capability.

The Story exists in full — port, fake and real adapters — because that is what
makes EPIC-17 _complete behind its boundary_ rather than half-built. The
FISC-012/FISC-013 precedent: the implementers own the boundary, the operator
owns the credentials, and the live run is recorded **pending and by name**
instead of implied.

## Context

- PRD §24 names exactly two channels: `EMAIL` and `WHATSAPP`, and it fixes the
  MVP rule that **WhatsApp is transactional only**.
- PRD §10 fixes the twelve feature codes and includes `whatsapp`. WhatsApp is
  therefore gated by the **existing** `whatsapp` entitlement, and email is **not
  gated at all**. No thirteenth code — [[DEC-058]].
- PRD §41 requires every new field carrying personal material to be classified.
  The recipient's email address or phone number is **RESTRICTED**: it is never
  logged, never placed in a job payload, and never echoed in an API response.
- The selection pattern to copy is
  `packages/fiscal/src/fiscal-provider.module.ts` ([[DEC-048]], and its
  production rules proven by FISC-012 WU-E2): a closed set of accepted
  environment values shared by every deployable's schema and the composition
  root, an unknown value refused by name, an absent value refused in production,
  and no silent fallback.
- `ENGINEERING-RULES.md` is explicit that a database transaction is never held
  open while waiting on email or WhatsApp: persist the intent, commit, enqueue,
  process asynchronously.

## The gate: an ADR before any email dependency

`AGENTS.md` requires a concrete requirement before a new dependency, and the
choice of the library that sends email is architectural in exactly the way
[[ADR-006]] treated the signing library.

**No email dependency is added before its ADR is `accepted`.** The ADR states
the concrete requirement, the candidates, the licence and advisory record, the
package it becomes a dependency of, and what is deliberately not solved by it.
The number is assigned when the Story opens; `ADR-011` is the next free slot.

The WhatsApp adapter is a different question and may not need one: if the chosen
integration is an HTTPS call to the WhatsApp Business API and adds no
dependency, the ADR is not triggered — the requirement, not the channel,
decides.

## In Scope

- One `NotificationChannelPort` abstraction with two implementations selected by
  configuration.
- A deterministic `FakeNotificationChannel` — no network, no clock dependence, a
  stable result per input — used by every automated test.
- The real `EMAIL` adapter behind the port, subject to the ADR gate above.
- The real `WHATSAPP` adapter behind the port, transactional only.
- The provider selection: the closed env value set, the composition root, and
  the production refusal rules.
- The recipient resolution: from a stored reference to RESTRICTED contact data,
  read at send time and never persisted in the delivery record or the payload.
- The entitlement gate for `WHATSAPP` only.
- Classification and sanitization: logs, errors and provider snapshots.
- A delivery invocation on the [[NOTIF-001]] aggregate's claim: `SENDING` →
  `SENT` / `FAILED`, with bounded retry.
- **The worker consumer and the delivery handler, moved here from
  [[NOTIF-001]].** That Story owns the queue contract; this one owns the
  consumer that registers for it and the handler that claims a delivery, sends
  through the port, persists the outcome and splits a retryable failure
  (recorded on the row, retried by BullMQ) from a non-retryable one (`FAILED`,
  terminal). The move is recorded rather than silent, and its reason is in
  [[NOTIF-001]]'s In Scope: a claim whose only next step is a send has nowhere
  to go.

## Out of Scope

- The reminder schedule, the settings namespace, the cancellation path and the
  three emitters — [[NOTIF-003]].
- Any HTTP route, permission or UI — [[NOTIF-004]].
- A tenant-editable template editor. This Story sends a defined transactional
  message; a template _surface_ is a product feature nobody approved.
- Marketing or bulk messaging. PRD §24 makes MVP WhatsApp transactional only.
- A per-channel module, a channel plugin registry, or any extensibility
  framework. Two channels behind one port is the requirement; a registry is
  speculative generality.
- Changing the `whatsapp` feature code's name or plan mapping.

## Acceptance Criteria

- [x] The fake is deterministic: the same input produces the same result, and no
      test depends on the network, on wall-clock time or on a random value.
      Evidence: `fake.channel.test.ts`'s determinism cases, with the clock
      supplied by the caller.
- [x] A test can force each outcome the caller must handle — success, a
      retryable failure and a non-retryable failure — without a network.
      Evidence: the fake's ordered `outcomes` script, with its last entry
      repeating.
- [x] The selection is fail-closed in production exactly as `FISCAL_PROVIDER`
      is: one exported list of accepted values shared by the deployables'
      schemas and the composition root, an unknown value refused **by name**,
      and an absent value refused in production instead of silently defaulting.
      Evidence: `resolveChannelProvider`'s cases, written against the pure
      function so an untested safety path cannot regress silently.
- [x] There is no silent fallback to the fake: a deployment that names no
      provider fails loudly rather than quietly delivering nothing. Evidence:
      the production refusal above, plus a real selection refusing a missing
      deployment input **by variable name** at build time.
- [x] The entitlement gate applies to `WHATSAPP` and not to `EMAIL`, and it is
      evaluated before any persistence or external call; a tenant without the
      `whatsapp` grant gets a stable `FEATURE_NOT_ENTITLED`-class refusal and no
      delivery record. Evidence: `checkEntitlement` runs before the recipient is
      resolved and before any adapter is reached, through a port the worker
      composes over its own Prisma client (the API's `EntitlementsService`
      cannot serve the worker). Cases: email never asks the port at all;
      WhatsApp without the grant settles `NOTIFICATION_FEATURE_NOT_ENTITLED`
      with the adapter never called; WhatsApp with the grant sends.
- [x] The recipient's contact datum is RESTRICTED: it is read at send time, it
      is never written to the delivery record, never placed in a job payload,
      never logged, and never returned by an API. A log-capture assertion proves
      it. Evidence: the reader resolves it from `CustomerContact` at send time
      and the handler's call frame is its only home; a case captures every
      console channel across a full send and asserts nothing is printed at all;
      both adapters are asserted never to echo it, including through the
      library's own message text (only the error's `code` and `responseCode`
      travel); the consumer's failure log carries ids and a sanitized reason.
      The delivery record and the job payload carry the reference and never the
      datum, which the [[NOTIF-001]] column set and its payload case assert.
- [x] Every provider call happens **outside** a database transaction: the intent
      is committed and enqueued, and only then is the provider called. Evidence:
      the handler issues single statements only — a claim `updateMany`, the read
      of the row, then one settle — and the case that exercises a full send does
      so against a Prisma stub with **no `$transaction` member at all**, so a
      handler that wrapped its work in one would throw.
- [x] A provider failure lands the delivery on `FAILED` with a bounded,
      sanitized reason, and a retryable failure is retried within the bounded
      budget rather than retried forever. Evidence: the classification is per
      adapter (a connection failure and an SMTP `4xx` or an HTTP `429`/`5xx` are
      retryable; a decision, a configuration problem or a bad message is not),
      and the handler persists it: a non-retryable failure settles `FAILED` with
      the code and message, and a retryable one keeps `SENDING`, records the
      reason, and **throws** so BullMQ's bounded attempts own the retry. A
      boundary that throws is treated the same way as a retryable answer.
- [x] A retried delivery does not send a second message for a delivery already
      `SENT`. Evidence: a settled row — `SENT`, `FAILED` or `CANCELLED` —
      returns before any claim is attempted, asserted for all three statuses
      with the adapter never called, and the database freezes `SENT` and
      `CANCELLED` outright ([[NOTIF-001]]).
- [x] The worker registers the consumer for exactly
      `NOTIFICATION_DELIVERY_QUEUE` and exposes the handler through DI, and a
      delivery whose observed status the guard does not admit is a no-op rather
      than a crash — the fiscal consumer's duplicate-delivery discipline.
      Evidence: `NotificationDeliveryConsumer` and `NotificationDeliveryHandler`
      are providers of `WorkerModule` alongside `NotificationChannelsModule` and
      the three seams; the processor hands the job's payload (never the BullMQ
      job) to the handler and lets a failure propagate to BullMQ; and the
      settled-row and lost-claim cases are no-ops.
- [x] A claim is a compare-and-swap on the observed status and the lease, so two
      workers racing one delivery admit exactly one attempt, and an abandoned
      claim past its lease may be re-claimed in place (the status is unchanged,
      which is why the guard admits it). Evidence: a fresh `SENDING` claim is
      left to its owner (no claim issued); an abandoned lease is re-claimed with
      the CAS pinned to the observed `lastAttemptAt` and **no status change**;
      and a claim that loses the race stops before reaching an adapter.
- [x] A retryable failure records its bounded, sanitized reason on the row and
      throws so BullMQ retries; a non-retryable one lands `FAILED`. Neither
      writes a reason the delivery's own CHECKs refuse. Evidence: the retryable
      case writes only `last_error_*` and leaves the status at `SENDING`, which
      is exactly the pair the table's CHECK admits; every reason is truncated to
      500 characters and newline-flattened; and `SENT` clears both error columns
      in the same write, which the `SENT` biconditional requires.
- [x] Both channels are reached only through the port; no caller imports a
      concrete adapter, and a repository search proves it. Evidence: the handler
      reaches a channel only through `channels.for(value)`, which is the whole
      point of resolving by the row's own data; `dependency-boundary.test.ts`
      proves [[ADR-011]] guardrail 7 (the email library is imported by exactly
      one file) and that **no file under `apps/api` or `apps/worker` names a
      concrete adapter factory**.
- [x] Tenant isolation is enforced when applicable. Evidence: the recipient read
      is tenant-predicated and active-only, so a foreign customer's contact
      never resolves; every statement the handler issues carries `tenantId`,
      which a case asserts across all of them; and no transport is shared
      between tenants ([[ADR-011]] guardrail 2), which the per-send transport
      case asserts.
- [x] Backend authorization is enforced when applicable. Evidence: not
      applicable in this Story — no route is added; the entitlement gate above
      is not a permission check and [[NOTIF-004]] owns permissions.
- [x] Required loading/error/empty/success UX exists. Evidence: not applicable
      in this Story — no UI.
- [x] Required audit exists. Evidence: not applicable — PRD §27 does not list a
      notification delivery among the critical audited actions; the delivery
      record carries the outcome. Stated rather than left silent so the omission
      reads as a decision.
- [x] Tests required by the Story pass, **including the production-refusal tests
      for the selection**, which are written against the pure resolver so an
      untested safety path cannot regress silently. Evidence: 40 new cases in
      the boundary and 39 in the delivery path, all green, with no network, no
      database and no Redis.

## Domain Invariants

- One delivery produces at most one provider call per attempt, and `SENT` is
  terminal.
- A contact datum never leaves the channel boundary's own call frame.
- The demo fake is selectable only by an operator naming it; no default and no
  fallback reaches it.
- The port carries no Prisma type and no Nest-specific type, so the adapters
  stay testable in isolation.

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
None planned
```

This Story adds no table. It writes the outcome columns [[NOTIF-001]] created
(`status`, `attempt_count`, `last_attempt_at`, `last_error_code`,
`last_error_message`).

### Models/Tables

- No new model. No contact datum is persisted.

## Configuration

```text
EMAIL_PROVIDER    = one of a closed set (a fake plus the real adapter id)
WHATSAPP_PROVIDER = one of a closed set (a fake plus the real adapter id)
```

Both lists are exported from one place and consumed by every deployable's schema
and by the composition root, so a per-deployment copy cannot drift. Credentials
are read from the environment at the boundary and never persisted in a
notification record.

## UI

- None. This Story adds no surface.
- If any UI is added later in this epic, it must consume semantic branding
  tokens rather than project-specific literals.

## Implementation Summary

**WU-C1 (the channel boundary) is implemented. WU-C2 (the delivery path) is
not**, which is why this Story is `in-progress`: the boundary is complete and
nothing calls it yet.

Landed:

- **`channel.port.ts`** — the port, the two channels, the provider ids, the
  request/outcome contract and the two stable failure-reason codes. The request
  carries `subject`/`body` **and** ordered `parameters`, because the two
  channels do not carry the same kind of message: an email is rendered text,
  while a business-initiated WhatsApp message must be an operator-approved
  template whose text cannot be replaced at send time. Pretending they are the
  same would have been a lie in the contract.
- **`fake.channel.ts`** — the deterministic fake with a scripted outcome list
  (the fiscal fake's shape), a caller-supplied clock, and an in-memory attempt
  log. One property is documented rather than assumed: the fake is selectable in
  production for the documented demo path, so its attempt log is the only place
  this package retains a recipient datum, in memory, never logged.
- **`email.channel.ts`** — the SMTP adapter, and the only file that imports
  `nodemailer` ([[ADR-011]] guardrail 7). It builds a transport **per send** and
  closes it (guardrail 2), always sets `disableFileAccess`/`disableUrlAccess`
  (guardrail 3), validates the recipient with a deliberately stricter
  single-address check that refuses whitespace, separators, angle brackets, a
  second `@` and every control character, and reports a failure from the error's
  own `code`/`responseCode` only — never the library's message text, which is
  the one field that could have echoed the recipient.
- **`whatsapp.channel.ts`** — the Cloud API adapter over global `fetch`, with
  **no dependency**. It posts the approved template with the request's ordered
  parameters, bounds one attempt with an abort signal, and maps `429`/`5xx` and
  an unreachable API to retryable while `4xx` settles the delivery.
- **`channel.module.ts`** — `resolveChannelProvider` (pure, exported, tested),
  `buildNotificationChannels` (pure) and `NotificationChannelsModule.forRoot()`.
  The selection is fail-closed exactly as `FISCAL_PROVIDER` is: one exported
  list per channel, an unknown value refused by name, an absent value refused in
  production, and no silent fallback. One deliberate difference from the fiscal
  boundary, recorded here: a real selection validates its own deployment inputs
  at **build** time and refuses by name, because an SMTP endpoint is one
  deployment's configuration while a tenant's signing material is that tenant's
  state.
- **`dependency-boundary.test.ts`** — [[ADR-011]] guardrail 7 as an executable
  rule, not a promise.

One abstraction was written and then **deleted**, because the selection makes it
unreachable: an "unconfigured channel" provider answering
`CHANNEL_NOT_CONFIGURED`, with its two reason codes. A provider is either
selected or the production boot refuses, so nothing could ever return that
answer, and an abstraction with no consumer is one to delete rather than keep.

### WU-C2 — the delivery path, landed

- **`notification-recipient.read.ts`** — the `CustomerContact` reader, in the
  worker because the worker is the only consumer today (it moves to its own
  package beside `fiscal-persistence` if the API ever needs it, rather than
  being a package created for one caller). Tenant-predicated, active-only, the
  channel's own contact kind, primary-then-oldest so two runs resolve the same
  address. A missing contact answers `null` (a settled state); a failed READ
  propagates, because a database blip is not a missing phone number.
- **`notification-entitlement.read.ts`** — [[DEC-058]]'s per-channel gate over
  the tenant's own rows, the same query shape as the API's `EntitlementsService`
  so the two cannot disagree about what a grant means. A failed read propagates
  instead of answering `false`, which would settle a delivery the tenant is
  entitled to receive.
- **`notification-content.ts`** — the content seam, **still failing closed**:
  the reminder's real builder is [[NOTIF-003]]'s, and this unit must not invent
  the message. The default answers `NOTIFICATION_CONTENT_UNAVAILABLE` by name,
  so a delivery arriving first settles rather than sending an empty message.
- **`notification-delivery.handler.ts`** — the claim (a compare-and-swap on the
  observed status and the lease, with a re-claim that keeps `SENDING` because
  the status is what does not change), the gates in order, the send, and the
  outcome: `SENT` with the provider handle and the error columns cleared,
  `FAILED` for a non-retryable failure, and a retryable one recorded with the
  row left on `SENDING` and thrown so BullMQ owns the bounded retry.
- **`notification-delivery.consumer.ts`** — the BullMQ consumer, the fiscal
  one's shape, with `maxRetriesPerRequest: null` (correct for a worker, wrong
  for a producer) and a failure log that carries ids and a sanitized reason and
  never a datum.
- **Wiring**: `WorkerModule` composes `NotificationChannelsModule.forRoot()`
  plus the recipient reader, the entitlement reader, the content seam, the
  handler and the consumer. The worker's env schema declares both provider
  selections against the package's closed value lists and refuses their absence
  in production, the same rule `FISCAL_PROVIDER` follows.

**One thing was found missing rather than planned: the delivery record had no
column for the provider's handle.** Both adapters produce one for a message they
accepted (nodemailer's `messageId`, the WhatsApp Cloud API's `wamid`), and
without a column the contract's `providerReference` would have had no consumer
at all. `20261017000002_notif_002_provider_reference` adds it — one nullable
column, no guard clause, because a `SENT` row is already frozen outright and a
never-clear rule would be a rule the database could never reach.

## Verification

```text
Local gates (green, on the final tree):
  pnpm format-check                                 clean
  pnpm lint                              21/21 tasks successful
  pnpm typecheck                         21/21 tasks successful
  pnpm build                             13/13 tasks successful
  pnpm test                              all suites green:
    @newsaas/notifications               7 files, 54 tests (40 new)
    @newsaas/worker                      15 files, 203 tests (39 new)
    @newsaas/database                    27 files, 512 tests (+3)
    @newsaas/fiscal 788, api 1214 passed | 266 skipped, web 1087, ui 36,
    shared 16, secret-store 50

Review (RDD, medium tier, one lens):
  WU-C1  review-02c5036e0cf9a762   approved, 5 advisories -> TD-040
  WU-C2  (see the completion notes: recorded in
         odd/tasks/epic-17-notifications.md)

Live PostgreSQL 16:
  prisma migrate deploy                  all 45 migrations apply to a fresh DB
                                         (44 + the provider_reference one)
Dependency facts measured, not assumed (2026-10-17):
  registry.npmjs.org/nodemailer/latest              10.1.2, MIT-0
  its manifest                                      dependencies: {}, no gypfile
  its exports                                       import + require + own types
  pnpm audit --prod | grep nodemailer               0 advisories contributed
```

Not run, and why: no live provider exists (no operator credentials), so the
adapters' evidence is the injected transport's and the fake's, and the live run
is recorded pending at [[NOTIF-005]]. No CI run yet: the branches are local.

## Tests Added

**WU-C1 (36 cases)** — the selection's production refusals against the pure
resolver; the fake's determinism with a caller-supplied clock and its three
forced outcomes; the email adapter's guardrails (a transport per send closed on
success and on failure, file/URL access disabled, exactly one recipient, an
undeliverable address refused without a retry and without being echoed, a leaky
library message never reaching the reason, 13 address shapes, the retryable
classification); the WhatsApp adapter's template payload, status mapping,
unreachable API, local refusals, timeout, 11 phone shapes; and the dependency
boundary.

**WU-C2 (39 cases)** — the handler's claim (SCHEDULED into SENDING, an absent
row, all three settled statuses, a fresh claim left to its owner, an abandoned
lease re-claimed in place with no status change, a lost race); its gates (email
never asks about a feature, WhatsApp refused without the grant and sent with it,
an unresolved recipient, the closed content seam, the message built from the
seam and passed with the resolved datum); its outcome (`SENT` with the handle
and cleared errors, an absent handle not becoming a null write, `FAILED`
non-retryable, `SENDING` + reason + throw for a retryable one, a throwing
boundary, a failed read propagating, bounded newline-free reasons, no console
output at all, no transaction, tenant-predication on every statement); the two
readers (the channel's contact kind, tenant-predication, null for no contact,
error propagation, the unsupported recipient type; the grant read and its false
and throwing cases); and the consumer (the shared queue names, payload
delegation, a failure propagating, DI registration).

## Known Limitations

- **No operator credentials exist**, so the real adapters are unproven against a
  live provider. The run is recorded **pending and by name** at [[NOTIF-005]].
- **The content is a failing seam until [[NOTIF-003]]** wires the reminder's
  builder: today every delivery settles `NOTIFICATION_CONTENT_UNAVAILABLE`. That
  is deliberate and named, not a silent no-op.
- **A business-initiated WhatsApp message requires an operator-approved
  template**, whose name, language and parameter order are deployment inputs.
- **Platform-level credentials only**; a per-tenant sending identity is a
  product decision that would use the `SecretStore` [[ADR-005]] built
  ([[ADR-011]]).
- **[[ADR-011]]'s advisory record is a maintenance obligation**: the dependency
  must be updated on its security releases (the floor is pinned and `pnpm audit`
  reports 0 advisories for it today).
- **[[TD-040]]**: this Story's five non-blocking review advisories, two of which
  read as real defects (an unguarded transport `close()`, a lenient port parse).

## Decisions / ADRs

- [[DEC-058]] — email ungated, WhatsApp behind the existing `whatsapp` code, no
  thirteenth feature code. The gate is enforced per channel value at the send
  path, and email never asks.
- [[DEC-061]] — this boundary's shape: port, deterministic fake, real adapters,
  fail-closed selection, live run pending.
- **[[ADR-011]] — `accepted` 2026-10-17**: the transactional email dependency is
  `nodemailer` `^10.1.2` over SMTP. It is the Story's gate and it is satisfied.
  The WhatsApp adapter needs no ADR: it is an HTTPS call and adds no dependency,
  which is the requirement deciding rather than the channel.

## Files / Modules

- `packages/notifications/src/channel/` — the port, the fake, both adapters, the
  selection module and their suites.
- `packages/notifications/src/{recipient,entitlement}.port.ts` and
  `delivery.reason.ts` — the delivery path's ports and its settle reasons.
- `apps/worker/src/notification-delivery/` — the handler, the consumer, the two
  readers, the content seam and their suites.
- `apps/worker/src/worker.module.ts` and
  `apps/worker/src/config/worker-env.schema.ts` — the composition root and its
  deployment contract.
- `packages/database/prisma/schema.prisma` and
  `migrations/20261017000002_notif_002_provider_reference/` — the provider
  handle.
- `docs/04-adrs/ADR-011-transactional-email-dependency.md` — the gate.
- [[TD-004]] — the password reset becomes implementable now that the delivery
  path exists, and remains a separate unit.

## Completion Notes

`done` on 2026-10-17. WU-C1 (the boundary) and WU-C2 (the delivery path) both
landed, every acceptance criterion above carries evidence, and the [[ADR-011]]
gate the Story declared was satisfied before the dependency landed.

What keeps this honest: the adapters are proven by injected transports rather
than by a live provider, the content seam deliberately fails closed until
[[NOTIF-003]], and the five review advisories are tracked as [[TD-040]] rather
than absorbed. `done` here means implementation closure — the live send run is
still an operator act and [[NOTIF-005]] records it.

Commits: `c283d92` (WU-C1) and WU-C2 on `feat/notif-002-wu-c1`; receipts in
`odd/tasks/epic-17-notifications.md`.

## Decisions / ADRs

- [[DEC-058]] — email ungated, WhatsApp behind the existing `whatsapp` code, no
  thirteenth feature code.
- [[DEC-061]] — this boundary's shape: port, deterministic fake, real adapters,
  fail-closed selection, live run pending.
- **[[ADR-011]] — `accepted` 2026-10-17**: the transactional email dependency is
  `nodemailer` `^10.1.2` over SMTP. It is the Story's gate and it is satisfied.
  The WhatsApp adapter needs no ADR: it is an HTTPS call and adds no dependency,
  which is the requirement deciding rather than the channel.

## Files / Modules

- `packages/notifications/src/channel/` — `channel.port.ts`, `fake.channel.ts`,
  `email.channel.ts`, `whatsapp.channel.ts`, `channel.module.ts` and their
  suites.
- `packages/notifications/src/index.ts` — the boundary re-exported.
- `packages/notifications/package.json` — `nodemailer` `^10.1.2` and
  `@nestjs/common`, and `pnpm-lock.yaml`.
- `docs/04-adrs/ADR-011-transactional-email-dependency.md` — the gate.
- **Pending (WU-C2)**: `apps/worker/src/notification-delivery/`,
  `apps/api/src/notifications/`, the recipient reader, the entitlement port, and
  the deployables' environment schemas.
- [[TD-004]] — the password reset becomes implementable once the delivery path
  lands, and remains a separate unit.

## Completion Notes

`in-progress`: WU-C1 landed on 2026-10-17 and WU-C2 is the rest of the Story.
Keeping the Story open rather than calling it done is the point — the boundary
compiles, is tested and is selectable, and **nothing sends anything yet**, so
`done` would claim a delivery path that does not exist. The [[ADR-011]] gate the
Story declared was satisfied before the dependency landed, the dependency's
advisories were measured rather than taken on faith, and the review approved the
boundary on the first pass with five non-blocking advisories now tracked as
[[TD-040]].

Commits: `c283d92` (WU-C1) on `feat/notif-002-wu-c1`, stacked on the TD-039
branch. The review receipts are in `odd/tasks/epic-17-notifications.md`.
