import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";
import {
  PERMISSION_KEY_PATTERN,
  PERMISSION_SEEDS,
  ROLE_PERMISSION_MATRIX,
} from "./reference-seed.js";
import {
  DEMO_PATIENT_DOG_ID,
  DEMO_SCHEDULING_APPOINTMENT_ID,
  DEMO_SCHEDULING_BRANCH_ID,
  DEMO_SCHEDULING_VET_MEMBERSHIP_ID,
  DEMO_VETERINARIAN_ROLE_CODE,
  seedDemoScheduling,
  type DemoSchedulingSeedClient,
  type DemoSchedulingSeedTxClient,
} from "./demo-seed.js";

/**
 * Scheduling data foundation (EPIC-07 WU1).
 *
 * These checks parse the applied migration SQL, the schema document and the
 * seed-owned catalogs, so a live database is not required: CI applies these
 * exact files, so textual assertions on the DDL are faithful to real state.
 * The demo path is driven through a recording fake by delegate contract.
 */

const SCHEMA = loadPrismaSchema();
const MIGRATIONS = loadMigrations();
const SCHEDULING_SQL = findMigration(MIGRATIONS, "_scheduling").sql;

function modelBlock(model: string): string {
  const start = SCHEMA.indexOf(`model ${model} `);
  expect(start, `model ${model} must exist`).toBeGreaterThan(-1);
  return SCHEMA.slice(start, SCHEMA.indexOf("}", start));
}

