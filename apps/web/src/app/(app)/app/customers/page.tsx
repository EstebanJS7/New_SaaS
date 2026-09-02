import type { JSX } from "react";
import { CustomersList } from "./customers-list";

/**
 * Staff customers index page.
 *
 * Data fetching and mutations live in the client list component so loading,
 * empty, error, and success states are explicit and reactive.
 */
export default function CustomersPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl">
      <CustomersList />
    </div>
  );
}
