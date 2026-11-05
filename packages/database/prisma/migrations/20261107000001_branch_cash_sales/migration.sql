-- MB-002 / DEC-094 §9: cash registers and sales belong to a branch, and a
-- branch may carry its own fiscal issuance point.
--
-- Existing rows move to the tenant's OLDEST branch (DEC-094 §8): until MB-001
-- every clinic operated a single actual branch, the one its provisioning
-- created. A tenant that holds registers or sales but has no branch at all
-- (only possible for rows inserted by hand) gets one, so the backfill never
-- has to guess.

-- 0. Every tenant with cash or sales has a branch to receive them.
INSERT INTO "branch" ("tenant_id", "name", "updated_at")
SELECT t."id", 'Casa central', CURRENT_TIMESTAMP
FROM "tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "branch" b WHERE b."tenant_id" = t."id")
  AND (
    EXISTS (SELECT 1 FROM "cash_register" r WHERE r."tenant_id" = t."id")
    OR EXISTS (SELECT 1 FROM "sale" s WHERE s."tenant_id" = t."id")
  );

-- 1. A branch's own issuance point (DEC-094 §9). Both columns or neither: an
--    establishment without a point identifies no timbrado range.
ALTER TABLE "branch"
  ADD COLUMN "fiscal_establishment_id" UUID,
  ADD COLUMN "expedition_point" VARCHAR(3);

ALTER TABLE "branch"
  ADD CONSTRAINT "branch_issuance_point_complete"
    CHECK (("fiscal_establishment_id" IS NULL) = ("expedition_point" IS NULL)),
  ADD CONSTRAINT "branch_expedition_point_tdPunExp"
    CHECK ("expedition_point" IS NULL OR "expedition_point" ~ '^[0-9]{3}$'),
  ADD CONSTRAINT "branch_fiscal_establishment_fkey"
    FOREIGN KEY ("tenant_id", "fiscal_establishment_id")
    REFERENCES "fiscal_establishment"("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- One branch per issuance point: two places sharing a point would print the
-- same establishment on documents issued in different addresses.
CREATE UNIQUE INDEX "branch_issuance_point_key"
  ON "branch"("tenant_id", "fiscal_establishment_id", "expedition_point")
  WHERE "fiscal_establishment_id" IS NOT NULL;

-- 2. Cash registers (supersedes DEC-020's tenant-wide register).
ALTER TABLE "cash_register" ADD COLUMN "branch_id" UUID;

UPDATE "cash_register" r
SET "branch_id" = (
  SELECT b."id" FROM "branch" b
  WHERE b."tenant_id" = r."tenant_id"
  ORDER BY b."created_at", b."id"
  LIMIT 1
);

ALTER TABLE "cash_register"
  ALTER COLUMN "branch_id" SET NOT NULL,
  ADD CONSTRAINT "cash_register_branch_fkey"
    FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "cash_register_tenant_id_branch_id_idx" ON "cash_register"("tenant_id", "branch_id");

-- 3. Sales. A sale is created in a branch and charged in a register of that
--    branch (DEC-094 §9). `sale` has only a DELETE guard, so the backfill
--    UPDATE runs on completed and cancelled sales too.
ALTER TABLE "sale" ADD COLUMN "branch_id" UUID;

UPDATE "sale" s
SET "branch_id" = (
  SELECT b."id" FROM "branch" b
  WHERE b."tenant_id" = s."tenant_id"
  ORDER BY b."created_at", b."id"
  LIMIT 1
);

ALTER TABLE "sale"
  ALTER COLUMN "branch_id" SET NOT NULL,
  ADD CONSTRAINT "sale_branch_fkey"
    FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "sale_tenant_id_branch_id_idx" ON "sale"("tenant_id", "branch_id");
