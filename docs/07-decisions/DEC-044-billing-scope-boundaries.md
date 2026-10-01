---
id: DEC-044
type: decision
title: Billing epic scope boundaries (EPIC-14)
status: accepted
date: 2026-10-01
related_epics:
  - "EPIC-14"
related_decisions:
  - "DEC-003"
  - "DEC-008"
  - "DEC-033"
  - "DEC-038"
  - "DEC-042"
related_stories:
  - "BILL-001"
  - "BILL-004"
prd_change_required: false
---

# DEC-044 — Billing epic scope boundaries (EPIC-14)

## Context

EPIC-14 is the first Billing slice, so its boundary against neighbouring domains
must be fixed before implementation rather than discovered slice by slice. Every
neighbouring epic has already recorded an expectation about Billing, and several
of those expectations cannot all be satisfied by one epic without inflating it.

Verified current state in this repository (2026-10-01):

- `docs/01-roadmap/EPIC-08-Portal.md:58` lists "Invoices, documents and files
  (blocked on EPIC-14/§25)" as out of scope, and
  `apps/api/src/rbac/route-contract.probe.test.ts:858` actively **fails** the
  build if any route appears under `/portal/invoices`, `/portal/documents` or
  `/portal/files`. PRD §26 lists "invoices/documents" as a portal capability.
- `docs/00-product/SCOPE.md:72` lists "advanced accounts receivable" as an MVP
  non-goal.
- [[DEC-033]] kept sale reversal and payment refund in [[TD-018]] and gave Cash
  standalone movements only; EPIC-13 emitted no invoice.
- `docs/03-architecture/REVERSALS-CORRECTIONS.md` delegates fiscal cancellation
  and events to the Fiscal domain, and [[DEC-042]] keeps the whole Fiscal
  boundary in [[EPIC-15]].
- `docs/01-roadmap/ROADMAP.md` assigns dashboards and reports to [[EPIC-18]],
  notifications to [[EPIC-17]] and imports to [[EPIC-19]].
- The seeded `fiscal-ui` tenant settings namespace (PRD §38) has no schema and
  no surface, and [[DEC-042]] leaves it to [[EPIC-15]].
- [[DEC-018]] and [[DEC-027]] reserve printed and fiscal identifiers for the
  epic that owns a printed or fiscal document, so rendering an invoice number to
  a printable string is not a Billing-epic-internal choice.

## Question

Which adjacent capabilities does EPIC-14 deliberately exclude, and how are the
exclusions tracked so the neighbouring epics' blockers stay visible?

## Options

### Option A — Narrow Billing slice with explicit deferrals (recommended)

EPIC-14 ships the tenant-scoped invoice aggregate, its commands, its permissions
and entitlement gate, and a staff surface. It explicitly excludes:

- **Portal invoices and documents** — stays deferred; the route-contract probe's
  prohibition is not removed in this epic. The customer-visible document surface
  needs its own decision about what a portal identity may see, which is a
  product/privacy question rather than a Billing implementation detail, and it
  is not answered by PRD §21. [[TD-022]] records the deferral, its owner and its
  re-evaluation point after [[EPIC-15]]/[[EPIC-16]].
- **Accounts receivable, credit ledger and invoice payment allocation** — MVP
  non-goal (`SCOPE.md:72`) and, per PRD §19, payments belong to the sale rather
  than to the invoice.
- **Fiscal documents, fiscal state and fiscal UI** — [[EPIC-15]] per
  [[DEC-042]].
- **Printed document rendering** (invoices as printable PDFs, official number
  formatting) — follows [[DEC-018]]/[[DEC-039]] and belongs to the epic that
  owns a printed document.
- **Reports and dashboards over invoices** — [[EPIC-18]].
- **Email/WhatsApp invoice delivery** — [[EPIC-17]].
- **Refunds, payment reversal and sale reversal** — [[TD-018]].
- **Multi-branch or establishment-scoped numbering** — [[DEC-039]] fixes one
  per-tenant sequence; branch series are not required by PRD §21 and the branch
  hierarchy is already out of scope for stock and cash.

Benefits: the epic stays reviewable, every exclusion has a named owner, and no
adjacent epic's blocker is silently closed.

Costs: the portal's "invoices/documents" blocker stays open after EPIC-14, so
[[TD-022]] keeps it visible with a named owner and a re-evaluation point, and
the PRD §26 portal row remains unimplemented.

The re-evaluation point is deliberate rather than a vague "later": what a
customer actually wants to open in the portal is the authorised fiscal document
(the KuDE), not an internal business invoice, and no fiscal document exists
before [[EPIC-15]]/[[EPIC-16]]. Building the portal reader in EPIC-14 would ship
a surface that has to be redesigned once the authorised document exists.

### Option B — Also open the portal invoice read surface

Add a read-only `/portal/invoices` surface in EPIC-14 and remove the probe
prohibition.

Costs: it adds a second identity model's authorization surface, its own data
classification and redaction decisions, and a UI surface to an epic that has no
portal knowledge; it also contradicts the portal epic's own recorded boundary
without a product decision.

### Option C — No explicit boundary record

Let the boundaries emerge from the story files.

Rejected: the repository's governance requires scope control and named debt
owners, and the neighbouring epics already recorded expectations that would
otherwise be broken silently.

## Recommendation

Option A, with [[TD-022]] recording the still-blocked portal invoice and
document surface so it is not lost. The boundary rule to apply while
implementing: EPIC-14 may read Sales and may write only its own aggregate; it
may not write money, stock, payments, cash or fiscal state.

## Impact

### Product

Users get correct, auditable invoicing for completed sales. No portal document
view, no receivable tracking and no fiscal behaviour arrive in this epic.

### Architecture

Billing reads the Sales aggregate and writes only its own tables. No new
runtime, queue, dependency or cross-domain writer.

### Database/API

Only `invoice`, `invoice_line` and `invoice_number_sequence` are added, plus the
`billing.*` permission seeds. No portal route, no fiscal table and no report
table.

### Delivery

BILL-001 owns the aggregate boundary; BILL-004 owns the staff surface and must
not add a portal route or a print/export feature; BILL-005 keeps [[TD-022]] and
the explicit limitation list current instead of closing either by implication.

## Decision

Accepted on 2026-10-01 by the maintainer. Option A is the decision: EPIC-14
ships the narrow Billing slice and every exclusion listed above stands, with the
portal invoice and document surface tracked by [[TD-022]] — owned by the
maintainer, re-evaluated after [[EPIC-15]]/[[EPIC-16]] — instead of being
implemented here.

The other options stay recorded above as what was considered; acceptance selects
Option A only.

The boundary rule is binding while implementing: EPIC-14 may read Sales and may
write only its own aggregate, and it writes no money, stock, payment, cash or
fiscal state. BILL-001 owns the aggregate boundary; BILL-004 owns the staff
surface and must not add a portal route or a print or export feature; BILL-005
keeps [[TD-022]] and the limitation list current instead of closing either by
implication.

## PRD Update

No PRD change is required. Every exclusion above either matches an existing PRD
non-goal, an existing epic boundary or a decision already recorded; nothing here
narrows or extends approved product scope. If the maintainer wants the portal
invoice surface in EPIC-14, that is a product scope decision and must be
recorded as an accepted decision before implementation.
