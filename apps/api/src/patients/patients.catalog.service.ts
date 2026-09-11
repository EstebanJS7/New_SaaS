import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { BreedCatalogEntry, SpeciesCatalogEntry } from "./patient.dto.js";

/** GLOBAL Species reference row; never tenant-scoped (Decision #2211). */
export interface CatalogSpeciesRow {
  id: string;
  code: string;
  name: string;
}

/** GLOBAL Breed reference row; belongs to exactly one global Species. */
export interface CatalogBreedRow {
  id: string;
  speciesId: string;
  code: string;
  name: string;
}

/**
 * Structural contract for the ONLY Prisma delegate this read boundary needs.
 * The generated client and the in-memory test fake both satisfy it; the
 * `include.breeds` relation replaces a second query.
 */
export interface SpeciesCatalogDelegate {
  findMany: (args: {
    orderBy: { name: "asc" | "desc" };
    include: { breeds: { orderBy: { name: "asc" | "desc" } } };
  }) => Promise<(CatalogSpeciesRow & { breeds: CatalogBreedRow[] })[]>;
}

export interface PatientsCatalogPrisma {
  species: SpeciesCatalogDelegate;
}

/** Maps Prisma rows to allowlisted INTERNAL catalog entries (no tenant data). */
function toSpeciesCatalogEntry(
  row: CatalogSpeciesRow & { breeds: CatalogBreedRow[] }
): SpeciesCatalogEntry {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    breeds: row.breeds.map((breed): BreedCatalogEntry => ({
      id: breed.id,
      code: breed.code,
      name: breed.name,
    })),
  };
}

/**
 * Read-only GLOBAL Species/Breed taxonomy boundary (Veterinary, Decision
 * #2211).
 *
 * - Tenant identity still comes exclusively from `RequestContextService`, and
 *   the `veterinary` entitlement still gates the read, so an unentitled tenant
 *   cannot enumerate the taxonomy either.
 * - The Species/Breed rows themselves carry NO tenant predicate: the catalog is
 *   shared across every tenant and must never be filtered by `tenantId`.
 * - DTOs are allowlisted and INTERNAL; no tenant-private data is joined.
 */
@Injectable()
export class PatientsCatalogService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PatientsCatalogPrisma,
    private readonly requestContext: RequestContextService,
    private readonly entitlements: EntitlementsService
  ) {}

  async list(): Promise<SpeciesCatalogEntry[]> {
    await this.requireTenantContext();
    const rows = await this.prisma.species.findMany({
      orderBy: { name: "asc" },
      include: { breeds: { orderBy: { name: "asc" } } },
    });
    return rows.map(toSpeciesCatalogEntry);
  }

  /**
   * Resolves tenant context and re-applies the `veterinary` entitlement gate;
   * `FEATURE_NOT_ENTITLED` (403) is the only rejection path.
   */
  private async requireTenantContext(): Promise<string> {
    const tenantId = this.requestContext.requireTenantId();
    if (!(await this.entitlements.has(tenantId, "veterinary"))) {
      throw new DomainError(
        "FEATURE_NOT_ENTITLED",
        "Veterinary features are not enabled for this tenant."
      );
    }
    return tenantId;
  }
}
