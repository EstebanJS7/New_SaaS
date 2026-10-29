import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaService } from "@newsaas/database";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { ClinicalLinksService } from "./clinical.links.service.js";
import {
  ClinicalLinksController,
  clinicalAppointmentLinkBody,
  clinicalSaleLinkBody,
} from "./clinical.links.controller.js";
import { REQUIRE_PERMISSIONS_KEY } from "../rbac/require-permissions.decorator.js";

const url = process.env.CLINICAL_LINKS_TEST_URL;
describe.skipIf(!url)("Clinical journey links — live PostgreSQL", () => {
  const prisma = new PrismaService({ datasources: { db: { url } } });
  const context = new RequestContextService();
  const allPermissions = [
    "vet.clinical.read",
    "vet.clinical.update",
    "scheduling.appointment.read",
    "sales.read",
  ];
  let permissions = new Set(allPermissions);
  let entitled = true;
  const resolver = {
    resolveForActiveRequest: vi.fn(() => Promise.resolve(permissions)),
  } as unknown as PermissionResolver;
  const entitlements = { has: vi.fn(() => Promise.resolve(entitled)) } as unknown as EntitlementsService;
  const audit = new AuditWriter(
    prisma as unknown as { auditLog: AuditAppendTx["auditLog"] },
    context
  );
  const service = new ClinicalLinksService(prisma, context, entitlements, resolver, audit);
  const actor = randomUUID();
  const tenant = randomUUID();
  const foreignTenant = randomUUID();
  let patient: string;
  let foreignPatient: string;
  let appointment: string;
  let otherAppointment: string;
  let foreignAppointment: string;
  let encounter: string;
  let foreignEncounter: string;
  let sale: string;
  let foreignSale: string;
  function run<T>(work: () => T) {
    return context.run(randomUUID(), () => {
      context.setUserProfileId(actor);
      context.setTenantMembership({
        tenantId: tenant,
        membershipId: randomUUID(),
        roleId: randomUUID(),
        roleCode: "OWNER",
      });
      return work();
    });
  }
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.startsWith("/newsaas_links_test_"))
      throw new Error("Disposable test database required.");
    await prisma.$connect();
    await prisma.tenant.createMany({
      data: [
        { id: tenant, name: "Links test", slug: tenant },
        { id: foreignTenant, name: "Other test", slug: foreignTenant },
      ],
    });
    await prisma.userProfile.create({
      data: {
        id: actor,
        email: `${actor}@example.test`,
        displayName: "Synthetic operator",
        status: "ACTIVE",
      },
    });
    const species = await prisma.species.create({
      data: { code: randomUUID(), name: "Synthetic species" },
    });
    const p = await prisma.patient.create({
      data: {
        tenantId: tenant,
        name: "Synthetic",
        speciesId: species.id,
        sex: "UNKNOWN",
        isActive: false,
      },
    });
    patient = p.id;
    const fp = await prisma.patient.create({
      data: {
        tenantId: foreignTenant,
        name: "Foreign synthetic",
        speciesId: species.id,
        sex: "UNKNOWN",
        isActive: false,
      },
    });
    foreignPatient = fp.id;
    const role = await prisma.role.create({ data: { code: randomUUID(), name: "Synthetic vet" } });
    async function appointmentFixture(tenantId: string, patientId: string, start: string) {
      const branch = await prisma.branch.create({ data: { tenantId, name: "Synthetic branch" } });
      const member = await prisma.tenantMembership.upsert({
        where: { tenantId_userProfileId: { tenantId, userProfileId: actor } },
        create: { tenantId, userProfileId: actor, roleId: role.id, status: "ACTIVE" },
        update: {},
      });
      return prisma.appointment.create({
        data: {
          tenantId,
          patientId,
          branchId: branch.id,
          professionalMembershipId: member.id,
          status: "CONFIRMED",
          startAt: new Date(start),
          endAt: new Date(new Date(start).getTime() + 1800000),
        },
      });
    }
    appointment = (await appointmentFixture(tenant, patient, "2030-01-01T12:00:00Z")).id;
    otherAppointment = (await appointmentFixture(tenant, patient, "2030-01-02T12:00:00Z")).id;
    foreignAppointment = (
      await appointmentFixture(foreignTenant, foreignPatient, "2030-01-01T12:00:00Z")
    ).id;
    encounter = (
      await prisma.clinicalEncounter.create({ data: { tenantId: tenant, patientId: patient } })
    ).id;
    foreignEncounter = (
      await prisma.clinicalEncounter.create({
        data: { tenantId: foreignTenant, patientId: foreignPatient },
      })
    ).id;
    sale = (await prisma.sale.create({ data: { tenantId: tenant, currency: "PYG" } })).id;
    foreignSale = (await prisma.sale.create({ data: { tenantId: foreignTenant, currency: "PYG" } }))
      .id;
  }, 120000);
  afterAll(async () => {
    await prisma.$disconnect();
  });
  it("rejects tenant/body injection and pins granular route authorization", () => {
    expect(
      clinicalAppointmentLinkBody.safeParse({ appointmentId: appointment, tenantId: tenant })
        .success
    ).toBe(false);
    expect(clinicalSaleLinkBody.safeParse({ saleId: "invalid" }).success).toBe(false);
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, Object.getOwnPropertyDescriptor(ClinicalLinksController.prototype, "appointment")?.value as object)
    ).toEqual(["vet.clinical.read", "vet.clinical.update", "scheduling.appointment.read"]);
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, Object.getOwnPropertyDescriptor(ClinicalLinksController.prototype, "sale")?.value as object)
    ).toEqual(["vet.clinical.read", "vet.clinical.update", "sales.read"]);
  });
  it("denies missing permissions and entitlement before writes", async () => {
    for (const missing of allPermissions) {
      permissions = new Set(allPermissions.filter((key) => key !== missing));
      await expect(
        run(() =>
          service.link(
            patient,
            encounter,
            missing === "sales.read" ? { saleId: sale } : { appointmentId: appointment }
          )
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    permissions = new Set(allPermissions);
    entitled = false;
    await expect(run(() => service.list(patient, encounter))).rejects.toMatchObject({
      code: "FEATURE_NOT_ENTITLED",
    });
    entitled = true;
    expect(await prisma.clinicalAppointmentLink.count()).toBe(0);
  });
  it("foreign and unknown resources return identical 404 messages", async () => {
    const failure = async (
      p: string,
      e: string,
      target: { appointmentId: string } | { saleId: string }
    ) => {
      try {
        await run(() => service.link(p, e, target));
        return "unexpected";
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(await failure(patient, encounter, { appointmentId: foreignAppointment })).toBe(
      await failure(patient, encounter, { appointmentId: randomUUID() })
    );
    expect(await failure(patient, encounter, { saleId: foreignSale })).toBe(
      await failure(patient, encounter, { saleId: randomUUID() })
    );
    expect(
      await failure(foreignPatient, foreignEncounter, { appointmentId: foreignAppointment })
    ).toBe(await failure(randomUUID(), randomUUID(), { appointmentId: randomUUID() }));
    expect(await prisma.clinicalSaleLink.count()).toBe(0);
  });
  it("same-tenant wrong patient cannot be attached to a consultation", async()=>{
    const p = await prisma.patient.findUniqueOrThrow({where:{id:patient}});
    const other = await prisma.patient.create({data:{tenantId:tenant,name:"Other synthetic",speciesId:p.speciesId,sex:"UNKNOWN",isActive:false}});
    const origin = await prisma.appointment.findUniqueOrThrow({where:{id:appointment}});
    const wrong = await prisma.appointment.create({data:{tenantId:tenant,patientId:other.id,branchId:origin.branchId,professionalMembershipId:origin.professionalMembershipId,status:"CONFIRMED",startAt:new Date("2030-03-01T12:00:00Z"),endAt:new Date("2030-03-01T12:30:00Z")}});
    await expect(run(()=>service.link(patient,encounter,{appointmentId:wrong.id}))).rejects.toMatchObject({code:"NOT_FOUND"});
    await expect(run(()=>service.forAppointment(patient,wrong.id))).rejects.toMatchObject({code:"NOT_FOUND"});
  });
  it("same link concurrent retries produce one link and one co-committed audit", async () => {
    await Promise.all([
      run(() => service.link(patient, encounter, { appointmentId: appointment })),
      run(() => service.link(patient, encounter, { appointmentId: appointment })),
    ]);
    expect(await prisma.clinicalAppointmentLink.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "clinical.appointment_linked" } })).toBe(
      1
    );
    await expect(
      run(() => service.link(patient, encounter, { appointmentId: otherAppointment }))
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("many encounters per appointment and many sales per encounter without state or money effects", async () => {
    const another = await prisma.clinicalEncounter.create({
      data: { tenantId: tenant, patientId: patient },
    });
    await run(() => service.link(patient, another.id, { appointmentId: appointment }));
    const second = await prisma.sale.create({ data: { tenantId: tenant, currency: "PYG" } });
    await Promise.all([
      run(() => service.link(patient, encounter, { saleId: sale })),
      run(() => service.link(patient, encounter, { saleId: sale })),
    ]);
    await run(() => service.link(patient, encounter, { saleId: second.id }));
    expect((await run(() => service.list(patient, encounter))).sales).toHaveLength(2);
    expect((await run(() => service.forAppointment(patient, appointment))).encounterIds).toEqual(
      expect.arrayContaining([encounter, another.id])
    );
    await expect(
      run(() => service.forAppointment(patient, foreignAppointment))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      run(() => service.link(patient, another.id, { saleId: sale }))
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale } })).status).toBe("DRAFT");
    expect(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointment } })).status
    ).toBe("CONFIRMED");
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.stockMovement.count()).toBe(0);
    expect(await prisma.cashMovement.count()).toBe(0);
  });

  it("concurrent different encounters cannot claim the same sale", async () => {
    const first = await prisma.clinicalEncounter.create({
      data: { tenantId: tenant, patientId: patient },
    });
    const second = await prisma.clinicalEncounter.create({
      data: { tenantId: tenant, patientId: patient },
    });
    const target = await prisma.sale.create({ data: { tenantId: tenant, currency: "PYG" } });
    const results = await Promise.allSettled([
      run(() => service.link(patient, first.id, { saleId: target.id })),
      run(() => service.link(patient, second.id, { saleId: target.id })),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await prisma.clinicalSaleLink.count({ where: { saleId: target.id } })).toBe(1);
  });
  it("links closed content without editing it and hides unreadable related domains", async () => {
    const closed = await prisma.clinicalEncounter.create({
      data: {
        tenantId: tenant,
        patientId: patient,
        status: "CLOSED",
        closedAt: new Date(),
        closedByUserProfileId: actor,
        internalNotes: "Synthetic private note",
      },
    });
    await run(() => service.link(patient, closed.id, { appointmentId: appointment }));
    expect(await prisma.clinicalEncounter.findUnique({ where: { id: closed.id } })).toEqual(closed);
    permissions = new Set(["vet.clinical.read"]);
    expect(await run(() => service.list(patient, closed.id))).toEqual({
      appointmentId: null,
      sales: [],
      canReadAppointments: false,
      canReadSales: false,
    });
    permissions = new Set(allPermissions);
    const logs = await prisma.auditLog.findMany({
      where: { action: "clinical.appointment_linked" },
    });
    expect(JSON.stringify(logs)).not.toContain("Synthetic private note");
  });
  it("an audit failure rolls back the link; SQL FK/immutability fences remain active", async () => {
    const fresh = await prisma.clinicalEncounter.create({
      data: { tenantId: tenant, patientId: patient },
    });
    const failing = vi.spyOn(audit, "append").mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(
      run(() => service.link(patient, fresh.id, { appointmentId: appointment }))
    ).rejects.toThrow("audit unavailable");
    failing.mockRestore();
    expect(await prisma.clinicalAppointmentLink.count({ where: { encounterId: fresh.id } })).toBe(
      0
    );
    await expect(
      prisma.clinicalAppointmentLink.create({
        data: {
          tenantId: tenant,
          patientId: patient,
          encounterId: fresh.id,
          appointmentId: foreignAppointment,
        },
      })
    ).rejects.toThrow();
    await expect(
      prisma.clinicalAppointmentLink.deleteMany({ where: { encounterId: encounter } })
    ).rejects.toThrow("immutable");
  });
});
