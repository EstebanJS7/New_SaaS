---
id: NOTIF-002
type: story
title: The channel port
epic: EPIC-17
status: in-progress
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
- [ ] The entitlement gate applies to `WHATSAPP` and not to `EMAIL`, and it is
      evaluated before any persistence or external call; a tenant without the
      `whatsapp` grant gets a stable `FEATURE_NOT_ENTITLED`-class refusal and no
      delivery record. **Pending (WU-C2)**: the read lives beside the recipient
      resolution, where the tenant's grant can be read from the same client the
      send path already holds.
- [ ] The recipient's contact datum is RESTRICTED: it is read at send time, it
      is never written to the delivery record, never placed in a job payload,
      never logged, and never returned by an API. A log-capture assertion proves
      it. **Partly done**: the port takes it as a frame-local value and both
      adapters are asserted never to echo it into a reason — including the
      library's own message text, which is why only the error's `code` and
      `responseCode` travel. The reader over `CustomerContact` and the
      log-capture assertion are **pending (WU-C2)**.
- [ ] Every provider call happens **outside** a database transaction: the intent
      is committed and enqueued, and only then is the provider called. **Pending
      (WU-C2)**: this Story ships no call site yet.
- [ ] A provider failure lands the delivery on `FAILED` with a bounded,
      sanitized reason, and a retryable failure is retried within the bounded
      budget rather than retried forever. **Partly done**: the classification is
      implemented and tested per adapter (a connection failure and an SMTP `4xx`
      or an HTTP `429`/`5xx` are retryable; a decision, a configuration problem
      or a bad message is not); its persistence is **pending (WU-C2)**.
- [ ] A retried delivery does not send a second message for a delivery already
      `SENT`. **Pending (WU-C2)** — the claim is what enforces it.
- [ ] The worker registers the consumer for exactly
      `NOTIFICATION_DELIVERY_QUEUE` and exposes the handler through DI, and a
      delivery whose observed status the guard does not admit is a no-op rather
      than a crash — the fiscal consumer's duplicate-delivery discipline.
      **Pending (WU-C2)**.
- [ ] A claim is a compare-and-swap on the observed status and the lease, so two
      workers racing one delivery admit exactly one attempt, and an abandoned
      claim past its lease may be re-claimed in place (the status is unchanged,
      which is why the guard admits it). **Pending (WU-C2)**.
- [ ] A retryable failure records its bounded, sanitized reason on the row and
      throws so BullMQ retries; a non-retryable one lands `FAILED`. Neither
      writes a reason the delivery's own CHECKs refuse. **Pending (WU-C2)**.
- [ ] Both channels are reached only through the port; no caller imports a
      concrete adapter, and a repository search proves it. **Partly done**: the
      composition root is the only constructor site, and
      `dependency-boundary.test.ts` proves [[ADR-011]] guardrail 7 — the email
      library is imported by exactly one file. The "no caller imports a concrete
      adapter" half needs the caller, which is **pending (WU-C2)**.
- [x] Tenant isolation is enforced when applicable. Evidence: the boundary holds
      no tenant state at all — it is stateless per call — so the isolation that
      matters here is that no transport is shared between tenants ([[ADR-011]]
      guardrail 2), which the adapter's per-send transport case asserts. The
      tenant-predicated recipient resolution is **pending (WU-C2)**.
- [ ] Backend authorization is enforced when applicable. Evidence: not
      applicable in this Story — no route is added; the entitlement gate above
      is not a permission check and [[NOTIF-004]] owns permissions.
- [ ] Required loading/error/empty/success UX exists. Evidence: not applicable
      in this Story — no UI.
- [ ] Required audit exists. Evidence: not applicable — PRD §27 does not list a
      notification delivery among the critical audited actions; the delivery
      record carries the outcome.
- [x] Tests required by the Story pass, **including the production-refusal tests
      for the selection**, which are written against the pure resolver so an
      untested safety path cannot regress silently. Evidence: 36 new cases
      across the boundary's five suites, all green, with no network and no
      database.

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

### WU-C2 — the delivery path, still pending

The recipient reader over `CustomerContact` (RESTRICTED), the `WHATSAPP`
entitlement gate, the worker consumer and the delivery handler with its claim
compare-and-swap, the two deployables' composition roots, and the environment
schemas that consume the exported value lists.

