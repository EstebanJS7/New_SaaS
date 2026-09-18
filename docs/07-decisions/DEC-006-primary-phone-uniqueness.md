---
id: DEC-006
type: decision
title: Back "exactly one primary phone" with a partial unique index
status: proposed
date: 2026-09-17
related_epics:
  - EPIC-08
related_stories: []
prd_change_required: false
---

# DEC-006 — Back "exactly one primary phone" with a partial unique index

## Context

EPIC-08 WU4C adds holder profile self-service (`GET`/`PUT /portal/profile`, PRs
#34 and #35). The epic text and the portal-management spec both speak of "the
primary phone" and "the active address" as if those were settled concepts.

Verified reality in `packages/database/prisma/schema.prisma` and the migrations:

- `CustomerContact` has an `isPrimary` boolean (default `false`) and an
  `isActive` boolean (default `true`). **No index or constraint restricts how
  many rows may be primary**, and the staff write path simply stores whatever
  `isPrimary` the caller sent.
- `CustomerAddress` has `isActive` but **no primary/default column at all**; a
  Customer may legitimately keep several active addresses, and the epic's "the
  active address" is a convention rather than a modelled fact.
- This is not the repo's only precedent for such a rule: `PatientGuardian` does
  enforce its single-active-primary through a partial unique index
  (`patient_guardian_primary_active_key`, migration
  `20260911000003_patients/migration.sql`). Customer contacts got no equivalent.

Because the database does not back the invariant, the portal profile boundary
establishes it in application code instead: the upsert writes the primary phone
and demotes the holder's other `PHONE` rows in the same transaction. That is
**correct for a single writer and not sufficient under concurrency**: two
simultaneous first-time updates can each observe no PHONE row, create their own
primary, and never see the other transaction's uncommitted row — leaving the
holder with two primary phones. The in-memory test harness is single-threaded
and cannot expose this; only a real PostgreSQL run can.

## Question

Should the "exactly one primary phone per Customer" rule be enforced by the
database, by application code only, or not at all?

## Options

### Option A — Partial unique index on primary PHONE contacts (recommended)

Add an additive migration creating a partial unique index equivalent to the
`PatientGuardian` precedent, for example
`customer_contact (tenant_id, customer_id) WHERE kind = 'PHONE' AND is_primary`,
and handle the resulting `P2002` in the portal upsert as an idempotent retry or
a `CONFLICT` instead of an `INTERNAL` failure. Because existing databases may
already hold duplicate primary PHONE rows, the migration must also define what
happens to them (fail the migration with a clear message, or demote all but the
most recently updated row before creating the index).

### Option B — Application-code convention only (current state)

Keep the demotion in the profile service and accept that concurrent first-time
updates can break the rule. Cheap, no migration, no data cleanup — but the
invariant is then only as strong as the discipline of every future writer, and
the staff customer flow can also create multiple primaries today.

### Option C — Model primacy explicitly instead of a flag

Replace the boolean convention with a dedicated `customer_primary_phone`
ownership row (or a `primary_contact_id` on `Customer`) so primacy is
single-valued by construction. Cleanest semantics and no partial index needed,
but it is a schema remodel touching the staff customers module, the portal, and
any future consumer, for a rule the portal is currently the only writer of.

### Option D — Drop the concept

Stop speaking of a primary phone and return the most recently updated active
PHONE contact. Removes an invariant nobody enforces, but changes the approved
spec wording and would need the spec to be amended rather than silently
reinterpreted.

## Recommendation

Option A, scoped as its own additive database slice with an explicit decision on
pre-existing duplicates. It matches an invariant the repo already enforces for
`PatientGuardian`, it is the only option that makes the rule true under
concurrency, and it is small: one partial index plus one error mapping.

Until it is accepted, the portal profile boundary keeps the application-level
demotion and the residual concurrency risk stays documented in the WU4C PRs and
in the epic task file.

## Impact

### Product

No user-visible change on the happy path. It removes the possibility of a holder
(or the staff flow) leaving several primary phones, which would make "the" phone
ambiguous for display and for any future notification work.

### Architecture

Reinforces an existing pattern rather than introducing a new one: the same
partial-unique-plus-application-guard approach already used for patient
guardians. No new abstraction, no new dependency.

### Database/API

One additive migration and its rollback. If duplicates already exist, the
migration needs a deterministic cleanup or a hard failure — that is the main
risk and the reason this is a decision rather than a quick patch. The portal
upsert gains a `P2002` mapping so a concurrent loss is idempotent or a clean
`409` rather than a `500`.

### Delivery

A small slice after WU4C, independent of WU4D. It should carry a live-PostgreSQL
test proving two concurrent first-time upserts leave exactly one primary phone —
the same live-PG gap already recorded for booking approval in WU5.

## Decision

_Pending._

## PRD Update

No PRD change is required: the PRD does not define customer contact primacy. If
Option C or D is chosen instead, the portal-management spec wording must be
amended accordingly, because it currently describes "the primary phone".
