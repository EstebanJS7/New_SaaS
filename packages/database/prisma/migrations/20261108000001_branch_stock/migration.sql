-- MB-003 / DEC-094 §10: stock lives in a branch.
--
-- The balance becomes one row per (item, branch); every movement says where it
-- happened; a purchase is received into a branch; and a transfer between two
-- branches is a pair of movements (TRANSFER_OUT at the origin, TRANSFER_IN at
-- the destination) sharing one `transfer_id`.
--
-- Existing rows move to the tenant's OLDEST branch (DEC-094 §8), the one its
-- provisioning created. A tenant holding stock or purchases but no branch at
-- all (only possible for rows inserted by hand) gets "Casa central" first.

-- 0. Every tenant with stock or purchases has a branch to receive them.
INSERT INTO "branch" ("tenant_id", "name", "updated_at")
SELECT t."id", 'Casa central', CURRENT_TIMESTAMP
FROM "tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "branch" b WHERE b."tenant_id" = t."id")
  AND (
    EXISTS (SELECT 1 FROM "stock_movement" m WHERE m."tenant_id" = t."id")
    OR EXISTS (SELECT 1 FROM "stock_balance" s WHERE s."tenant_id" = t."id")
    OR EXISTS (SELECT 1 FROM "purchase" p WHERE p."tenant_id" = t."id")
  );

-- 1. The transfer movement kinds (reserved since EPIC-10, appended additively).
ALTER TYPE "stock_movement_type" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
ALTER TYPE "stock_movement_type" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';

-- 2. Movements: where each one happened, and the transfer pair it belongs to.
ALTER TABLE "stock_movement"
  ADD COLUMN "branch_id" UUID,
  ADD COLUMN "transfer_id" UUID;

UPDATE "stock_movement" m
SET "branch_id" = (
  SELECT b."id" FROM "branch" b
  WHERE b."tenant_id" = m."tenant_id"
  ORDER BY b."created_at", b."id"
  LIMIT 1
);

ALTER TABLE "stock_movement"
  ALTER COLUMN "branch_id" SET NOT NULL,
  ADD CONSTRAINT "stock_movement_branch_fkey"
    FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- `type::text` keeps this CHECK valid in the same transaction that added the
-- two enum values (a new value cannot be used as a literal before commit).
ALTER TABLE "stock_movement"
  ADD CONSTRAINT "stock_movement_transfer_pairing"
    CHECK (("transfer_id" IS NOT NULL) = ("type"::text IN ('TRANSFER_OUT', 'TRANSFER_IN')));

CREATE INDEX "stock_movement_tenant_id_branch_id_catalog_item_id_idx"
  ON "stock_movement"("tenant_id", "branch_id", "catalog_item_id");
-- One OUT and one IN per transfer.
CREATE UNIQUE INDEX "stock_movement_transfer_id_type_key"
  ON "stock_movement"("transfer_id", "type") WHERE "transfer_id" IS NOT NULL;

-- 3. Balances: one projection row per (item, branch).
ALTER TABLE "stock_balance" ADD COLUMN "branch_id" UUID;

UPDATE "stock_balance" s
SET "branch_id" = (
  SELECT b."id" FROM "branch" b
  WHERE b."tenant_id" = s."tenant_id"
  ORDER BY b."created_at", b."id"
  LIMIT 1
);

ALTER TABLE "stock_balance"
  ALTER COLUMN "branch_id" SET NOT NULL,
  ADD CONSTRAINT "stock_balance_branch_fkey"
    FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

DROP INDEX "stock_balance_tenant_id_catalog_item_id_key";
CREATE UNIQUE INDEX "stock_balance_tenant_id_catalog_item_id_branch_id_key"
  ON "stock_balance"("tenant_id", "catalog_item_id", "branch_id");

-- 4. Purchases: the branch the goods are received into.
ALTER TABLE "purchase" ADD COLUMN "branch_id" UUID;

UPDATE "purchase" p
SET "branch_id" = (
  SELECT b."id" FROM "branch" b
  WHERE b."tenant_id" = p."tenant_id"
  ORDER BY b."created_at", b."id"
  LIMIT 1
);

ALTER TABLE "purchase"
  ALTER COLUMN "branch_id" SET NOT NULL,
  ADD CONSTRAINT "purchase_branch_fkey"
    FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "purchase_tenant_id_branch_id_idx" ON "purchase"("tenant_id", "branch_id");
