/**
 * Allowlisted CustomerContact response. Only these fields are ever returned;
 * no internal metadata beyond the owning customer id is exposed.
 *
 * Data classification: label and value are CONFIDENTIAL. Logs must carry IDs
 * only.
 */
export interface CustomerContactResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly kind: "EMAIL" | "PHONE";
  readonly label: string | null;
  readonly value: string;
  readonly isPrimary: boolean;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}
