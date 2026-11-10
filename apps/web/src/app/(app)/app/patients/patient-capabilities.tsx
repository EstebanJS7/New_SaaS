import type { JSX } from "react";
import { EmptyState } from "@/components/feedback";
import type { CapabilityRequirement } from "@/lib/capabilities";
import { SALE_ACTIONS } from "../sales/sale-capabilities";

/** Every patient and clinical operation re-applies this entitlement in the API. */
const VETERINARY = "veterinary";

/**
 * What each patients action needs ([[UX-037]]), mirroring the API guards in
 * `apps/api/src/patients/patients.controller.ts`, `patient-search.controller.ts`
 * and `patient-guardians.controller.ts`, plus the `veterinary` entitlement the
 * patients services re-check (`patients.service.ts#requireTenantContext`). UX
 * only: unknown capabilities offer everything and the API stays the authority.
 */
export const PATIENT_ACTIONS = {
  read: { permission: "patients.read", feature: VETERINARY },
  create: { permission: "patients.create", feature: VETERINARY },
  update: { permission: "patients.update", feature: VETERINARY },
  deactivate: { permission: "patients.deactivate", feature: VETERINARY },
  manageGuardians: { permission: "patients.guardian.manage", feature: VETERINARY },
} as const satisfies Record<string, CapabilityRequirement>;

/**
 * What each encounter command needs ([[UX-037]]), mirroring
 * `apps/api/src/clinical/clinical.encounters.controller.ts` and
 * `clinical.links.controller.ts` (linking needs read + update), with the
 * `veterinary` entitlement `clinical.service.base.ts` re-checks. The POS
 * continuation needs what the counter it opens needs (`SALE_ACTIONS.sell`).
 */
export const ENCOUNTER_ACTIONS = {
  create: { permission: "vet.clinical.create", feature: VETERINARY },
  update: { permission: "vet.clinical.update", feature: VETERINARY },
  close: { permission: "vet.clinical.close", feature: VETERINARY },
  amend: { permission: "vet.clinical.amend", feature: VETERINARY },
  link: { permission: ["vet.clinical.read", "vet.clinical.update"], feature: VETERINARY },
  continueToSale: SALE_ACTIONS.sell,
} as const satisfies Record<string, CapabilityRequirement>;

/** The no-access state a patients route shows when the caller lacks its permission. */
export function PatientsNoAccess({
  title = "No tenés permiso para ver los pacientes",
}: {
  readonly title?: string;
}): JSX.Element {
  return (
    <EmptyState
      icon="shield"
      title={title}
      description="Pedile a quien administra la clínica que te habilite el acceso a los pacientes."
    />
  );
}
