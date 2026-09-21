import { DomainError } from "@newsaas/shared";

/**
 * Shared holder-ownership scoping primitives (EPIC-08 D6).
 *
 * Extracted from `PortalReadService` when the WU4A booking-request command
 * became the SECOND consumer of the "own pets" predicate. The uniform NOT_FOUND
 * outcome must have exactly one definition: two copies could drift into
 * distinguishable 404s and let a holder probe for the existence of another
 * Customer's (or another tenant's) resources.
 *
 * TWO OWNERSHIP RULES LIVE ON THE HOLDER SURFACE, AND THEY ARE NOT THE SAME
 * (DEC-007 A2d). Do not "unify" them:
 *
 * - PATIENT-SCOPED resources (pets, appointments) are owned through the ACTIVE
 *   guardian chain implemented here (`holderPatientIds` /
 *   `assertHolderOwnedPatient`). Revoking the link removes both visibility and
 *   authority over the pet and its appointments.
 * - A booking REQUEST is owner-scoped by its own stored `(tenantId,
 *   customerId)` (see `PortalBookingService`): it is the holder's own
 *   submission, so it stays visible and cancellable after the guardian link to
 *   its pet is revoked.
 *
 * Visibility of your own submission versus authority over a pet you no longer
 * have — the distinction is deliberate and covered by tests on both sides.
 */

/**
 * Uniform NOT_FOUND message for every non-owned, cross-tenant or unknown
 * reference. One message means the three cases are byte-equivalent to a caller
 * (see `expectCrossTenant404`), so a holder cannot probe for the existence of
 * another Customer's (or another tenant's) resources.
 */
export const PORTAL_NOT_FOUND_MESSAGE = "Resource was not found.";

/** The single NOT_FOUND factory used by every portal resource lookup. */
export function portalResourceNotFound(): DomainError {
  return new DomainError("NOT_FOUND", PORTAL_NOT_FOUND_MESSAGE);
}

/** Active guardian link row; only the anchor id is consumed. */
interface PortalGuardianLinkRow {
  readonly patientId: string;
}

/**
 * Structural Prisma surface for the holder-ownership chain. Deliberately narrow
 * so BOTH the read boundary and the booking command can pass their own client
 * type without casts.
 */
export interface PortalHolderScopePrisma {
  patientGuardian: {
    findMany: (args: {
      where: { tenantId: string; customerId: string; isActive: boolean };
      select?: unknown;
    }) => Promise<PortalGuardianLinkRow[]>;
    findFirst: (args: {
      where: { tenantId: string; patientId: string; customerId: string; isActive: boolean };
      select?: unknown;
    }) => Promise<PortalGuardianLinkRow | null>;
  };
}

/** Active guardian links for the holder's Customer — the "own pets" chain. */
export async function holderPatientIds(
  prisma: PortalHolderScopePrisma,
  tenantId: string,
  customerId: string
): Promise<string[]> {
  const links = await prisma.patientGuardian.findMany({
    where: { tenantId, customerId, isActive: true },
    select: { patientId: true },
  });
  return links.map((link) => link.patientId);
}

/** Rejects any pet without an ACTIVE guardian link to this holder. */
export async function assertHolderOwnedPatient(
  prisma: PortalHolderScopePrisma,
  tenantId: string,
  customerId: string,
  patientId: string
): Promise<void> {
  const link = await prisma.patientGuardian.findFirst({
    where: { tenantId, patientId, customerId, isActive: true },
    select: { patientId: true },
  });
  if (!link) {
    throw portalResourceNotFound();
  }
}
