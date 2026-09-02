import { Controller, Get, Param } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { Public } from "../auth/public.decorator.js";
import { validateBrandOverride } from "./brand-override.zod.js";
import { activeProductPreset } from "./brand-resolver.js";
import type { BrandOverride, PublicBrandingDto } from "./dto.js";

/**
 * Unauthenticated public branding resolution surface.
 *
 * Exposes only the allowlisted v1 PUBLIC tokens plus the product display name.
 * Internal fields (`tenantId`, `slug`, `updatedBy`, audit material) are never
 * returned, and corrupt stored rows degrade to the preset-only fallback rather
 * than leaking validation details.
 */
@Controller("api/v1/public/tenants")
export class PublicBrandingController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get(":slug/branding")
  async getBySlug(@Param("slug") slug: string): Promise<PublicBrandingDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!tenant) {
      throw new DomainError("NOT_FOUND", "Tenant not found.");
    }

    const row = await this.prisma.tenantBranding.findUnique({
      where: { tenantId: tenant.id },
    });

    const overrides = this.parseStoredOverrides(row?.overrides ?? null);

    return {
      productDisplayName: activeProductPreset.productName,
      primary: overrides?.primary,
      accent: overrides?.accent,
      radius: overrides?.radius,
      defaultAppearance: overrides?.defaultAppearance,
    };
  }

  private parseStoredOverrides(stored: unknown): BrandOverride | null {
    if (stored === undefined || stored === null) {
      return null;
    }
    try {
      return validateBrandOverride(stored);
    } catch {
      // Public surface stays available: a corrupt stored row is surfaced to
      // staff via the private endpoint, while public callers see the product
      // preset fallback.
      return null;
    }
  }
}
