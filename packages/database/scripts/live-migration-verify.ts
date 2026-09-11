import { randomUUID } from "node:crypto";
import { PrismaClient } from "../src/generated/index.js";

/**
 * Live PostgreSQL verification for the EPIC-03 Phase B + EPIC-04 + EPIC-05
 * migrations.
 *
 * Run against a freshly `prisma migrate deploy`-ed database to prove:
 * - all expected tables and columns exist;
 * - tenant isolation holds at the persistence boundary for Customer/Address/Contact;
 * - PatientGuardian is activated with BOTH patient_id and customer_id FKs;
 * - the global Species/Breed taxonomy is not tenant-scoped;
 * - audit_log captures tenant-scoped customer mutations;
 * - BOTH deferred constraint triggers enforce exactly-one active primary
 *   guardian across guardian writes AND active Patient INSERT/UPDATE, including
 *   two-sided validation when a guardian UPDATE reparents it to another Patient.
 */

async function expectRejected(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  rejected (expected): ${label} → ${message.split("\n")[0]}`);
    return;
  }
  throw new Error(`Expected rejection but the write committed: ${label}`);
}

async function expectCommitted(label: string, run: () => Promise<unknown>): Promise<void> {
  await run();
  console.log(`  committed (expected): ${label}`);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    // Verify expected tables exist by querying them.
    const tableNames = (
      await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
      )
    ).map((row) => row.tablename);

    const requiredTables = [
      "tenant_branding",
      "customer",
      "customer_address",
      "customer_contact",
      "species",
      "breed",
      "patient",
      "patient_guardian",
      "audit_log",
    ];
    for (const table of requiredTables) {
      if (!tableNames.includes(table)) {
        throw new Error(`Missing required table: ${table}`);
      }
    }

    // Verify PatientGuardian is activated: BOTH patient_id and customer_id FKs.
    const guardianForeignKeys = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'patient_guardian'
        AND tc.table_schema = 'public'
      `
    );
    const guardianFkColumns = guardianForeignKeys.map((row) => row.column_name);
    if (!guardianFkColumns.includes("patient_id")) {
      throw new Error("patient_guardian must have a patient_id FK (EPIC-05 activation)");
    }
    if (!guardianFkColumns.includes("customer_id")) {
      throw new Error("patient_guardian must have a customer_id FK");
    }

    // Verify the global taxonomy is not tenant-scoped and the partial primary
    // index exists (Decisions #2210/#2211).
    const speciesColumns = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('species', 'breed')
      `
    );
    if (speciesColumns.some((row) => row.column_name === "tenant_id")) {
      throw new Error("species/breed must be global: no tenant_id column");
    }

    const primaryIndexes = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'patient_guardian'
        AND indexname = 'patient_guardian_primary_active_key'
      `
    );
    if (primaryIndexes.length !== 1) {
      throw new Error("patient_guardian_primary_active_key partial index is missing");
    }

    // Seed two tenants and a customer in tenant A.
    const tenantA = await prisma.tenant.create({ data: { slug: "live-a", name: "Tenant A" } });
    const tenantB = await prisma.tenant.create({ data: { slug: "live-b", name: "Tenant B" } });

    const customerA = await prisma.customer.create({
      data: {
        tenantId: tenantA.id,
        kind: "INDIVIDUAL",
        displayName: "Live Customer A",
        firstName: "Live",
        lastName: "Customer",
      },
    });

    const addressA = await prisma.customerAddress.create({
      data: {
        tenantId: tenantA.id,
        customerId: customerA.id,
        line1: "Live Address",
      },
    });

    const contactA = await prisma.customerContact.create({
      data: {
        tenantId: tenantA.id,
        customerId: customerA.id,
        kind: "EMAIL",
        value: "live@example.test",
      },
    });

    // Tenant-scoped queries return only A's rows.
    const aCustomers = await prisma.customer.findMany({ where: { tenantId: tenantA.id } });
    if (aCustomers.length !== 1 || aCustomers[0].id !== customerA.id) {
      throw new Error("Tenant A customer scope failed");
    }

    const bCustomers = await prisma.customer.findMany({ where: { tenantId: tenantB.id } });
    if (bCustomers.length !== 0) {
      throw new Error("Tenant B must see zero customers");
    }

    // Direct UUID read without tenant filter still returns the row; the
    // application layer is responsible for masking foreign tenant IDs as 404.
    // Here we prove the row exists and is tagged with tenant A.
    const directCustomer = await prisma.customer.findUnique({ where: { id: customerA.id } });
    if (directCustomer?.tenantId !== tenantA.id) {
      throw new Error("Customer tenant tag mismatch");
    }

    // Address/contact are tagged with the same tenant and customer.
    const directAddress = await prisma.customerAddress.findUnique({ where: { id: addressA.id } });
    if (directAddress?.tenantId !== tenantA.id || directAddress.customerId !== customerA.id) {
      throw new Error("Address tenant/customer tag mismatch");
    }

    const directContact = await prisma.customerContact.findUnique({ where: { id: contactA.id } });
    if (directContact?.tenantId !== tenantA.id || directContact.customerId !== customerA.id) {
      throw new Error("Contact tenant/customer tag mismatch");
    }

    // Tenant branding unique index enforces one row per tenant.
    await prisma.tenantBranding.create({
      data: {
        tenantId: tenantA.id,
        schemaVersion: 1,
        overrides: { schemaVersion: 1, primary: "#0ea5e9" },
      },
    });
    try {
      await prisma.tenantBranding.create({
        data: {
          tenantId: tenantA.id,
          schemaVersion: 1,
          overrides: { schemaVersion: 1, primary: "#f43f5e" },
        },
      });
      throw new Error("tenant_branding unique index did not enforce one row per tenant");
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "P2002") {
        throw error;
      }
    }

    // Audit log can record a tenant-scoped customer event.
    await prisma.auditLog.create({
      data: {
        tenantId: tenantA.id,
        action: "customer.created",
        actorType: "STAFF",
        targetType: "customer",
        targetId: customerA.id,
        metadata: { schemaVersion: 1, changedFields: ["kind", "displayName"] },
      },
    });

    const auditRows = await prisma.auditLog.findMany({ where: { tenantId: tenantA.id } });
    if (auditRows.length !== 1 || auditRows[0].targetId !== customerA.id) {
      throw new Error("Audit log tenant scope failed");
    }

    // --- EPIC-05 Patient lifecycle invariant (Decision #2210) -------------
    // Both deferred constraint triggers must exist: the guardian-side half and
    // the Patient-side half that closes the lone-active-Patient gap.
    const constraintTriggers = await prisma.$queryRawUnsafe<Array<{ tgname: string }>>(
      `
      SELECT tgname FROM pg_trigger
      WHERE tgname IN (
        'patient_guardian_exactly_one_primary_trigger',
        'patient_exactly_one_primary_guardian_trigger'
      )
      `
    );
    const triggerNames = constraintTriggers.map((row) => row.tgname);
    for (const required of [
      "patient_guardian_exactly_one_primary_trigger",
      "patient_exactly_one_primary_guardian_trigger",
    ]) {
      if (!triggerNames.includes(required)) {
        throw new Error(`Missing constraint trigger: ${required}`);
      }
    }

    // Global taxonomy row for live Patient fixtures (never tenant-scoped).
    const liveSpecies = await prisma.species.upsert({
      where: { code: "live-verify-species" },
      create: { code: "live-verify-species", name: "Live Verify Species" },
      update: {},
    });

    // Second customer so the partial unique index (not the (patient, customer)
    // link unique) is the constraint under test.
    const customerA2 = await prisma.customer.create({
      data: {
        tenantId: tenantA.id,
        kind: "INDIVIDUAL",
        displayName: "Live Customer A2",
        firstName: "Live2",
        lastName: "Customer",
      },
    });

    // Third customer so a reparented guardian lands on a distinct
    // (patient_id, customer_id) pair and only the primary invariant is exercised.
    const customerA3 = await prisma.customer.create({
      data: {
        tenantId: tenantA.id,
        kind: "INDIVIDUAL",
        displayName: "Live Customer A3",
        firstName: "Live3",
        lastName: "Customer",
      },
    });

    const patientId = randomUUID();
    const guardianId = randomUUID();
    const replacementGuardianId = randomUUID();

    // 1. A lone active Patient MUST NOT commit (Patient-side trigger).
    await expectRejected("active Patient INSERT with no primary guardian", () =>
      prisma.$transaction(async (tx) => {
        await tx.patient.create({
          data: {
            id: patientId,
            tenantId: tenantA.id,
            name: "Live Alone",
            speciesId: liveSpecies.id,
            sex: "UNKNOWN",
            isActive: true,
          },
        });
      })
    );
    if (await prisma.patient.findUnique({ where: { id: patientId } })) {
      throw new Error("lone active Patient was not rolled back");
    }

    // 2. Active Patient + primary guardian in one transaction commits.
    await expectCommitted("active Patient + primary guardian in one transaction", () =>
      prisma.$transaction(async (tx) => {
        await tx.patient.create({
          data: {
            id: patientId,
            tenantId: tenantA.id,
            name: "Live Active",
            speciesId: liveSpecies.id,
            sex: "UNKNOWN",
            isActive: true,
          },
        });
        await tx.patientGuardian.create({
          data: {
            id: guardianId,
            tenantId: tenantA.id,
            patientId,
            customerId: customerA.id,
            isPrimary: true,
            isActive: true,
          },
        });
      })
    );

    // 3. A second active primary violates the immediate partial unique index.
    await expectRejected("second active primary guardian", () =>
      prisma.$transaction(async (tx) => {
        await tx.patientGuardian.create({
          data: {
            id: randomUUID(),
            tenantId: tenantA.id,
            patientId,
            customerId: customerA2.id,
            isPrimary: true,
            isActive: true,
          },
        });
      })
    );

    // 4. Adding a non-primary guardian is allowed while exactly one primary holds.
    await expectCommitted("non-primary guardian added", () =>
      prisma.$transaction(async (tx) => {
        await tx.patientGuardian.create({
          data: {
            id: replacementGuardianId,
            tenantId: tenantA.id,
            patientId,
            customerId: customerA2.id,
            isPrimary: false,
            isActive: true,
          },
        });
      })
    );

    // 5. Demoting the sole primary without a replacement fails at COMMIT.
    await expectRejected("demote sole primary then commit", () =>
      prisma.$transaction(async (tx) => {
        await tx.patientGuardian.update({
          where: { id: guardianId },
          data: { isPrimary: false },
        });
      })
    );
    const demoted = await prisma.patientGuardian.findUnique({ where: { id: guardianId } });
    if (!demoted?.isPrimary) {
      throw new Error("demote-only rejection was not rolled back");
    }

    // 6. Demote-then-promote in one transaction commits exactly one primary.
    await expectCommitted("demote-then-promote primary swap", () =>
      prisma.$transaction(async (tx) => {
        await tx.patientGuardian.update({ where: { id: guardianId }, data: { isPrimary: false } });
        await tx.patientGuardian.update({
          where: { id: replacementGuardianId },
          data: { isPrimary: true },
        });
      })
    );
    const primaries = await prisma.patientGuardian.findMany({
      where: { patientId, isPrimary: true, isActive: true },
    });
    if (primaries.length !== 1 || primaries[0].id !== replacementGuardianId) {
      throw new Error("primary swap did not converge on exactly one replacement");
    }

    // 7. Deactivating an active Patient is allowed.
    await expectCommitted("active Patient deactivated", () =>
      prisma.$transaction(async (tx) => {
        await tx.patient.update({ where: { id: patientId }, data: { isActive: false } });
      })
    );

    // 8. An inactive Patient with no guardian commits...
    const inactiveId = randomUUID();
    await expectCommitted("inactive Patient with no guardian", () =>
      prisma.$transaction(async (tx) => {
        await tx.patient.create({
          data: {
            id: inactiveId,
            tenantId: tenantA.id,
            name: "Live Inactive",
            speciesId: liveSpecies.id,
            sex: "UNKNOWN",
            isActive: false,
          },
        });
      })
    );

    // 9. ...but activating it without a primary fails at COMMIT and stays inactive.
    await expectRejected("activate inactive Patient with zero primaries", () =>
      prisma.$transaction(async (tx) => {
        await tx.patient.update({ where: { id: inactiveId }, data: { isActive: true } });
      })
    );
    const stillInactive = await prisma.patient.findUnique({ where: { id: inactiveId } });
    if (stillInactive?.isActive) {
      throw new Error("failed activation was not rolled back");
    }

    // --- PAT-001 reparent regression (guardian OLD/NEW validation) ---------
    // A patient_guardian UPDATE can change patient_id, so the deferred trigger
    // must validate BOTH the OLD and the NEW Patient. The original function only
    // checked the NEW Patient, letting the OLD active Patient commit with zero
    // active primaries. These cases prove the fixed two-sided behavior.
    const reparentSourceId = randomUUID();
    const reparentInactiveTargetId = randomUUID();
    const reparentActiveTargetId = randomUUID();
    const reparentSourceGuardianId = randomUUID();
    const reparentExtraGuardianId = randomUUID();
    const reparentActiveTargetGuardianId = randomUUID();

    // Source: active with a sole primary. Active target: active with its own
    // primary. Inactive target: no guardian, exempt from the invariant.
    await expectCommitted("reparent fixture: source active with sole primary", () =>
      prisma.$transaction(async (tx) => {
        await tx.patient.create({
          data: {
            id: reparentSourceId,
            tenantId: tenantA.id,
            name: "Reparent Source",
            speciesId: liveSpecies.id,
            sex: "UNKNOWN",
            isActive: true,
          },
        });
        await tx.patientGuardian.create({
          data: {
            id: reparentSourceGuardianId,
            tenantId: tenantA.id,
            patientId: reparentSourceId,
            customerId: customerA.id,
            isPrimary: true,
            isActive: true,
          },
        });
      })
    );

    await expectCommitted("reparent fixture: inactive target with no guardian", () =>
      prisma.$transaction(async (tx) => {
        await tx.patient.create({
          data: {
            id: reparentInactiveTargetId,
            tenantId: tenantA.id,
            name: "Reparent Inactive Target",
            speciesId: liveSpecies.id,
            sex: "UNKNOWN",
            isActive: false,
          },
        });
      })
    );

    await expectCommitted("reparent fixture: active target with its own primary", () =>
      prisma.$transaction(async (tx) => {
        await tx.patient.create({
          data: {
            id: reparentActiveTargetId,
            tenantId: tenantA.id,
            name: "Reparent Active Target",
            speciesId: liveSpecies.id,
            sex: "UNKNOWN",
            isActive: true,
          },
        });
        await tx.patientGuardian.create({
          data: {
            id: reparentActiveTargetGuardianId,
            tenantId: tenantA.id,
            patientId: reparentActiveTargetId,
            customerId: customerA2.id,
            isPrimary: true,
            isActive: true,
          },
        });
      })
    );

    // 10. Reparenting the source's sole active primary to another Patient leaves
    // the source active with zero primaries → rejected at COMMIT, rolled back.
    await expectRejected("reparent sole active primary to another Patient", () =>
      prisma.$transaction(async (tx) => {
        await tx.patientGuardian.update({
          where: { id: reparentSourceGuardianId },
          data: { patientId: reparentInactiveTargetId },
        });
      })
    );
    const reparentedGuardian = await prisma.patientGuardian.findUnique({
      where: { id: reparentSourceGuardianId },
    });
    if (reparentedGuardian?.patientId !== reparentSourceId) {
      throw new Error("rejected reparent was not rolled back to the OLD Patient");
    }
    const sourcePrimaries = await prisma.patientGuardian.count({
      where: { patientId: reparentSourceId, isPrimary: true, isActive: true },
    });
    if (sourcePrimaries !== 1) {
      throw new Error("rejected reparent left the OLD active Patient without a primary");
    }
    const leakedTargetPrimaries = await prisma.patientGuardian.count({
      where: { patientId: reparentInactiveTargetId, isPrimary: true, isActive: true },
    });
    if (leakedTargetPrimaries !== 0) {
      throw new Error("rejected reparent leaked a primary onto the NEW Patient");
    }

    // Add a non-primary guardian so the unchanged-patient_id path can be probed.
    await expectCommitted("reparent fixture: add non-primary guardian", () =>
      prisma.$transaction(async (tx) => {
        await tx.patientGuardian.create({
          data: {
            id: reparentExtraGuardianId,
            tenantId: tenantA.id,
            patientId: reparentSourceId,
            customerId: customerA3.id,
            isPrimary: false,
            isActive: true,
          },
        });
      })
    );

    // 11. An UPDATE that leaves patient_id unchanged is validated once and must
    // not raise a duplicate false failure while exactly one primary still holds.
    await expectCommitted("update guardian on unchanged patient_id", () =>
      prisma.$transaction(async (tx) => {
        await tx.patientGuardian.update({
          where: { id: reparentExtraGuardianId },
          data: { isActive: false },
        });
        await tx.patientGuardian.update({
          where: { id: reparentExtraGuardianId },
          data: { isActive: true },
        });
      })
    );

    // 12. Reparenting a non-primary guardian to another active Patient keeps
    // exactly one primary on both sides → commits (two-sided check passes).
    await expectCommitted("reparent non-primary guardian to another active Patient", () =>
      prisma.$transaction(async (tx) => {
        await tx.patientGuardian.update({
          where: { id: reparentExtraGuardianId },
          data: { patientId: reparentActiveTargetId },
        });
      })
    );
    const movedGuardian = await prisma.patientGuardian.findUnique({
      where: { id: reparentExtraGuardianId },
    });
    if (movedGuardian?.patientId !== reparentActiveTargetId || movedGuardian.isPrimary) {
      throw new Error("non-primary reparent did not move the link as expected");
    }
    const finalSourcePrimaries = await prisma.patientGuardian.count({
      where: { patientId: reparentSourceId, isPrimary: true, isActive: true },
    });
    const finalTargetPrimaries = await prisma.patientGuardian.count({
      where: { patientId: reparentActiveTargetId, isPrimary: true, isActive: true },
    });
    if (finalSourcePrimaries !== 1 || finalTargetPrimaries !== 1) {
      throw new Error("reparent of a non-primary guardian broke the one-primary invariant");
    }

    console.log("LIVE MIGRATION VERIFICATION PASSED");
    console.log(`  tenants created: ${tenantA.id}, ${tenantB.id}`);
    console.log(`  customer created: ${customerA.id}`);
    console.log(`  tenant_branding unique index enforced`);
    console.log(`  audit log written: ${auditRows[0].id}`);
    console.log(`  both deferred constraint triggers present`);
    console.log(`  patient lifecycle invariant matrix passed (9 cases)`);
    console.log(`  guardian reparent regression passed (OLD+NEW validation, 3 cases)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("LIVE MIGRATION VERIFICATION FAILED", error);
  process.exit(1);
});
