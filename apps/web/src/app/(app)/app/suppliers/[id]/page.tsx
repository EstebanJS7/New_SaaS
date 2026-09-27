import type { JSX } from "react";
import { SupplierDetail } from "./supplier-detail";

/**
 * Staff supplier detail page.
 *
 * Read-only by design: the interactive shell stays a client component so the
 * loading, error, not-found and permission-denied states are explicit and
 * reactive, while every write — including the deactivation that is the only
 * removal — stays on a separate route the API authorizes.
 */
export default function SupplierDetailPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl">
      <SupplierDetail />
    </div>
  );
}
