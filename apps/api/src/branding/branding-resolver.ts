import { Inject, Injectable } from "@nestjs/common";
// Value import (not `import type`): the DI token must exist at runtime.
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { activeProductPreset, resolveBrand } from "./brand-resolver.js";
import { BrandOverrideValidationError, validateBrandOverride } from "./brand-override.zod.js";
import { BrandingAssetDeliveryService } from "./branding-asset-delivery.service.js";
import { BrandingCache, computeBrandingRevision } from "./branding-cache.js";
import type { BrandOverride, BrandingResponse, ResolvedAssets, ResolvedBrand } from "./dto.js";

interface TenantBrandingWithAssets {
  id?: string;
  updatedAt: Date;
  overrides: unknown;
  displayName?: string | null;
  logoLightAssetId?: string | null;
  logoDarkAssetId?: string | null;
  faviconAssetId?: string | null;
  logoLightAsset: { id: string; updatedAt: Date } | null;
  logoDarkAsset: { id: string; updatedAt: Date } | null;
  faviconAsset: { id: string; updatedAt: Date } | null;
}

/**
 * Cached, asset-aware brand resolver.
 *
 * - Computes a revision token from the tenant branding row and its linked
 *   assets so any mutation automatically invalidates prior cache entries.
 * - Signs a single canonical API-local URL form for assets; storage
 *   keys/buckets/paths never leave the server.
 * - Used by both the private staff endpoint and the unauthenticated public
 *   endpoint. Branding assets are intentionally public, so both surfaces
 *   resolve the exact same canonical URL and share one cache entry — the
 *   authoritative "staff and portal render the same identity" invariant.
 */
@Injectable()
export class BrandingResolver {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly cache: BrandingCache,
    private readonly delivery: BrandingAssetDeliveryService
  ) {}

  /**
   * Resolves the complete brand for a tenant, including signed asset URLs.
   * Throws if stored overrides are corrupt (private surfaces must surface
   * validation errors to staff).
   */
  async resolveSourceAndBrand(tenantId: string): Promise<BrandingResponse> {
    const row = await this.loadRow(tenantId);
    const overrides = this.parseStoredOverrides(row?.overrides ?? null);
    const brand = await this.resolveBrand(tenantId, row, overrides);
    return { source: row === null ? "preset" : "tenant", brand };
  }

  /**
   * Resolves the brand for a tenant using the supplied overrides. This lets
   * the public endpoint degrade corrupt stored rows to the preset fallback
   * without losing the tenant's linked assets.
   *
   * Both audiences resolve the same canonical public API-local HMAC URL: the
   * branding assets are intentionally public, so the rendered identity must
   * not depend on which surface asked. Staff management routes stay protected
   * separately (upload/remove/private content), so this is a rendering
   * unification, not an authorization change.
   */
  async resolveBrandForTenant(
    tenantId: string,
    overrides: BrandOverride | null
  ): Promise<ResolvedBrand> {
    const row = await this.loadRow(tenantId);
    return this.resolveBrand(tenantId, row, overrides);
  }

  private async resolveBrand(
    tenantId: string,
    row: TenantBrandingWithAssets | null,
    overrides: BrandOverride | null
  ): Promise<ResolvedBrand> {
    const assets = [row?.logoLightAsset, row?.logoDarkAsset, row?.faviconAsset].filter(
      (asset): asset is { id: string; updatedAt: Date } => asset !== null && asset !== undefined
    );

    // No audience segment: staff and portal must share one resolved identity.
    const revision = computeBrandingRevision(row, assets);

    return this.cache.getOrLoad({
      tenantId,
      revision,
      loader: async () => {
        const base = resolveBrand(activeProductPreset, undefined, overrides);
        const resolvedAssets = await this.resolveAssetUrls(tenantId, row);
        return { ...base, assets: resolvedAssets };
      },
    });
  }

  private async resolveAssetUrls(
    tenantId: string,
    row: TenantBrandingWithAssets | null
  ): Promise<ResolvedAssets | undefined> {
    const assets: ResolvedAssets = {
      ...(row?.logoLightAsset
        ? {
            logoLightUrl: await this.delivery.signClientUrlForTenant(
              tenantId,
              "logoLight",
              row.logoLightAsset.id,
              "public"
            ),
          }
        : {}),
      ...(row?.logoDarkAsset
        ? {
            logoDarkUrl: await this.delivery.signClientUrlForTenant(
              tenantId,
              "logoDark",
              row.logoDarkAsset.id,
              "public"
            ),
          }
        : {}),
      ...(row?.faviconAsset
        ? {
            faviconUrl: await this.delivery.signClientUrlForTenant(
              tenantId,
              "favicon",
              row.faviconAsset.id,
              "public"
            ),
          }
        : {}),
    };
    return Object.keys(assets).length > 0 ? assets : undefined;
  }

  private async loadRow(tenantId: string): Promise<TenantBrandingWithAssets | null> {
    const row = await this.prisma.tenantBranding.findUnique({ where: { tenantId } });
    if (!row) {
      return null;
    }

    const [logoLightAsset, logoDarkAsset, faviconAsset] = await Promise.all([
      row.logoLightAssetId
        ? this.prisma.brandingAsset.findUnique({ where: { id: row.logoLightAssetId } })
        : null,
      row.logoDarkAssetId
        ? this.prisma.brandingAsset.findUnique({ where: { id: row.logoDarkAssetId } })
        : null,
      row.faviconAssetId
        ? this.prisma.brandingAsset.findUnique({ where: { id: row.faviconAssetId } })
        : null,
    ]);

    return {
      ...row,
      logoLightAsset,
      logoDarkAsset,
      faviconAsset,
    };
  }

  private parseStoredOverrides(stored: unknown): BrandOverride | null {
    if (stored === undefined || stored === null) {
      return null;
    }
    try {
      return validateBrandOverride(stored);
    } catch (error) {
      if (error instanceof BrandOverrideValidationError) {
        throw new DomainError(
          "VALIDATION_FAILED",
          `Stored branding overrides are invalid: ${error.code}.`
        );
      }
      throw error;
    }
  }
}
