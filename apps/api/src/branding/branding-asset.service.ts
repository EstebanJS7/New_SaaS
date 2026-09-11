import { Inject, Injectable } from "@nestjs/common";
// Value import (not `import type`): the DI token must exist at runtime.
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditAppendTx, AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import {
  createOpaqueStorageKey,
  STORAGE_KEY_PREFIXES,
  STORAGE_PORT,
  type StoragePort,
} from "@newsaas/storage";
import { BrandingAssetDeliveryService } from "./branding-asset-delivery.service.js";
import { BrandingCache } from "./branding-cache.js";
import type { BrandingAssetKind, ParsedBrandingAssetFile } from "./branding-asset.pipe.js";

export interface BrandingAssetUploadResult {
  kind: BrandingAssetKind;
  contentType: string;
  byteSize: number;
  url: string;
}

interface AssetColumnMapping {
  fkColumn: "logoLightAssetId" | "logoDarkAssetId" | "faviconAssetId";
  action: "branding.asset.created" | "branding.asset.replaced" | "branding.asset.removed";
}

const KIND_TO_COLUMN: Record<BrandingAssetKind, AssetColumnMapping> = {
  logoLight: { fkColumn: "logoLightAssetId", action: "branding.asset.created" },
  logoDark: { fkColumn: "logoDarkAssetId", action: "branding.asset.created" },
  favicon: { fkColumn: "faviconAssetId", action: "branding.asset.created" },
};

/** Maps the URL kind slug to the Prisma enum value stored in the database. */
function kindToEnum(kind: BrandingAssetKind): "LOGO_LIGHT" | "LOGO_DARK" | "FAVICON" {
  return (
    {
      logoLight: "LOGO_LIGHT",
      logoDark: "LOGO_DARK",
      favicon: "FAVICON",
    } as const
  )[kind];
}

/**
 * Tenant-scoped branding asset lifecycle boundary.
 *
 * - Reads/mutations resolve tenant from RequestContextService only.
 * - Mutations require `branding.settings.manage` and the `custom_branding`
 *   entitlement and are gated by the `BRANDING_ASSETS_ENABLED` flag.
 * - Opaque storage keys are never exposed; only short-lived API-local signed
 *   URLs leave the service.
 * - Every mutation co-commits an audit row inside the same database
 *   transaction and invalidates the in-memory resolved-brand cache.
 * - Object-storage put/delete operations happen OUTSIDE the database
 *   transaction so a slow or failing provider cannot stall or abort the
 *   authoritative persistence (engineering rules: External calls).
 */
