import type { JSX, ReactNode } from "react";
import { headers } from "next/headers";
import { appearanceBootstrapScriptWithTenantDefault } from "@/lib/appearance";
import { brandStyleCss } from "@/lib/brand-style";
import { fetchPortalBrand } from "@/lib/portal-branding";

interface PortalLayoutProps {
  children: ReactNode;
  params: Promise<{ slug?: string }> | { slug?: string };
}

/**
 * Portal shell layout.
 *
 * Unauthenticated: it resolves the tenant from the `[slug]` path parameter or
 * the `x-tenant-slug` header, then resolves the public brand through the shared
 * `fetchPortalBrand` helper (the same code path every portal page uses, so the
 * anonymous branding read is deduplicated per request). No staff cookie is
 * forwarded. The resolved public brand is emitted as the same parser-blocking
 * bootstrap script and `<style>` bridge used by the staff shell, so both
 * surfaces render identical identity tokens.
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

  const { brand } = await fetchPortalBrand(slug);

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
