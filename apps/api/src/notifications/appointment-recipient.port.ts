/**
 * Who receives an appointment's reminder.
 *
 * This port exists because of a BOUNDARY rather than a convenience: the
 * recipient is the patient's responsible customer, and the link that makes a
 * customer responsible for a patient is **Veterinary**-owned (EPIC-05).
 * `notifications` is a **Core** capability (PRD §34), and a Core module may not
 * reach into a Veterinary aggregate; the dependency rule runs the other way
 * ("Veterinary may orchestrate capabilities exposed by Core domains").
 *
 * So Core declares the question and Veterinary answers it: the implementation
 * lives in `apps/api/src/patients/`, which is the only place the boundary suite
 * allows that aggregate to be named — this file must not name it either, which is
 * why the sentence above describes it instead — and the composition root wires
 * the two.
 * Core never imports Veterinary, and the boundary suite keeps it that way.
 */

/** Injection token for the resolver the composition root supplies. */
export const APPOINTMENT_RECIPIENT_PORT = Symbol("APPOINTMENT_RECIPIENT_PORT");

export interface AppointmentRecipientPort {
  /**
   * The customer responsible for the patient, or `null` when there is none.
   *
   * `null` is a settled answer and not an error: EPIC-05's invariant gives every
   * ACTIVE patient exactly one active primary guardian, so this is unreachable
   * for an appointment that exists — the guard is what keeps an invariant break
   * from throwing inside a post-commit reaction.
   */
  primaryCustomerFor(args: {
    readonly tenantId: string;
    readonly patientId: string;
  }): Promise<string | null>;
}

/**
 * The fail-closed default: nobody is responsible for anybody.
 *
 * A deployment that wires no resolver schedules no reminder, which is the correct
 * failure for a boundary that must not guess a recipient — a reminder sent to the
 * wrong customer is worse than one not sent.
 */
export function createNullAppointmentRecipientPort(): AppointmentRecipientPort {
  return {
    primaryCustomerFor: () => Promise.resolve(null),
  };
}
