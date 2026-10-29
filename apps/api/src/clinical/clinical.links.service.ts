import { Injectable } from "@nestjs/common";
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { type AuditAppendTx, AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { ClinicalServiceBase } from "./clinical.service.base.js";

export interface ClinicalLinksResponse {
  appointmentId: string | null;
  sales: { id: string; status: string }[];
  canReadAppointments: boolean;
  canReadSales: boolean;
}

/** Veterinary owns associations; Core aggregates and their transitions stay independent. */
@Injectable()
export class ClinicalLinksService extends ClinicalServiceBase<PrismaService> {
  constructor(
    prisma: PrismaService,
    context: RequestContextService,
    entitlements: EntitlementsService,
    permissions: PermissionResolver,
    audit: AuditWriter
  ) {
    super(prisma, context, entitlements, permissions, audit);
  }

  private async encounter(
    tx: Prisma.TransactionClient,
    tenantId: string,
    patientId: string,
    id: string
  ): Promise<void> {
    const row = await tx.clinicalEncounter.findFirst({
      where: { tenantId, patientId, id },
      select: { id: true },
    });
    if (!row) throw new DomainError("NOT_FOUND", "Clinical encounter was not found.");
  }

  async forAppointment(
    patientId: string,
    appointmentId: string
  ): Promise<{ encounterIds: string[] }> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission("vet.clinical.read");
    await this.requirePermission("scheduling.appointment.read");
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId, patientId },
      select: { id: true },
    });
    if (!appointment) throw new DomainError("NOT_FOUND", "Appointment was not found.");
    const links = await this.prisma.clinicalAppointmentLink.findMany({
      where: { tenantId, patientId, appointmentId },
      select: { encounterId: true },
      orderBy: { createdAt: "desc" },
    });
    return { encounterIds: links.map((link) => link.encounterId) };
  }

  async list(patientId: string, id: string): Promise<ClinicalLinksResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission("vet.clinical.read");
    await this.encounter(this.prisma, tenantId, patientId, id);
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    const canReadAppointments = permissions.has("scheduling.appointment.read");
    const canReadSales =
      permissions.has("sales.read") && (await this.entitlements.has(tenantId, "sales"));
    const appointment = canReadAppointments
      ? await this.prisma.clinicalAppointmentLink.findUnique({
          where: { tenantId_encounterId: { tenantId, encounterId: id } },
          select: { appointmentId: true },
        })
      : null;
    const sales = canReadSales
      ? await this.prisma.clinicalSaleLink.findMany({
          where: { tenantId, encounterId: id },
          select: { sale: { select: { id: true, status: true } } },
          orderBy: { createdAt: "desc" },
        })
      : [];
    return {
      appointmentId: appointment?.appointmentId ?? null,
      sales: sales.map((link) => ({ id: link.sale.id, status: link.sale.status })),
      canReadAppointments,
      canReadSales,
    };
  }

  async link(
    patientId: string,
    id: string,
    target: { appointmentId: string } | { saleId: string }
  ): Promise<{ linked: true }> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission("vet.clinical.read");
    await this.requirePermission("vet.clinical.update");
    const appointment = "appointmentId" in target;
    await this.requirePermission(appointment ? "scheduling.appointment.read" : "sales.read");
    if (!appointment && !(await this.entitlements.has(tenantId, "sales")))
      throw new DomainError("FEATURE_NOT_ENTITLED", "Sales are not enabled for this tenant.");
    const actor = this.requestContext.requireUserProfileId();
    await this.prisma.$transaction(async (tx) => {
      // Prisma's JSON input is narrower than the shared append seam; the writer
      // validates metadata before delegating, as in other audited Prisma services.
      const auditableTx = tx as unknown as AuditAppendTx;
      // Serialize identical/different origin links without altering the clinical record.
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM clinical_encounter WHERE tenant_id = ${tenantId}::uuid AND patient_id = ${patientId}::uuid AND id = ${id}::uuid FOR UPDATE`
      );
      await this.encounter(tx, tenantId, patientId, id);
      if ("appointmentId" in target) {
        const row = await tx.appointment.findFirst({
          where: { tenantId, patientId, id: target.appointmentId },
          select: { id: true },
        });
        if (!row) throw new DomainError("NOT_FOUND", "Appointment was not found.");
        const existing = await tx.clinicalAppointmentLink.findUnique({
          where: { tenantId_encounterId: { tenantId, encounterId: id } },
        });
        if (existing) {
          if (existing.appointmentId !== row.id)
            throw new DomainError(
              "CONFLICT",
              "This encounter already has another appointment origin."
            );
          return;
        }
        const link = await tx.clinicalAppointmentLink.create({
          data: { tenantId, patientId, encounterId: id, appointmentId: row.id },
        });
        await this.appendAudit(
          auditableTx,
          {
            action: "clinical.appointment_linked",
            targetType: "clinical_appointment_link",
            targetId: link.id,
            changedFields: ["encounterId", "appointmentId"],
          },
          tenantId,
          actor
        );
      } else {
        // A sale may be linked from different encounters concurrently: serialize on sale too.
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM sale WHERE tenant_id = ${tenantId}::uuid AND id = ${target.saleId}::uuid FOR UPDATE`
        );
        const row = await tx.sale.findFirst({
          where: { tenantId, id: target.saleId },
          select: { id: true },
        });
        if (!row) throw new DomainError("NOT_FOUND", "Sale was not found.");
        const existing = await tx.clinicalSaleLink.findUnique({
          where: { tenantId_saleId: { tenantId, saleId: row.id } },
        });
        if (existing) {
          if (existing.encounterId !== id)
            throw new DomainError("CONFLICT", "This sale is already linked to another encounter.");
          return;
        }
        const link = await tx.clinicalSaleLink.create({
          data: { tenantId, encounterId: id, saleId: row.id },
        });
        await this.appendAudit(
          auditableTx,
          {
            action: "clinical.sale_linked",
            targetType: "clinical_sale_link",
            targetId: link.id,
            changedFields: ["encounterId", "saleId"],
          },
          tenantId,
          actor
        );
      }
    });
    return { linked: true };
  }
}
