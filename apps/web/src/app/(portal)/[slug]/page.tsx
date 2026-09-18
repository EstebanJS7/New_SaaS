import type { JSX } from "react";
import Link from "next/link";
import { TenantHeader } from "@/components/portal/tenant-header";
import { PortalNav } from "@/components/portal/portal-nav";
import { fetchPortalBrand } from "@/lib/portal-branding";

interface PortalPageProps {
  params: Promise<{ slug: string }> | { slug: string };
}

/**
 * Portal landing page.
 *
 * Proves the `(portal)/layout.tsx` brand resolution is applied: the tenant
 * header is rendered from the shared public brand helper (the same code path as
 * the layout, so no second branding request in production), and the page links
 * the holder into the one private surface that exists after this slice — the
 * pets list — through the portal-only navigation.
 */
export default async function PortalPage({ params }: PortalPageProps): Promise<JSX.Element> {
  const { slug } = await params;
  const branding = await fetchPortalBrand(slug);

  if (!branding.tenantFound) {
    return (
      <main
        className="flex flex-1 flex-col items-center justify-center p-6"
        data-testid="portal-not-found"
      >
        <h1 className="text-2xl font-bold text-foreground">Tenant not found</h1>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col">
      <TenantHeader
        productDisplayName={branding.productDisplayName}
        displayName={branding.displayName}
        brand={branding.brand}
      />
      <PortalNav slug={slug} />
      <section
        className="flex flex-1 flex-col items-center justify-center gap-4 p-6"
        data-testid="portal-landing"
      >
        <h1 className="text-2xl font-bold text-foreground">
          {branding.displayName ?? branding.productDisplayName}
        </h1>
        <Link
          href={`/${encodeURIComponent(slug)}/pets`}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          View my pets
        </Link>
      </section>
    </main>
  );
}
