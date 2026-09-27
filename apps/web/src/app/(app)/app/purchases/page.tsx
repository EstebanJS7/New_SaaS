import type { JSX } from "react";
import { PurchaseList } from "./purchases-list";

/**
 * Staff purchase index page.
 *
 * Data fetching and mutations live in the client list component so loading,
 * empty, error and permission-denied states are explicit and reactive.
 */
export default function PurchasesPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl">
      <PurchaseList />
    </div>
  );
}
