import type { JSX } from "react";
import { TenantHeader } from "@/components/portal/tenant-header";
import { publicBrandingDtoToResolvedBrand, type PublicBrandingDto } from "@/lib/public-branding";

const DEFAULT_API_URL = "http://localhost:3001";

interface PortalPageProps {
  params: Promise<{ slug: string }> | { slug: string };
}

/**
 * Minimal portal landing page.
 *
 * Proves the `(portal)/layout.tsx` brand resolution is applied: the tenant
 * header is rendered using only the public safe DTO, with no staff cookies and
 * no private fields.
 */
export default async function PortalPage({ params }: PortalPageProps): Promise<JSX.Element> {
  const { slug } = await params;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;

  const response = await fetch(
    `${apiUrl}/api/v1/public/tenants/${encodeURIComponent(slug)}/branding`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    return (
      <main
        className="flex flex-1 flex-col items-center justify-center p-6"
        data-testid="portal-not-found"
      >
        <h1 className="text-2xl font-bold text-foreground">Tenant not found</h1>
      </main>
    );
  }

  const dto = (await response.json()) as PublicBrandingDto;
  const brand = publicBrandingDtoToResolvedBrand(dto);

  return (
    <main className="flex flex-1 flex-col">
      <TenantHeader
        productDisplayName={dto.productDisplayName}
        displayName={dto.displayName}
        brand={brand}
      />
      <section
        className="flex flex-1 flex-col items-center justify-center p-6"
        data-testid="portal-landing"
      >
        <h1 className="text-2xl font-bold text-foreground">
          {dto.displayName ?? dto.productDisplayName}
        </h1>
      </section>
    </main>
  );
}
