import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditAppendTx, AuditWriter } from "../audit/audit-writer.service.js";
import { toLoggableError } from "../common/errors/loggable-error.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import {
  BRAND_OVERRIDE_SCHEMA_VERSION,
  BrandOverrideValidationError,
  validateBrandOverride,
} from "./brand-override.zod.js";
import type { BrandingResponse, BrandOverride } from "./dto.js";
import { BrandingCache } from "./branding-cache.js";
import { BrandingResolver } from "./branding-resolver.js";
import {
  BRANDING_RESET_CLEANUP_PRODUCER,
  type CleanupProducer,
} from "./branding-reset-cleanup.producer.js";

export interface TenantBrandingRow {
  id: string;
  tenantId: string;
  schemaVersion: number;
  overrides: unknown;
  /** Nullable asset FKs; present on rows read through the generated client. */
  logoLightAssetId?: string | null;
  logoDarkAssetId?: string | null;
  faviconAssetId?: string | null;
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

/** Tenant-owned asset row shape consumed by the reset cleanup. */
export interface BrandingAssetRow {
  id: string;
  tenantId: string;
  kind: string;
  assetKey: string;
}

export interface BrandingAssetDelegate {
  findMany: (args: { where: { tenantId: string } }) => Promise<BrandingAssetRow[]>;
  delete: (args: { where: { id: string } }) => Promise<BrandingAssetRow>;
}

/** Durable cleanup-intent row created inside the reset transaction. */
export interface BrandingResetCleanupIntentRow {
  id: string;
}

export interface BrandingResetCleanupIntentDelegate {
  create: (args: {
    data: {
      tenantId: string;
      resetAuditId: string | null;
      requestedByUserProfileId: string | null;
      storageKeys: string[];
    };
  }) => Promise<BrandingResetCleanupIntentRow>;
}

export interface BrandingPrisma {
  $transaction: <T>(work: (tx: BrandingTransaction) => Promise<T>) => Promise<T>;
  tenantBranding: TenantBrandingDelegate;
}

export interface BrandingTransaction {
  tenantBranding: TenantBrandingDelegate;
  brandingAsset: BrandingAssetDelegate;
  brandingResetCleanupIntent: BrandingResetCleanupIntentDelegate;
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
 * - `reset()` clears the tenant branding row and every linked `BrandingAsset`
 *   row inside the same transaction, co-commits one durable cleanup intent for
 *   the captured storage keys, and enqueues that intent after commit. Storage
 *   is never touched in-request; a same-kind re-upload is never blocked by
 *   `P2002`, and a failed enqueue leaves the intent PENDING for reconciliation.
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
    private readonly audit: AuditWriter,
    private readonly resolver: BrandingResolver,
    private readonly cache: BrandingCache,
    @Inject(BRANDING_RESET_CLEANUP_PRODUCER) private readonly cleanupProducer: CleanupProducer
  ) {}

  async get(): Promise<BrandingResponse> {
    const tenantId = this.requestContext.requireTenantId();
    return this.resolver.resolveSourceAndBrand(tenantId);
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

    await this.prisma.$transaction(async (tx) => {
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

    this.cache.invalidate({ tenantId });
    return this.resolver.resolveSourceAndBrand(tenantId);
  }

  async reset(input: ResetBrandingInput): Promise<BrandingResponse> {
    const tenantId = this.requestContext.requireTenantId();

    await this.requireManagePermission();
    await this.requireCustomBrandingEntitlement(tenantId);

    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const priorAssetIds: string[] = [];
    const priorAssetKeys: string[] = [];
    const hadAssets = { logoLight: false, logoDark: false, favicon: false };
    let cleanupIntentId: string | null = null;

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.tenantBranding.findUnique({ where: { tenantId } });
      // Tenant-scoped collection: only rows owned by the resolved tenant can be
      // captured, so the subsequent delete-by-id can never cross tenants.
      const linkedAssets = await tx.brandingAsset.findMany({ where: { tenantId } });

      if (existing) {
        hadAssets.logoLight = (existing.logoLightAssetId ?? null) !== null;
        hadAssets.logoDark = (existing.logoDarkAssetId ?? null) !== null;
        hadAssets.favicon = (existing.faviconAssetId ?? null) !== null;
        await tx.tenantBranding.delete({ where: { tenantId } });
      }

      // Delete the asset rows inside the same transaction so the
      // `@@unique([tenantId, kind])` index is freed: a later same-kind upload
      // must not fail with `P2002`. The FK `onDelete: SetNull` is moot once the
      // tenant branding row is gone.
      for (const asset of linkedAssets) {
        priorAssetIds.push(asset.id);
        priorAssetKeys.push(asset.assetKey);
        await tx.brandingAsset.delete({ where: { id: asset.id } });
      }

      const resetAudit = await this.audit.append(
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
            hadAssets,
            priorAssetIds,
            priorAssetKeys,
          },
        },
        tx
      );

      // One durable intent per reset that actually disconnected objects. An
      // empty reset co-commits no intent, so repeated reset stays idempotent
      // and never accumulates orphaned cleanup work.
      if (priorAssetKeys.length > 0) {
        const intent = await tx.brandingResetCleanupIntent.create({
          data: {
            tenantId,
            resetAuditId: resetAudit.id,
            requestedByUserProfileId: actorUserProfileId,
            storageKeys: priorAssetKeys,
          },
        });
        cleanupIntentId = intent.id;
      }
    });

    // Object storage is an external boundary: reset NEVER deletes in-request.
    // The durable intent committed above is enqueued AFTER commit; a failure
    // here is non-fatal because the PENDING row is reclaimed by the
    // reconciliation sweep, and the reset response still reflects the committed
    // database state.
    if (cleanupIntentId !== null) {
      try {
        await this.cleanupProducer.enqueue(cleanupIntentId);
      } catch (error) {
        // Non-fatal by design: the durable PENDING intent is reclaimed by the
        // reconciliation sweep. Emit a sanitized structured event so the
        // commit->enqueue gap is observable instead of silently swallowed.
        // Never log captured storage keys (INTERNAL).
        console.error(
          "Branding reset cleanup enqueue failed; intent remains PENDING for reconciliation",
          {
            intentId: cleanupIntentId,
            tenantId,
            error: toLoggableError(error),
          }
        );
      }
    }

    this.cache.invalidate({ tenantId });
    return this.resolver.resolveSourceAndBrand(tenantId);
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
