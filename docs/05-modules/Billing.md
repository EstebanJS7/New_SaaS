---
type: module
status: implemented
epic: EPIC-14
updated: 2026-10-01
---

# Billing

The Billing module owns business invoices sourced from completed sales: the
invoice header, its immutable line snapshot, confirmation-time numbering, the
confirm and cancel transitions, and the staff workspace that operates them.
Billing is a Core Business domain. It reads the completed Sale snapshot and
writes only its own aggregate; it performs no money arithmetic and has no fiscal
state or provider integration ([[DEC-038]], [[DEC-042]], [[DEC-044]]).

Implemented by [[BILL-001]] (aggregate and constraints), [[BILL-002]] (creation
and reads), [[BILL-003]] (confirm and cancel) and [[BILL-004]] (staff surface).
The documented behavior is implemented behavior, not a claim of production
readiness; the native review of the BILL-004 slice is escalated and not closed.

## Owned tables

| Table                     | Purpose                                                                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invoice`                 | The tenant-scoped header: source `sale_id`, inherited `customer_id` and `currency`, `status` (`DRAFT` / `CONFIRMED` / `CANCELLED`), `series`, optional `number`, transition timestamps and cancellation reason. |
| `invoice_line`            | The append-only snapshot: catalog item, description, tax rate code, quantity, unit price, line total, taxable base, tax amount and zero-based position.                                                         |
| `invoice_number_sequence` | The tenant-and-series counter used by confirmation to allocate invoice numbers atomically.                                                                                                                      |

All three tables are tenant-scoped, carry composite `(tenant_id, id)` ownership
keys and have `RESTRICT` foreign keys. The aggregate references `sale`,
`customer`, `catalog_item` and the global `tax_rate(code)`; Billing does not own
those records. Composite references ensure the sale, optional customer and
catalog item belong to the same tenant. The tax-rate reference is global.

## Routes

All five routes require the `billing` entitlement and their listed permission;
the entitlement is asserted before the granular permission, reads included.
Tenant identity comes from authenticated server context, not caller input.

| Route                        | Permission        | Contract                                                                                                                                                    |
| ---------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /invoices`             | `billing.create`  | Create a `DRAFT` from one completed in-tenant sale (`201`); body contains the sale reference only.                                                          |
| `GET /invoices`              | `billing.read`    | List tenant invoices; optional `status` filter, ordered `createdAt desc, id asc`. There is no pagination.                                                   |
| `GET /invoices/:id`          | `billing.read`    | Read one invoice and its immutable lines; foreign and unknown IDs share `404`.                                                                              |
| `POST /invoices/:id/confirm` | `billing.confirm` | Payload-free confirm (`200`): allocate the number and transition `DRAFT` to `CONFIRMED`; an already confirmed invoice replays as `200`. No idempotency key. |
| `POST /invoices/:id/cancel`  | `billing.cancel`  | Cancel a `DRAFT` or `CONFIRMED` invoice (`200`) with a required reason of at most 500 characters; an already cancelled invoice replays as `200`.            |

There is no update, delete, generic status patch or reopen route.

## Invariants

- **One live invoice per sale.** The partial unique index
  `invoice_tenant_id_sale_id_key` covers `(tenant_id, sale_id)` while
  `status <> 'CANCELLED'`. A cancelled invoice releases the sale for a corrected
  replacement; two live invoices for one sale are database-impossible.
- **Number and confirmation timestamp agree.** The
  `invoice_number_iff_confirmed` CHECK requires `number` and `confirmed_at` to
  be present or absent together. A draft cancelled before confirmation consumes
  no number; a confirmed invoice keeps its number permanently, including after
  cancellation.
- **Headers change only through the three permitted transitions.** The database
  guard `invoice_no_update_unless_permitted_transition` allows exactly
  `DRAFT -> CONFIRMED`, `DRAFT -> CANCELLED` and `CONFIRMED -> CANCELLED`. It
  rejects every other update, including updates to a `CANCELLED` row. A
  permitted transition cannot also change `tenant_id`, `id`, `sale_id`,
  `customer_id`, `currency`, `series` or `created_at`; `confirmed_at` can move
  only on `DRAFT -> CONFIRMED`.
- **The line snapshot is append-only.** Database triggers reject every update
  and delete of `invoice_line` rows.
- **Numbers are unique and permanent.** `UNIQUE (tenant_id, series, number)`
  prevents reuse; a number is positive. A series is non-blank.
- **Line values are constrained.** Quantity is strictly positive; money amounts
  and position are non-negative; position is unique within its invoice.
  Cancellation requires a reason.
- **The invoice originates from one completed sale.** Currency and customer are
  inherited, and the `sales.requireCustomerForInvoice` typed setting can require
  a customer at creation.
- **Billing does no money arithmetic.** Every money and quantity field is copied
  verbatim from the frozen `SaleLine`; no client amount is accepted and no
  header totals are stored. DTO `total` and `taxTotal` are projections summed
  from the invoice's immutable lines.
- **Description and order are snapshot rules.** Descriptions come from
  `catalog_item.name` read in one tenant-predicated query. Names longer than 200
  characters are refused, not truncated. Lines are walked in ascending
  `catalogItemId`; `position` is their zero-based index.
- **Number allocation has no read-then-write window.** One atomic statement
  inserts the tenant/series counter at `next_value = 2`, or increments it on
  conflict, and returns `next_value - 1`. The first invoice in a series is 1.
