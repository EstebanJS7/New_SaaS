---
id: DEC-051
type: decision
title: Confirmed invoice cancellation after FiscalDocument exists
status: accepted
date: 2026-10-02
related_epics:
  - "EPIC-15"
related_decisions:
  - "DEC-043"
related_stories:
  - "FISC-005"
prd_change_required: false
---

# DEC-051 — Confirmed invoice cancellation after FiscalDocument exists

## Context

[[DEC-043]] intentionally shipped Billing cancellation before fiscal documents
existed and made the hand-off binding: once EPIC-15 introduces `FiscalDocument`,
confirmed invoice cancellation must request fiscal cancellation through Fiscal
or record why it does not. The concrete risk is a `CANCELLED` invoice coexisting
with an approved fiscal document.

## Question

How does EPIC-15 prevent Billing cancellation from contradicting Fiscal state?

## Options

### Option A — Block Billing cancellation when an active fiscal document exists; Fiscal cancellation is explicit (recommended)

Before cancelling a confirmed invoice, Billing asks the Fiscal boundary whether
an active submitted/approved fiscal document exists. If yes, the Billing cancel
command returns a stable conflict directing the operator to the Fiscal
cancellation workflow. Fiscal owns provider-specific cancellation; after Fiscal
permits/records cancellation, Billing cancellation can proceed according to the
accepted service contract.

Benefits: prevents contradiction without pretending every provider can cancel in
the same transaction.

Costs: introduces a two-step operational workflow.

### Option B — Billing cancel synchronously requests Fiscal cancellation

Benefits: one user action. Costs: risks long/external work in the Billing
command path and provider-specific coupling.

### Option C — Leave Billing cancel unchanged

Rejected unless issuance is not enabled; it leaves the contradiction risk open.

## Recommendation

Option A for EPIC-15. Real provider-specific cancellation semantics can be
expanded in EPIC-16.

## Impact

### Product

Operators see a clear conflict instead of silently cancelling a business invoice
with an active fiscal document.

### Architecture

Billing consults the Fiscal application boundary only; Fiscal owns provider
cancellation.

### Database/API

FISC-005 updates cancel-path tests and Fiscal action routes per accepted scope.

### Delivery

The hand-off from [[DEC-043]] is closed before fiscal issuance is enabled.

## Decision

Accepted: Before cancelling a confirmed invoice, Billing will consult the Fiscal
application boundary. If an active submitted/approved fiscal document exists,
Billing cancellation is blocked with a stable conflict directing the operator to
the explicit Fiscal cancellation workflow. Fiscal owns provider-specific
cancellation; Billing cancellation may proceed according to the accepted service
contract after Fiscal permits or records cancellation.

## PRD Update

No PRD change is required.
