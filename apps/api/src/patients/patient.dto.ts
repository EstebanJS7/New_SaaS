/**
 * Patient response DTOs.
 *
 * `PatientResponse` is a deliberate re-export shim ([[DEC-073]], [[IMP-001A]]):
 * it now lives in `@newsaas/patients` beside the create contract's response
 * mapper, so the API's DTO shape and the shape a caller outside a request reads
 * cannot drift. Forwarding it here keeps every existing importer working without
 * a test diff; collapsing the shim is a separate cleanup.
 *
 * The guardian and GLOBAL catalog DTOs below did NOT move: they belong to the
 * read/guardian routes that stay in the API.
 */
export type { PatientResponse } from "@newsaas/patients";

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
