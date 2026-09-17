/**
 * Portal boundary constants (EPIC-08 D6/D7).
 *
 * Shared by the guard (entitlement gate), the staff provisioning commands, and
 * the route-contract probe so the feature code and permission key are declared
 * exactly once.
 */

/** Entitlement feature code that gates every portal route and provisioning. */
export const PORTAL_FEATURE_CODE = "portal";

/**
 * Staff permission key governing portal-access provisioning/revocation
 * (seeded catalog key, granted OWNER/ADMIN — see reference-seed).
 */
export const PORTAL_ACCESS_PERMISSION = "portal.access.manage";