@Injectable()
export class BrandingAssetService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    private readonly entitlements: EntitlementsService,
    private readonly permissionResolver: PermissionResolver,
    private readonly audit: AuditWriter,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly cache: BrandingCache,
    private readonly delivery: BrandingAssetDeliveryService
  ) {}

  async upload(
    kind: BrandingAssetKind,
    file: ParsedBrandingAssetFile
  ): Promise<BrandingAssetUploadResult> {
    const tenantId = this.requestContext.requireTenantId();
    await this.requireManagePermission();
    await this.requireCustomBrandingEntitlement(tenantId);
    this.requireEnabled();

    const actorUserProfileId = this.requestContext.requireUserProfileId();
    const mapping = KIND_TO_COLUMN[kind];

    const assetKey = createOpaqueStorageKey(STORAGE_KEY_PREFIXES.brandingAsset);

    // Persist bytes BEFORE opening the database transaction. The provider call
    // is an external operation and must not hold a transaction open.
    const stored = await this.storage.put({
      key: assetKey,
      body: file.buffer,
      contentType: file.contentType,
      metadata: {
        tenantId,
        kind,
        sha256: file.sha256,
      },
    });

    let priorAssetId: string | null = null;
    let priorAssetKey: string | null = null;

    try {
      const assetId = await this.prisma.$transaction(async (tx) => {
        const priorBranding = await tx.tenantBranding.findUnique({
          where: { tenantId },
          select: { [mapping.fkColumn]: true },
        });
        const priorId = (priorBranding as Record<string, string | null> | null)?.[mapping.fkColumn];

        // Delete the prior row FIRST so the tenant+kind unique constraint is
        // free before we insert the replacement (PostgreSQL-credible lifecycle).
        if (priorId) {
          const prior = await tx.brandingAsset.findUnique({ where: { id: priorId } });
          if (prior) {
            priorAssetId = prior.id;
            priorAssetKey = prior.assetKey;
            await tx.brandingAsset.delete({ where: { id: prior.id } });
          }
        }

        const created = await tx.brandingAsset.create({
          data: {
            tenantId,
            kind: kindToEnum(kind),
            assetKey: stored.key,
            contentType: file.contentType,
            byteSize: file.byteSize,
            sha256: file.sha256,
            uploadedByUserProfileId: actorUserProfileId,
          },
        });

        await tx.tenantBranding.upsert({
          where: { tenantId },
          create: {
            tenantId,
            schemaVersion: 1,
            overrides: {},
            [mapping.fkColumn]: created.id,
            updatedByUserProfileId: actorUserProfileId,
          },
          update: {
            [mapping.fkColumn]: created.id,
            updatedByUserProfileId: actorUserProfileId,
          },
        });

        const action: AssetColumnMapping["action"] = priorAssetId
          ? "branding.asset.replaced"
          : "branding.asset.created";
        await this.audit.append(
          {
            action,
            tenantId,
            actorUserProfileId,
            targetType: "branding_asset",
            targetId: created.id,
            metadata: {
              kind: kindToEnum(kind),
              contentType: file.contentType,
              byteSize: file.byteSize,
              sha256: file.sha256,
            },
          },
          tx as unknown as AuditAppendTx
        );

        return created.id;
      });

      // Best-effort cleanup of the retired storage object after the DB commit.
      if (priorAssetKey) {
        await this.storage.delete({ key: priorAssetKey }).catch(() => {
          // Orphaned objects are acceptable to lose here; a background
          // reconciler can clean them up. Do not fail the request.
        });
      }

      this.cache.invalidate({ tenantId });

      return {
        kind,
        contentType: file.contentType,
        byteSize: file.byteSize,
        url: await this.delivery.signClientUrl(kind, assetId),
      };
    } catch (error) {
      // The database transaction rolled back; the new bytes are now orphaned.
      // Attempt to remove them so we do not leak storage on repeated failures.
      await this.storage.delete({ key: stored.key }).catch(() => {
        // Ignore cleanup failures; the object is already unreferenced.
      });
      throw error;
    }
  }

  async remove(kind: BrandingAssetKind): Promise<{ kind: BrandingAssetKind; removed: boolean }> {
    const tenantId = this.requestContext.requireTenantId();
    await this.requireManagePermission();
    await this.requireCustomBrandingEntitlement(tenantId);
    this.requireEnabled();

    const actorUserProfileId = this.requestContext.requireUserProfileId();
    const mapping = KIND_TO_COLUMN[kind];

    let retiredKey: string | null = null;

    const removed = await this.prisma.$transaction(async (tx) => {
      const branding = await tx.tenantBranding.findUnique({ where: { tenantId } });
      const assetId = (branding as Record<string, string | null> | null)?.[mapping.fkColumn];

      if (!assetId) {
        return false;
      }

      const asset = await tx.brandingAsset.findUnique({ where: { id: assetId } });
      if (!asset) {
        return false;
      }

      retiredKey = asset.assetKey;

      await tx.tenantBranding.update({
        where: { tenantId },
        data: { [mapping.fkColumn]: null },
      });

      await tx.brandingAsset.delete({ where: { id: asset.id } });

      await this.audit.append(
        {
          action: "branding.asset.removed",
          tenantId,
          actorUserProfileId,
          targetType: "branding_asset",
          targetId: asset.id,
          metadata: {
            kind: kindToEnum(kind),
            contentType: asset.contentType,
            byteSize: asset.byteSize,
          },
        },
        tx as unknown as AuditAppendTx
      );

      return true;
    });

    if (removed && retiredKey) {
      // Storage deletion is external and happens after the DB commit.
      await this.storage.delete({ key: retiredKey }).catch(() => {
        // Best-effort; unreferenced orphan is acceptable to lose.
      });
      this.cache.invalidate({ tenantId });
    }

    return { kind, removed };
  }

  async getClientDeliveryUrl(kind: BrandingAssetKind): Promise<string | undefined> {
    const tenantId = this.requestContext.requireTenantId();
    const asset = await this.prisma.brandingAsset.findFirst({
      where: { tenantId, kind: kindToEnum(kind) },
    });

    if (!asset) {
      return undefined;
    }

    return this.delivery.signClientUrl(kind, asset.id);
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

  private requireEnabled(): void {
    if (process.env.BRANDING_ASSETS_ENABLED !== "true") {
      throw new DomainError("FEATURE_NOT_ENTITLED", "Branding assets are not enabled.");
    }
  }
}
