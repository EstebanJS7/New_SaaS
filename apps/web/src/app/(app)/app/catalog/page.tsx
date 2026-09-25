import type { JSX } from "react";
import { CatalogList } from "./catalog-list";

/**
 * Staff catalog index page.
 *
 * Data fetching and mutations live in the client list component so loading,
 * empty, error and permission-denied states are explicit and reactive.
 */
export default function CatalogPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl">
      <CatalogList />
    </div>
  );
}
