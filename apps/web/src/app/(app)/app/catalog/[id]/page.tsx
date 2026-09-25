import type { JSX } from "react";
import { CatalogItemDetail } from "./catalog-item-detail";

/**
 * Staff catalog item detail page.
 *
 * Read-only by design: the interactive shell stays a client component so the
 * loading, error and permission-denied states are explicit and reactive, while
 * every write stays on the separate edit route the API authorizes.
 */
export default function CatalogItemDetailPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl">
      <CatalogItemDetail />
    </div>
  );
}
