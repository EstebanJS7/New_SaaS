import { Injectable } from "@nestjs/common";
import { PrismaService, type Prisma } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import {
  PATIENT_IDENTITY_LIMIT,
  PATIENT_SEARCH_LIMIT,
  type PatientIdentityResponse,
  type PatientLookupInput,
} from "./patient-lookup.dto.js";

/** Veterinary-owned projection; Core Scheduling does not import this service. */
@Injectable()
export class PatientLookupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
    private readonly entitlements: EntitlementsService
  ) {}

  async lookup(input: PatientLookupInput): Promise<PatientIdentityResponse[]> {
    const tenantId = this.context.requireTenantId();
    if (!(await this.entitlements.has(tenantId, "veterinary"))) {
      throw new DomainError("FEATURE_NOT_ENTITLED", "Veterinary features are not enabled.");
    }
    const guardianWhere: Prisma.PatientGuardianWhereInput = {
      tenantId,
      isActive: true,
      isPrimary: true,
      customer: { tenantId, isActive: true },
    };
    const where: Prisma.PatientWhereInput =
      "q" in input
        ? {
            tenantId,
            isActive: true,
            OR: [
              { name: { contains: input.q, mode: "insensitive" } },
              {
                guardians: {
                  some: {
                    ...guardianWhere,
                    customer: {
                      tenantId,
                      isActive: true,
                      displayName: { contains: input.q, mode: "insensitive" },
                    },
                  },
                },
              },
            ],
          }
        : { tenantId, id: { in: [...new Set(input.ids)] } };

    const rows = await this.prisma.patient.findMany({
      where,
      take: "q" in input ? PATIENT_SEARCH_LIMIT : PATIENT_IDENTITY_LIMIT,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        isActive: true,
        species: { select: { name: true } },
        guardians: {
          where: guardianWhere,
          take: 1,
          select: { customer: { select: { displayName: true } } },
        },
      },
    });
    if ("ids" in input && rows.length !== new Set(input.ids).size) {
      // Explicit UUID reads preserve the existing foreign/unknown 404 contract.
      throw new DomainError("NOT_FOUND", "Patient was not found.");
    }
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      isActive: row.isActive,
      speciesName: row.species.name,
      primaryGuardianName: row.guardians[0]?.customer.displayName ?? null,
    }));
  }
}
