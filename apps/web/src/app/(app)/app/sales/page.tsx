import type { JSX } from "react";
import { CounterSurface } from "./counter-surface";

/**
 * Staff POS counter page.
 *
 * Data fetching, the local cart and the completion commands live in the client
 * surface so loading, empty, error, permission-denied and entitlement-denied
 * states are explicit and reactive.
 */
export default function SalesPage(): JSX.Element {
  return <CounterSurface />;
}
