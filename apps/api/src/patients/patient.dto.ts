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
