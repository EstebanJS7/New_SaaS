import type { JSX } from "react";
import type { ResolvedBrand } from "@newsaas/ui/branding";

interface TenantHeaderProps {
  readonly productDisplayName: string;
  readonly displayName?: string;
  readonly brand: ResolvedBrand;
}

interface TenantLogoProps {
  readonly src: string;
  readonly alt: string;
}

/**
 * Tenant logo image contract: every rendered variant keeps the same box and a
 * meaningful `alt` so the identity stays visible and accessible in all modes.
 */
function TenantLogo({ src, alt }: TenantLogoProps): JSX.Element {
  return (
    <img
      src={src}
      alt={alt}
      width={120}
      height={40}
      className="h-10 w-auto object-contain"
      data-testid="tenant-logo"
    />
  );
}

/**
 * Portal tenant header.
 *
 * Renders the resolved public identity: light/dark logos through a `<picture>`
 * source that respects `prefers-color-scheme`, a plain `<img>` fallback when
 * only the dark logo exists (a `<picture>` with only a `<source>` paints
 * nothing in the light scheme), a favicon preview, the tenant or product
 * display name, and the resolved primary/accent tokens through the CSS
 * variable bridge. No client-side fetches.
 */
export function TenantHeader({
  productDisplayName,
  displayName,
  brand,
}: TenantHeaderProps): JSX.Element {
  const identityName = displayName ?? productDisplayName;
  const logoLight = brand.assets?.logoLightUrl;
  const logoDark = brand.assets?.logoDarkUrl;
  const favicon = brand.assets?.faviconUrl;

  return (
    <header
      data-testid="tenant-header"
      className="flex h-16 items-center justify-between border-b bg-card px-6"
    >
      <div className="flex items-center gap-3">
        {logoLight ? (
          <picture>
            {logoDark ? <source srcSet={logoDark} media="(prefers-color-scheme: dark)" /> : null}
            <TenantLogo src={logoLight} alt={identityName} />
          </picture>
        ) : logoDark ? (
          <TenantLogo src={logoDark} alt={identityName} />
        ) : null}
        {favicon ? (
          <img
            src={favicon}
            alt={`${identityName} favicon`}
            width={32}
            height={32}
            className="h-8 w-8 object-contain"
            data-testid="tenant-favicon"
          />
        ) : null}
        <span
          className="text-lg font-semibold text-foreground"
          style={{ color: "var(--primary)" }}
          data-testid="tenant-name"
        >
          {identityName}
        </span>
      </div>
    </header>
  );
}
