import type { JSX } from "react";
import { TenantHeader } from "@/components/portal/tenant-header";
import { PortalNav } from "@/components/portal/portal-nav";
import { fetchPortalBrand } from "@/lib/portal-branding";
import { PortalBookingGrid } from "./portal-booking-grid";

interface PortalBookingPageProps {
  params: Promise<{ slug: string; id: string }> | { slug: string; id: string };
}

/**
 * Portal booking page.
 *
 * Thin server component: it resolves the shared public brand for the header and
 * hands the interactive grid its tenant slug and pet id. All holder-data
 * fetching happens in the client component so loading/empty/error/denied and
 * submission states stay reactive.
 */
export default async function PortalBookingPage({
  params,
}: PortalBookingPageProps): Promise<JSX.Element> {
  const { slug, id } = await params;
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
        <PortalBookingGrid slug={slug} petId={id} />
      </section>
    </main>
  );
}
