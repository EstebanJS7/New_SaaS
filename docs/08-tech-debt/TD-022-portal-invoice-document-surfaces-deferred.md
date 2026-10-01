---
id: TD-022
type: tech-debt
title: Portal invoice and document surfaces remain deferred
status: open
severity: medium
related_epics:
  - EPIC-08
  - EPIC-14
  - EPIC-15
  - EPIC-16
related_stories:
  - BILL-005
created: 2026-10-01
updated: 2026-10-01
---

# TD-022 — Portal invoice and document surfaces remain deferred

## Context

PRD §26 lists "invoices/documents" among the customer portal capabilities, and
the PRD §36 MVP acceptance journey ends with "customer portal login → customer
sees pet and allowed documents". The portal epic closed without them:
`docs/01-roadmap/EPIC-08-Portal.md` records "Invoices, documents and files
(blocked on EPIC-14/§25)" as out of scope, and [[DEC-008]] records the same
deferral. That statement named [[EPIC-14]] as the unblocking epic.

Verified current state in this repository (2026-10-01):

- No `Invoice`, `InvoiceLine` or `FiscalDocument` model and no portal document
  route exist. EPIC-14 Billing is scoped to the staff surface only, and
  [[DEC-044]] explicitly defers the portal reader instead of shipping it.
- `apps/api/src/rbac/route-contract.probe.test.ts` keeps `invoices`,
  `documents`, `files`, `notifications`, `email` and `treatments` in a "deferred
  surfaces" list and **fails the build** if any route appears under
  `/portal/<root>`, so an accidental partial portal document surface cannot ship
  unnoticed.
- The portal has its own proxy and identity path
  (`apps/web/src/app/api/portal/[[...path]]/route.ts`), separate from the staff
  cookie context, and the repository rules forbid a portal identity from gaining
  staff access by sharing controllers or weak role checks.
- `docs/03-architecture/DATA-CLASSIFICATION-RETENTION.md` classifies
  invoice/payment references as CONFIDENTIAL, and PRD §41 forbids logging
  CONFIDENTIAL or RESTRICTED payloads by default. A customer-visible invoice
  reader therefore needs an explicit visibility and redaction rule.
- [[EPIC-15]] and [[EPIC-16]] own the fiscal document, and [[DEC-042]] keeps the
  whole Fiscal boundary out of EPIC-14. The authorised document a customer
  actually wants to open (the KuDE) does not exist before those epics.
- A sale may carry no customer ([[DEC-028]]: a walk-in counter sale needs none),
  so a portal reader can only ever show the subset of invoices tied to the
  signed-in customer's sales.

## Debt

The PRD §26 "invoices/documents" portal capability is unimplemented, and the
blocker has changed owner: [[EPIC-08]] named [[EPIC-14]], and EPIC-14 has now
explicitly declined it in [[DEC-044]]. No epic currently owns the
customer-facing document surface, so this record is the only place that keeps it
visible.

## Why It Is Safe to Defer

- EPIC-08's own acceptance criteria are closed and its deferral was recorded, so
  nothing it claims is broken by continuing to defer.
- EPIC-14's acceptance criteria explicitly exclude the portal surface, so the
  deferral is a scope statement rather than a missing criterion.
- No partial portal document route exists, and the route-contract probe's
  deferred-surfaces list actively prevents one from shipping unnoticed.
- PRD §26 lists the capability but fixes no behaviour, and the visibility and
  redaction rules a reader needs have not been decided; implementing them
  without that decision would invent product scope.
- The document a clinic's customer needs is the authorised fiscal document,
  which [[EPIC-15]]/[[EPIC-16]] own, so a reader built now would be redesigned
  later.

## Risk

- **Unmet PRD scope.** The §26 portal row and the journey step "customer sees
  pet and allowed documents" stay incomplete, and no epic is tracking them until
  this record is picked up.
- **Double implementation.** If the reader is built against the internal
  business invoice before the fiscal document exists, the surface is likely to
  be rebuilt once the authorised document and its storage references arrive.
- **Privacy drift.** If the visibility rule is not decided explicitly, whoever
  implements the reader will invent it, and a CONFIDENTIAL invoice reference is
  one weak relation away from a cross-customer leak.
- **Reported as a defect.** A future reviewer who finds `/portal/invoices`
  missing may file it as a bug rather than reading this record, because the
  probe's deferred list is the only other place the deferral is visible.

## Proposed Resolution

1. Decide the portal document visibility rule as an explicit decision: whether a
   portal identity sees internal business invoices, fiscal documents, or both;
   what is redacted (tax detail, internal notes, other customers' data); and
   whether a walk-in sale without a customer is representable in the portal at
   all.
2. Implement a read-only portal document surface behind the portal identity
   policy, with portal-only authorization, never sharing the staff controllers.
3. Remove only the entries that actually shipped from the route-contract probe's
   deferred-surfaces list, so the probe keeps guarding the rest.
4. Document the classification, redaction and logging behaviour in the Story or
   the module documentation, per PRD §41.

## Trigger / Target

Re-evaluate when [[EPIC-15]] or [[EPIC-16]] ships an authorised fiscal document
(the KuDE), or earlier if product explicitly asks for a customer invoice view
before a fiscal document exists. Owner: the maintainer, who decides the
visibility rule; explicitly **not** [[EPIC-14]].

## Verification After Resolution

- [ ] The PRD §26 "invoices/documents" capability is delivered by a portal route
      that authorizes a portal identity and returns only that customer's own
      documents.
- [ ] Cross-tenant and cross-customer portal isolation tests exist for the new
      surface.
- [ ] The route-contract probe's deferred-surfaces list matches exactly what
      actually shipped.
- [ ] Classification, redaction and logging behaviour is documented per
      `docs/03-architecture/DATA-CLASSIFICATION-RETENTION.md` and PRD §41.
- [ ] This record is `resolved` or superseded by a decision that records the
      final scope.
