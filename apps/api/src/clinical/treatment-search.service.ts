import { Injectable } from "@nestjs/common";
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import {
  TREATMENT_PAGE_SIZE,
  type TreatmentSearchInput,
  type TreatmentSearchResponse,
  type TreatmentDetail,
} from "./treatment-search.dto.js";

@Injectable()
export class TreatmentSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
    private readonly entitlements: EntitlementsService,
    private readonly permissions: PermissionResolver
  ) {}

  private async authorize(): Promise<string> {
    const tenantId = this.context.requireTenantId();
    if (!(await this.entitlements.has(tenantId, "veterinary")))
      throw new DomainError("FEATURE_NOT_ENTITLED", "Veterinary features are not enabled.");
    if (!(await this.permissions.resolveForActiveRequest()).has("vet.clinical.read"))
      throw new DomainError("FORBIDDEN", "The required clinical permission is missing.");
    return tenantId;
  }

  async search(patientId: string, input: TreatmentSearchInput): Promise<TreatmentSearchResponse> {
    const tenantId = await this.authorize();
    const now = new Date();
    const where: Prisma.ClinicalTreatmentWhereInput = {
      tenantId,
      patientId,
      ...(input.q && { description: { contains: input.q, mode: "insensitive" } }),
      ...(input.period === "last30" && {
        administeredAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), lte: now },
      }),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const patient = await tx.patient.findFirst({
          where: { id: patientId, tenantId },
          select: { id: true },
        });
        if (!patient) throw new DomainError("NOT_FOUND", "Clinical record was not found.");
        const total = await tx.clinicalTreatment.count({ where });
        const totalPages = Math.ceil(total / TREATMENT_PAGE_SIZE);
        const page = Math.min(input.page, Math.max(1, totalPages));
        const rows = await tx.clinicalTreatment.findMany({
          where,
          take: TREATMENT_PAGE_SIZE,
          skip: (page - 1) * TREATMENT_PAGE_SIZE,
          orderBy: [{ administeredAt: input.sort === "recent" ? "desc" : "asc" }, { id: "asc" }],
          select: { id: true, description: true, administeredAt: true },
        });
        return {
          items: rows.map((row) => ({
            id: row.id,
            description: row.description,
            administeredAt: row.administeredAt.toISOString(),
          })),
          page,
          pageSize: TREATMENT_PAGE_SIZE,
          total,
          totalPages,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
  }

  async get(patientId: string, id: string): Promise<TreatmentDetail> {
    const tenantId = await this.authorize();
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        description: string;
        administeredAt: Date;
        context: string | null;
        version: number;
      }[]
    >(Prisma.sql`SELECT id, description, administered_at AS "administeredAt", context, version
      FROM clinical_treatment WHERE id = ${id}::uuid AND patient_id = ${patientId}::uuid AND tenant_id = ${tenantId}::uuid`);
    const row = rows[0];
    if (!row) throw new DomainError("NOT_FOUND", "Clinical record was not found.");
    return {
      id: row.id,
      version: row.version,
      description: row.description,
      administeredAt: row.administeredAt.toISOString(),
      context: row.context,
    };
  }
}
