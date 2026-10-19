-- PORTAL-002. The portal's password-recovery token.
--
-- The staff flow's sibling (DAT-007's `password_reset_token`), and a table of its OWN rather than a
-- widened one. The staff table's `user_profile_id` foreign key cannot hold a portal access id, so
-- reuse would need a polymorphic owner -- trading referential integrity for the appearance of it.
-- DEC-008's boundary applies one level down: a staff token must not be redeemable for a portal
-- password, nor the reverse. Two tables, each with its subject, is that boundary in the schema.
--
-- Strictly additive: one new table with its indexes, constraint and triggers, plus two appended
-- enum values on EPIC-17's delivery aggregate. It alters no other table, changes no column, writes
-- no row and drops nothing.
--
-- There is deliberately NO tenant column. The access it belongs to carries the tenant
-- (`customer_portal_access.tenant_id`), and the read asserts the two agree, so tenancy has ONE home
-- instead of two that could disagree.
--
-- The plaintext token never reaches this table: only its SHA-256, following `StaffSession` and the
-- staff token. The row holds no personal data -- an access reference, a digest and two instants.
--
-- What the database enforces, rather than trusting the application layer for:
--   * the token's identity is fixed at insert: `portal_access_id`, `token_hash`, `expires_at` and
--     `created_at`. A mutable digest could be repointed; a mutable expiry could resurrect a dead
--     token, which is extending somebody's access;
--   * the token is SINGLE-USE: `consumed_at` moves once from NULL to a value, and can neither be
--     rewritten (a second consumption instant) nor cleared (an un-consumed token is a second
--     password change);
--   * an expiry is after its creation, as a CHECK, so a unit or clock mistake fails at the database
--     instead of issuing a token that is born dead.

CREATE TABLE "portal_password_reset_token" (
  "id"               UUID           NOT NULL DEFAULT gen_random_uuid(),
  "portal_access_id" UUID           NOT NULL,
  "token_hash"       TEXT           NOT NULL,
  "expires_at"       TIMESTAMPTZ(3) NOT NULL,
  "consumed_at"      TIMESTAMPTZ(3),
  "created_at"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "portal_password_reset_token_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "portal_password_reset_token_expiry_after_creation" CHECK ("expires_at" > "created_at")
);

-- A digest that is unique, so a lookup by digest is one row by construction.
CREATE UNIQUE INDEX "portal_password_reset_token_token_hash_key"
  ON "portal_password_reset_token" ("token_hash");

CREATE INDEX "portal_password_reset_token_portal_access_id_idx"
  ON "portal_password_reset_token" ("portal_access_id");

-- Tokens die with their access, the `staff_session` and staff-token precedent: a removed access's
-- tokens are not leftovers worth keeping.
ALTER TABLE "portal_password_reset_token"
  ADD CONSTRAINT "portal_password_reset_token_portal_access_id_fkey"
  FOREIGN KEY ("portal_access_id") REFERENCES "customer_portal_access" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "portal_password_reset_token_identity_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'a portal reset token id cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."portal_access_id" IS DISTINCT FROM OLD."portal_access_id" THEN
    RAISE EXCEPTION 'a portal reset token cannot be reassigned to another access' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."token_hash" IS DISTINCT FROM OLD."token_hash" THEN
    RAISE EXCEPTION 'a portal reset token digest cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."expires_at" IS DISTINCT FROM OLD."expires_at" THEN
    RAISE EXCEPTION 'a portal reset token expiry cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'a portal reset token created_at cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "portal_password_reset_token_identity_immutable_trigger"
  BEFORE UPDATE ON "portal_password_reset_token" FOR EACH ROW EXECUTE FUNCTION "portal_password_reset_token_identity_immutable"();

-- Single use, with the rewrite and the clear refused separately: they are different mistakes and a
-- reader should not have to infer which one they made.
CREATE OR REPLACE FUNCTION "portal_password_reset_token_single_use"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."consumed_at" IS NOT NULL AND NEW."consumed_at" IS DISTINCT FROM OLD."consumed_at" THEN
    IF NEW."consumed_at" IS NULL THEN
      RAISE EXCEPTION 'a consumed portal reset token cannot be un-consumed' USING ERRCODE = 'restrict_violation';
    END IF;
    RAISE EXCEPTION 'a portal reset token consumption instant cannot be rewritten' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "portal_password_reset_token_single_use_trigger"
  BEFORE UPDATE ON "portal_password_reset_token" FOR EACH ROW EXECUTE FUNCTION "portal_password_reset_token_single_use"();

-- The delivery aggregate gains the portal's source and recipient, appended so every existing row
-- keeps its meaning. `ALTER TYPE ... ADD VALUE` is the correct form here (these ARE existing types)
-- and neither value is USED as a literal in this migration, which is the rule DAT-007's migration
-- records: a value added in a transaction cannot be used in that same transaction.
ALTER TYPE "notification_source_type" ADD VALUE IF NOT EXISTS 'PORTAL_ACCOUNT';
ALTER TYPE "notification_recipient_type" ADD VALUE IF NOT EXISTS 'PORTAL_HOLDER';