describe("migration · scheduling (EPIC-07 WU1)", () => {
  it("creates the appointment table and its seven-state lifecycle enum", () => {
    expect(SCHEDULING_SQL).toMatch(/CREATE TABLE "appointment"/);
    expect(SCHEDULING_SQL).toMatch(
      /CREATE TYPE "appointment_status" AS ENUM \(\s*'SCHEDULED',\s*'CONFIRMED',\s*'ARRIVED',\s*'IN_PROGRESS',\s*'COMPLETED',\s*'CANCELLED',\s*'NO_SHOW'\s*\)/
    );
    expect(SCHEDULING_SQL).toMatch(/"status" "appointment_status" NOT NULL DEFAULT 'SCHEDULED'/);
  });

  it("persists an initial version on every appointment", () => {
    expect(SCHEDULING_SQL).toMatch(/"version" INTEGER NOT NULL DEFAULT 1/);
  });

  it("persists start/end as UTC TIMESTAMPTZ(3) with a strict ordering CHECK", () => {
    expect(SCHEDULING_SQL).toMatch(/"start_at" TIMESTAMPTZ\(3\) NOT NULL/);
    expect(SCHEDULING_SQL).toMatch(/"end_at" TIMESTAMPTZ\(3\) NOT NULL/);
    expect(SCHEDULING_SQL).toMatch(
      /CONSTRAINT "appointment_time_range_check" CHECK \("end_at" > "start_at"\)/
    );
  });

  it("declares the branch and membership tenant-ownership keys before the composite FKs", () => {
    const branchKey = SCHEDULING_SQL.indexOf(
      'CREATE UNIQUE INDEX "branch_tenant_id_id_key" ON "branch"("tenant_id", "id")'
    );
    const membershipKey = SCHEDULING_SQL.indexOf(
      'CREATE UNIQUE INDEX "tenant_membership_tenant_id_id_key"'
    );
    const firstCompositeFk = SCHEDULING_SQL.indexOf('"appointment_tenant_id_branch_id_fkey"');

    expect(branchKey).toBeGreaterThan(-1);
    expect(membershipKey).toBeGreaterThan(-1);
    expect(firstCompositeFk).toBeGreaterThan(-1);
    expect(branchKey).toBeLessThan(firstCompositeFk);
    expect(membershipKey).toBeLessThan(firstCompositeFk);
  });

  it("uses RESTRICT FKs to tenant and to every composite tenant-ownership key", () => {
    expect(SCHEDULING_SQL).toMatch(
      /ALTER TABLE "appointment" ADD CONSTRAINT "appointment_tenant_id_fkey"\s+FOREIGN KEY \("tenant_id"\) REFERENCES "tenant"\("id"\)\s+ON DELETE RESTRICT/
    );
    expect(SCHEDULING_SQL).toMatch(
      /ALTER TABLE "appointment" ADD CONSTRAINT "appointment_tenant_id_branch_id_fkey"\s+FOREIGN KEY \("tenant_id", "branch_id"\) REFERENCES "branch"\("tenant_id", "id"\)\s+ON DELETE RESTRICT/
    );
    expect(SCHEDULING_SQL).toMatch(
      /ALTER TABLE "appointment" ADD CONSTRAINT "appointment_tenant_id_patient_id_fkey"\s+FOREIGN KEY \("tenant_id", "patient_id"\) REFERENCES "patient"\("tenant_id", "id"\)\s+ON DELETE RESTRICT/
    );
    expect(SCHEDULING_SQL).toMatch(
      /ALTER TABLE "appointment" ADD CONSTRAINT "appointment_tenant_id_professional_membership_id_fkey"\s+FOREIGN KEY \("tenant_id", "professional_membership_id"\) REFERENCES "tenant_membership"\("tenant_id", "id"\)\s+ON DELETE RESTRICT/
    );
  });

  it("indexes tenant/branch, tenant/professional, tenant/patient and tenant/status", () => {
    expect(SCHEDULING_SQL).toMatch(
      /CREATE INDEX "appointment_tenant_id_branch_id_idx"\s+ON "appointment"\("tenant_id", "branch_id"\)/
    );
    expect(SCHEDULING_SQL).toMatch(
      /CREATE INDEX "appointment_tenant_id_professional_membership_id_idx"\s+ON "appointment"\("tenant_id", "professional_membership_id"\)/
    );
    expect(SCHEDULING_SQL).toMatch(
      /CREATE INDEX "appointment_tenant_id_patient_id_idx"\s+ON "appointment"\("tenant_id", "patient_id"\)/
    );
    expect(SCHEDULING_SQL).toMatch(
      /CREATE INDEX "appointment_tenant_id_status_idx"\s+ON "appointment"\("tenant_id", "status"\)/
    );
  });

  it("rejects any appointment DELETE (schedule history is never destroyed)", () => {
    expect(SCHEDULING_SQL).toMatch(/CREATE OR REPLACE FUNCTION "appointment_no_delete"\(\)/);
    expect(SCHEDULING_SQL).toMatch(/TG_OP = 'DELETE'|BEFORE DELETE ON "appointment"/);
    expect(SCHEDULING_SQL).toMatch(
      /CREATE TRIGGER "appointment_no_delete_trigger"\s+BEFORE DELETE ON "appointment"\s+FOR EACH ROW EXECUTE FUNCTION "appointment_no_delete"\(\)/
    );
    expect(SCHEDULING_SQL).toMatch(/ERRCODE = 'restrict_violation'/);
  });
});