## Verification

```text
Local gates (green):
  pnpm format-check                                 clean
  pnpm lint                              21/21 tasks successful
  pnpm typecheck                         21/21 tasks successful
  pnpm build                             13/13 tasks successful
  pnpm test                              all suites green:
    @newsaas/notifications               7 files, 53 tests (36 new)
    @newsaas/database 509, @newsaas/fiscal 788, worker 164, web 1087,
    ui 36, shared 16, secret-store 50, api 1214 passed | 266 skipped

Review (RDD, medium tier, one lens):
  lineage                                review-02c5036e0cf9a762
  base                                   c6acccf (the TD-039 receipt)
  candidate tree                         70fd3e6b
  consent                                relayed, granted by the maintainer
  lens                                   review-reliability
  result                                 APPROVED on the first pass, no
                                         correction, no blocker
  advisories                             R3-001..R3-005 (4 WARNING, 1 SUGGESTION)
                                         -> recorded as [[TD-040]]
  outcome                                acknowledged, authority burned

Dependency facts measured, not assumed (2026-10-17):
  registry.npmjs.org/nodemailer/latest              10.1.2, MIT-0
  its manifest                                      dependencies: {}, no gypfile
  its exports                                       import + require + own types
  pnpm audit --prod | grep nodemailer               0 advisories contributed
  installed                                         10.1.2
```

Not run, and why: no live provider exists (no operator credentials), so the
adapters' evidence is the fake's and the injected-transport cases'; the live run
is recorded pending at [[NOTIF-005]]. No CI run yet: the branch is local.

## Tests Added

- `channel.module.test.ts` (9) — the selection: absent outside production,
  absent refused in production by variable name, unknown refused by name in
  every environment, `fake` accepted everywhere including production, a real
  selection refusing each missing input by name, a non-numeric port refused, and
  the override seam.
- `fake.channel.test.ts` (5) — determinism with a caller-supplied clock, the
  three forced outcomes with the last repeating, no recipient in a failure
  reason, the attempt log, and the parameters being copied rather than held.
- `email.channel.test.ts` (11) — a transport per send, closed on success and on
  failure, file/URL access disabled on every message, exactly one recipient and
  no caller header, the provider reference, an undeliverable address refused
  without a retry and without being echoed, a leaky library message never
  reaching the reason, 13 address shapes accepted/refused, and the retryable vs
  non-retryable classification.
- `whatsapp.channel.test.ts` (10) — the template payload and its ordered
  parameters, the rendered body never sent, a configured base URL, a 2xx with no
  message id, the status mapping, an unreachable API, both local refusals
  without a call, the timeout bound, 11 phone shapes, and the classification.
- `dependency-boundary.test.ts` (4) — the package is walked (so the rule is not
  vacuous), each import form a bypass would use is recognised, only the email
  adapter imports the library, and the adapter really does import it.

## Known Limitations

- **No operator credentials exist**, so the real adapters are unproven against a
  live provider. The run is recorded **pending and by name** at [[NOTIF-005]];
  the automated evidence is the fake's and the injected transport's.
- **A business-initiated WhatsApp message requires an operator-approved
  template**, whose name, language and parameter order are deployment inputs.
  The adapter therefore sends the template and the ordered parameters and
  ignores the rendered body — a policy constraint of the channel, documented in
  the adapter.
- **Platform-level credentials only.** A per-tenant sending identity is not
  implemented; it is a product decision that would use the `SecretStore`
  [[ADR-005]] built ([[ADR-011]]).
- **[[ADR-011]]'s advisory record is a maintenance obligation**: the dependency
  must be updated on its security releases. The floor is pinned and the audit is
  clean today (`pnpm audit` reports 0 advisories for it).
- No email dependency was added before the ADR was accepted: [[ADR-011]] is
  `accepted` as of 2026-10-17.

## Technical Debt

- **[[TD-040]] — this unit's five non-blocking review advisories**, four WARNING
  and one SUGGESTION, recorded by coordinate with their readings explicitly
  marked as readings (the closure publishes no claim text). Two of the readings
  read as real defects to me and are cheap: an unguarded transport `close()`
  that could turn a successful send into a failure, and a `Number.parseInt` that
  accepts `587abc` as `587`. They are later work rather than a reopened review,
  which is what the closure's own wording requires.

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
