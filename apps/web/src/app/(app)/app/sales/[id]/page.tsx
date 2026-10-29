import Link from "next/link";
import type { JSX } from "react";
import { SaleDetail } from "./sale-detail";

/**
 * Staff sale detail route.
 *
 * Reopens a sale by id through the client detail component so the loading,
 * error, not-found, permission-denied and entitlement-denied states are explicit
 * and reactive.
 */
export default function SaleDetailPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <Link href="/app/sales/history" className="text-sm text-primary hover:underline">
        Volver al listado de ventas
      </Link>
      <SaleDetail />
    </div>
  );
}
