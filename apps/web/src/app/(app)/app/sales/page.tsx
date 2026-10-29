import type { JSX } from "react";
import { CounterSurface } from "./counter-surface";

/**
 * Staff POS counter page.
 *
 * Data fetching, the local cart and the completion commands live in the client
 * surface so loading, empty, error, permission-denied and entitlement-denied
 * states are explicit and reactive.
 */
export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{
    appointment?: string | string[];
    patient?: string | string[];
    encounter?: string | string[];
  }>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  return (
    <CounterSurface
      appointmentId={typeof params.appointment === "string" ? params.appointment : undefined}
      patientId={typeof params.patient === "string" ? params.patient : undefined}
      encounterId={typeof params.encounter === "string" ? params.encounter : undefined}
    />
  );
}
