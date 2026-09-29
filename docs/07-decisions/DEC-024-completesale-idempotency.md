---
id: DEC-024
type: decision
title: CompleteSale idempotency (EPIC-12)
status: accepted
date: 2026-09-27
related_epics:
  - "EPIC-12"
related_decisions:
  - "DEC-014"
related_stories:
  - "POS-003"
prd_change_required: false
---

# DEC-024 — CompleteSale idempotency (EPIC-12)

## Context

PRD §18 states that Complete Sale "must be idempotent", and
`docs/03-architecture/REVERSALS-CORRECTIONS.md` "Idempotency" requires sensitive
commands to accept and persist an `Idempotency-Key` and to return the prior
result for a repeated identical request instead of creating a duplicate. The
shipped EPIC-11 receiving command already solves the concurrency half of this
problem: it locks the aggregate header row first, re-reads the status after the
lock, writes the status conditionally and returns a stable `409` for a replay
([[DEC-014]]). PRD §28 fixes the API conventions, and PRD §41 forbids automatic
destructive retention of confirmed financial records before an approved policy
exists. POS-003 records the idempotency mechanism as an open question.

Verified current state in this repository (2026-09-27):

- `apps/api/src/purchases/purchases.service.ts:395-460` shows the shipped
  receiving pattern: the header `SELECT ... FOR UPDATE` lock (`lockById`, line
  404), the post-lock `DRAFT` gate (`assertDraft`, line 411), the
  per-`(tenant, item)` advisory lock (line 432), the ledger movement (line 442)
  and the balance upsert (line 454), then the conditional `DRAFT`-only status
  write as a backstop.
- `docs/02-stories/PUR-002-purchase-receiving.md` records the double-receive
  defect and its fix: the header lock first, a post-lock status re-read, a
  conditional status write, and a stable `409` on any replay.
- There is no idempotency-key table or helper anywhere in the repository, and no
  sale or payment model exists yet.
- `docs/03-architecture/REVERSALS-CORRECTIONS.md` already establishes the
  `Idempotency-Key` convention for sensitive commands.

## Question

Which idempotency mechanism does CompleteSale use — a persisted idempotency
record, the shipped row-lock conditional transition, or both — and how long do
any idempotency rows live?

## Options

### Option A — Persisted idempotency record AND the row-lock conditional transition (recommended)

Both mechanisms together. (a) A persisted, tenant-scoped idempotency record,
unique per `(tenant, operation, key)`, holding the request fingerprint and a
reference to the stored result: the same key with the same fingerprint returns
the prior result instead of a `409` and never completes a second time; the same
key with a different fingerprint is a stable conflict; the key scope is the
tenant, never global. (b) A conditional `WHERE status = 'DRAFT'` transition
guarded by a `SELECT ... FOR UPDATE` header row lock with a post-lock status
re-read, so a replay without a key is a stable `409` and persists nothing — the
shipped PUR-002 precedent. The key travels through the existing API convention
(`Idempotency-Key`). Retention of idempotency rows is recorded as a limitation:
no destructive retention until an approved retention policy exists (PRD §41).

Benefits: the two mechanisms cover different failures — the row lock serializes
concurrent first attempts, and the persisted record lets an identical retry
recover the original result instead of guessing whether a `409` meant "already
done by me" or "someone else did it" — so PRD §18's idempotency requirement is
met in both the concurrent and the retry case.

Costs: it adds a small tenant-scoped table and a fingerprint contract, and the
rows accumulate until a retention policy exists, which is recorded as [[TD-020]]
rather than solved by an automatic purge.

### Option B — Only the row-lock conditional transition

Reuse the shipped PUR-002 pattern exactly, with no idempotency table.

Benefits: no new table, the smallest change, and it reuses a proven concurrency
control the repository already tests.

Costs: a network retry of an already-completed request returns a `409` rather
than the prior result, so a client cannot distinguish its own duplicate from
another actor's completion, and PRD §18's idempotency requirement is satisfied
only narrowly. It leaves the retry case unanswered.

### Option C — Only a persisted idempotency record

Add the idempotency table and no header row lock.

Benefits: one new table and a clean replay contract for identical requests.

Costs: two concurrent first-time requests with different keys on the same
`DRAFT` sale race on the status read-modify-write; without the header lock both
can pass the `DRAFT` pre-check and double-complete, writing duplicate stock and
cash movements. The store makes replays safe but does not serialize concurrent
first attempts.

## Recommendation

Option A. PRD §18 requires idempotency and PRD §40 requires reversals to be
idempotent and audited; the row lock is the concurrency correctness control and
the persisted record is the replay/output-token control, and each option that
drops one leaves a concrete failure open. Option B is exactly the shipped
receiving behaviour, which the epic could adopt if scope had to shrink, and
Option C is rejected because it reintroduces the double-complete race the
PUR-002 defect already demonstrated.

## Impact

### Product

A retried completion returns the same sale instead of creating a second one, and
a genuinely conflicting request fails predictably. The cash and stock effects of
a sale are written at most once regardless of how many times a client retries.

### Architecture

No new runtime, datastore, queue, dependency or API protocol. The idempotency
record is one more tenant-scoped table inside the existing database, and the
row-lock transition reuses the shipped receiving seam rather than inventing a
new one.

### Database/API

A tenant-scoped idempotency table with a unique `(tenant, operation, key)` and a
stored request fingerprint and result reference, plus the header
`SELECT ... FOR UPDATE` lock and the conditional `WHERE status = 'DRAFT'` write
on the sale. The `Idempotency-Key` header follows the existing API convention; a
same-key, same-fingerprint replay returns the prior result, and a same-key,
different-fingerprint request is a stable conflict.

### Delivery

POS-003 owns the CompleteSale command, the idempotency record and its
fingerprint contract, and the row-lock conditional transition with its replay
tests. The retention limitation is recorded as [[TD-020]] pending an approved
retention policy.

## Decision

Accepted on 2026-09-27 by the maintainer. Option A is the decision: both
mechanisms together. (a) A persisted idempotency record, tenant-scoped, unique
per `(tenant, operation, key)`, holding the request fingerprint and a reference
to the stored result: the same key with the same fingerprint returns the prior
result instead of a `409` and never completes a second time; the same key with a
different fingerprint is a stable conflict; the key scope is the tenant, never
global. (b) A conditional `WHERE status = 'DRAFT'` transition guarded by a
`SELECT ... FOR UPDATE` header row lock with a post-lock status re-read, so a
replay without a key is a stable `409` and persists nothing (the shipped PUR-002
precedent). The key travels through the existing API convention
(`Idempotency-Key`). Retention of idempotency rows is recorded as a limitation:
no destructive retention until an approved retention policy exists (PRD §41).

The other options stay recorded above as what was considered; acceptance selects
Option A only.

POS-003 owns the CompleteSale idempotency, and the retention limitation is
recorded as [[TD-020]].

## PRD Update

No PRD change is required. PRD §18 already requires Complete Sale to be
idempotent, PRD §28 already fixes the API conventions, and
`docs/03-architecture/REVERSALS-CORRECTIONS.md` already establishes the
`Idempotency-Key` convention; PRD §41 already forbids automatic destructive
retention before an approved policy. This record chooses the mechanism that
satisfies that existing intent and records a retention limitation the PRD
already accounts for, so it extends no approved scope and no PRD edit is
proposed here.
