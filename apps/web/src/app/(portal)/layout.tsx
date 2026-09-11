import type { JSX, ReactNode } from "react";
import { headers } from "next/headers";
import { activeProductPreset, resolveBrand, type ResolvedBrand } from "@newsaas/ui/branding";
import { appearanceBootstrapScriptWithTenantDefault } from "@/lib/appearance";
import { brandStyleCss } from "@/lib/brand-style";
import { publicBrandingDtoToResolvedBrand, type PublicBrandingDto } from "@/lib/public-branding";

const DEFAULT_API_URL = "http://localhost:3001";

interface PortalLayoutProps {
  children: ReactNode;
  params: Promise<{ slug?: string }> | { slug?: string };
}

/**
 * Portal shell layout.
 *
 * Unauthenticated: it resolves the tenant from the `[slug]` path parameter or
 * the `x-tenant-slug` header, then calls the public branding endpoint without
 * forwarding any staff cookies. The resolved public brand is emitted as the
 * same parser-blocking bootstrap script and `<style>` bridge used by the staff
 * shell, so both surfaces render identical identity tokens.
 */
export default async function PortalLayout({
  children,
  params,
}: PortalLayoutProps): Promise<JSX.Element> {
  const resolvedParams = await params;
  let slug = resolvedParams.slug;

  if (!slug) {
    const headerStore = await headers();
    // Middleware forwards an empty value on non-portal paths; treat it as absent.
    const headerSlug = headerStore.get("x-tenant-slug");
    if (headerSlug) {
      slug = headerSlug;
    }
  }

  const brand = await fetchPublicBrand(slug);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <script
        dangerouslySetInnerHTML={{
          __html: appearanceBootstrapScriptWithTenantDefault(brand.defaultAppearance),
        }}
      />
      <style dangerouslySetInnerHTML={{ __html: brandStyleCss(brand) }} />
      {children}
    </div>
  );
}

async function fetchPublicBrand(slug?: string): Promise<ResolvedBrand> {
  const effectiveSlug = slug ?? activeProductPreset.productName;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;

  try {
    const response = await fetch(
      `${apiUrl}/api/v1/public/tenants/${encodeURIComponent(effectiveSlug)}/branding`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      return resolveBrand(activeProductPreset);
    }

    const dto = (await response.json()) as PublicBrandingDto;
    return publicBrandingDtoToResolvedBrand(dto);
  } catch {
    return resolveBrand(activeProductPreset);
  }
}
