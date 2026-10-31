import { Injectable } from "@nestjs/common";
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import {
  STUDY_PAGE_SIZE,
  type StudySearchInput,
  type StudySearchResponse,
  type StudyDetail,
} from "./study-search.dto.js";

@Injectable()
export class StudySearchService {
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

  async search(patientId: string, input: StudySearchInput): Promise<StudySearchResponse> {
    const tenantId = await this.authorize();
    const now = new Date();
    const where: Prisma.ClinicalStudyWhereInput = {
      tenantId,
      patientId,
      ...(input.q && { studyType: { contains: input.q, mode: "insensitive" } }),
      ...(input.period === "last30" && {
        performedAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), lte: now },
      }),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const patient = await tx.patient.findFirst({
          where: { id: patientId, tenantId },
          select: { id: true },
        });
        if (!patient) throw new DomainError("NOT_FOUND", "Clinical record was not found.");
        const total = await tx.clinicalStudy.count({ where });
        const totalPages = Math.ceil(total / STUDY_PAGE_SIZE);
        const page = Math.min(input.page, Math.max(1, totalPages));
        const rows = await tx.clinicalStudy.findMany({
          where,
          take: STUDY_PAGE_SIZE,
          skip: (page - 1) * STUDY_PAGE_SIZE,
          orderBy: [{ performedAt: input.sort === "recent" ? "desc" : "asc" }, { id: "asc" }],
          select: { id: true, studyType: true, performedAt: true },
        });
        return {
          items: rows.map((row) => ({
            id: row.id,
            studyType: row.studyType,
            performedAt: row.performedAt.toISOString(),
          })),
          page,
          pageSize: STUDY_PAGE_SIZE,
          total,
          totalPages,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
  }

  async get(patientId: string, id: string): Promise<StudyDetail> {
    const tenantId = await this.authorize();
    const rows = await this.prisma.$queryRaw<
      { id: string; studyType: string; performedAt: Date; result: string; version: number }[]
    >(Prisma.sql`SELECT id, study_type AS "studyType", performed_at AS "performedAt", result, version
      FROM clinical_study WHERE id = ${id}::uuid AND patient_id = ${patientId}::uuid AND tenant_id = ${tenantId}::uuid`);
    const row = rows[0];
    if (!row) throw new DomainError("NOT_FOUND", "Clinical record was not found.");
    return {
      id: row.id,
      version: row.version,
      studyType: row.studyType,
      performedAt: row.performedAt.toISOString(),
      result: row.result,
    };
  }
}
