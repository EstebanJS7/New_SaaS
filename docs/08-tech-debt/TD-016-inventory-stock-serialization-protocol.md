---
id: TD-016
type: tech-debt
title:
  Inventory stock serialization depends on every writer acquiring the same
  advisory lock
status: open
severity: medium
related_epics:
  - EPIC-10
  - EPIC-11
  - EPIC-12
related_stories:
  - CAT-007
created: 2026-09-25
updated: 2026-09-25
---

# TD-016 — Inventory stock serialization depends on every writer acquiring the same advisory lock

## Context

`InventoryService.adjust` (`apps/api/src/inventory/inventory.service.ts`)
serializes the stock read-modify-write per `(tenant, item)` with a
transaction-scoped PostgreSQL advisory lock:

```sql
SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text
```

where `lockKey = stockSerializationLockKey(tenantId, catalogItemId)` =
`"<tenantId>:<catalogItemId>"`, exported from
`apps/api/src/inventory/inventory.repository.ts` precisely so the live-PG
evidence can reconstruct the exact key.

The lock exists because the fixed `BLOCK` negative-stock policy is evaluated
against the running projection and the balance is then written as an
**absolute** value. Under `READ COMMITTED` without the lock, two concurrent
outputs both read the pre-commit balance, both pass the pre-check and both write
their own projected value. The live-PostgreSQL race case first exposed exactly
that failure: two concurrent `-7.000` outputs against a `10.000` balance both
returned `201`, the projection ended at `3.000` and the ledger sum was `-4.000`
— an admitted overdraw **and** a projection that no longer equalled the ledger's
signed sum. The lock is what fixed it; the same case now yields exactly one
`201`, one `409`, a projection equal to the ledger sum, one movement and one
audit row.

This is the EPIC-10 ledger's serialization protocol, documented in [[Inventory]]
under "Concurrency and the serialization protocol" and binding on later slices:
[[EPIC-11]] purchases/receiving and [[EPIC-12]] POS/sales **MUST** acquire
`stockSerializationLockKey(tenantId, catalogItemId)` before reading or writing
`stock_balance`.

## Debt

The correctness of `stock_balance` rests on a **convention that no schema and no
type enforces**. A stock writer that skips the lock — a new command, a script, a
raw SQL data fix, or a future `InventoryRepository.upsertBalance` call site —
silently reintroduces the lost update. The failure is quiet and dangerous: the
projection stays non-negative and every individual request returns success, so
nothing surfaces until the balance diverges from the ledger's signed sum, or an
accumulated overdraw shows up as a negative ledger total.

The repository seam does not help, because `upsertBalance` writes an absolute
value and is a plain data-access method: it cannot tell whether its caller
already holds the lock.

## Why It Is Safe to Defer

- The only stock writer that exists today is `InventoryService.adjust`, and it
  takes the lock before reading the projection.
- The live-PostgreSQL suite asserts the exact lock key and the projected-equals-
  ledger-sum invariant on the race path, so a regression in the one existing
  writer fails a real test rather than passing unnoticed.
- No acceptance criterion of EPIC-10 depends on the stronger shape; the current
  lock satisfies the epic's concurrency evidence.

## Risk

- [[EPIC-11]] and [[EPIC-12]] add new writers (purchase receiving, sale
  completion, reversals). Each one is a fresh opportunity to forget the lock,
  and a forgotten lock produces no error — only a diverging projection.
- The invariant is not self-documenting at the database level: a reviewer
  reading `stock_balance` DDL sees only `CHECK (quantity >= 0)`, which the lost
  update does **not** violate when the phantom write lands last.
- Query-level enforcement is currently absent, so the guarantee is only as broad
  as the discipline of the writer(s).

## Proposed Resolution

Prefer a self-enforcing row-level guard over a documented convention, in this
order:

1. **Atomic guarded write.** Replace the read-then-absolute-upsert with one
   conditional statement that both asserts and mutates, for example an
   `UPDATE "stock_balance" SET quantity = quantity + delta WHERE ... AND quantity + delta >= 0`
   (or the Prisma `updateMany` equivalent), so a writer cannot separate the
   check from the write. A zero-row result is the `BLOCK` rejection. Note that a
   missing row still needs an insert path, which is where the lock remains
   useful.
2. **Row-level lock.** Alternatively take a real row lock on the projection row
   (`SELECT … FOR UPDATE`) inside the transaction, which enforces the
   serialization through the row itself instead of a derived key.
3. Either path requires **extending the shared in-memory boundary**
   (`apps/api/test/support/in-memory-database.ts`) to model the guarded update
   or the row lock. Today the boundary models `pg_advisory_xact_lock` as a no-op
   because a synchronous map cannot interleave, and its `$queryRaw` fake
   recognizes only the advisory lock and the membership `FOR UPDATE` query; a
   new raw-SQL shape fails there until it is taught, and a silent no-op would
   make the application-path suite pass without proving anything.

Whichever shape is adopted, keep the `(tenant, item)` scope so unrelated items
stay concurrent, and keep the projected-equals-ledger-sum assertion in the race
case as the regression guard.

## Trigger / Target

The next stock writer added by [[EPIC-11]] or [[EPIC-12]], or the next change to
`InventoryRepository.upsertBalance` / the lock seam.

## Verification After Resolution

- [ ] The application-path HTTP suite proves the guard is enforced by the
      database path (the in-memory boundary models the guard, not a no-op).
- [ ] The live-PostgreSQL race case still yields exactly one `201`, one `409`,
      one movement and one audit row, with the projection equal to the ledger's
      signed sum.
- [ ] A writer that bypasses the new guard (or the lock) fails a test instead of
      silently diverging the projection.
- [ ] The ledger's serialization contract is updated in [[Inventory]] and in the
      EPIC-11/EPIC-12 records.
