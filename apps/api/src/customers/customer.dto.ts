/**
 * Allowlisted Customer response. Only these fields are ever returned; no
 * internal metadata, foreign row IDs, or derived classifications are exposed.
 *
 * Data classification: displayName, legalName, taxId, firstName, lastName and
 * documentNumber are CONFIDENTIAL. Logs must carry IDs only.
 */
export interface CustomerResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: "INDIVIDUAL" | "COMPANY";
  readonly displayName: string;
  readonly legalName: string | null;
  readonly taxId: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly documentNumber: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}
