-- EPIC-01 · Migration 001 · Staff identity foundation (tasks 2.2 / U3).
--
-- Tables: user_profile, user_credential, staff_session.
-- staff_session intentionally ships HERE (not in 002): tasks.md task 2.2
-- defines the identity migration as profile + credential + session.
--
-- Conventions (design D2): snake_case identifiers via @@map/@map, UUID public
-- ids defaulted by gen_random_uuid(), timestamptz(3) UTC timestamps, no
-- floating point money columns.
--
-- Data classification:
--   user_profile.email / display_name  CONFIDENTIAL (never logged)
--   user_credential.password_hash      RESTRICTED   (argon2id; only the login
--                                      verification path selects this table —
--                                      its shared PK makes app reads join-free)
--
-- Delete semantics (design D2): RESTRICT everywhere except staff_session,
-- which CASCADEs with its profile.

CREATE TABLE "user_profile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_profile_pkey" PRIMARY KEY ("id")
);

-- Email uniqueness is GLOBAL: login resolves the profile, memberships bind
-- profiles to tenants. Values are lowercased by the application before write.
CREATE UNIQUE INDEX "user_profile_email_key" ON "user_profile"("email");

-- Shared primary key with user_profile: 1:1 credentials without a join for
-- regular reads (design decision; spec: identity / Argon2id storage).
CREATE TABLE "user_credential" (
    "user_profile_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_credential_pkey" PRIMARY KEY ("user_profile_id")
);

CREATE TABLE "staff_session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_profile_id" UUID NOT NULL,
    -- SHA-256 of the opaque token; plaintext tokens never persist.
    "token_hash" TEXT NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_session_pkey" PRIMARY KEY ("id")
);

-- Session lookup happens by presented-token hash.
CREATE UNIQUE INDEX "staff_session_token_hash_key" ON "staff_session"("token_hash");

-- Profile-centric session listing/rotation cleanup.
CREATE INDEX "staff_session_user_profile_id_idx" ON "staff_session"("user_profile_id");

ALTER TABLE "user_credential" ADD CONSTRAINT "user_credential_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The only CASCADE relationship in EPIC-01 (design D2 delete semantics).
ALTER TABLE "staff_session" ADD CONSTRAINT "staff_session_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