describe("schema · appointment inventory (EPIC-07 WU1)", () => {
  it("declares the Appointment model and AppointmentStatus enum", () => {
    expect(SCHEMA).toMatch(/model Appointment\b/);
    expect(SCHEMA).toMatch(/enum AppointmentStatus\b/);
  });

  it("scopes tenant, branch, patient and professional membership on every appointment", () => {
    const block = modelBlock("Appointment");
    expect(block).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)/);
    expect(block).toMatch(/branchId\s+String\s+@map\("branch_id"\)/);
    expect(block).toMatch(/patientId\s+String\s+@map\("patient_id"\)/);
    expect(block).toMatch(
      /professionalMembershipId\s+String\s+@map\("professional_membership_id"\)/
    );
    expect(block).toMatch(/status\s+AppointmentStatus\s+@default\(SCHEDULED\)/);
    expect(block).toMatch(/version\s+Int\s+@default\(1\)/);
  });

  it("uses composite tenant-ownership relations for branch, patient and membership", () => {
    const block = modelBlock("Appointment");
    expect(block).toMatch(
      /branch\s+Branch\s+@relation\(fields: \[tenantId, branchId\], references: \[tenantId, id\]/
    );
    expect(block).toMatch(
      /patient\s+Patient\s+@relation\(fields: \[tenantId, patientId\], references: \[tenantId, id\]/
    );
    expect(block).toMatch(
      /professionalMembership\s+TenantMembership\s+@relation\(fields: \[tenantId, professionalMembershipId\], references: \[tenantId, id\]/
    );
    expect(block).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(block).toMatch(/@@index\(\[tenantId, branchId\]\)/);
    expect(block).toMatch(/@@index\(\[tenantId, professionalMembershipId\]\)/);
    expect(block).toMatch(/@@index\(\[tenantId, status\]\)/);
  });

  it("exposes tenant-ownership keys on Branch and TenantMembership", () => {
    expect(modelBlock("Branch")).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(modelBlock("TenantMembership")).toMatch(/@@unique\(\[tenantId, id\]\)/);
  });
});

describe("reference seed · scheduling role matrix (EPIC-07 WU1)", () => {
  const schedulingKeys = [
    "scheduling.appointment.read",
    "scheduling.appointment.manage",
    "scheduling.appointment.transition",
    "scheduling.settings.manage",
  ] as const;

  it("seeds the granular scheduling permission catalog keys", () => {
    const catalogKeys = PERMISSION_SEEDS.map((permission) => permission.key);
    for (const key of schedulingKeys) {
      expect(catalogKeys).toContain(key);
      expect(key).toMatch(PERMISSION_KEY_PATTERN);
    }
  });

  it("grants the full scheduling set to OWNER and ADMIN only", () => {
    for (const roleCode of ["OWNER", "ADMIN"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toEqual(expect.arrayContaining([...schedulingKeys]));
    }
    for (const roleCode of [
      "VETERINARIAN",
      "RECEPTIONIST",
      "CASHIER",
      "INVENTORY_MANAGER",
    ] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain("scheduling.settings.manage");
    }
  });

  it("grants read/manage/transition to front-desk and read/transition to veterinarians", () => {
    expect(ROLE_PERMISSION_MATRIX.RECEPTIONIST).toEqual(
      expect.arrayContaining([
        "scheduling.appointment.read",
        "scheduling.appointment.manage",
        "scheduling.appointment.transition",
      ])
    );
    expect(ROLE_PERMISSION_MATRIX.VETERINARIAN).toEqual(
      expect.arrayContaining(["scheduling.appointment.read", "scheduling.appointment.transition"])
    );
    expect(ROLE_PERMISSION_MATRIX.VETERINARIAN).not.toContain("scheduling.appointment.manage");
  });

  it("withholds scheduling authority from cash and inventory roles", () => {
    for (const roleCode of ["CASHIER", "INVENTORY_MANAGER"] as const) {
      for (const key of schedulingKeys) {
        expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain(key);
      }
    }
  });
});

type AppointmentRow = Parameters<
  DemoSchedulingSeedTxClient["appointment"]["createMany"]
>[0]["data"][number];

/**
 * Structural fake mirroring the scheduling seed delegates, including Prisma's
 * interactive `$transaction`. Writes are recorded with their transaction scope
 * so the test can prove the branch, membership and appointment are
 * co-transactional.
 */
function makeFakeSchedulingDb(): {
  db: DemoSchedulingSeedClient;
  tables: {
    roles: Map<string, { id: string; code: string }>;
    patients: Map<string, { id: string; tenantId: string }>;
    branches: Map<string, { id: string; tenantId: string; name: string }>;
    profiles: Map<string, { id: string; email: string }>;
    memberships: Map<
      string,
      { id: string; tenantId: string; userProfileId: string; roleId: string; status: string }
    >;
    appointments: Map<string, AppointmentRow>;
    transactionCount: number;
    writesOutsideTransaction: number;
  };
} {
  const roles = new Map<string, { id: string; code: string }>([
    ["role-vet", { id: "role-vet", code: DEMO_VETERINARIAN_ROLE_CODE }],
  ]);
  const patients = new Map<string, { id: string; tenantId: string }>([
    [DEMO_PATIENT_DOG_ID, { id: DEMO_PATIENT_DOG_ID, tenantId: "tenant-demo" }],
  ]);
  const branches = new Map<string, { id: string; tenantId: string; name: string }>();
  const profiles = new Map<string, { id: string; email: string }>();
  const memberships = new Map<
    string,
    { id: string; tenantId: string; userProfileId: string; roleId: string; status: string }
  >();
  const appointments = new Map<string, AppointmentRow>();
  const tables = {
    roles,
    patients,
    branches,
    profiles,
    memberships,
    appointments,
    transactionCount: 0,
    writesOutsideTransaction: 0,
  };
  let inTransaction = false;

  function recordWrite(): void {
    if (!inTransaction) tables.writesOutsideTransaction += 1;
  }

  /**
   * Mirrors Prisma `createMany` primary-key semantics: with `skipDuplicates`
   * the existing rows are dropped and only the inserted count is returned;
   * without it a duplicate id is a rejected unique-constraint violation.
   * Overwriting the Map unconditionally (the previous fake) could never fail,
   * so the idempotency assertion was vacuous; this makes a missing
   * `skipDuplicates` a hard error that rejects like the real delegate.
   */
  function applyCreateMany<Row extends { id: string }>(
    data: Row[],
    has: (id: string) => boolean,
    skipDuplicates: boolean | undefined,
    write: (rows: Row[]) => void
  ): Promise<{ count: number }> {
    const inserts: Row[] = [];
    for (const row of data) {
      if (has(row.id)) {
        if (skipDuplicates) continue;
        return Promise.reject(
          new Error(
            `Unique constraint failed on the fields: (\`id\`) — duplicate primary key ${row.id}`
          )
        );
      }
      inserts.push(row);
    }
    write(inserts);
    return Promise.resolve({ count: inserts.length });
  }

  const txClient: DemoSchedulingSeedTxClient = {
    branch: {
      createMany: ({ data, skipDuplicates }) => {
        recordWrite();
        return applyCreateMany(
          data,
          (id) => branches.has(id),
          skipDuplicates,
          (rows) => {
            for (const row of rows) branches.set(row.id, row);
          }
        );
      },
    },
    userProfile: {
      createMany: ({ data, skipDuplicates }) => {
        recordWrite();
        return applyCreateMany(
          data,
          (id) => profiles.has(id),
          skipDuplicates,
          (rows) => {
            for (const row of rows) profiles.set(row.id, { id: row.id, email: row.email });
          }
        );
      },
    },
    tenantMembership: {
      createMany: ({ data, skipDuplicates }) => {
        recordWrite();
        return applyCreateMany(
          data,
          (id) => memberships.has(id),
          skipDuplicates,
          (rows) => {
            for (const row of rows) memberships.set(row.id, row);
          }
        );
      },
    },
    appointment: {
      createMany: ({ data, skipDuplicates }) => {
        recordWrite();
        return applyCreateMany(
          data,
          (id) => appointments.has(id),
          skipDuplicates,
          (rows) => {
            for (const row of rows) appointments.set(row.id, row);
          }
        );
      },
    },
  };

  const db: DemoSchedulingSeedClient = {
    role: {
      findUnique: ({ where }: { where: { code: string } }) =>
        Promise.resolve([...roles.values()].find((row) => row.code === where.code) ?? null),
    },
    patient: {
      findFirst: ({ where }: { where: { id: string; tenantId: string } }) => {
        const row = patients.get(where.id);
        return Promise.resolve(row?.tenantId === where.tenantId ? { id: row.id } : null);
      },
    },
    ...txClient,
    $transaction: async <T>(fn: (tx: DemoSchedulingSeedTxClient) => Promise<T>): Promise<T> => {
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

describe("seedDemoScheduling (EPIC-07 WU1)", () => {
  it("seeds one branch, one VETERINARIAN membership and one SCHEDULED appointment", async () => {
    const { db, tables } = makeFakeSchedulingDb();

    const result = await seedDemoScheduling(db, "tenant-demo");

    expect(result.branches).toBe(1);
    expect(result.memberships).toBe(1);
    expect(result.appointments).toBe(1);

    const membership = [...tables.memberships.values()][0];
    expect(membership.tenantId).toBe("tenant-demo");
    expect(membership.roleId).toBe("role-vet");
    expect(membership.status).toBe("ACTIVE");

    const appointment = [...tables.appointments.values()][0];
    expect(appointment.id).toBe(DEMO_SCHEDULING_APPOINTMENT_ID);
    expect(appointment.tenantId).toBe("tenant-demo");
    expect(appointment.patientId).toBe(DEMO_PATIENT_DOG_ID);
    expect(appointment.professionalMembershipId).toBe(DEMO_SCHEDULING_VET_MEMBERSHIP_ID);
    expect(appointment.status).toBe("SCHEDULED");
    expect(appointment.endAt.getTime()).toBeGreaterThan(appointment.startAt.getTime());
  });

  it("writes every scheduling fixture inside one transaction", async () => {
    const { db, tables } = makeFakeSchedulingDb();

    await seedDemoScheduling(db, "tenant-demo");

    expect(tables.transactionCount).toBe(1);
    expect(tables.writesOutsideTransaction).toBe(0);
  });

  it("converges on rerun: fixed ids keep the collections stable", async () => {
    const { db, tables } = makeFakeSchedulingDb();

    await seedDemoScheduling(db, "tenant-demo");
    await seedDemoScheduling(db, "tenant-demo");

    expect(tables.branches.size).toBe(1);
    expect(tables.memberships.size).toBe(1);
    expect(tables.appointments.size).toBe(1);
  });

  it("honors skipDuplicates on rerun: the second run inserts zero rows", async () => {
    const { db } = makeFakeSchedulingDb();

    const first = await seedDemoScheduling(db, "tenant-demo");
    const second = await seedDemoScheduling(db, "tenant-demo");

    expect(first).toEqual({ branches: 1, memberships: 1, appointments: 1 });
    // The fake now raises a unique-constraint error when `skipDuplicates` is
    // absent, so reaching this assertion proves every seed delegate passed it.
    expect(second).toEqual({ branches: 0, memberships: 0, appointments: 0 });
  });

  it("would fail the rerun if a delegate dropped skipDuplicates", async () => {
    const { db } = makeFakeSchedulingDb();

    await seedDemoScheduling(db, "tenant-demo");

    // Directly exercise the same delegate contract the seed uses: a duplicate
    // primary key without skipDuplicates must throw, proving the fake is
    // sensitive to the option the seed relies on.
    await db.$transaction(async (tx) => {
      await expect(
        tx.branch.createMany({
          data: [
            { id: DEMO_SCHEDULING_BRANCH_ID, tenantId: "tenant-demo", name: "Duplicate Branch" },
          ],
        })
      ).rejects.toThrow(/Unique constraint failed/);
      await expect(
        tx.branch.createMany({
          data: [
            { id: DEMO_SCHEDULING_BRANCH_ID, tenantId: "tenant-demo", name: "Duplicate Branch" },
          ],
          skipDuplicates: true,
        })
      ).resolves.toEqual({ count: 0 });
    });
  });

  it("fails instructively when the reference seed has not run (VETERINARIAN role missing)", async () => {
    const { db, tables } = makeFakeSchedulingDb();
    tables.roles.clear();

    await expect(seedDemoScheduling(db, "tenant-demo")).rejects.toThrow(
      /role VETERINARIAN missing/
    );
    expect(tables.branches.size).toBe(0);
    expect(tables.appointments.size).toBe(0);
  });

  it("fails instructively when the demo patient has not been seeded", async () => {
    const { db, tables } = makeFakeSchedulingDb();
    tables.patients.clear();

    await expect(seedDemoScheduling(db, "tenant-demo")).rejects.toThrow(/demo patient missing/);
    expect(tables.branches.size).toBe(0);
    expect(tables.appointments.size).toBe(0);
  });
});
