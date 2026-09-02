import type { JSX } from "react";
import { CustomerDetail } from "./customer-detail";

/**
 * Staff customer detail page.
 *
 * The interactive shell is a client component so loading, empty, error, and
 * mutation states remain explicit and reactive.
 */
export default function CustomerDetailPage(): JSX.Element {
  return <CustomerDetail />;
}
