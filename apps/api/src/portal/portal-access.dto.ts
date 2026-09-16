import { z } from "zod";

/** DTO schema version recorded on portal-access audit rows (append-only). */
export const PORTAL_ACCESS_DTO_SCHEMA_VERSION = 1;

/**
 * Staff provisioning body (EPIC-08 D7/D8). `email` is the holder's login id
 * (`CustomerPortalAccess.contactEmail`, staff-managed); `password` is the
 * initial credential — there is NO self-service signup, email invitation,
 * magic-link or recovery flow in this epic, so staff must set it here. The
 * 12-character floor is the only policy shipped (no reset path exists yet).
 * `.strict()` rejects any extra field.
 */
export const provisionPortalAccessBodySchema = z
  .object({
    email: z.string().trim().min(3).max(254).email(),
    password: z.string().min(12).max(1024),
  })
  .strict();

/** `:customerId` path param contract for the staff admin commands. */
export const portalAccessCustomerParamSchema = z.object({
  customerId: z.string().uuid(),
});

/** Row shape the service maps from — never returned raw. */
export interface PortalAccessRecord {
  id: string;
  tenantId: string;
  customerId: string;
  contactEmail: string;
  status: string;
}

/**
 * Allowlisted portal-access DTO. Never the Prisma model, and never the
 * credential (the password hash lives in `portal_credential` and is RESTRICTED:
 * it is not selected here and must never leave the login verification path).
 */
export interface PortalAccessResponse {
  id: string;
  tenantId: string;
  customerId: string;
  contactEmail: string;
  status: "ACTIVE" | "REVOKED";
}

export function toPortalAccessResponse(row: PortalAccessRecord): PortalAccessResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    contactEmail: row.contactEmail,
    status: row.status === "REVOKED" ? "REVOKED" : "ACTIVE",
  };
}
