/**
 * Allowlisted Patient response. Only these fields are ever returned; Prisma
 * models are never exposed and `primaryGuardianCustomerId` is intentionally
 * absent because guardians are read through their own routes.
 *
 * Data classification: `name` and `birthDate` are CONFIDENTIAL. Logs and audit
 * metadata carry stable IDs only.
 */
export interface PatientResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly speciesId: string;
  readonly breedId: string | null;
  readonly sex: "MALE" | "FEMALE" | "UNKNOWN";
  readonly birthDate: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Allowlisted PatientGuardian response. The Core Customer is referenced by id
 * only; no Customer fields are joined or leaked here.
 */
export interface PatientGuardianResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly patientId: string;
  readonly customerId: string;
  readonly isPrimary: boolean;
  readonly isActive: boolean;
  readonly position: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Allowlisted GLOBAL Breed reference entry (Decision #2211). INTERNAL data:
 * `code`/`name` are the stable taxonomy values shared by every tenant, so no
 * tenant identifier is ever present.
 */
export interface BreedCatalogEntry {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/**
 * Allowlisted GLOBAL Species reference entry with its nested Breeds. The
 * catalog is not tenant-scoped, so the DTO carries no `tenantId`; exposing it
 * to any entitled tenant is intentional and leaks no tenant-private data.
 */
export interface SpeciesCatalogEntry {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly breeds: readonly BreedCatalogEntry[];
}
