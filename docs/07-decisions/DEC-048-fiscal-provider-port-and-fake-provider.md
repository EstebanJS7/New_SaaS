---
id: DEC-048
type: decision
title: Fiscal provider port, fake provider and result taxonomy
status: accepted
date: 2026-10-02
related_epics:
  - "EPIC-15"
related_stories:
  - "FISC-003"
prd_change_required: false
---

# DEC-048 — Fiscal provider port, fake provider and result taxonomy

## Context

PRD §22 requires Billing to depend on a Fiscal application interface rather than
a concrete provider. `docs/06-fiscal/SIFEN.md` fixes the sequence
`FakeFiscalProvider → ThirdPartyFiscalProvider → SifenDirectFiscalProvider` and
forbids implementing SIFEN Direct from stale notes.

## Question

What provider contract does EPIC-15 expose, and what behavior does the fake
provider implement?

## Options

### Option A — Minimal provider port with deterministic fake outcomes (recommended)

Define a Fiscal provider port with issue/cancel capabilities required by
EPIC-15, returning normalized outcomes: approved, rejected, transient failure
and configuration/functional failure. `FakeFiscalProvider` selects deterministic
outcomes from controlled non-secret test/dev inputs. It does not generate SIFEN
XML or simulate provider protocol details.

Benefits: proves the abstraction without stale protocol assumptions.

Costs: fake behavior is intentionally narrower than a real provider.

### Option B — Rich SIFEN-shaped fake provider

Rejected until official DNIT docs are revalidated; it invites false protocol
confidence.

### Option C — No provider implementation in EPIC-15

Rejected by [[DEC-042]], which assigns the fake provider to this epic.

## Recommendation

Option A.

## Impact

### Product

Dev/test tenants can exercise fiscal flows without a production provider.

### Architecture

Concrete providers stay behind the Fiscal boundary.

### Database/API

Provider results map to FiscalDocument state and sanitized snapshots.

### Delivery

FISC-003 owns port/fake/tests.

## Decision

Accepted: EPIC-15 will define a minimal Fiscal provider port with issue/cancel
capabilities and normalized approved, rejected, transient-failure, and
configuration/functional-failure outcomes. `FakeFiscalProvider` will select
deterministic outcomes from controlled non-secret test/dev inputs and will not
generate SIFEN XML or simulate provider protocol details.

## PRD Update

No PRD change is required.