- **Replay follows state.** A repeat confirm on `CONFIRMED` and repeat cancel on
  `CANCELLED` return `200` with the same representation, without another audit
  row. These payload-free commands require no idempotency key. `CANCELLED` is
  terminal.
- **No external business effect is coupled to cancellation or confirmation.**
  Billing writes no payment, cash, stock or fiscal state and emits no fiscal
  event.

## The invoice snapshot and totals

Creation copies the frozen `SaleLine` quantities and all money fields verbatim.
The description is the catalog item's name at creation, resolved by a single
query constrained by tenant and requested catalog item IDs. Billing does not
reprice, recompute tax or round. The invoice stores no header total: the DTO
projects `total` and `taxTotal` by summing its own immutable lines.

The invoice line order is deterministic but arbitrary: source lines are visited
in ascending `catalogItemId` and positions start at zero ([[TD-025]]). This is
not the order in which items were sold.

## Numbering and transitions

A draft has no number. Confirmation locks the invoice, allocates its number in
the same transaction as the `DRAFT -> CONFIRMED` transition and audit row, and
uses one atomic SQL statement:

```sql
INSERT INTO "invoice_number_sequence" ("tenant_id", "series", "next_value")
VALUES ($1::uuid, $2, 2)
ON CONFLICT ("tenant_id", "series") DO UPDATE
SET "next_value" = "invoice_number_sequence"."next_value" + 1,
    "updated_at" = now()
RETURNING "next_value" - 1
```

The first allocated number for a tenant and series is 1. The guarantee is that
no number is consumed before confirmation and `(tenant_id, series, number)` is
unique; it is not a promise of a gap-free sequence under every transaction
failure ([[DEC-039]]).

Cancellation accepts a `DRAFT` or `CONFIRMED` invoice, stores its required
reason and transitions to terminal `CANCELLED`. A confirmed invoice retains its
number; a draft cancelled before confirmation remains unnumbered. Neither
command requires an idempotency key because its state gate makes a payload-free
retry a no-op.

## Staff surface

`/app/billing` provides the status-filtered invoice list, invoice detail with
snapshot lines and projected totals, create-from-sale panel, confirm and cancel
(with reason). It covers loading, empty, error, success, permission-denied and
entitlement-denied states. The navigation entry declares
`requiredFeature: "billing"`.

All browser API calls go through the `/api/billing` proxy, which allowlists
exactly the five operations and forwards staff cookie context only. It does not
accept portal context or synthesize tenant authority. The backend remains the
authority for permission and entitlement checks. The client displays server
values without doing money arithmetic and cannot distinguish a replay from a
fresh transition response.

## Does Not Own

- **Fiscal documents, providers, fiscal status or submission** — [[EPIC-15]],
  [[EPIC-16]] and [[DEC-042]].
- **Payments or payment allocation to invoices** — payments stay on the sale
  (PRD §19).
- **The portal invoice surface** — deferred ([[DEC-044]], [[TD-022]]).
- **Reports and dashboards** — [[EPIC-18]].
- **Notification delivery** — [[EPIC-17]].
- **Printed or exported documents** — [[DEC-039]], [[DEC-044]].
- **Sale reversal or payment refund** — [[TD-018]].

## Audit and classification

Accepted mutations write one co-committed audit row: `invoice.created`,
`invoice.confirmed` or `invoice.cancelled`. Audit metadata carries field names
only and never the cancellation reason text. Reads are not audited. Customer and
sale references are CONFIDENTIAL; amounts, status, series, number and reason are
INTERNAL. Logs and audit do not carry aggregate payloads.

## Tests

- `packages/database/src/schema-billing.test.ts` — invoice tables, constraints,
  ownership and migration/schema invariants. Database suite: **18 files / 403
  tests**.
- `apps/api/src/billing/billing.integration.test.ts` — route contracts,
  authorization, tenant isolation, snapshot, transitions, replay and audit. API
  suite: **77 files / 1173 tests** when `DATABASE_URL_TEST` is exported; the
  live-PostgreSQL spec runs inside it with 153 cases, including two FORCED
  concurrency overlaps.
- `apps/web/src/app/(app)/app/billing/*` — client, panels, validation, display,
  outcome and workspace states. Web suite: **90 files / 1052 tests**.
- Billing integration suite: **32 cases**. Billing proxy suite: **27 cases**.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — durable PostgreSQL route,
  tenant-isolation, constraint and concurrency coverage.

## Known limitations

- No fiscal state, submission or event exists; EPIC-15 owns the fiscal boundary.
- No standalone or manual invoicing: every invoice comes from a completed sale.
- Replay and fresh transition responses are indistinguishable; the client cannot
  show a distinct “already confirmed” outcome.
- `GET /invoices` is unbounded ([[TD-026]]).
- Invoice line order is deterministic but arbitrary ([[TD-025]]).
- A catalog item name longer than 200 characters blocks invoicing ([[TD-024]]).
- Cancellation has no payment, cash, stock or fiscal effect; [[TD-018]] still
  owns refunds and sale reversal.
- There is no portal invoice read, printed document or export.
- The navigation entitlement gate is dormant because no browser-side entitlement
  source is wired; the backend gate remains authoritative.
- The native review of the BILL-004 slice is escalated and not closed.
