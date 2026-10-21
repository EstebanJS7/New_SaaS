/**
 * Allowlisted Customer response. Only these fields are ever returned; no
 * internal metadata, foreign row IDs, or derived classifications are exposed.
 *
 * It lives here rather than in `apps/api` because the create contract's
 * response mapper (`toCustomerResponse`) is single-sourced with it: the API
 * answers its routes with this shape and a caller from a non-request context
 * reads the same one — see [[DEC-073]].
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
