-- MB-001 / DEC-094: branches become a managed aggregate, and staff are
-- assigned to the branches where they work.
--
-- Additive. Every existing branch stays active, and every existing membership
-- is assigned to every existing branch of its tenant (DEC-094 §8): until now a
-- clinic operated a single actual branch, so nothing a professional could do
-- yesterday is refused today.

-- 1. Branch identity and lifecycle.
ALTER TABLE "branch"
  ADD COLUMN "address" VARCHAR(255),
  ADD COLUMN "phone" VARCHAR(30),
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "branch"
  ADD CONSTRAINT "branch_name_length" CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
  ADD CONSTRAINT "branch_address_not_blank" CHECK ("address" IS NULL OR btrim("address") <> ''),
  ADD CONSTRAINT "branch_phone_not_blank" CHECK ("phone" IS NULL OR btrim("phone") <> '');

-- One name per clinic, case-insensitively: two "Centro" branches would make
-- every branch picker ambiguous.
CREATE UNIQUE INDEX "branch_tenant_id_lower_name_key" ON "branch"("tenant_id", lower("name"));

-- A branch is never deleted (DEC-094 §2): turnos, and later sales and stock,
-- keep their reference. Removal is `is_active = false`.
CREATE FUNCTION "branch_reject_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'branch rows are never deleted; deactivate instead'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "branch_reject_delete"
  BEFORE DELETE ON "branch"
  FOR EACH ROW EXECUTE FUNCTION "branch_reject_delete"();

-- 2. Staff assignment: where a membership works (DEC-094 §5).
CREATE TABLE "membership_branch" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "membership_branch_pkey" PRIMARY KEY ("id")
);

-- One assignment per (membership, branch).
CREATE UNIQUE INDEX "membership_branch_membership_id_branch_id_key"
  ON "membership_branch"("membership_id", "branch_id");
CREATE INDEX "membership_branch_tenant_id_branch_id_idx" ON "membership_branch"("tenant_id", "branch_id");

-- Composite tenant-ownership FKs: the membership and the branch are both in the
-- row's tenant, so a cross-tenant assignment is unrepresentable.
ALTER TABLE "membership_branch"
  ADD CONSTRAINT "membership_branch_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "membership_branch_membership_fkey"
    FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "tenant_membership"("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "membership_branch_branch_fkey"
    FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 3. Backfill (DEC-094 §8): everyone works everywhere they could yesterday.
INSERT INTO "membership_branch" ("tenant_id", "membership_id", "branch_id")
SELECT m."tenant_id", m."id", b."id"
FROM "tenant_membership" m
JOIN "branch" b ON b."tenant_id" = m."tenant_id";

-- The `branches.manage` permission (DEC-094 §4) is seeded by the reference
-- seed, which owns the permission catalog and the role matrix.
