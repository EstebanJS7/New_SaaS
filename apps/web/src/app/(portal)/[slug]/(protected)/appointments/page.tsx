import type { JSX } from "react";
import { TenantHeader } from "@/components/portal/tenant-header";
import { PortalNav } from "@/components/portal/portal-nav";
import { fetchPortalBrand } from "@/lib/portal-branding";
import { PortalAppointmentsView } from "./portal-appointments";

interface PortalAppointmentsPageProps {
  params: Promise<{ slug: string }> | { slug: string };
}

/**
 * Portal appointments page.
 *
 * Thin server component: it resolves the shared public brand for the header
 * (deduplicated with the layout by `fetchPortalBrand`) and hands the interactive
 * list its slug. All fetching of holder data happens in the client component so
 * loading/empty/error/denied states stay reactive.
 */
export default async function PortalAppointmentsPage({
  params,
}: PortalAppointmentsPageProps): Promise<JSX.Element> {
  const { slug } = await params;
  const branding = await fetchPortalBrand(slug);

  return (
    <main className="flex flex-1 flex-col">
      <TenantHeader
        productDisplayName={branding.productDisplayName}
        displayName={branding.displayName}
        brand={branding.brand}
      />
      <PortalNav slug={slug} />
      <section className="flex-1 p-6">
        <PortalAppointmentsView slug={slug} />
      </section>
    </main>
  );
}
