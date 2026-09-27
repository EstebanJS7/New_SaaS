import type { JSX } from "react";
import { PurchaseDetail } from "./purchase-detail";

/**
 * Staff purchase detail page.
 *
 * The interactive shell stays a client component so the loading, error,
 * not-found and permission-denied states are explicit and reactive, while every
 * transition — the explicit receive and cancel commands — is a separate action
 * the API authorizes.
 */
export default function PurchaseDetailPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-4xl">
      <PurchaseDetail />
    </div>
  );
}
