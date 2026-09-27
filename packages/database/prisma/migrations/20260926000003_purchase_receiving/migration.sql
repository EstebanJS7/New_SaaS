-- Additive migration: EPIC-11 PUR-002 purchase receiving movement type.
--
-- `stock_movement_type` gains `PURCHASE` additively for the receiving command
-- (DEC-014), following the reservation documented on the enum since EPIC-10.
-- A `PURCHASE` movement is a POSITIVE input by the ledger's signed convention.
--
-- This migration is strictly additive: it alters the enum only. No table is
-- created or dropped, no column is added or changed, no existing row is
-- rewritten, no constraint or trigger is touched, and `ADJUSTMENT` keeps its
-- original position and behaviour.
--
-- TRANSACTION NOTE: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction
-- block on PostgreSQL 11 and older, and on PostgreSQL 12+ it may run inside a
-- transaction as long as the new value is NOT used in that same transaction.
-- This migration only adds the value and never references it, and the
-- supported server is PostgreSQL 16, so the plain single-statement form below is
-- applied by `prisma migrate deploy` as-is. The applied value is proven against
-- a live PostgreSQL 16 by the receiving live-database evidence.

ALTER TYPE "stock_movement_type" ADD VALUE 'PURCHASE';
