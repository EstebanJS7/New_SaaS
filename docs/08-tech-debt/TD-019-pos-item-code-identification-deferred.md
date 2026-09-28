---
id: TD-019
type: tech-debt
title:
  POS item identification has no code column, so the barcode scanner is deferred
status: open
severity: low
related_epics:
  - EPIC-12
related_stories:
  - POS-004
created: 2026-09-27
updated: 2026-09-27
---

# TD-019 — POS item identification has no code column, so the barcode scanner is deferred

## Context

PRD §18 states the POS must be "optimized for keyboard, barcode scanner, touch
and tablet", which implies identifying an item by a scannable code. No such code
exists: `packages/database/prisma/schema.prisma:1284-1286` states that
`tracksStock` "is the only stock dimension on the catalog — no SKU, barcode,
category, unit or branch column exists", and [[DEC-010]] added only the optional
reference price columns (`schema.prisma:1277-1278`).

[[DEC-025]] decides that [[EPIC-12]] adds no `barcode`/`sku`/unit/branch column
to `CatalogItem`. The POS resolves items through the shipped, tenant-scoped,
permission-checked catalog read API by name, and PRD §18's scanner optimization
is recorded as an unmet scope item here rather than presented as supported.

Verified current state in this repository (2026-09-27):

- `schema.prisma:1284-1286` documents the absence of a SKU, barcode, category,
  unit or branch column.
- `docs/05-modules/Catalog-Taxes.md` records the same absence, and the catalog
  read surface already exposes items to the roles a POS needs, so no new lookup
  route is required for name resolution.
- No sales or POS module exists yet, so no POS input surface exists.
- No `barcode`, `sku`, unit or branch column and no uniqueness rule for one
  exists anywhere in the catalog.

## Debt

A barcode scanner emits keystrokes and a terminator. Against the EPIC-12 POS it
is therefore indistinguishable from a person typing: the scanner types into the
name search field and the operator must still choose a result. The scanner
cannot reliably resolve an item, because a name search matches on text rather
than on an exact code and can return several items or none.

The gap is a scope decision rather than a defect — the catalog column belongs to
whichever slice owns the catalog change, and [[DEC-025]] shows the column is
purely additive later — but PRD §18 names scanner optimization as approved
product intent and EPIC-12 does not deliver it, so the gap must stay visible
instead of being read as "the POS supports scanners".

## Why It Is Safe to Defer

- The POS architecture does not change if the code lands later: item resolution
  is a search, and an exact code would simply make the search unambiguous, so
  the additive column invalidates no POS code.
- The input stays keyboard-first and tablet/touch-friendly, so the counter flow
  is fully usable without a scanner; no EPIC-12 acceptance criterion claims
  scanner support, and [[DEC-025]] records the boundary explicitly.
- A non-unique free-text code was considered and rejected by [[DEC-025]], so the
  deferral does not leave a half-measure behind: there is no code column at all,
  and there is nothing to migrate or unwind.
- The catalog change is additive — a nullable, per-tenant-unique `barcode`
  column with its own migration and validation — so deferral costs scheduling,
  not rework.

## Risk

- Staff at a counter with a scanner will expect it to work and will find that it
  behaves as typing, which is a usability surprise unless the limitation is
  communicated.
- Name-only resolution is slower and error-prone for items with similar names,
  and it relies on free-text search quality rather than an exact identifier.
- As the catalog grows, the ambiguity of a name search grows with it, so the
  cost of the deferral rises with adoption.
- The unmet PRD §18 intent must not be quietly forgotten: without this record a
  future reader could assume scanner support exists.

## Proposed Resolution

1. Add a nullable `barcode` column to `catalog_item` through an additive
   migration, with a per-tenant uniqueness rule so a code resolves at most one
   item inside a tenant, and a format validation plus its own field
   classification.
2. Expose the column through the catalog read and write contracts with the
   catalog's existing permission family and validation discipline.
3. Extend the POS item resolution to try an exact code match first and fall back
   to the name search, keeping the keyboard and touch paths unchanged.
4. Prove it live: a per-tenant-unique insert succeeds, a duplicate inside the
   tenant is rejected, the same code in another tenant is accepted, and the POS
   resolves an item from the exact code.

## Trigger / Target

The catalog or POS slice that owns the item code column, or the first real
barcode-scanner requirement from a tenant, whichever arrives first.

## Verification After Resolution

- [ ] A nullable, per-tenant-unique `barcode` column exists on `catalog_item`
      and its uniqueness is enforced by the database, not by the application.
- [ ] The same code in two different tenants is accepted, and a duplicate inside
      one tenant is rejected.
- [ ] The POS resolves an item from an exact code and still resolves items by
      name when no code exists.
- [ ] The catalog write path validates the code format and rejects unknown keys,
      and the field carries an explicit data classification.
- [ ] The sales module documentation and this record state that the PRD §18
      scanner optimization is delivered, and this record is closed only then.
