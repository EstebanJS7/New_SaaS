import type { JSX } from "react";
import { CashSurface } from "./cash-surface";

/**
 * Staff Cash route.
 *
 * Data fetching and the register, session, movement and close commands live in
 * the client surface so loading, empty, error, permission-denied and
 * entitlement-denied states are explicit and reactive.
 */
export default function CashPage(): JSX.Element {
  return <CashSurface />;
}
