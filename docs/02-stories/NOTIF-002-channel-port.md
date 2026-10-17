---
id: NOTIF-002
type: story
title: The channel port
epic: EPIC-17
status: planned
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

- [ ] Both channels are reached only through the port; no caller imports a
      concrete adapter, and a repository search proves it.
- [ ] The fake is deterministic: the same input produces the same result, and no
      test depends on the network, on wall-clock time or on a random value.
- [ ] A test can force each outcome the caller must handle — success, a
      retryable failure and a non-retryable failure — without a network.
- [ ] The selection is fail-closed in production exactly as `FISCAL_PROVIDER`
      is: one exported list of accepted values shared by the deployables'
      schemas and the composition root, an unknown value refused **by name**,
      and an absent value refused in production instead of silently defaulting.
- [ ] There is no silent fallback to the fake: a deployment that names no
      provider fails loudly rather than quietly delivering nothing.
- [ ] The entitlement gate applies to `WHATSAPP` and not to `EMAIL`, and it is
      evaluated before any persistence or external call; a tenant without the
      `whatsapp` grant gets a stable `FEATURE_NOT_ENTITLED`-class refusal and no
      delivery record.
- [ ] The recipient's contact datum is RESTRICTED: it is read at send time, it
      is never written to the delivery record, never placed in a job payload,
      never logged, and never returned by an API. A log-capture assertion proves
      it.
- [ ] Every provider call happens **outside** a database transaction: the intent
      is committed and enqueued, and only then is the provider called.
- [ ] A provider failure lands the delivery on `FAILED` with a bounded,
      sanitized reason, and a retryable failure is retried within the bounded
      budget rather than retried forever.
- [ ] A retried delivery does not send a second message for a delivery already
      `SENT`.
- [ ] Tenant isolation is enforced when applicable. Evidence: the recipient
      resolution is tenant-predicated and a foreign reference never resolves.
- [ ] Backend authorization is enforced when applicable. Evidence: not
      applicable in this Story — no route is added; the entitlement gate above
      is not a permission check and [[NOTIF-004]] owns permissions.
- [ ] Required loading/error/empty/success UX exists. Evidence: not applicable
      in this Story — no UI.
- [ ] Required audit exists. Evidence: not applicable — PRD §27 does not list a
      notification delivery among the critical audited actions; the delivery
      record carries the outcome.
- [ ] Tests required by the Story pass, **including the production-refusal tests
      for the selection**, which are written against the pure resolver so an
      untested safety path cannot regress silently.

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

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- The fake's determinism and its three forced outcomes.
- The selection resolver: accepted values, unknown value refused by name, absent
  value refused in production, and no fallback to the fake.
- The entitlement gate: `WHATSAPP` refused without the grant and admitted with
  it; `EMAIL` unaffected.
- The RESTRICTED-datum assertions: log capture, payload inspection and the
  delivery-record column set.
- Retry and terminal-state behavior on the aggregate from [[NOTIF-001]].

## Known Limitations

- **No operator credentials exist**, so the real adapters are unproven against a
  live provider. The run is recorded **pending and by name** at [[NOTIF-005]];
  the automated evidence is the fake's.
- If the WhatsApp integration requires a dependency, it triggers an ADR of its
  own before it lands.

## Technical Debt

- None yet; anything raised by the implementation is recorded here and triaged
  at [[NOTIF-005]].

## Decisions / ADRs

- [[DEC-058]] — email ungated, WhatsApp behind the existing `whatsapp` code, no
  thirteenth feature code.
- [[DEC-061]] — this boundary's shape: port, deterministic fake, real adapters,
  fail-closed selection, live run pending.
- **A new ADR is required for the email library** (gate for this Story, and for
  any dependency the WhatsApp integration introduces). Compare [[ADR-006]].

## Files / Modules

- `packages/notifications/src/` — the port, the fake and the selection resolver.
- `packages/notifications/src/email/` and `packages/notifications/src/whatsapp/`
  — the adapters, behind the ADR gate.
- `apps/api/src/notifications/` and `apps/worker/src/notification-delivery/` —
  the composition roots where the selection is bound.
- The deployables' environment schemas, which consume the shared value lists.
- [[TD-004]] — the password reset becomes implementable once this Story lands,
  and remains a separate unit.

## Completion Notes

_Status must remain non-done until all required gates pass._
