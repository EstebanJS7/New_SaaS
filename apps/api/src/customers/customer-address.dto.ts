/**
 * Allowlisted CustomerAddress response. Only these fields are ever returned;
 * no internal metadata beyond the owning customer id is exposed.
 *
 * Data classification: label, line1, line2, city, state, postalCode and
 * countryCode are CONFIDENTIAL. Logs must carry IDs only.
 */
export interface CustomerAddressResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly label: string | null;
  readonly line1: string | null;
  readonly line2: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}
