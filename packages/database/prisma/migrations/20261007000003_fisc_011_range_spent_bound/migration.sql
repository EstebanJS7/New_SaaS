-- Additive correction: EPIC-16 FISC-011, the bound on an ACTIVE range's counter.
--
-- `20261007000002` required an ACTIVE range to satisfy `next_number <= range_to`.
-- That is wrong, and it made **the last number of every range impossible to
-- issue**: the counter holds the NEXT number to hand out, so the claim that takes
-- the last number increments it to `range_to + 1` while the status is still
-- ACTIVE — the rollover happens on the *next* call, when the allocation finds the
-- range spent.
--
-- The defect was found by the live-PostgreSQL rollover case, and it could not have
-- been found by either unit's own suite: the allocation's uses a fake that does
-- not apply the schema's CHECKs, and the schema's only inserted rows. Two units
-- that are each correct can still disagree, and the disagreement was only visible
-- where both meet an actual database.
--
-- **Why this is a separate migration rather than an edit.** Prisma does not
-- re-run applied migrations, so editing `20261007000002` in place would have left
-- every database that already ran it with the old bound — the fix would have
-- reached fresh databases only, and the production defect would have survived in
-- exactly the environments that matter.
--
-- The EXHAUSTED implication is untouched, and the two together still pin the
-- counter to the status: an ACTIVE range may be spent and awaiting its rollover,
-- and an EXHAUSTED one has run out. RETIRED remains free of both.
--
-- This migration alters one constraint. It creates or drops no table, adds or
-- changes no column, rewrites no row, and touches no other constraint or trigger.

ALTER TABLE "fiscal_timbrado_range"
  DROP CONSTRAINT "fiscal_timbrado_range_active_has_numbers_left";

ALTER TABLE "fiscal_timbrado_range"
  ADD CONSTRAINT "fiscal_timbrado_range_active_within_one_past_the_end"
  CHECK ("status" <> 'ACTIVE' OR "next_number" <= "range_to" + 1);
