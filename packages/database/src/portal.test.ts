import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";
/**
 * Portal data foundation (EPIC-08 WU1).
 *
 * These checks parse the applied migration SQL, the schema document and the
 * seed-owned catalogs, so a live database is not required: CI applies these
 * exact files, so textual assertions on the DDL are faithful to real state.
 * The demo path is driven through a recording fake by delegate contract.
 */

const SCHEMA = loadPrismaSchema();
const MIGRATIONS = loadMigrations();
const PORTAL_SQL = findMigration(MIGRATIONS, "_portal").sql;

function modelBlock(model: string): string {
  const start = SCHEMA.indexOf(`model ${model} `);
  expect(start, `model ${model} must exist`).toBeGreaterThan(-1);
  return SCHEMA.slice(start, SCHEMA.indexOf("}", start));
}

describe("migration · portal foundation (EPIC-08 WU1)", () => {
  it("creates the portal identity, session and booking-request tables", () => {
    expect(PORTAL_SQL).toMatch(/CREATE TABLE "portal_credential"/);
    expect(PORTAL_SQL).toMatch(/CREATE TABLE "portal_session"/);
    expect(PORTAL_SQL).toMatch(/CREATE TABLE "portal_booking_request"/);
  });

  it("adds the appointment-source and booking-request-status enums", () => {
    expect(PORTAL_SQL).toMatch(/CREATE TYPE "appointment_source" AS ENUM \('STAFF', 'PORTAL'\)/);
    expect(PORTAL_SQL).toMatch(
      /CREATE TYPE "portal_booking_request_status" AS ENUM \(\s*'PENDING',\s*'APPROVED',\s*'REJECTED',\s*'CANCELLED'\s*\)/
    );
  });

  it("widens the audit actor taxonomy with PORTAL", () => {
    expect(PORTAL_SQL).toMatch(/ALTER TYPE "audit_actor_type" ADD VALUE IF NOT EXISTS 'PORTAL'/);
  });

  it("links customer_portal_access to its Customer through a composite tenant FK", () => {
    expect(PORTAL_SQL).toMatch(
      /ALTER TABLE "customer_portal_access" ADD COLUMN "customer_id" UUID NOT NULL/
    );
    expect(PORTAL_SQL).toMatch(
      /ALTER TABLE "customer_portal_access" ADD CONSTRAINT "customer_portal_access_tenant_id_customer_id_fkey"\s+FOREIGN KEY \("tenant_id", "customer_id"\) REFERENCES "customer"\("tenant_id", "id"\)\s+ON DELETE RESTRICT/
    );
  });

  it("declares the customer tenant-ownership key before the composite customer FK", () => {
    const customerKey = PORTAL_SQL.indexOf(
      'CREATE UNIQUE INDEX "customer_tenant_id_id_key" ON "customer"("tenant_id", "id")'
    );
    const compositeFk = PORTAL_SQL.indexOf('"customer_portal_access_tenant_id_customer_id_fkey"');

    expect(customerKey).toBeGreaterThan(-1);
    expect(compositeFk).toBeGreaterThan(-1);
    expect(customerKey).toBeLessThan(compositeFk);
  });

  it("enforces at most one ACTIVE holder per Customer with a partial unique index", () => {
    // A partial index (not a plain unique) lets a Customer keep historical
    // revoked holder rows while still admitting only one ACTIVE holder.
    expect(PORTAL_SQL).toMatch(
      /CREATE UNIQUE INDEX "customer_portal_access_active_customer_key"\s+ON "customer_portal_access"\("tenant_id", "customer_id"\)\s+WHERE "status" = 'ACTIVE'/
    );
  });

  it("shares the credential primary key with the access row and RESTRICTs its FK", () => {
    expect(PORTAL_SQL).toMatch(
      /CREATE TABLE "portal_credential"[\s\S]*?CONSTRAINT "portal_credential_pkey" PRIMARY KEY \("portal_access_id"\)/
    );
    expect(PORTAL_SQL).toMatch(/"password_hash" TEXT NOT NULL/);
    expect(PORTAL_SQL).toMatch(
      /ALTER TABLE "portal_credential" ADD CONSTRAINT "portal_credential_portal_access_id_fkey"\s+FOREIGN KEY \("portal_access_id"\) REFERENCES "customer_portal_access"\("id"\)\s+ON DELETE RESTRICT/
    );
  });

  it("pins portal sessions to a unique token hash with TTLs and a CASCADE parent", () => {
    expect(PORTAL_SQL).toMatch(/CREATE UNIQUE INDEX "portal_session_token_hash_key"/);
    expect(PORTAL_SQL).toMatch(/"last_seen_at" TIMESTAMPTZ\(3\) NOT NULL/);
    expect(PORTAL_SQL).toMatch(/"idle_expires_at" TIMESTAMPTZ\(3\) NOT NULL/);
    expect(PORTAL_SQL).toMatch(/"absolute_expires_at" TIMESTAMPTZ\(3\) NOT NULL/);
    expect(PORTAL_SQL).toMatch(/"revoked_at" TIMESTAMPTZ\(3\),/);
    expect(PORTAL_SQL).toMatch(
      /ALTER TABLE "portal_session" ADD CONSTRAINT "portal_session_portal_access_id_fkey"\s+FOREIGN KEY \("portal_access_id"\) REFERENCES "customer_portal_access"\("id"\)\s+ON DELETE CASCADE/
    );
  });

  it("persists pending booking requests with a valid ordered UTC range", () => {
    expect(PORTAL_SQL).toMatch(
      /"status" "portal_booking_request_status" NOT NULL DEFAULT 'PENDING'/
    );
    expect(PORTAL_SQL).toMatch(/"start_at" TIMESTAMPTZ\(3\) NOT NULL/);
    expect(PORTAL_SQL).toMatch(/"end_at" TIMESTAMPTZ\(3\) NOT NULL/);
    expect(PORTAL_SQL).toMatch(
      /CONSTRAINT "portal_booking_request_time_range_check" CHECK \("end_at" > "start_at"\)/
    );
  });

  it("uses RESTRICT composite tenant-ownership FKs for the request anchors", () => {
    expect(PORTAL_SQL).toMatch(
      /ALTER TABLE "portal_booking_request" ADD CONSTRAINT "portal_booking_request_tenant_id_fkey"\s+FOREIGN KEY \("tenant_id"\) REFERENCES "tenant"\("id"\)\s+ON DELETE RESTRICT/
    );
    expect(PORTAL_SQL).toMatch(
      /ADD CONSTRAINT "portal_booking_request_tenant_id_customer_id_fkey"\s+FOREIGN KEY \("tenant_id", "customer_id"\) REFERENCES "customer"\("tenant_id", "id"\)\s+ON DELETE RESTRICT/
    );
    expect(PORTAL_SQL).toMatch(
      /ADD CONSTRAINT "portal_booking_request_tenant_id_patient_id_fkey"\s+FOREIGN KEY \("tenant_id", "patient_id"\) REFERENCES "patient"\("tenant_id", "id"\)\s+ON DELETE RESTRICT/
    );
  });

  it("adds appointment provenance with a STAFF default and a nullable unique request link", () => {
    expect(PORTAL_SQL).toMatch(
      /ALTER TABLE "appointment" ADD COLUMN "source" "appointment_source" NOT NULL DEFAULT 'STAFF'/
    );
    expect(PORTAL_SQL).toMatch(
      /ALTER TABLE "appointment" ADD COLUMN "portal_booking_request_id" UUID;/
    );
    expect(PORTAL_SQL).toMatch(
      /ADD CONSTRAINT "appointment_tenant_id_portal_booking_request_id_fkey"\s+FOREIGN KEY \("tenant_id", "portal_booking_request_id"\)\s+REFERENCES "portal_booking_request"\("tenant_id", "id"\)\s+ON DELETE RESTRICT/
    );
    expect(PORTAL_SQL).toMatch(
      /CREATE UNIQUE INDEX "appointment_tenant_id_portal_booking_request_id_key"\s+ON "appointment"\("tenant_id", "portal_booking_request_id"\)/
    );
  });

  it("declares the booking-request tenant-ownership key before the appointment provenance FK", () => {
    const requestKey = PORTAL_SQL.indexOf(
      'CREATE UNIQUE INDEX "portal_booking_request_tenant_id_id_key"'
    );
    const provenanceFk = PORTAL_SQL.indexOf(
      '"appointment_tenant_id_portal_booking_request_id_fkey"'
    );

    expect(requestKey).toBeGreaterThan(-1);
    expect(provenanceFk).toBeGreaterThan(-1);
    expect(requestKey).toBeLessThan(provenanceFk);
  });

  it("attaches the portal actor to the append-only audit trail with a RESTRICT FK", () => {
    expect(PORTAL_SQL).toMatch(/ALTER TABLE "audit_log" ADD COLUMN "actor_portal_access_id" UUID;/);
    expect(PORTAL_SQL).toMatch(
      /ADD CONSTRAINT "audit_log_actor_portal_access_id_fkey"\s+FOREIGN KEY \("actor_portal_access_id"\) REFERENCES "customer_portal_access"\("id"\)\s+ON DELETE RESTRICT/
    );
  });
});

