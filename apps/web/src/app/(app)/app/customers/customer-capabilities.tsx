import type { JSX } from "react";
import { EmptyState } from "@/components/feedback";
import type { CapabilityRequirement } from "@/lib/capabilities";

/**
 * What each customers action needs ([[UX-037]]), mirroring the API guards in
 * `apps/api/src/customers/customers.controller.ts`,
 * `customer-search.controller.ts`, `customer-addresses.controller.ts` and
 * `customer-contacts.controller.ts`. UX only: unknown capabilities offer
 * everything and the API stays the authority.
 */
export const CUSTOMER_ACTIONS = {
  read: { permission: "customers.read" },
  create: { permission: "customers.create" },
  update: { permission: "customers.update" },
  deactivate: { permission: "customers.deactivate" },
  manageAddresses: { permission: "customers.address.manage" },
  manageContacts: { permission: "customers.contact.manage" },
} as const satisfies Record<string, CapabilityRequirement>;

/** The no-access state a customers route shows when the caller lacks its permission. */
export function CustomersNoAccess({
  title = "No tenés permiso para ver los clientes",
}: {
  readonly title?: string;
}): JSX.Element {
  return (
    <EmptyState
      icon="shield"
      title={title}
      description="Pedile a quien administra la clínica que te habilite el acceso a los clientes."
    />
  );
}
