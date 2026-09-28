---
id: DEC-025
type: decision
title: POS item identification and the deferred barcode (EPIC-12)
status: accepted
date: 2026-09-27
related_epics:
  - "EPIC-12"
related_stories:
  - "POS-004"
prd_change_required: false
---

# DEC-025 — POS item identification and the deferred barcode (EPIC-12)

## Context

PRD §18 states the POS must be "optimized for keyboard, barcode scanner, touch
and tablet", which implies item identification by a scannable code. The catalog
has no such code: `packages/database/prisma/schema.prisma` stores no SKU,
barcode, category, unit or branch column, and `docs/05-modules/Catalog-Taxes.md`
records the absence. Adding a code column is a catalog change with its own
uniqueness and validation surface, not a POS input detail. POS-004 records the
barcode question as open.

Verified current state in this repository (2026-09-27):

- `schema.prisma:1284-1286` states that `tracksStock` "is the only stock
  dimension on the catalog — no SKU, barcode, category, unit or branch column
  exists", and [[DEC-010]] added only the optional reference price columns
  (`schema.prisma:1277-1278`).
- The catalog read API and its permission family (`catalog.read` and the
  `catalog.*` write keys) already expose items to all six roles, so a POS can
  resolve an item through the existing tenant-scoped read surface without a new
  lookup route.
- No sales or POS module exists yet.
- No `barcode`, `sku`, unit or branch column, and no uniqueness rule for one,
  exists anywhere in the catalog.

## Question

Does EPIC-12 add a barcode/SKU column so the PRD §18 scanner optimization can
resolve an item, and if not, how does the POS identify items?

## Options

### Option A — No new item code; resolve by name and defer the barcode (recommended)

EPIC-12 adds no `barcode`/`sku`/unit/branch column to `CatalogItem`. The POS
resolves items through the existing catalog read API by name. PRD §18's
barcode-scanner optimization is recorded as an unmet scope item with [[TD-019]]
record. The POS input stays keyboard-first and tablet/touch-friendly, and a
scanner that types text into the search field behaves exactly like typing but
cannot reliably resolve an item without a code column. Adding an optional,
per-tenant-unique `barcode` later is additive and needs no rework of the POS
architecture.

Benefits: it keeps the catalog unchanged, it reuses the shipped read surface and
permissions, and a later barcode column does not invalidate any POS code because
the resolution path is a search that a code would simply make unambiguous.

Costs: PRD §18 names scanner optimization and EPIC-12 does not deliver it, so
scanning is limited to whatever the name search supports until the code column
exists, and the gap must be tracked as debt rather than hidden.

### Option B — Add an optional per-tenant-unique `barcode` column now

Extend the catalog item with a nullable, per-tenant-unique barcode and let the
POS resolve by exact code first, then by name.

Benefits: it satisfies the PRD §18 scanner optimization directly and gives the
POS a deterministic lookup.

Costs: it expands the catalog aggregate and its validation, uniqueness and
isolation surface inside a POS epic, and it pre-empts a catalog decision that
belongs to whichever slice first needs the code. The added column is additive
later, so doing it now buys scheduling, not removability.

### Option C — Add a non-unique free-text code

Store a per-item code with no uniqueness.

Rejected: a non-unique scannable code cannot reliably resolve an item, so it
delivers neither the scanner optimization nor a trustworthy lookup while still
adding a catalog column and its validation.

## Recommendation

Option A. PRD §18's scanner line is a real requirement, but the smallest change
that keeps the epic honest is to record it as unmet and defer the catalog column
to a slice that owns the catalog change, as [[DEC-015]] and [[DEC-018]] defer
their respective gaps rather than absorb adjacent domains. Option C is rejected
because a code that cannot uniquely resolve an item is worse than no code, and
Option B is deferred, not rejected: it is purely additive when a real barcode
requirement lands.

## Impact

### Product

Staff identify a sale line by searching the item name, and the POS remains
usable with a keyboard or a touch screen. Barcode scanning is not delivered in
EPIC-12 and is recorded as an explicit unmet scope item rather than presented as
supported.

### Architecture

No new runtime, datastore, queue, dependency or API protocol, and no catalog
schema change. The POS consumes the existing tenant-scoped catalog read API, so
a future code column is additive and the POS resolution path does not have to be
rebuilt.

### Database/API

No `barcode`, `sku`, unit or branch column is added by this epic and no new
lookup route is created. Item resolution uses the shipped catalog read contract,
which is tenant-scoped and permission-checked; a later `barcode` is a nullable,
per-tenant-unique additive column with its own migration and validation.

### Delivery

POS-004 owns the name-based item search and the keyboard/touch input surface,
and POS-005 records the deferred barcode as [[TD-019]]. The future code column
belongs to a catalog or POS slice that owns its uniqueness and isolation tests.

## Decision

Accepted on 2026-09-27 by the maintainer. Option A is the decision: EPIC-12 adds
no `barcode`/`sku`/unit/branch column to `CatalogItem`; the POS resolves items
through the existing catalog read API by name; PRD §18's barcode-scanner
optimization is recorded as an unmet scope item with [[TD-019]]; the POS input
stays keyboard-first and tablet/touch-friendly, and a scanner that types text
into the search field behaves exactly like typing but cannot reliably resolve an
item without a code column; adding an optional per-tenant-unique `barcode` later
is additive and needs no rework of the POS architecture.

The other options stay recorded above as what was considered; acceptance selects
Option A only.

POS-004 owns the name-based resolution and input surface, and POS-005 records
the deferred barcode as debt.

## PRD Update

No PRD change is required. PRD §18 keeps the barcode-scanner optimization as
approved product intent; this record does not remove or rewrite it, it records
that EPIC-12 does not deliver it and tracks the gap as [[TD-019]]. The
engineering rules require a Story not to silently modify the PRD and require a
Tech Debt record instead of a hidden shortcut, which is exactly the treatment
chosen here, so no PRD edit is proposed.
