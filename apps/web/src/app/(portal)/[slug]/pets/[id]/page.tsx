import type { JSX } from "react";
import { TenantHeader } from "@/components/portal/tenant-header";
import { PortalNav } from "@/components/portal/portal-nav";
import { fetchPortalBrand } from "@/lib/portal-branding";
import { PortalPetDetailView } from "./portal-pet-detail";

interface PortalPetDetailPageProps {
  params: Promise<{ slug: string; id: string }> | { slug: string; id: string };
}

/**
 * Portal pet detail page.
 *
 * Thin server component: shared public brand for the header plus the interactive
 * detail view. The view owns loading, denied, error, not-found and success so a
 * masked (not-the-holder's) pet and a genuinely missing pet are handled by the
 * same honest not-found copy.
 */
export default async function PortalPetDetailPage({
  params,
}: PortalPetDetailPageProps): Promise<JSX.Element> {
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
        <PortalPetDetailView petId={id} />
      </section>
    </main>
  );
}
