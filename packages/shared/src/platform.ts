/**
 * Platform-wide facts every deployable needs and none of them owns.
 *
 * They live in the shared kernel for the reason `ERROR_CODES` does: two copies
 * drift, and the two copies here would be an API that validates availability in
 * one timezone and a worker that renders a reminder in another.
 */

/**
 * The single tenant timezone fixed for v1 by the PRD.
 *
 * Scheduling stores availability as local wall-clock minutes in THIS zone and
 * converts at read time, and the reminder renders an appointment's instant in it.
 * A per-tenant zone is a product decision that would move this into the settings
 * registry; until then it is one constant so the two never disagree.
 */
export const TENANT_TIME_ZONE = "America/Asuncion";
