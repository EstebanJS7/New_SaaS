---
id: DEC-011
type: decision
title:
  Supplier identity, uniqueness and classification (EPIC-11)
status: accepted
date: 2026-09-26
related_epics:
  - "EPIC-11"
related_stories:
  - "SUP-001"
prd_change_required: false
---

# DEC-011 — Supplier identity, uniqueness and classification (EPIC-11)

## Context

PRD §17 requires a purchase to exist and defines its three states and its
receiving steps, but it defines **no supplier attributes**: no name, no tax
identifier, no contact field, no address and no uniqueness rule. PRD §5 lists
`suppliers` as a Core domain, so the aggregate is approved in principle while
its shape is not. PRD §41 requires every new field carrying personal, fiscal or
secret material to be classified before it is persisted.

Verified current state in this repository (2026-09-26):

- No supplier implementation exists.
  `packages/database/prisma/schema.prisma` has no supplier model, no
  `apps/api/src/suppliers/` module exists, and no `suppliers.*` permission key is
  seeded in `PERMISSION_SEEDS` (`packages/database/src/reference-seed.ts`).
- A **classification precedent already exists**: the `Customer` model documents
  `display_name`, `legal_name`, `tax_id`, `first_name`, `last_name` and
  `document_number` as CONFIDENTIAL with application logs carrying IDs only
  (`schema.prisma:631-633`), and `docs/05-modules/Customers.md` repeats the rule.
  `docs/05-modules/Patients.md` carries the same per-field classification in a
  `## Data Classification` section.
- A **lifecycle precedent already exists**: `CatalogItem` removes an item by
  setting `isActive = false` and the migration rejects `DELETE`
  (`schema.prisma`, catalog model comment). `suppliers` is the same kind of Core
  registry, not a ledger.
- [[SUP-001 Supplier foundation]] deliberately leaves the attribute set to an
  accepted Decision and fixes none of it by assumption.

## Question

Which supplier attributes are required, which are unique per tenant, what
lifecycle applies, and what data classification does each field carry — given
that PRD §17 does not define a supplier and no supplier consumer exists yet?

## Options

### Option A — Minimal identity with per-tenant tax-id uniqueness (recommended)

Required `name` (1..200 characters, **not** unique, because two real suppliers may
share a trading name). Optional `legalName`, `taxId` (RUC), `email`, `phone` and
`address`. `taxId` is unique per tenant **when present** — the partial unique
index over the nullable column is the mechanism the decision fixes, not a
service-only convention. Lifecycle is the
catalog's: an `isActive` flag with an explicit deactivate command and no delete
route. Classification follows the `Customer` precedent: `taxId`, `legalName`,
`email`, `phone` and `address` are CONFIDENTIAL; `name` is INTERNAL; application
logs carry IDs only.

Benefits: it is the smallest attribute set that PRD §17's purchase can reference
without inventing product scope, it reuses two shipped patterns (deactivation
instead of delete, nullable-scoped uniqueness), and it tells the implementer
exactly what may never reach a log.

Costs: the optional fields create surface whose consumer does not exist yet, so
imports ([[EPIC-19]]) and later fiscal use may still extend the set additively,
and a partial unique index on a nullable column is the mechanism that makes
"unique when present" true rather than a convention the service merely
implements.

### Option B — Name-only supplier

Required `name` only; every contact and fiscal field is deferred until a real
consumer needs it.

Benefits: the smallest possible aggregate, with nothing to classify beyond
INTERNAL and no uniqueness question at all.

Costs: a supplier registry that cannot record the RUC or a contact makes the
purchase surface a name lookup only, so the first fiscal or import slice
immediately reopens this decision and migrates the table.

### Option C — Rich supplier with payment terms, credit limit and bank details

Add settlement fields to the supplier aggregate.

Rejected: that is accounts payable and settlement scope ([[EPIC-13]] and
Billing), not supplier identity. PRD §17 defines no owed amount, and the
[[EPIC-11]] epic explicitly records "no payment concept and no owed amount" as
out of scope, so such fields would change approved product scope rather than
describe a supplier.

## Recommendation

Option A. It is the smallest set that makes a purchase reference meaningful while
reusing the classification precedent (`schema.prisma:631-633`) and the catalog's
deactivation-not-delete lifecycle, and it keeps every non-identity field out.
Options B and C are rejected as written: B on the ground that it will be reopened
by the first fiscal or import slice, C because settlement is a different domain
and a different epic. Because `taxId` is optional, the decision fixes the
**uniqueness mechanism** (a partial unique index over `(tenant_id, tax_id) WHERE
tax_id IS NOT NULL`) and not merely a service-level check.

## Impact

### Product

Staff can register a supplier with the fiscal and contact data a purchase
reference needs, and retire a supplier without destroying the purchases that
point at it. No supplier becomes a financial record: it holds no balance, no owed
amount and no payment state.

### Architecture

No new runtime, datastore, queue, dependency or API protocol. The aggregate
follows the tenant-scoped Core registry shape already used by the catalog, so
tenant-isolation tests are required for the new private aggregate under the
engineering rules. It stays a Core capability and is not entitlement-gated
(see [[DEC-016]]).

### Database/API

A new tenant-scoped supplier table with a tenant composite ownership key and a
`RESTRICT` tenant foreign key, plus a partial unique index on nullable `taxId`. A
deactivate command replaces any delete route. DTOs are strict and allowlisted;
no Prisma model crosses the HTTP boundary. Classification is documented on the
model the way `Customer` documents it, so the no-logging rule is visible at the
schema.

### Delivery

[[SUP-001 Supplier foundation]] owns the model, migration, DTOs, service,
permission keys, isolation tests and the schema gate. The attribute set, the
partial index and the classification notes are prerequisites of that slice, not
follow-ups.

## Decision

Accepted on 2026-09-26 by the maintainer. Option A is the decision: the
supplier aggregate requires `name` (1..200 characters, **not** unique, because two
real suppliers may share a trading name) and offers the optional `legalName`,
`taxId` (RUC), `email`, `phone` and `address`; `taxId` is unique per tenant **when
present**, and the mechanism the decision fixes is the partial unique index over
the nullable column over `(tenant_id, tax_id) WHERE tax_id IS NOT NULL`, not a
service-only convention; the lifecycle is the catalog's, an `isActive` flag with
an explicit deactivate command and no delete route; and classification follows
the `Customer` precedent, with `taxId`, `legalName`, `email`, `phone` and
`address` CONFIDENTIAL, `name` INTERNAL, and application logs carrying IDs only.

The other options stay recorded above as the alternatives that were considered
and rejected; acceptance selects Option A only.

[[SUP-001 Supplier foundation]] owns the implementation slice: the model,
migration, DTOs, service, permission keys, isolation tests and the schema gate,
with the attribute set, the partial index and the classification notes as
prerequisites of that slice, not follow-ups.

## PRD Update

No PRD change is required. PRD §5 already lists `suppliers` as a Core domain and
PRD §41 already requires classification; this record applies existing intent to a
domain whose attributes the PRD deliberately leaves open. None of the options
extends or alters approved PRD scope, and the engineering rules forbid editing
the PRD to normalize an implementation detail, so no PRD edit is proposed here.
