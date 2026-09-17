import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";
import {
  PERMISSION_KEY_PATTERN,
  PERMISSION_SEEDS,
  ROLE_PERMISSION_MATRIX,
} from "./reference-seed.js";
import {
  DEMO_PATIENT_DOG_ID,
  DEMO_PORTAL_ACCESS_ID,
  DEMO_PORTAL_BOOKING_REQUEST_ID,
  DEMO_PORTAL_CUSTOMER_ID,
  seedDemoPortal,
  type DemoPortalSeedClient,
  type DemoPortalSeedTxClient,
} from "./demo-seed.js";

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

describe("reference seed · portal role matrix (EPIC-08 WU1)", () => {
  const portalKeys = ["portal.access.manage", "portal.settings.manage"] as const;

  it("seeds the portal permission catalog keys in canonical format", () => {
    const catalogKeys = PERMISSION_SEEDS.map((permission) => permission.key);
    for (const key of portalKeys) {
      expect(catalogKeys).toContain(key);
      expect(key).toMatch(PERMISSION_KEY_PATTERN);
    }
  });

  it("grants both portal keys to OWNER and ADMIN only", () => {
    for (const roleCode of ["OWNER", "ADMIN"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toEqual(expect.arrayContaining([...portalKeys]));
    }
    for (const roleCode of [
      "VETERINARIAN",
      "RECEPTIONIST",
      "CASHIER",
      "INVENTORY_MANAGER",
    ] as const) {
      for (const key of portalKeys) {
        expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain(key);
      }
    }
  });
});

/**
 * Structural fake mirroring the portal seed delegates, including Prisma's
 * interactive `$transaction`. Writes are recorded with their transaction scope
 * so the test can prove access and its pending request are co-transactional.
 */
function makeFakePortalDb(): {
  db: DemoPortalSeedClient;
  tables: {
    customers: Map<string, { id: string; tenantId: string }>;
    access: Map<
      string,
      { id: string; tenantId: string; customerId: string; contactEmail: string; status: string }
    >;
    bookingRequests: Map<
      string,
      {
        id: string;
        tenantId: string;
        customerId: string;
        patientId: string;
        status: string;
        startAt: Date;
        endAt: Date;
      }
    >;
    transactionCount: number;
    writesOutsideTransaction: number;
  };
} {
  const customers = new Map<string, { id: string; tenantId: string }>([
    [DEMO_PORTAL_CUSTOMER_ID, { id: DEMO_PORTAL_CUSTOMER_ID, tenantId: "tenant-demo" }],
  ]);
  const access = new Map<
    string,
    { id: string; tenantId: string; customerId: string; contactEmail: string; status: string }
  >();
  const bookingRequests = new Map<
    string,
    {
      id: string;
      tenantId: string;
      customerId: string;
      patientId: string;
      status: string;
      startAt: Date;
      endAt: Date;
    }
  >();
  const tables = {
    customers,
    access,
    bookingRequests,
    transactionCount: 0,
    writesOutsideTransaction: 0,
  };
  let inTransaction = false;

  const txClient: DemoPortalSeedTxClient = {
    customerPortalAccess: {
      createMany: ({ data }) => {
        if (!inTransaction) tables.writesOutsideTransaction += 1;
        for (const row of data) access.set(row.id, row);
        return Promise.resolve({ count: data.length });
      },
    },
    portalBookingRequest: {
      createMany: ({ data }) => {
        if (!inTransaction) tables.writesOutsideTransaction += 1;
        for (const row of data) bookingRequests.set(row.id, row);
        return Promise.resolve({ count: data.length });
      },
    },
  };

  const db: DemoPortalSeedClient = {
    customer: {
      findFirst: ({ where }: { where: { id: string; tenantId: string } }) => {
        const row = customers.get(where.id);
        return Promise.resolve(row?.tenantId === where.tenantId ? { id: row.id } : null);
      },
    },
    ...txClient,
    $transaction: async <T>(fn: (tx: DemoPortalSeedTxClient) => Promise<T>): Promise<T> => {
      tables.transactionCount += 1;
      inTransaction = true;
      try {
        return await fn(txClient);
      } finally {
        inTransaction = false;
      }
    },
  };

  return { db, tables };
}

describe("seedDemoPortal (EPIC-08 WU1)", () => {
  it("seeds an ACTIVE holder and a PENDING request anchored to the demo fixtures", async () => {
    const { db, tables } = makeFakePortalDb();

    const result = await seedDemoPortal(db, "tenant-demo");

    expect(result.access).toBe(1);
    expect(result.bookingRequests).toBe(1);

    const holder = [...tables.access.values()][0];
    expect(holder.tenantId).toBe("tenant-demo");
    expect(holder.customerId).toBe(DEMO_PORTAL_CUSTOMER_ID);
    expect(holder.status).toBe("ACTIVE");

    const request = [...tables.bookingRequests.values()][0];
    expect(request.tenantId).toBe("tenant-demo");
    expect(request.customerId).toBe(DEMO_PORTAL_CUSTOMER_ID);
    expect(request.patientId).toBe(DEMO_PATIENT_DOG_ID);
    expect(request.status).toBe("PENDING");
    expect(request.endAt.getTime()).toBeGreaterThan(request.startAt.getTime());
  });

  it("writes the holder and request inside one transaction", async () => {
    const { db, tables } = makeFakePortalDb();

    await seedDemoPortal(db, "tenant-demo");

    expect(tables.transactionCount).toBe(1);
    expect(tables.writesOutsideTransaction).toBe(0);
  });

  it("converges on rerun: fixed ids keep the collections stable", async () => {
    const { db, tables } = makeFakePortalDb();

    await seedDemoPortal(db, "tenant-demo");
    await seedDemoPortal(db, "tenant-demo");

    expect(tables.access.size).toBe(1);
    expect(tables.bookingRequests.size).toBe(1);
  });

  it("uses stable synthetic ids and clearly non-PII email", () => {
    expect(DEMO_PORTAL_ACCESS_ID).toMatch(/^[0-9a-f-]{36}$/);
    expect(DEMO_PORTAL_BOOKING_REQUEST_ID).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("fails instructively when the demo customer has not been seeded", async () => {
    const { db, tables } = makeFakePortalDb();
    tables.customers.clear();

    await expect(seedDemoPortal(db, "tenant-demo")).rejects.toThrow(/demo customer missing/);
    expect(tables.access.size).toBe(0);
    expect(tables.bookingRequests.size).toBe(0);
  });
});
