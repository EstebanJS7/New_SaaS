---
id: DEC-061
type: decision
title:
  The notification channel boundary — one port, a deterministic fake, real
  adapters and an ADR gate
status: accepted
date: 2026-10-16
related_epics:
  - "EPIC-17"
related_decisions:
  - "DEC-048"
  - "DEC-058"
related_stories:
  - "NOTIF-002"
prd_change_required: false
---

# DEC-061 — The notification channel boundary

## Context

PRD §24 names two channels, `EMAIL` and `WHATSAPP`. They are two ways to deliver
one thing, not two domains: a second `notifications` module per channel would be
a second module for one capability, and `AGENTS.md` prefers deleting an
unnecessary abstraction over adding one.

Two precedents are directly reusable and were both proven in the fiscal epics:

- **[[DEC-048]] and `packages/fiscal/src/fiscal-provider.module.ts`** — one
  port, a deterministic fake and the real implementation behind it, selected by
  a closed set of environment values shared by every deployable's schema and the
  composition root. Its production rule is precise, and this decision adopts it
  rather than a paraphrase of it: an **absent** value is refused in production,
  an **unknown** value is refused **by name**, there is **no silent fallback**,
  and the fake remains selectable when an operator names it deliberately,
  because that is the documented dedicated-demo path. The refusal is about
  absence, not about the fake.
- **FISC-012 and FISC-013** — the boundary ships complete in code and the live
  run is recorded **pending and by name** when the operator inputs do not exist.

`AGENTS.md` requires a concrete requirement before a new dependency, and
`DOCUMENTATION-RULES.md` insists that architectural choices be recorded.
[[ADR-006]] is the precedent for treating a library choice as architectural.

## Question

How do two channels reach production: one module or two, a port with fakes or
direct calls, how is the provider selected, how much of it ships without
operator credentials, and what does a new dependency require?

## Options

### Option A — One port, a deterministic fake, both real adapters behind it, ADR-gated dependencies, the live run recorded pending (recommended)

`EMAIL` and `WHATSAPP` are two implementations of one `NotificationChannelPort`,
selected by configuration with the fiscal module's fail-closed rules. The real
adapters ship. The tests are carried by the fake. The live run is recorded as
pending because no operator credentials exist. Any new dependency needs an
accepted ADR first.

Benefits: the epic is complete behind its boundary instead of half-built; the
safety path is proven without credentials; the delivery record, the queue and
the lifecycle stay channel-agnostic, so a third channel would be an adapter.

### Option B — Ship the fake only, defer the real adapters

Rejected: PRD §24 names the channels as product behaviour, and a fake-only
delivery would make the epic's own acceptance criteria unreachable. It also
leaves [[TD-004]] blocked on nothing in particular.

### Option C — Two modules, one per channel

Rejected: two aggregates, two lifecycles and two permission families for one
capability. `AGENTS.md`'s domain-boundary rule does not require a module per
provider, and the fiscal epic already proved the port shape.

### Option D — Call an email library and a WhatsApp SDK directly from the delivery

handler

Rejected: it hardcodes the provider into the aggregate's only caller, makes the
channel untestable without the network, and leaves no place to put the
production-selection rule.

## Recommendation

Option A.

## Impact

### Product

Both MVP channels exist. WhatsApp stays transactional only (PRD §24) and stays
entitled ([[DEC-058]]).

### Architecture

One port, two adapters, one selection surface. `ENGINEERING-RULES.md`'s
external-call rule is respected: the intent is persisted, committed and
enqueued, and the provider is called outside any database transaction. A channel
registry, a plugin system or a per-channel module is explicitly **not**
introduced.

### Database/API

No schema change beyond [[NOTIF-001]]'s. The recipient's contact datum is
**RESTRICTED** (PRD §41): resolved at send time, never persisted in the delivery
record, never placed in a job payload, never logged and never serialized into a
response.

### Delivery

[[NOTIF-002]] owns the port, the fake, the adapters and the selection.
[[NOTIF-005]] records the live-run outcome as pending if it stays unperformed.

## Decision

Accepted by the maintainer on 2026-10-16. **The channel boundary ships complete:
one port, a deterministic fake for tests, the real `EMAIL` and `WHATSAPP`
adapters behind it, and fail-closed provider selection in production following
`FISCAL_PROVIDER`'s exact rules. With no operator credentials, the live run is
recorded PENDING and by name.**

Two consequences the epic carries:

1. **The email library's choice requires an ADR**, exactly as [[ADR-006]]
   treated the signing library: it is a new dependency chosen for an
   architectural role. **No email dependency is added before its ADR is
   `accepted`.** The ADR records the concrete requirement, the candidates, the
   licence and advisory record, the package it lands in, and what it
   deliberately does not solve. The WhatsApp integration triggers the same rule
   only if it actually adds a dependency — the requirement decides, not the
   channel.
2. **The fake is the evidence, and the pending run is named.** The automated
   suite proves the port's contract, the outcomes and the fail-closed selection.
   The live run is a separate, operator-owned act, and the epic's `done` does
   not absorb it.

## PRD Update

No PRD change. This decision implements PRD §24's two channels and PRD §41's
classification obligation; it adds no product scope and no channel beyond the
two the PRD names.
