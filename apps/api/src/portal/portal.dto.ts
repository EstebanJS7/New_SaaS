import { z } from "zod";

/**
 * Portal login body contract (EPIC-08 D8).
 *
 * The login id is the staff-managed `contactEmail`, scoped by the tenant slug
 * the holder presents. `.strict()` rejects any extra field so a client cannot
 * smuggle a `customerId`/`tenantId` hint into the login path; identity is
 * always resolved server-side.
 */
export const portalLoginBodySchema = z
  .object({
    tenantSlug: z.string().trim().min(1).max(63),
    email: z.string().trim().min(3).max(254).email(),
    password: z.string().min(1).max(1024),
  })
  .strict();

/** Allowlisted portal identity projection — stable ids only, no tenant echo. */
export interface PortalIdentityDto {
  portalAccessId: string;
  customerId: string;
}

/** `GET /portal/me` response: server-derived identity + correlation id. */
export interface PortalMeResponse {
  portal: PortalIdentityDto;
  requestId: string;
}
