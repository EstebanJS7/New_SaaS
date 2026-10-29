import Link from "next/link";
import type { JSX } from "react";
import { CustomerDetail } from "./customer-detail";

/**
 * Staff customer detail page.
 *
 * The interactive shell is a client component so loading, empty, error, and
 * mutation states remain explicit and reactive.
 */
export default function CustomerDetailPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <Link href="/app/customers" className="text-sm text-primary hover:underline">
        Volver al listado de clientes
      </Link>
      <CustomerDetail />
    </div>
  );
}
