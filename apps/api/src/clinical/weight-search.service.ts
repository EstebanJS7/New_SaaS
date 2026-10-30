import { Injectable } from "@nestjs/common";
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import {
  WEIGHT_PAGE_SIZE,
  type WeightSearchInput,
  type WeightSearchResponse,
  type WeightDetail,
} from "./weight-search.dto.js";

@Injectable()
export class WeightSearchService {
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

  async search(patientId: string, input: WeightSearchInput): Promise<WeightSearchResponse> {
    const tenantId = await this.authorize();
    const now = new Date();
    const hasRange = input.minQuantity !== undefined || input.maxQuantity !== undefined;
    const unit = input.unit ?? (hasRange ? "unspecified" : "all");
    if (hasRange && unit === "all")
      throw new DomainError("VALIDATION_FAILED", "Select one unit for a weight range.");
    const where: Prisma.ClinicalWeightWhereInput = {
      tenantId,
      patientId,
      ...(unit !== "all" && { unit: unit === "KG" ? "KG" : null }),
      ...((input.minQuantity !== undefined || input.maxQuantity !== undefined) && {
        quantity: {
          ...(input.minQuantity !== undefined && { gte: input.minQuantity }),
          ...(input.maxQuantity !== undefined && { lte: input.maxQuantity }),
        },
      }),
      ...(input.period === "last30" && {
        measuredAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), lte: now },
      }),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const patient = await tx.patient.findFirst({
          where: { id: patientId, tenantId },
          select: { id: true },
        });
        if (!patient) throw new DomainError("NOT_FOUND", "Clinical record was not found.");
        const total = await tx.clinicalWeight.count({ where });
        const totalPages = Math.ceil(total / WEIGHT_PAGE_SIZE);
        const page = Math.min(input.page, Math.max(1, totalPages));
        const rows = await tx.clinicalWeight.findMany({
          where,
          take: WEIGHT_PAGE_SIZE,
          skip: (page - 1) * WEIGHT_PAGE_SIZE,
          orderBy: [{ measuredAt: input.sort === "recent" ? "desc" : "asc" }, { id: "asc" }],
          select: { id: true, quantity: true, measuredAt: true, unit: true },
        });
        return {
          items: rows.map((row) => ({
            id: row.id,
            quantity: row.quantity.toFixed(3),
            unit: row.unit,
            measuredAt: row.measuredAt.toISOString(),
          })),
          page,
          pageSize: WEIGHT_PAGE_SIZE,
          total,
          totalPages,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
  }

  async get(patientId: string, id: string): Promise<WeightDetail> {
    const tenantId = await this.authorize();
    const row = await this.prisma.clinicalWeight.findFirst({
      where: { id, patientId, tenantId, patient: { tenantId } },
      select: { id: true, quantity: true, measuredAt: true, unit: true },
    });
    if (!row) throw new DomainError("NOT_FOUND", "Clinical record was not found.");
    return {
      id: row.id,
      quantity: row.quantity.toFixed(3),
      unit: row.unit,
      measuredAt: row.measuredAt.toISOString(),
    };
  }
}
