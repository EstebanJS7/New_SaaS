-- DAT-007 (EPIC-01). The staff password-recovery token.
--
-- Adds `password_reset_token`, the record a completed reset is built on. This is
-- strictly additive: one new table with its indexes, constraints and triggers, two
-- appended enum values on EPIC-17's delivery aggregate, and nothing else. It
-- alters no existing column, writes no row and drops nothing.
--
-- WHY THIS TABLE HAS NO TENANT COLUMN, stated here because every other private
-- aggregate in this repository does have one and its absence will look like an
-- oversight to the next reader. The credential a reset authorises is
-- `UserCredential`, whose key is SHARED with `UserProfile` and which is therefore
-- global to the profile, not to a membership: a staff member with two memberships
-- has ONE password. Scoping the token to a tenant would mean the flow could only
-- reset the password of a member of the tenant they happened to be thinking about,
-- which is neither what the user asked for nor what the credential model supports.
-- The token is consequently an identity resource, exactly like `StaffSession` and
-- `UserCredential`, and the tenant-scoping rule does not apply to it. What IS
-- tenant-scoped is the delivery the request creates, and that goes through
-- `notification_delivery` like every other message.
--
-- The plaintext token never reaches this table. Only its SHA-256 does, following
-- the `StaffSession` convention: a 256-bit random token needs a fast digest rather
-- than argon2, whose cost exists to make a LOW-entropy human-chosen password
-- expensive to guess. Nothing in the row is personal data -- a profile reference,
-- a digest and two instants -- which is why expired rows can simply accumulate
-- without a retention policy.
--
-- What the database enforces, rather than trusting the application layer for:
--   * the token's identity is fixed at insert: `user_profile_id`, `token_hash`,
--     `expires_at` and `created_at`. A mutable digest would mean a token could be
--     pointed at a different value; a mutable expiry would mean a dead token could
--     be resurrected by extending it, which is extending somebody's access;
--   * the token is SINGLE-USE: `consumed_at` may only move from NULL to a value,
--     once. It cannot be rewritten (a second consumption instant) and it cannot be
--     cleared (an un-consumed token is a second password change);
--   * an expiry is after its creation: `expires_at > created_at` is a CHECK, so a
--     unit or clock mistake fails at the database instead of issuing a token that
--     is born dead or one that outlives the intent.

CREATE TABLE "password_reset_token" (
  "id"              UUID           NOT NULL DEFAULT gen_random_uuid(),
  "user_profile_id" UUID           NOT NULL,
  "token_hash"      TEXT           NOT NULL,
  "expires_at"      TIMESTAMPTZ(3) NOT NULL,
  "consumed_at"     TIMESTAMPTZ(3),
  "created_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "password_reset_token_pkey" PRIMARY KEY ("id"),
  -- A digest that is after its own creation, always. The application sets the TTL;
  -- this is the fence that keeps a mistake from issuing a dead token.
  CONSTRAINT "password_reset_token_expiry_after_creation" CHECK ("expires_at" > "created_at")
);

-- Unique so that a lookup by digest is one row by construction, not by ordering.
CREATE UNIQUE INDEX "password_reset_token_token_hash_key"
  ON "password_reset_token" ("token_hash");

-- Finding the live tokens of a profile (and a future sweep of one profile's
-- expired rows).
CREATE INDEX "password_reset_token_user_profile_id_idx"
  ON "password_reset_token" ("user_profile_id");

-- Tokens die with their profile, the only CASCADE in this table and the
-- `staff_session` precedent: a deleted profile's reset tokens are not leftovers
-- worth keeping.
ALTER TABLE "password_reset_token"
  ADD CONSTRAINT "password_reset_token_user_profile_id_fkey"
  FOREIGN KEY ("user_profile_id") REFERENCES "user_profile" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The token's identity, fixed at insert.
CREATE OR REPLACE FUNCTION "password_reset_token_identity_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'a password reset token id cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."user_profile_id" IS DISTINCT FROM OLD."user_profile_id" THEN
    RAISE EXCEPTION 'a password reset token cannot be reassigned to another profile' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."token_hash" IS DISTINCT FROM OLD."token_hash" THEN
    RAISE EXCEPTION 'a password reset token digest cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."expires_at" IS DISTINCT FROM OLD."expires_at" THEN
    RAISE EXCEPTION 'a password reset token expiry cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'a password reset token created_at cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "password_reset_token_identity_immutable_trigger"
  BEFORE UPDATE ON "password_reset_token" FOR EACH ROW EXECUTE FUNCTION "password_reset_token_identity_immutable"();

-- Single use. The three refusals are separate and each one is load-bearing:
-- a REWRITE would let one token record two consumptions (the second of which the
-- application would read as "already spent" while the first already changed a
-- password); a CLEAR would turn a spent token back into a usable one.
CREATE OR REPLACE FUNCTION "password_reset_token_single_use"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."consumed_at" IS NOT NULL AND NEW."consumed_at" IS DISTINCT FROM OLD."consumed_at" THEN
    IF NEW."consumed_at" IS NULL THEN
      RAISE EXCEPTION 'a consumed password reset token cannot be un-consumed' USING ERRCODE = 'restrict_violation';
    END IF;
    RAISE EXCEPTION 'a password reset token consumption instant cannot be rewritten' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "password_reset_token_single_use_trigger"
  BEFORE UPDATE ON "password_reset_token" FOR EACH ROW EXECUTE FUNCTION "password_reset_token_single_use"();

-- EPIC-17's delivery aggregate gains the staff source and recipient. Appended, so
-- every existing row keeps its meaning. `ALTER TYPE ... ADD VALUE` is used here
-- rather than a `CREATE TYPE` replacement because these ARE existing types, and
-- neither value is used as an enum literal inside this migration -- the rule the
-- notification migration records (a value added in a transaction cannot be used as
-- a literal in that same transaction) does not bite when the migration only
-- declares the values and writes no row.
ALTER TYPE "notification_source_type" ADD VALUE IF NOT EXISTS 'STAFF_ACCOUNT';
ALTER TYPE "notification_recipient_type" ADD VALUE IF NOT EXISTS 'STAFF';
