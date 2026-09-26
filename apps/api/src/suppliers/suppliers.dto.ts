/**
 * Allowlisted supplier read projections (EPIC-11 W2).
 *
 * Data classification (DEC-011, mirroring the `Customer` precedent): `name` is
 * INTERNAL, while `legalName`, `taxId`, `email`, `phone` and `address` are
 * CONFIDENTIAL. Application logs carry supplier IDS only, and the audit trail
 * carries field NAMES only — never a stored CONFIDENTIAL value.
 *
 * Prisma models are never returned from this boundary; only the keys declared
 * here cross the HTTP boundary.
 */

/**
 * Allowlisted Supplier response. `tenantId` is the CALLER's own tenant — the
 * same disclosure the Customer/Patient/CatalogItem DTOs make — and every
 * optional identity field is `null` when absent.
 */
export interface SupplierResponse {
  readonly id: string;
  readonly tenantId: string;
  /** Trading name; INTERNAL. */
  readonly name: string;
  /** CONFIDENTIAL nullable identity field. */
  readonly legalName: string | null;
  /** CONFIDENTIAL nullable tax identifier (RUC). */
  readonly taxId: string | null;
  /** CONFIDENTIAL nullable contact field. */
  readonly email: string | null;
  /** CONFIDENTIAL nullable contact field. */
  readonly phone: string | null;
  /** CONFIDENTIAL nullable contact field. */
  readonly address: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}
