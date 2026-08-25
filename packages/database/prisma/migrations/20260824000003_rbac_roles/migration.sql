-- EPIC-01 · Migration 003 · RBAC reference tables (tasks 2.4 / U5, split 1 of 2).
--
-- Tables: role, permission, role_permission. Also resolves the deviation
-- accepted in migration 002: tenant_membership.role_id receives its FOREIGN
-- KEY to role(id) here, now that the referenced table exists.
--
-- Conventions (design D2): snake_case identifiers, UUID public ids via
-- gen_random_uuid(), timestamptz(3) UTC timestamps, RESTRICT FKs everywhere
-- (no delete endpoints exist; sessions are the only CASCADE and live in 001).
--
-- Split note: task 2.4 exceeded the ~400-line PR budget, so its migration was
-- split per the tasks.md contingency — 003 = RBAC (+ membership FK),
-- 004 = entitlements boundary + append-only audit log.
--
-- Scope fence (spec: RBAC scope fence): these rows are seeded inertly by the
-- reference seed; no role-management UI/CRUD exists, and authorization during
-- EPIC-01 relies only on authentication + membership.

CREATE TABLE "role" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "role_code_key" ON "role"("code");

CREATE TABLE "permission" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "permission_key_key" ON "permission"("key");

CREATE TABLE "role_permission" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("id")
);

-- One binding per (role, permission); doubles as the seed upsert key.
CREATE UNIQUE INDEX "role_permission_role_id_permission_id_key" ON "role_permission"("role_id", "permission_id");

ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permission"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Deferred from migration 002 (accepted deviation, resolved here): the column
-- already exists as a final NOT NULL uuid; only the constraint is added.
ALTER TABLE "tenant_membership" ADD CONSTRAINT "tenant_membership_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
