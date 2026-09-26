---
id: DEC-017
type: decision
title:
  Suppliers/purchases audit scope (EPIC-11)
status: accepted
date: 2026-09-26
related_epics:
  - "EPIC-11"
related_decisions:
  - "DEC-016"
related_stories:
  - "SUP-001"
  - "PUR-001"
  - "PUR-002"
prd_change_required: false
---

# DEC-017 — Suppliers/purchases audit scope (EPIC-11)

## Context

PRD §27 lists "purchase receive" among the audited actions but says nothing about
cancelling a purchase or about supplier creation, update and deactivation.
[[SUP-001 Supplier foundation]], [[PUR-001 Purchase draft]] and [[PUR-002 Purchase
receiving]] record the gap, and the engineering rules require critical operations
to be auditable.

Verified current state in this repository (2026-09-26):

- `AuditWriter.append(input, tx?)` exposes only an append operation
  (`apps/api/src/audit/audit-writer.service.ts:56`), and passing `tx` joins the
  append to the caller's transaction so an append failure aborts the whole
  transaction.
- The `AuditLog` model has `tenantId`, `actorUserProfileId`, `actorPortalAccessId`,
  `actorType`, `action`, `targetType`, `targetId`, `metadata Json`, `requestId`
  and `createdAt` and **no `changedFields` column**
  (`schema.prisma:1428-1462`). The changed-field list travels inside `metadata`
  as `{ schemaVersion, changedFields }`.
- Precedent: the catalog writes one co-committed audit row per accepted mutation
  inside the open transaction, with `action`, `targetType`, `targetId` and
  `metadata { schemaVersion, changedFields }` (`apps/api/src/catalog/catalog.service.ts:324`
  and the update/deactivate rows beside it). Inventory does the same for an
  adjustment (`apps/api/src/inventory/inventory.service.ts:269`).
- Classification precedent: supplier contact and fiscal fields are CONFIDENTIAL
  under [[DEC-011]], and the schema documents the no-logging rule for `Customer`
  (`schema.prisma:631-633`).

## Question

Which supplier and purchase operations write an audit row, at what granularity,
and what may each row carry?

## Options

### Option A — One co-committed row per accepted mutation (recommended)

Audit every accepted mutation as exactly one row, committed in the mutation's own
transaction: `receive` (PRD §27 requires it), purchase create, update and cancel,
and supplier create, update and deactivate. Each row carries `action`,
`targetType`, `targetId` and `metadata { schemaVersion, changedFields }`. No
per-line audit rows, and reads are never audited.

Benefits: it satisfies PRD §27's requirement and extends the same treatment to the
state-changing operations the PRD does not name, it reuses the catalog's
co-committed one-row-per-mutation shape, and it keeps a rejected mutation free of
any audit row because a rollback removes the append with the mutation.

Costs: it audits operations PRD §27 does not name, so the actions must be named
and pinned deliberately rather than inferred, and the metadata contract must be
kept payload-free.

### Option B — Audit only `receive`

Audit exactly PRD §27's literal list and nothing else.

Benefits: the smallest trail that satisfies the named requirement, with no
surface PRD §27 did not ask for.

Costs: cancelling a purchase and deactivating a supplier change state with no
record, so a governance question about "who retired this supplier" or "who
cancelled this draft" has no answerable row.

### Option C — Audit per line as well as per purchase

Write one purchase-level row plus one row per line.

Rejected for now: it multiplies rows without adding an answerable question that
the purchase-level row does not already answer, and the line-level facts already
travel in the co-committed movements the ledger records. It can be added
additively later if a concrete question needs it.

## Recommendation

Option A. The governance baseline makes critical operations auditable, and both
deactivating a supplier and cancelling a purchase change state in a way an
operator may need to attribute, so the PRD §27 literal minimum (Option B) leaves
the trail incomplete. The catalog's shipped precedent is one co-committed row per
accepted mutation (`catalog.service.ts:324`), which is exactly what A reuses.
Option C is rejected on row volume without a new question to answer. Because
`AuditLog` has no `changedFields` column, the field list travels inside
`metadata` with a `schemaVersion` (`schema.prisma:1428-1462`), and CONFIDENTIAL
supplier payloads must never be copied into metadata — the row carries stable ids
and field names only.

## Impact

### Product

Every accepted supplier or purchase mutation has an attributable record, so an
operator can answer who changed a supplier or cancelled a draft. Reads stay
unrecorded and add no audit volume.

### Architecture

No new runtime, datastore, queue, dependency or API protocol. The services call
the existing `AuditWriter.append(input, tx)` and pass the open transaction, so an
append failure aborts the mutation rather than leaving a half-audited change.

### Database/API

No schema change: the existing append-only `AuditLog` is reused. Actions are
named per operation, `targetType`/`targetId` identify the aggregate, and the
`metadata` object carries `{ schemaVersion, changedFields }` with no CONFIDENTIAL
payload. Consistency with the permission surface in [[DEC-016]] means the audit
row and the mutation share one authorization decision and one transaction.

### Delivery

[[SUP-001 Supplier foundation]] owns supplier create/update/deactivate audit;
[[PUR-001 Purchase draft]] owns purchase create/update/cancel audit;
[[PUR-002 Purchase receiving]] owns the receive audit. Each work unit pins its
action names and the no-payload metadata rule with tests.

## Decision

Accepted on 2026-09-26 by the maintainer. Option A is the decision: every
accepted mutation is audited as **exactly one** row, committed in the mutation's
own transaction — `receive`, which PRD §27 requires, plus purchase create, update
and cancel and supplier create, update and deactivate — and each row carries
`action`, `targetType`, `targetId` and `metadata { schemaVersion, changedFields }`;
there are no per-line audit rows, and reads are never audited.

The other options stay recorded above as what was considered; acceptance selects
Option A only.

[[SUP-001 Supplier foundation]] owns the implementation slice for supplier
create/update/deactivate audit, [[PUR-001 Purchase draft]] owns purchase
create/update/cancel audit and [[PUR-002 Purchase receiving]] owns the receive
audit, with each work unit pinning its action names and the no-payload metadata
rule with tests.

## PRD Update

No PRD change is required. PRD §27 already requires purchase receive to be
audited and the governance baseline already requires critical operations to be
auditable; this record applies existing intent to the mutation set PRD §27 leaves
unnamed. None of the options extends approved scope, and the engineering rules
forbid editing the PRD to normalize an implementation detail, so no PRD edit is
proposed here.
