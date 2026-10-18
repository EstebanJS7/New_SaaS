---
id: DEC-058
type: decision
title: Notification entitlements — email ungated and no thirteenth feature code
status: accepted
date: 2026-10-16
related_epics:
  - "EPIC-17"
related_decisions:
  - "DEC-061"
related_stories:
  - "NOTIF-002"
  - "NOTIF-003"
prd_change_required: false
---

# DEC-058 — Notification entitlements: email ungated, WhatsApp behind `whatsapp`

## Context

PRD §10 fixes the twelve initial feature codes:

```text
veterinary  inventory  purchases  sales  cash  billing
fiscal  portal  whatsapp  multi_branch  advanced_reports  custom_branding
```

`whatsapp` is among them, it is already seeded in
`packages/database/src/reference-seed.ts` (`FEATURE_CODE_SEEDS`) and it is
mapped to the starter plan. `notifications` is **not** among the twelve, while
PRD §34 lists `notifications` as a Core **capability** — a capability that is
not a feature code.

PRD §24 requires two channels for the MVP, `EMAIL` and `WHATSAPP`, and fixes the
rule that MVP WhatsApp is transactional only.

`AGENTS.md` and `DOCUMENTATION-RULES.md` both require that a scope change to the
PRD be an explicit decision rather than an implementation shortcut, and
`docs/03-architecture/TENANT-SETTINGS.md` already has an entitlement mechanism
(`requiresFeature`) that a namespace can use.

## Question

How is notification access gated per tenant: does email get its own feature
code, is WhatsApp gated by the existing `whatsapp` code, and should the
`notifications` settings namespace be feature-gated?

## Options

### Option A — Email ungated; WhatsApp behind the existing `whatsapp` code (recommended)

Email is available to every tenant. WhatsApp requires the tenant's `whatsapp`
grant, checked on the cost-bearing path. The `notifications` settings namespace
declares **no** `requiresFeature`.

Benefits: uses the code that already exists and is already mapped, honours PRD
§10's fixed twelve, needs no PRD change, and matches the fact that PRD §34
treats `notifications` as a capability rather than a feature code. Email is the
channel every tenant needs for the transactional messages the product already
owes (password reset, per [[TD-004]]).

### Option B — Add a thirteenth `notifications` feature code

Rejected by the maintainer: PRD §10 fixes the twelve, so a thirteenth is a PRD
change and therefore a product-scope decision, not an implementation detail.
Rejecting it also avoids gating an email channel that a blocked Tech Debt item
already depends on.

### Option C — Gate both channels behind `whatsapp`

Rejected: `whatsapp` describes WhatsApp. Gating email behind it would make the
password-reset unblock depend on a WhatsApp entitlement, which is a product
claim nobody made.

## Recommendation

Option A.

## Impact

### Product

Every tenant may send email. WhatsApp is an entitled capability, and MVP
WhatsApp stays transactional only (PRD §24).

### Architecture

No new catalog entry. The `notifications` settings namespace is registered
without `requiresFeature`, and the WhatsApp gate is a value-level check at the
send path, not a namespace gate.

### Database/API

No migration for feature codes. The settings write path seeds
`notifications.settings.manage` and evaluates the `whatsapp` grant only when a
configured channel set includes `WHATSAPP`.

### Delivery

[[NOTIF-002]] implements the channel gate; [[NOTIF-003]] implements the settings
namespace and the configured-channel-set check.

## Decision

Accepted by the maintainer on 2026-10-16. **Email is not gated by any feature
code. WhatsApp is gated by the existing `whatsapp` feature code. No thirteenth
feature code is added, and the `notifications` tenant-settings namespace
declares no `requiresFeature`, because PRD §10 fixes the twelve.**

The consequence this creates, recorded deliberately: the WhatsApp gate is
enforced **per channel value**, so a tenant without the grant cannot put
`WHATSAPP` into its configured channel set, and the send path re-asserts the
grant regardless of what the stored setting says. A namespace-level gate would
have been simpler and wrong, since it would also gate email.

## PRD Update

No PRD change. This decision explicitly preserves PRD §10's twelve codes, and
the `notifications` capability in PRD §34 is unchanged by it.
