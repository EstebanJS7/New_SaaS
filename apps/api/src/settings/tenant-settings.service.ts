import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { AuditAppendTx, AuditWriter } from "../audit/audit-writer.service.js";
import { getSettingsDefinition, type SettingsDefinition } from "./registry.js";

export interface TenantSettingNamespaceRow {
  readonly id: string;
  readonly tenantId: string;
  readonly namespace: string;
  readonly schemaVersion: number;
  readonly data: unknown;
}

export interface TenantSettingNamespaceDelegate {
  findUnique: (args: {
    where: { tenantId_namespace: { tenantId: string; namespace: string } };
  }) => Promise<TenantSettingNamespaceRow | null>;
  upsert: (args: {
    where: { tenantId_namespace: { tenantId: string; namespace: string } };
    create: {
      tenantId: string;
      namespace: string;
      schemaVersion: number;
      data: unknown;
    };
    update: { schemaVersion: number; data: unknown };
  }) => Promise<TenantSettingNamespaceRow>;
}

export interface TenantSettingsPrisma {
  $transaction: <T>(work: (tx: TenantSettingsTransaction) => Promise<T>) => Promise<T>;
  tenantSettingNamespace: TenantSettingNamespaceDelegate;
}

export interface TenantSettingsTransaction {
  tenantSettingNamespace: TenantSettingNamespaceDelegate;
  auditLog: AuditAppendTx["auditLog"];
}

type SettingsData = Record<string, unknown>;

function isRecord(value: unknown): value is SettingsData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationFailure(message: string): DomainError {
  return new DomainError("VALIDATION_FAILED", message);
}

/**
 * Typed, tenant-scoped settings boundary. The tenant id is always obtained
 * from RequestContextService; namespace and patch data are validated against
 * the closed registry schema before the single-row upsert.
 */
@Injectable()
export class TenantSettingsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: TenantSettingsPrisma,
    private readonly requestContext: RequestContextService,
    private readonly entitlements: EntitlementsService,
    private readonly permissionResolver: PermissionResolver,
    private readonly audit: AuditWriter
  ) {}

  async get(namespace: string): Promise<SettingsData> {
    const definition = getSettingsDefinition(namespace);
    const tenantId = this.requestContext.requireTenantId();
    const row = await this.prisma.tenantSettingNamespace.findUnique({
      where: { tenantId_namespace: { tenantId, namespace: definition.namespace } },
    });

    return this.parseStoredSettings(definition, row?.data);
  }

  async update(namespace: string, patch: unknown): Promise<SettingsData> {
    // Registry lookup intentionally precedes entitlement and persistence work.
    const definition = getSettingsDefinition(namespace);
    const tenantId = this.requestContext.requireTenantId();

    // Defense in depth for non-HTTP callers and forgotten route metadata.
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(definition.requiredPermissionKey)) {
      throw new DomainError("FORBIDDEN", "The required settings permission is missing.");
    }

    // Entitlements gate only writes. Reads never call this boundary.
    if (
      definition.requiresFeature !== undefined &&
      !(await this.entitlements.has(tenantId, definition.requiresFeature))
    ) {
      throw new DomainError(
        "FEATURE_NOT_ENTITLED",
        "The requested feature is not enabled for this tenant."
      );
    }

    const parsedPatch = definition.schema.partial().safeParse(patch);
    if (!parsedPatch.success) {
      throw validationFailure("Settings patch failed namespace validation.");
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await tx.tenantSettingNamespace.findUnique({
        where: { tenantId_namespace: { tenantId, namespace: definition.namespace } },
      });
      const current = row?.data === undefined ? {} : row.data;
      if (!isRecord(current)) {
        throw validationFailure("Stored settings are not a valid namespace object.");
      }

      const merged = {
        ...definition.defaults,
        ...current,
        ...parsedPatch.data,
      };
      const parsedSettings = definition.schema.safeParse(merged);
      if (!parsedSettings.success) {
        throw validationFailure("Settings failed namespace validation.");
      }

      const savedRow = await tx.tenantSettingNamespace.upsert({
        where: { tenantId_namespace: { tenantId, namespace: definition.namespace } },
        create: {
          tenantId,
          namespace: definition.namespace,
          schemaVersion: definition.version,
          data: parsedSettings.data,
        },
        update: {
          schemaVersion: definition.version,
          data: parsedSettings.data,
        },
      });

      await this.audit.append(
        {
          action: "settings.namespace_updated",
          tenantId,
          actorUserProfileId: this.requestContext.requireUserProfileId(),
          targetType: "tenant_setting_namespace",
          targetId: savedRow.id,
          metadata: { namespace: definition.namespace, schemaVersion: definition.version },
        },
        tx
      );

      return savedRow;
    });

    return this.parseStoredSettings(definition, saved.data);
  }

  private parseStoredSettings(definition: SettingsDefinition, stored: unknown): SettingsData {
    const storedValues = stored === undefined ? {} : stored;
    if (!isRecord(storedValues)) {
      throw validationFailure("Stored settings are not a valid namespace object.");
    }

    const parsed = definition.schema.safeParse({ ...definition.defaults, ...storedValues });
    if (!parsed.success) {
      throw validationFailure("Stored settings failed namespace validation.");
    }
    return parsed.data;
  }
}
