---
type: architecture
status: active
updated: 2026-08-13
---

# Reversals and Corrections

## Principle

Confirmed business records are not "fixed" by editing history.

Correction creates an explicit reversal/compensation and a new correct operation
when needed.

## Common requirements

Every reversal stores or can derive:

```text
original operation
reversal operation
reason
actor
timestamp
idempotency key
audit trail
```

A reversal cannot be executed twice.

## Sale

Completed Sale:

```text
COMPLETED
  ↓ cancel/reverse
CANCELLED
```

Cancellation must compensate, when applicable:

- stock SALE movements with SALE_REVERSAL;
- cash SALE movements with REFUND/explicit reversal;
- payment state/refund records;
- invoice/fiscal workflow according to Billing/Fiscal state.

Never simply delete SaleItems or StockMovements.

## Payment

A completed payment is not changed to a new amount.

Correction:

```text
Payment original
  ↓
Refund/Reversal record
```

Partial refund may be added when product scope requires it.

For MVP, implement only flows required by the active Story and avoid inventing a
full payment-accounting engine.

## Cash

Cash movements are immutable.

Incorrect manual movement:

```text
original movement
+
compensating movement
```

Reason is mandatory.

Closed sessions are never reopened silently.

Any exceptional administrative correction requires explicit operation + audit.

## Purchase

A RECEIVED Purchase cannot be changed back to DRAFT.

Cancellation/reversal:

- validates whether reversal is permitted;
- creates PURCHASE_REVERSAL stock movements;
- preserves original purchase;
- audits actor/reason.

If stock has already been consumed and strict reversal would make stock invalid,
return a conflict and require an explicit operational resolution.

## Invoice

Confirmed Invoice is immutable.

Cancellation is a business transition, not deletion.

If FiscalDocument has been submitted/approved, Billing delegates the fiscal
cancellation/event requirement to Fiscal.

Do not mark fiscal state cancelled locally unless provider/SIFEN workflow
supports and confirms the appropriate transition.

## Fiscal

Fiscal corrections/cancellations are jurisdiction/provider-specific.

The reusable Core models intent/status; provider adapter executes the required
fiscal operation.

## Clinical

Clinical records use **amendments**, not financial reversal terminology.

Closed ClinicalEncounter remains immutable; amendment is explicit and audited.

## API convention

Prefer explicit commands:

```text
POST /sales/:id/cancel
POST /payments/:id/refund
POST /purchases/:id/reverse
POST /cash/movements/:id/reverse
POST /invoices/:id/cancel
```

Only implement endpoints actually required by current scope.

## Idempotency

Sensitive reversal commands accept/persist an `Idempotency-Key`.

Repeated identical requests return the prior result instead of creating
duplicate compensation.

## Tests

Each implemented reversal needs:

- happy path;
- duplicate/idempotent request;
- tenant isolation;
- permissions;
- invalid state;
- transactional rollback on failure;
- compensating ledger verification;
- audit verification.
