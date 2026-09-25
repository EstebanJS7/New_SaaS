---
id: TD-014
type: tech-debt
title: Catalog writes have no optimistic concurrency
status: open
severity: medium
related_epics:
  - EPIC-09
related_stories:
  - CAT-003
created: 2026-09-25
updated: 2026-09-25
---

# TD-014 — Catalog writes have no optimistic concurrency

## Context

`CatalogItem` has no `version` column and no other optimistic-lock token.
`PUT /catalog/:id` performs a single conditional write against the tenant scope:

```text
updateMany where { id, tenantId }   -- no version predicate
```

so two concurrent updates of the same item are last-write-wins: both match the
row, both commit, and the audit trail contains two `catalog_item.updated` rows
while only the later value survives. `updatedAt` is a timestamp maintained by
the database, not a concurrency token, and nothing compares it.

This is a deliberate state, not an oversight: the WU2 A3 Story ([[CAT-003
Catalog write API]]) records "Last write wins" under Known Limitations, and the
live-PostgreSQL suite documents the same reasoning explicitly — the aggregate has
no unique business key and no cross-row cardinality rule, so it has no
compare-and-set invariant to race, and the live block therefore races the
invariant the module _does_ claim (item change and audit row are one atomic unit)
instead of inventing a winner.

The neighboring aggregates are stricter: `Appointment` and the clinical
encounter both carry a `version` and reject a stale write with `409 CONFLICT`,
and the portal write paths inherit that behavior.

## Debt

A concurrent edit silently discards the earlier writer's change, and the audit
trail cannot reconstruct which value was lost — it records field names, not
values. Two staff editing the same item, or a staff edit racing an integration
write, can produce a stored state that neither caller intended.

Every other invariant of the write path holds: the tenant predicate rides in the
same statement, the mandatory rate and pair validation are unchanged, and the
item change and its audit row still commit atomically.

## Why It Is Safe to Defer

- No acceptance criterion requires stale-write detection, and the catalog has no
  automatic writer, no import path and no cross-row rule that a lost update
  could corrupt.
- The failure is bounded to the editing convenience of a low-write-volume staff
  configuration aggregate; it cannot break tenant isolation, the rate invariant
  or the audit-commit invariant.
- The behavior is documented in the Story, the module documentation
  ([[Catalog-Taxes]]) and the live suite, so nobody can meet it by surprise.

## Risk

- A silent overwrite is unrecoverable: the previous value exists nowhere the
  application can read, because audit metadata carries names only.
- Once [[EPIC-10]] Inventory or an import/pricing flow writes catalog items in
  bulk, the collision probability rises and the missing token becomes a real
  data quality problem rather than a theoretical one.
- Adding the token later is a schema change plus an API contract change, so the
  cost of deferral grows with adoption.

## Proposed Resolution

1. Add a `version` integer column to `catalog_item` (default `1`, incremented in
   the same statement) through an additive migration.
2. Change `PUT /catalog/:id` to a compare-and-set: the request carries the
   expected `version`, the update predicate includes it, and a zero-row match on
   an existing tenant-owned row is `409 CONFLICT` rather than `404` (the
   `updateMany` zero-row path must distinguish "missing/foreign" from "stale").
3. Expose `version` in the allowlisted DTO and surface the conflict honestly in
   the staff form, mirroring the appointment reschedule conflict UX.
4. Prove it live: two concurrent same-version updates must yield exactly one
   `200` and one `409`, with the stored row matching the winner and exactly one
   audit row.

## Trigger / Target

Before [[EPIC-10]] Inventory or any bulk/import writer mutates catalog items, or
at the first report of a lost catalog edit.

## Verification After Resolution

- [ ] Two concurrent same-version `PUT /catalog/:id` calls return exactly one
      `200` and one `409`, and the stored row matches the winner.
- [ ] A stale version persists nothing and appends no audit row; the accepted
      call appends exactly one.
- [ ] The DTO carries `version` and the client sends it on update.
- [ ] The live-PostgreSQL concurrency case covers the compare-and-set, replacing
      the current "no version invariant to race" note.
