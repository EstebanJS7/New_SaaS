import type { JSX } from "react";
import { BillingSurface } from "./billing-surface";

/**
 * Staff Billing route.
 *
 * Data fetching and the create, confirm and cancel commands live in the client
 * surface so loading, empty, error, permission-denied and entitlement-denied
 * states are explicit and reactive.
 */
export default function BillingPage(): JSX.Element {
  return <BillingSurface />;
}
