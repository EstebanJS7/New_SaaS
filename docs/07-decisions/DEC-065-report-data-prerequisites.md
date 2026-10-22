---
id: DEC-065
type: decision
title:
  The catalog gains a per-item low-stock threshold and Clinical a staff-entered
  due date
status: accepted
date: 2026-10-19
related_epics:
  - "EPIC-18"
  - "EPIC-06"
  - "EPIC-09"
  - "EPIC-10"
related_decisions:
  - "DEC-010"
  - "DEC-005"
related_stories:
  - "REP-001"
  - "REP-005"
  - "REP-006"
prd_change_required: false
---

# DEC-065 — The two data sources PRD §31 assumes and the schema never had

## Context

Two of PRD §31's reports have no data source anywhere in the system. This was
established by reading the schema, not by reading the PRD.

**Low stock.** A search for `lowStock`, `low_stock`, `reorderPoint`, `minStock`,
`min_stock` and `threshold` across `packages/database/prisma/schema.prisma` and
`packages/database/src` returns **zero** matches. `stock_balance` holds
`quantity Decimal(10,3)` per `(tenant, catalog_item_id)` and nothing compares it
to anything. `docs/05-modules/Inventory.md` defers the threshold to EPIC-18 by
name.

**Vaccines and deworming.** Both tables carry the administration instant and
nothing forward-looking:

```text
clinical_vaccination   vaccine, administered_at, created_at, updated_at
clinical_deworming     product, administered_at, created_at, updated_at
```

There is no `next_due_at`, no `due_at`, no status and no protocol table.
"Upcoming vaccines", "overdue vaccines" and "upcoming deworming" are therefore
not computable — not approximately, not at all. Roughly a third of PRD §31's
veterinary scope rests on a column that does not exist.

## Question

Where do the threshold and the due date come from?

## Options

### The threshold

**A — a nullable `catalog_item.low_stock_threshold Decimal(10,3)` (accepted).**
The threshold is a property of the item: ten units of a vaccine and ten units of
a syringe are not the same fact. NULL means "not monitored", and the report
excludes NULL rather than inventing a default. It needs one column and one
optional field on the catalog item form, which already exists.

**B — one threshold per tenant in the `inventory` settings namespace.** Zero
domain migration, but a single number is close to useless in a veterinary where
items are measured in doses, boxes, millilitres and kilos. It also needs a new
settings namespace for a value that is not a setting.

**C — a tenant default plus a per-item override.** The most complete and the
most expensive: a migration, a namespace, a form field and a precedence rule to
test. Rejected as scope the MVP does not need, recorded as a shape [[TD-053]]
could adopt if a tenant asks.

### The due date

**A — nullable `next_due_at` on both clinical tables, entered by staff
(accepted).** The veterinarian who administers the vaccine knows the booster
interval; the system does not. The field is optional, the report only filters on
it, and rows without it simply do not appear.

**B — a revaccination protocol engine.** A protocol per vaccine/product with an
interval, from which the due date is computed. Rejected: it is a new aggregate,
a maintenance surface, a seed of veterinary protocols and a set of immunological
assumptions this repository has no authority to make. No approved decision
exists for it.

**C — defer both reports.** Rejected by the maintainer: PRD §31 names "upcoming
and overdue vaccines" explicitly, so deferring them is a visible hole in the MVP
rather than an internal detail.

## Decision

Accepted by the maintainer on 2026-10-19.

**`catalog_item.low_stock_threshold`** is a nullable `Decimal(10,3)`. The
low-stock report selects `stock_balance.quantity <= low_stock_threshold` and
skips items whose threshold is NULL. The catalog item write surface gains the
optional field.

**`clinical_vaccination.next_due_at` and `clinical_deworming.next_due_at`** are
nullable `timestamptz(3)` columns with an index on `(tenant_id, next_due_at)`.
The clinical vaccination and deworming registration surface gains the optional
field. The reports split on a single server-side "today in the tenant zone"
([[DEC-063]]): `next_due_at >= today` is upcoming within a bounded horizon, and
`next_due_at < today` is overdue.

**No history is backfilled.** Existing vaccination and deworming rows have no
due date and will not appear in either report, which is the honest outcome — the
fact was never recorded. No threshold is backfilled either; items start
unmonitored until somebody sets one, so the low-stock report begins empty by
design rather than by failure.

The crossings this creates are declared: **EPIC-09** (catalog write surface) and
**EPIC-06** (clinical vaccination and deworming write surface) each gain one
optional field on an existing form and one column on an existing model.

## Consequences

### Product

An item is monitored only when somebody sets a threshold, and a patient is due
only when a veterinarian said so. Both reports are empty until the tenant opts
in, which is a first-run state the UI has to render honestly.

### Architecture

Two optional domain fields on existing aggregates. No protocol engine, no
scheduling of clinical events, no derived state.

### Database/API

One migration: three nullable columns and two indexes. The catalog item create
and update DTOs accept the threshold; the clinical vaccination and deworming
requests accept the due date. Both are optional and both are validated server
side (threshold `> 0` when present, due date any calendar date).

### Delivery

[[REP-001]] carries the schema and the writer/validator changes. [[REP-005]]
consumes `low_stock_threshold`; [[REP-006]] consumes `next_due_at`.

## PRD Update

No PRD change. PRD §31 asked for reports whose inputs it assumed; this decision
supplies the inputs.
