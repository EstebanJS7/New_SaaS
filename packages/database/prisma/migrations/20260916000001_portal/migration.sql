-- Additive migration: EPIC-08 Portal data foundation (WU1).
--
-- Adds the portal identity/session tables, extends the previously inert
-- customer_portal_access scaffold with its Customer link and active-holder
-- uniqueness, adds the pending portal_booking_request lifecycle, and records
-- Appointment provenance. Also widens the shared audit actor taxonomy with
-- PORTAL and adds the nullable actor_portal_access_id FK.
--
-- Strictly additive: new tables, new nullable/unique columns, enum-value
-- additions and indexes. Existing rows are unaffected (appointment.source
-- defaults STAFF; no portal rows exist).
--
-- Composite tenant-ownership FKs ((tenant_id, x_id) -> x(tenant_id, id)) make
-- PostgreSQL reject any row whose tenant does not own the referenced Customer,
-- Patient or booking request. FKs are RESTRICT everywhere so tenants,
-- customers, patients, access rows and the audit trail stay joinable and
-- indestructible; the single CASCADE is portal_session ->
-- customer_portal_access (session rows die with their access, mirroring
-- staff_session). Prisma cannot express partial indexes, so the one-ACTIVE-
-- holder uniqueness is declared here as raw SQL.
--
-- Data classification: portal contact_email INTERNAL; portal password_hash
-- RESTRICTED; scheduling details and the Patient/Customer link CONFIDENTIAL;
-- logs/audit carry stable IDs only.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Audit actor taxonomy (EPIC-08 D5). ALTER TYPE ... ADD VALUE is
-- transaction-safe on PostgreSQL 12+ as long as the new value is not used
-- within the same transaction; this migration only declares it.
ALTER TYPE "audit_actor_type" ADD VALUE IF NOT EXISTS 'PORTAL';

-- Appointment provenance (EPIC-08 D4).
CREATE TYPE "appointment_source" AS ENUM ('STAFF', 'PORTAL');

-- Pending portal booking request lifecycle (EPIC-08 D3).
CREATE TYPE "portal_booking_request_status" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);

-- Tenant-ownership key on Customer: unique target of the composite customer
-- FKs added below (customer_portal_access and portal_booking_request).
CREATE UNIQUE INDEX "customer_tenant_id_id_key" ON "customer"("tenant_id", "id");

-- Extend the inert customer_portal_access scaffold with its Customer link.
ALTER TABLE "customer_portal_access" ADD COLUMN "customer_id" UUID NOT NULL;

ALTER TABLE "customer_portal_access" ADD CONSTRAINT "customer_portal_access_tenant_id_customer_id_fkey"
  FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customer"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "customer_portal_access_customer_id_idx"
  ON "customer_portal_access"("customer_id");

-- At most one ACTIVE portal holder per Customer. Revoked rows ('REVOKED') are
-- ignored by the predicate, so a Customer may accumulate historical holders.
CREATE UNIQUE INDEX "customer_portal_access_active_customer_key"
  ON "customer_portal_access"("tenant_id", "customer_id")
  WHERE "status" = 'ACTIVE';

-- RESTRICTED credential material; the PK is SHARED with customer_portal_access
-- so join-free reads never touch it.
CREATE TABLE "portal_credential" (
  "portal_access_id" UUID NOT NULL,
  "password_hash" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "portal_credential_pkey" PRIMARY KEY ("portal_access_id")
);

ALTER TABLE "portal_credential" ADD CONSTRAINT "portal_credential_portal_access_id_fkey"
  FOREIGN KEY ("portal_access_id") REFERENCES "customer_portal_access"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- First-party portal sessions (distinct cookie from staff). Sessions cascade
-- with their access row — the deliberate session exception to RESTRICT.
CREATE TABLE "portal_session" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "portal_access_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
  "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "portal_session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portal_session_token_hash_key" ON "portal_session"("token_hash");
CREATE INDEX "portal_session_portal_access_id_idx" ON "portal_session"("portal_access_id");

ALTER TABLE "portal_session" ADD CONSTRAINT "portal_session_portal_access_id_fkey"
  FOREIGN KEY ("portal_access_id") REFERENCES "customer_portal_access"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Pending booking requests: outside the appointment overlap ledger.
CREATE TABLE "portal_booking_request" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "patient_id" UUID NOT NULL,
  "status" "portal_booking_request_status" NOT NULL DEFAULT 'PENDING',
  "start_at" TIMESTAMPTZ(3) NOT NULL,
  "end_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "portal_booking_request_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "portal_booking_request_time_range_check" CHECK ("end_at" > "start_at")
);

CREATE UNIQUE INDEX "portal_booking_request_tenant_id_id_key"
  ON "portal_booking_request"("tenant_id", "id");
CREATE INDEX "portal_booking_request_tenant_id_status_idx"
  ON "portal_booking_request"("tenant_id", "status");
CREATE INDEX "portal_booking_request_tenant_id_customer_id_idx"
  ON "portal_booking_request"("tenant_id", "customer_id");
CREATE INDEX "portal_booking_request_tenant_id_patient_id_idx"
  ON "portal_booking_request"("tenant_id", "patient_id");

ALTER TABLE "portal_booking_request" ADD CONSTRAINT "portal_booking_request_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "portal_booking_request" ADD CONSTRAINT "portal_booking_request_tenant_id_customer_id_fkey"
  FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customer"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "portal_booking_request" ADD CONSTRAINT "portal_booking_request_tenant_id_patient_id_fkey"
  FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patient"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Appointment provenance and the nullable unique booking-request link. The
-- portal_booking_request tenant-ownership key is declared BEFORE this FK.
ALTER TABLE "appointment" ADD COLUMN "source" "appointment_source" NOT NULL DEFAULT 'STAFF';
ALTER TABLE "appointment" ADD COLUMN "portal_booking_request_id" UUID;

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_tenant_id_portal_booking_request_id_fkey"
  FOREIGN KEY ("tenant_id", "portal_booking_request_id")
  REFERENCES "portal_booking_request"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Nullable unique: PostgreSQL treats NULLs as distinct, so staff appointments
-- (no request) never collide, while a repeated approval of one request cannot
-- create a second appointment.
CREATE UNIQUE INDEX "appointment_tenant_id_portal_booking_request_id_key"
  ON "appointment"("tenant_id", "portal_booking_request_id");

-- Portal actor attribution on the append-only audit trail.
ALTER TABLE "audit_log" ADD COLUMN "actor_portal_access_id" UUID;

ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_portal_access_id_fkey"
  FOREIGN KEY ("actor_portal_access_id") REFERENCES "customer_portal_access"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
