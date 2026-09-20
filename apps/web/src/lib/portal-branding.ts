import { cache } from "react";
import { activeProductPreset, resolveBrand, type ResolvedBrand } from "@newsaas/ui/branding";
import { publicBrandingDtoToResolvedBrand, type PublicBrandingDto } from "@/lib/public-branding";

const DEFAULT_API_URL = "http://localhost:3001";

/**
 * Public, anonymous brand resolution shared by the portal layout and pages.
 *
 * `PublicBrandingDto` flows through the same allowlisted mapper as before; this
 * wrapper adds the two facts a page also needs beyond the resolved brand: the
 * display identity for `TenantHeader` and whether the tenant was actually
 * found (so the landing page can keep its honest "tenant not found" branch).
 */
export interface PortalBrandResolution {
  readonly brand: ResolvedBrand;
  readonly productDisplayName: string;
  readonly displayName?: string;
  /** False when the tenant branding read failed, 404'd, or was unreachable. */
  readonly tenantFound: boolean;
}

/**
 * Resolves the tenant's public brand once per server request.
 *
 * The portal layout and every portal page need the brand (the pages also render
 * `TenantHeader`), and each call is an unauthenticated branding request. This
 * helper is the single shared code path, and `cache()` collapses repeated calls
 * with the same slug into one fetch for the lifetime of a request/render pass.
 *
 * Next.js constraint: a layout cannot hand server-resolved data down to its
 * child pages, so the pages cannot receive the layout's brand as a prop; they
 * must be able to resolve it themselves. React's request-scoped `cache()` is
 * therefore the deduplication mechanism, not a plain module constant (which
 * would leak one tenant's brand across tenants).
 *
 * Slug provenance differs by caller: the `(portal)` layout resolves the slug
 * from `params` or the middleware-set `x-tenant-slug` header, while a page
 * resolves it from its own `[slug]` segment. In production those are the same
 * value, so the cache keys match and one fetch serves both. If they ever
 * diverge, each distinct slug gets its own fetch AND the two callers would
 * render two different brands on one page — layout chrome from one tenant's
 * preset, header identity and assets from another's. The dedup is not the only
 * thing at stake: keep the two sources of truth aligned.
 */
export const fetchPortalBrand = cache(async (slug?: string): Promise<PortalBrandResolution> => {
  const effectiveSlug = slug ?? activeProductPreset.productName;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;

  try {
    const response = await fetch(
      `${apiUrl}/api/v1/public/tenants/${encodeURIComponent(effectiveSlug)}/branding`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      return fallbackPortalBrand();
    }

    const dto = (await response.json()) as PublicBrandingDto;
    return {
      brand: publicBrandingDtoToResolvedBrand(dto),
      productDisplayName: dto.productDisplayName,
      ...(dto.displayName ? { displayName: dto.displayName } : {}),
      tenantFound: true,
    };
  } catch {
    return fallbackPortalBrand();
  }
});

/** Product-preset brand used whenever the tenant identity cannot be resolved. */
function fallbackPortalBrand(): PortalBrandResolution {
  return {
    brand: resolveBrand(activeProductPreset),
    productDisplayName: activeProductPreset.productName,
    tenantFound: false,
  };
}
