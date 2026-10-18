import type { Prisma } from "@newsaas/database";
import type { AppointmentRecipientPort } from "../notifications/appointment-recipient.port.js";

/**
 * The Veterinary side of the appointment-recipient port (EPIC-17 NOTIF-003).
 *
 * It lives HERE, in the Patients module, because `PatientGuardian` is
 * Veterinary-owned and this is the only place the boundary suite allows it to be
 * named. The Core notifications module declares the port and never imports this
 * file; the composition root is what binds them.
 */

/**
 * The narrow client this reader needs, in Prisma's own arg types so the real
 * client fits by construction and a test can pass a stub (`fiscal-persistence`'s
 * pattern).
 */
export interface ResponsibleCustomerRecipientClient {
  patientGuardian: {
    findFirst(args: Prisma.PatientGuardianFindFirstArgs): Promise<{ customerId: string } | null>;
  };
}

export function createResponsibleCustomerRecipientPort(args: {
  readonly client: ResponsibleCustomerRecipientClient;
}): AppointmentRecipientPort {
  return {
    async primaryCustomerFor({ tenantId, patientId }) {
      const guardian = await args.client.patientGuardian.findFirst({
        where: { tenantId, patientId, isPrimary: true, isActive: true },
        select: { customerId: true },
      });
      // A failed read propagates and the caller treats it as retryable; only an
      // ABSENT guardian answers null, which is a state a retry cannot change.
      return guardian?.customerId ?? null;
    },
  };
}
