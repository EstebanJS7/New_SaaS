---
id: DEC-042
type: decision
title: Fiscal boundary ownership across EPIC-14 and EPIC-15
status: accepted
date: 2026-10-01
related_epics:
  - "EPIC-14"
  - "EPIC-15"
related_decisions:
  - "DEC-039"
  - "DEC-041"
related_stories:
  - "BILL-001"
  - "BILL-003"
prd_change_required: false
---

# DEC-042 — Fiscal boundary ownership across EPIC-14 and EPIC-15

## Context

PRD §22 states that Fiscal is a reusable Core domain, that "Billing imports a
Fiscal application interface, never a concrete provider", and that
`FiscalDocument` stores the provider, external id, state, CDC, XML/KuDE storage
references, sanitized request/response snapshots, attempts/errors and
timestamps, with queued and idempotent submission. PRD §23 forbids implementing
SIFEN protocol details from memory before revalidating official DNIT
documentation. PRD §21 states that "Invoice is distinct from fiscal status".

The roadmap orders the epics as
`EPIC-14 Billing → EPIC-15 Fiscal Abstraction → EPIC-16 Fiscal Third-party Adapter`,
and `docs/01-roadmap/ROADMAP.md` records `EPIC-15` as depending on `EPIC-14`.
That ordering creates a design question that must be answered before BILL-001
lands.

Verified current state in this repository (2026-10-01):

- No `FiscalDocument` model, no fiscal enum and no fiscal module exist;
  `apps/api/src/` has no `fiscal/` or `billing/` directory.
- The seeded feature codes `billing` and `fiscal` both exist
  (`reference-seed.ts:387-388`), so the two capabilities are already separate at
  the entitlement layer.
- The tenant settings registry declares a `fiscal-ui` namespace
  (`docs/00-product/PRD.md` §38 lists it among the initial namespaces) but no
  fiscal settings schema or surface exists.
- `docs/06-fiscal/SIFEN.md` fixes the MVP provider sequence
  `FakeFiscalProvider → ThirdPartyFiscalProvider → SifenDirectFiscalProvider`,
  and `packages/shared/src/events/dispatcher.ts` exists without any `apps/`
  consumer.
- No worker job processor, queue producer or outbox table exists in `apps/`;
  `apps/worker` only performs a Redis health check.
- `apps/api/src/sales/sales.service.ts` completes a sale without any fiscal
  call, which is the only shipped precedent for "a business document that is not
  a fiscal document".

## Question

Does EPIC-14 define the Fiscal application interface (port, DTOs and a fake
provider) so that Billing can import it as PRD §22 requires, or does EPIC-14
ship a fiscal-free invoice aggregate and leave the whole Fiscal boundary to
EPIC-15?

## Options

### Option A — EPIC-14 ships a fiscal-free invoice (recommended)

BILL-001 adds no fiscal column, no fiscal reference, no port and no queue.
Invoice status stays exactly the PRD §21 business status, and "Invoice is
distinct from fiscal status" remains literally true in the schema. [[EPIC-15]]
then creates the Fiscal domain, the application interface, `FiscalDocument`, the
queued submission and the `fiscal-ui` surface, and links invoices to fiscal
documents through an **additive** change in that epic — the same additive
pattern [[EPIC-13]] used to extend the EPIC-12 cash foundation.

Benefits: the dependency direction stays acyclic; no interface is invented
before its provider requirements are known (PRD §23 defers the protocol
details); no speculative column or queue lands in Billing; and the epic stays
the smallest slice that satisfies PRD §21.

Costs: the PRD §36 journey step "fiscal submission queued" is not reached at the
end of EPIC-14, only after EPIC-15; the invoice detail cannot show any fiscal
state in this epic, and the Billing UI must say so rather than imply it.

### Option B — EPIC-14 defines the Fiscal application interface and a fake provider

Billing ships the port plus a `FakeFiscalProvider`, and EPIC-15 implements real
providers behind it.

Benefits: the seam exists one epic earlier and Billing can depend on an
interface from the start, matching the literal wording of PRD §22.

Costs: EPIC-14 would define a boundary, a fake provider and probably a
submission queue before the fiscal state machine, retry policy, sanitization
rules and `FiscalDocument` shape are designed, so the interface would be
rewritten by the epic that actually knows its requirements. It also moves
"queued submission" into the epic that has no worker processor.

### Option C — EPIC-14 adds a `fiscal_status` column as a placeholder

The invoice stores a fiscal status field that EPIC-15 later populates.

Costs: it duplicates state that PRD §22 places on `FiscalDocument`, violates the
"invoice is distinct from fiscal status" rule at the schema level, and forces a
backfill decision before the fiscal state machine exists.

## Recommendation

Option A. The roadmap ordering is coherent once the interface is read as
"EPIC-15 owns the Fiscal boundary and EPIC-14 prepares the document it will
annotate": PRD §22 describes the target architecture, not a requirement that
Billing ship the port first. Nothing in EPIC-14 calls a fiscal provider, so
Billing cannot be described as importing a concrete provider — the rule is not
violated by having no fiscal call at all.

## Impact

### Product

EPIC-14 delivers invoicing without any fiscal behaviour. Users see no fiscal
state and no fiscal action; the delivery note for the epic must state this
explicitly so the missing journey step is not mistaken for a defect.

### Architecture

No new runtime, queue, dependency or protocol. The Fiscal domain, its port and
its queued submission stay entirely inside [[EPIC-15]], and Billing never
imports a concrete provider.

### Database/API

No fiscal table, column or endpoint in EPIC-14. EPIC-15 is expected to add the
fiscal linkage additively rather than by rewriting the invoice aggregate.

### Delivery

BILL-001 owns the fiscal-free aggregate. The epic record and
`docs/05-modules/Billing.md` must record the deferred fiscal integration and the
journey step it leaves open, and [[EPIC-15]] is where the linkage and the
`InvoiceConfirmed` consumer land.

## Decision

Accepted on 2026-10-01 by the maintainer. Option A is the decision: EPIC-14
ships a fiscal-free invoice — no fiscal column, reference, port, provider, queue
or event — and [[EPIC-15]] owns the Fiscal application interface, the fake
provider, `FiscalDocument`, the queued submission, the `fiscal-ui` surface and
the additive linkage from an invoice to its fiscal document.

The other options stay recorded above as what was considered; acceptance selects
Option A only.

The consequence is accepted explicitly: the PRD §36 journey step "fiscal
submission queued" is not reached when EPIC-14 closes, and the epic, the module
documentation and the closure evidence must state that rather than imply it.
Billing imports no Fiscal provider, concrete or otherwise, in this epic.

## PRD Update

No PRD change is required. PRD §21 and §22 already assign fiscal status and
fiscal documents to the Fiscal domain; this record only sequences which epic
builds the boundary, which the PRD does not fix.
