---
id: DEC-069
type: decision
title: Imports create only, and a "duplicate" is a heuristic warning
status: accepted
date: 2026-10-19
related_epics:
  - "EPIC-19"
related_stories:
  - "IMP-002"
  - "IMP-003"
prd_change_required: false
---

# DEC-069 — Create-only, and duplicates are a heuristic

## Context

The exploration found that **`customer` has no natural unique key**. The only
unique index on the table is `(tenant_id, id)`:

```text
CREATE UNIQUE INDEX "customer_tenant_id_id_key" ON "customer"("tenant_id", "id");
```

`customer_contact` has no unique index either. `document_number` is nullable and
non-unique.

So "does this row describe a customer that already exists?" has no authoritative
answer available to an import.

## Question

Does an import create records only, or also update existing ones, and what does
it say when a row looks like one that already exists?

## Options

### Option A — Create only; duplicates reported as warnings (accepted)

Every row creates a record. When a row's document number or primary contact
value matches an existing record, the row carries a **warning** naming the
match. Nothing is updated and nothing is skipped automatically.

The operator sees "1 240 created, 37 suspected duplicates" and decides what to
do. Because the report is a warning rather than a rule, it can be wrong without
being harmful: a false positive means a warning nobody acts on; a false negative
means a created record the operator did not expect, and the summary still says
it was created.

### Option B — Update on match by document number

Rejected. `document_number` is nullable and not unique, so "match by document"
already fails for every row without one, and would need a new unique index — a
migration on a `done` epic's table, plus a decision about which fields an import
may overwrite on a person's record. An import that silently rewrites customer
data is the single most dangerous thing this epic could ship.

### Option C — Reject a row that matches

Rejected for the same reason as B, in the other direction: it turns a heuristic
into a hard rule, so a false positive silently drops a legitimate new customer.

## Decision

Accepted by the maintainer on 2026-10-19.

**Imports are create-only.** A suspected duplicate is a **warning attached to
the row**, computed by a heuristic documented in the module doc, and it never
changes what the import writes.

The word "duplicate" is used in the UI and the summary as _suspected_, because
that is what it is. The module doc must state the heuristic's definition and its
limits in the same paragraph, so a reader cannot mistake it for a constraint.

## Consequences

### Product

An import never modifies an existing record. A tenant importing twice gets the
records twice, with the second batch flagged as suspected duplicates.

### Architecture

No migration, no unique index, no update path. The heuristic lives in one
function with its own tests, including the case it cannot detect.

### Database/API

None. The heuristic may reuse the read paths that already exist for listing
customers.

### Delivery

[[IMP-002]] computes the warnings in the preview; [[IMP-003]] carries them into
the summary. A test asserts that a warned row is still CREATED, so the warning
can never become a silent skip.

## PRD Update

No PRD change. PRD §32 asks for validation, preview and a result summary; it
says nothing about updating.
