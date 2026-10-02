---
id: DEC-046
type: decision
title: Fiscal document aggregate, state machine and invoice linkage
status: accepted
date: 2026-10-02
related_epics:
  - "EPIC-15"
related_decisions:
  - "DEC-038"
  - "DEC-042"
  - "DEC-043"
related_stories:
  - "FISC-002"
prd_change_required: false
---

# DEC-046 — Fiscal document aggregate, state machine and invoice linkage

## Context

PRD §22 requires a reusable Core Fiscal domain and says `FiscalDocument` stores
provider, external ID, state, CDC when available, XML/KuDE storage refs,
sanitary request/response snapshots, attempts/errors and timestamps. PRD §21
says invoice status is distinct from fiscal status. [[DEC-042]] assigns the
additive invoice-to-fiscal-document linkage to EPIC-15 and rejected a fiscal
status column on `Invoice`.

## Question

What aggregate shape and fiscal states does EPIC-15 add, and how is it linked to
Billing invoices without duplicating invoice state?

## Options

### Option A — One active FiscalDocument per invoice, Fiscal-owned state (recommended)

Add a tenant-scoped `FiscalDocument` with provider, state, source invoice,
provider external identifiers, CDC/XML/KuDE storage refs, sanitized snapshots,
attempt counters/errors and timestamps. Enforce one active fiscal document per
invoice for issuance; future cancellation/event documents reference the original
fiscal document or use explicit Fiscal operations. `Invoice` receives no fiscal
status column.

Benefits: matches PRD §21/§22, preserves Billing/Fiscal separation and keeps
EPIC-15 reviewable.

Costs: future provider-specific event history may require additive tables once a
real adapter defines exact needs.

### Option B — Store fiscal state directly on Invoice

Rejected by [[DEC-042]] and PRD §21 because it duplicates Fiscal state.

### Option C — Model every provider attempt as its own FiscalDocument

Useful for audit detail but makes issuance multiplicity hard to reason about and
inflates the first abstraction slice.

## Recommendation

Option A. Use a single active issuance document per invoice with Fiscal-owned
state and additive fields/tables only where the accepted retry/idempotency
record requires them.

## Impact

### Product

Staff and later portal surfaces can reason about one fiscal issuance record for
an invoice.

### Architecture

Billing keeps business invoice status; Fiscal owns provider state.

### Database/API

FISC-002 adds the table/enums/constraints and live-PostgreSQL probes.

### Delivery

Implementation waits until this decision is accepted.

## Decision

Accepted: EPIC-15 will use one tenant-scoped active issuance `FiscalDocument`
per invoice, with Fiscal-owned state and no fiscal status column on `Invoice`.
Future cancellation/event documents will link to the original document or use
explicit Fiscal operations; additive fields or tables may be introduced only
when required by the accepted retry/idempotency record.

## PRD Update

No PRD change is expected. This records the implementation shape of PRD §22.
