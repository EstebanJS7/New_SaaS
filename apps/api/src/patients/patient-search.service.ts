import { Injectable } from "@nestjs/common";
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import {
  PATIENT_PAGE_SIZE,
  type PatientSearchInput,
  type PatientSearchResponse,
} from "./patient-search.dto.js";

@Injectable()
export class PatientSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
    private readonly entitlements: EntitlementsService,
    private readonly permissions: PermissionResolver
  ) {}

  async search(input: PatientSearchInput): Promise<PatientSearchResponse> {
    const tenantId = this.context.requireTenantId();
    const keys = await this.permissions.resolveForActiveRequest();
    if (!keys.has("patients.read"))
      throw new DomainError("FORBIDDEN", "Patient read permission is required.");
    if (!(await this.entitlements.has(tenantId, "veterinary")))
      throw new DomainError("FEATURE_NOT_ENTITLED", "Veterinary features are not enabled.");
    const canReadGuardians = keys.has("customers.read");
    const guardianWhere: Prisma.PatientGuardianWhereInput = {
      tenantId,
      isActive: true,
      isPrimary: true,
      customer: { tenantId, isActive: true },
    };
    const where: Prisma.PatientWhereInput = {
      tenantId,
      ...(input.status !== "all" && { isActive: input.status === "active" }),
      ...(input.q && {
        OR: [
          { name: { contains: input.q, mode: "insensitive" } },
          ...(canReadGuardians
            ? [
                {
                  guardians: {
                    some: {
                      ...guardianWhere,
                      customer: {
                        tenantId,
                        isActive: true,
                        displayName: { contains: input.q, mode: "insensitive" as const },
                      },
                    },
                  },
                },
              ]
            : []),
        ],
      }),
    };
    // Count and rows must describe one snapshot, including concurrent deactivation.
    return this.prisma.$transaction(
      async (tx) => {
        const total = await tx.patient.count({ where });
        const totalPages = Math.ceil(total / PATIENT_PAGE_SIZE);
        const page = Math.min(input.page, Math.max(1, totalPages));
        const rows = await tx.patient.findMany({
          where,
          take: PATIENT_PAGE_SIZE,
          skip: (page - 1) * PATIENT_PAGE_SIZE,
          orderBy:
            input.sort === "recent"
              ? [{ createdAt: "desc" }, { id: "asc" }]
              : [{ name: "asc" }, { id: "asc" }],
          select: {
            id: true,
            name: true,
            isActive: true,
            sex: true,
            species: { select: { name: true } },
            breed: { select: { name: true } },
          },
        });
        const guardians =
          canReadGuardians && rows.length > 0
            ? await tx.patientGuardian.findMany({
                where: { ...guardianWhere, patientId: { in: rows.map((row) => row.id) } },
                select: { patientId: true, customer: { select: { displayName: true } } },
              })
            : [];
        const guardianNames = new Map(
          guardians.map((row) => [row.patientId, row.customer.displayName])
        );
        return {
          items: rows.map((row) => ({
            id: row.id,
            name: row.name,
            isActive: row.isActive,
            sex: row.sex,
            speciesName: row.species.name,
            breedName: row.breed?.name ?? null,
            primaryGuardianName: guardianNames.get(row.id) ?? null,
          })),
          total,
          totalPages,
          page,
          pageSize: PATIENT_PAGE_SIZE,
          canReadGuardians,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
  }
}
