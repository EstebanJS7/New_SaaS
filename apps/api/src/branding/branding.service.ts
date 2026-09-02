import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditAppendTx, AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import {
  BRAND_OVERRIDE_SCHEMA_VERSION,
  BrandOverrideValidationError,
  validateBrandOverride,
} from "./brand-override.zod.js";
import { activeProductPreset, resolveBrand } from "./brand-resolver.js";
import type { BrandingResponse, BrandOverride } from "./dto.js";

export interface TenantBrandingRow {
  id: string;
  tenantId: string;
  schemaVersion: number;
  overrides: unknown;
  updatedByUserProfileId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantBrandingDelegate {
  findUnique: (args: { where: { tenantId: string } }) => Promise<TenantBrandingRow | null>;
  upsert: (args: {
    where: { tenantId: string };
    create: {
      tenantId: string;
      schemaVersion: number;
      overrides: unknown;
      updatedByUserProfileId: string;
    };
    update: {
      schemaVersion: number;
      overrides: unknown;
      updatedByUserProfileId: string;
    };
  }) => Promise<TenantBrandingRow>;
  delete: (args: { where: { tenantId: string } }) => Promise<TenantBrandingRow>;
}

export interface BrandingPrisma {
  $transaction: <T>(work: (tx: BrandingTransaction) => Promise<T>) => Promise<T>;
  tenantBranding: TenantBrandingDelegate;
}

export interface BrandingTransaction {
  tenantBranding: TenantBrandingDelegate;
  auditLog: AuditAppendTx["auditLog"];
}

export interface UpdateBrandingInput {
  readonly overrides: unknown;
  readonly reason?: string;
}

export interface ResetBrandingInput {
  readonly reason?: string;
}

/**
 * Tenant-scoped branding management boundary.
 *
 * - Tenant identity is obtained exclusively from `RequestContextService`.
 * - Reads require authentication and active membership.
 * - Mutations additionally require `branding.settings.manage` and the
 *   `custom_branding` entitlement.
 * - Every successful write/reset co-commits an `AuditLog` row in the same
 *   transaction.
 * - Stored overrides are re-validated on every read to catch corrupt/legacy
 *   rows (design D1).
 */
@Injectable()
export class BrandingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: BrandingPrisma,
    private readonly requestContext: RequestContextService,
    private readonly entitlements: EntitlementsService,
    private readonly permissionResolver: PermissionResolver,
    private readonly audit: AuditWriter
  ) {}

  async get(): Promise<BrandingResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const row = await this.prisma.tenantBranding.findUnique({ where: { tenantId } });
    const overrides = this.parseStoredOverrides(row?.overrides);

    return {
      source: row === null ? "preset" : "tenant",
      brand: resolveBrand(activeProductPreset, undefined, overrides),
    };
  }

  async update(input: UpdateBrandingInput): Promise<BrandingResponse> {
    const tenantId = this.requestContext.requireTenantId();

    await this.requireManagePermission();
    await this.requireCustomBrandingEntitlement(tenantId);

    let overrides: BrandOverride;
    try {
      overrides = validateBrandOverride(input.overrides);
    } catch (error) {
      if (error instanceof BrandOverrideValidationError) {
        throw new DomainError(error.code, error.message, { cause: error });
      }
      throw error;
    }
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const saved = await this.prisma.$transaction(async (tx) => {
      const savedRow = await tx.tenantBranding.upsert({
        where: { tenantId },
        create: {
          tenantId,
          schemaVersion: BRAND_OVERRIDE_SCHEMA_VERSION,
          overrides,
          updatedByUserProfileId: actorUserProfileId,
        },
        update: {
          schemaVersion: BRAND_OVERRIDE_SCHEMA_VERSION,
          overrides,
          updatedByUserProfileId: actorUserProfileId,
        },
      });

      await this.audit.append(
        {
          action: "branding.updated",
          tenantId,
          actorUserProfileId,
          targetType: "tenant_branding",
          targetId: savedRow.id,
          metadata: {
            schemaVersion: BRAND_OVERRIDE_SCHEMA_VERSION,
            reason: input.reason ?? null,
          },
        },
        tx
      );

      return savedRow;
    });

    return {
      source: "tenant",
      brand: resolveBrand(
        activeProductPreset,
        undefined,
        this.parseStoredOverrides(saved.overrides)
      ),
    };
  }

  async reset(input: ResetBrandingInput): Promise<BrandingResponse> {
    const tenantId = this.requestContext.requireTenantId();

    await this.requireManagePermission();
    await this.requireCustomBrandingEntitlement(tenantId);

    const actorUserProfileId = this.requestContext.requireUserProfileId();

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.tenantBranding.findUnique({ where: { tenantId } });
      if (existing) {
        await tx.tenantBranding.delete({ where: { tenantId } });
      }

      await this.audit.append(
        {
          action: "branding.reset",
          tenantId,
          actorUserProfileId,
          targetType: "tenant_branding",
          targetId: existing?.id ?? tenantId,
          metadata: {
            schemaVersion: BRAND_OVERRIDE_SCHEMA_VERSION,
            reason: input.reason ?? null,
            hadExistingRow: existing !== null,
          },
        },
        tx
      );
    });

    return {
      source: "preset",
      brand: resolveBrand(activeProductPreset),
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

  private async requireManagePermission(): Promise<void> {
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has("branding.settings.manage")) {
      throw new DomainError("FORBIDDEN", "The required branding permission is missing.");
    }
  }

  private async requireCustomBrandingEntitlement(tenantId: string): Promise<void> {
    if (!(await this.entitlements.has(tenantId, "custom_branding"))) {
      throw new DomainError(
        "FEATURE_NOT_ENTITLED",
        "Custom branding is not enabled for this tenant."
      );
    }
  }
}