describe("schema · portal inventory (EPIC-08 WU1)", () => {
  it("declares the portal models and provenance enums", () => {
    expect(SCHEMA).toMatch(/model CustomerPortalAccess\b/);
    expect(SCHEMA).toMatch(/model PortalCredential\b/);
    expect(SCHEMA).toMatch(/model PortalSession\b/);
    expect(SCHEMA).toMatch(/model PortalBookingRequest\b/);
    expect(SCHEMA).toMatch(/enum AppointmentSource\b/);
    expect(SCHEMA).toMatch(/enum PortalBookingRequestStatus\b/);
  });

  it("links the access row to its Customer with a composite tenant-ownership relation", () => {
    const block = modelBlock("CustomerPortalAccess");
    expect(block).toMatch(/customerId\s+String\s+@map\("customer_id"\)/);
    expect(block).toMatch(
      /customer\s+Customer\s+@relation\(fields: \[tenantId, customerId\], references: \[tenantId, id\]/
    );
    expect(block).toMatch(/@@index\(\[customerId\]\)/);
    expect(block).toMatch(/sessions\s+PortalSession\[\]/);
  });

  it("shares the credential primary key with its access row (join-free reads)", () => {
    const block = modelBlock("PortalCredential");
    expect(block).toMatch(/portalAccessId\s+String\s+@id\s+@map\("portal_access_id"\)\s+@db.Uuid/);
    expect(block).toMatch(/passwordHash\s+String\s+@map\("password_hash"\)/);
  });

  it("pins the session token hash unique and cascades with its access row", () => {
    const block = modelBlock("PortalSession");
    expect(block).toMatch(/tokenHash\s+String\s+@unique\s+@map\("token_hash"\)/);
    expect(block).toMatch(/idleExpiresAt\s+DateTime\s+@map\("idle_expires_at"\)/);
    expect(block).toMatch(/absoluteExpiresAt\s+DateTime\s+@map\("absolute_expires_at"\)/);
    expect(block).toMatch(/revokedAt\s+DateTime\?\s+@map\("revoked_at"\)/);
    expect(block).toMatch(
      /portalAccess\s+CustomerPortalAccess\s+@relation\(fields: \[portalAccessId\], references: \[id\], onDelete: Cascade/
    );
  });

  it("models pending booking requests with default PENDING and tenant-ownership keys", () => {
    const block = modelBlock("PortalBookingRequest");
    expect(block).toMatch(/status\s+PortalBookingRequestStatus\s+@default\(PENDING\)/);
    expect(block).toMatch(
      /customer\s+Customer\s+@relation\(fields: \[tenantId, customerId\], references: \[tenantId, id\]/
    );
    expect(block).toMatch(
      /patient\s+Patient\s+@relation\(fields: \[tenantId, patientId\], references: \[tenantId, id\]/
    );
    expect(block).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(block).toMatch(/@@index\(\[tenantId, status\]\)/);
  });

  it("records appointment provenance with a STAFF default and nullable unique link", () => {
    const block = modelBlock("Appointment");
    expect(block).toMatch(/source\s+AppointmentSource\s+@default\(STAFF\)/);
    expect(block).toMatch(
      /portalBookingRequestId\s+String\?\s+@map\("portal_booking_request_id"\)/
    );
    expect(block).toMatch(
      /portalBookingRequest\s+PortalBookingRequest\?\s+@relation\(fields: \[tenantId, portalBookingRequestId\], references: \[tenantId, id\]/
    );
    expect(block).toMatch(/@@unique\(\[tenantId, portalBookingRequestId\]\)/);
  });

  it("exposes the Customer tenant-ownership key the composite portal FKs target", () => {
    expect(modelBlock("Customer")).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(modelBlock("Customer")).toMatch(/portalAccess\s+CustomerPortalAccess\[\]/);
    expect(modelBlock("Patient")).toMatch(/portalBookingRequests\s+PortalBookingRequest\[\]/);
    expect(modelBlock("Tenant")).toMatch(/portalBookingRequests\s+PortalBookingRequest\[\]/);
  });

  it("adds PORTAL to the audit actor taxonomy with portal actor attribution", () => {
    expect(SCHEMA).toMatch(/enum AuditActorType \{[\s\S]*?PORTAL[\s\S]*?\}/);
    const block = modelBlock("AuditLog");
    expect(block).toMatch(/actorPortalAccessId\s+String\?\s+@map\("actor_portal_access_id"\)/);
    expect(block).toMatch(
      /actorPortalAccess\s+CustomerPortalAccess\?\s+@relation\(fields: \[actorPortalAccessId\], references: \[id\]/
    );
  });
});
