import { Controller, Get, Param } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { Public } from "../auth/public.decorator.js";
import { validateBrandOverride } from "./brand-override.zod.js";
import { activeProductPreset } from "./brand-resolver.js";
import { BrandingResolver } from "./branding-resolver.js";
import type { BrandOverride, PublicBrandingDto } from "./dto.js";

/**
 * Unauthenticated public branding resolution surface.
 *
 * Exposes only the allowlisted v1 PUBLIC tokens plus the product display name.
 * Internal fields (`tenantId`, `slug`, `updatedBy`, assetKey, bucket, audit,
 * membership, RUC, billing secrets) are never returned, and corrupt stored
 * rows degrade to the preset-only fallback rather than leaking validation
 * details.
 */
@Controller("api/v1/public/tenants")
export class PublicBrandingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: BrandingResolver
  ) {}

  @Public()
  @Get(":slug/branding")
  async getBySlug(@Param("slug") slug: string): Promise<PublicBrandingDto> {
    // Active-only resolution (DEC-005 + ADR-004): a SUSPENDED tenant is absent
    // from this lookup, so it follows the exact same NOT_FOUND path as an
    // unknown slug. No existence signal, no status signal.
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug, status: "ACTIVE" },
      select: { id: true },
    });

    if (!tenant) {
      throw new DomainError("NOT_FOUND", "Tenant not found.");
    }

    const row = await this.prisma.tenantBranding.findUnique({
      where: { tenantId: tenant.id },
    });

    const overrides = this.parseStoredOverrides(row?.overrides ?? null);
    const brand = await this.resolver.resolveBrandForTenant(tenant.id, overrides);

    const dto: PublicBrandingDto = {
      productDisplayName: activeProductPreset.productName,
      displayName: row?.displayName ?? undefined,
      primary: overrides?.primary,
      accent: overrides?.accent,
      radius: overrides?.radius,
      defaultAppearance: overrides?.defaultAppearance,
      logoLightUrl: brand.assets?.logoLightUrl,
      logoDarkUrl: brand.assets?.logoDarkUrl,
      faviconUrl: brand.assets?.faviconUrl,
    };

    assertPublicBrandingDto(dto);
    return dto;
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

const ALLOWED_PUBLIC_KEYS = new Set<keyof PublicBrandingDto>([
  "productDisplayName",
  "displayName",
  "primary",
  "accent",
  "radius",
  "defaultAppearance",
  "logoLightUrl",
  "logoDarkUrl",
  "faviconUrl",
]);

const FORBIDDEN_PRIVATE_SUBSTRINGS = [
  "assetKey",
  "bucket",
  "tenantId",
  "updatedBy",
  "audit",
  "membership",
  "ruc",
  "billingSecret",
];

/**
 * Fail-closed guard: if a future refactor accidentally adds a private field to
 * the public DTO, the response is blocked instead of leaked. The check is
 * performed server-side on the emitted object so tests can assert on the
 * actual response shape.
 */
function assertPublicBrandingDto(dto: PublicBrandingDto): void {
  for (const key of Object.keys(dto)) {
    if (!ALLOWED_PUBLIC_KEYS.has(key as keyof PublicBrandingDto)) {
      throw new DomainError("INTERNAL", `Public branding DTO contains a disallowed field: ${key}.`);
    }
  }

  const serialized = JSON.stringify(dto);
  for (const forbidden of FORBIDDEN_PRIVATE_SUBSTRINGS) {
    if (serialized.includes(forbidden)) {
      throw new DomainError(
        "INTERNAL",
        `Public branding DTO contains a disallowed value fragment: ${forbidden}.`
      );
    }
  }
}
