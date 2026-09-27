import type { JSX } from "react";
import { SupplierList } from "./suppliers-list";

/**
 * Staff supplier index page.
 *
 * Data fetching and mutations live in the client list component so loading,
 * empty, error and permission-denied states are explicit and reactive.
 */
export default function SuppliersPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl">
      <SupplierList />
    </div>
  );
}
