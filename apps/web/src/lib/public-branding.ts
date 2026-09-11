import {
  activeProductPreset,
  resolveBrand,
  type DefaultAppearance,
  type ResolvedBrand,
} from "@newsaas/ui/branding";

/**
 * Public safe branding DTO consumed by the portal shell.
 *
 * INTERNAL fields (`tenantId`, `slug`, `updatedBy`, assetKey, bucket, audit,
 * membership, RUC, billing secrets) are never exposed by the API; this local
 * type mirrors the allowlisted server contract so the portal never depends on
 * private backend shapes.
 */
export interface PublicBrandingDto {
  readonly productDisplayName: string;
  readonly displayName?: string;
  readonly primary?: string;
  readonly accent?: string;
  readonly radius?: string;
  readonly defaultAppearance?: DefaultAppearance;
  readonly logoLightUrl?: string;
  readonly logoDarkUrl?: string;
  readonly faviconUrl?: string;
}

/**
 * Convert the public safe DTO into the same `ResolvedBrand` shape used by the
 * staff shell. This keeps portal rendering preset-agnostic and guarantees that
 * only public fields reach components.
 */
export function publicBrandingDtoToResolvedBrand(dto: PublicBrandingDto): ResolvedBrand {
  const override =
    dto.primary || dto.accent || dto.radius || dto.defaultAppearance
      ? {
          schemaVersion: 1 as const,
          ...(dto.primary ? { primary: dto.primary } : {}),
          ...(dto.accent ? { accent: dto.accent } : {}),
          ...(dto.radius ? { radius: dto.radius } : {}),
          ...(dto.defaultAppearance ? { defaultAppearance: dto.defaultAppearance } : {}),
        }
      : null;

  const base = resolveBrand(activeProductPreset, undefined, override);

  const assets: ResolvedBrand["assets"] =
    dto.logoLightUrl || dto.logoDarkUrl || dto.faviconUrl
      ? {
          ...(dto.logoLightUrl ? { logoLightUrl: dto.logoLightUrl } : {}),
          ...(dto.logoDarkUrl ? { logoDarkUrl: dto.logoDarkUrl } : {}),
          ...(dto.faviconUrl ? { faviconUrl: dto.faviconUrl } : {}),
        }
      : undefined;

  return { ...base, assets };
}
