import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DomainError } from "@newsaas/shared";
import {
  createIsolationDatabase,
  type IsolationDatabase,
} from "../../test/support/in-memory-database.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { AuditWriter } from "../audit/audit-writer.service.js";
import { TenantSettingsService } from "./tenant-settings.service.js";
import { salesSettingsDefinition, SETTINGS_REGISTRY } from "./registry.js";

interface Boundaries {
  db: IsolationDatabase;
  ctx: RequestContextService;
  service: TenantSettingsService;
}

function seedSalesPermission(db: IsolationDatabase, roleId: string): void {
  const permission = db.prisma.permission.create({ data: { key: "sales.settings.manage" } });
  db.prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
}

function seedSalesPermissionAndEntitlement(
  db: IsolationDatabase,
  tenantId: string,
  roleId: string
): void {
  seedSalesPermission(db, roleId);
  const featureCode = db.prisma.featureCode.create({ data: { code: "sales" } });
  db.prisma.tenantEntitlement.create({ data: { tenantId, featureCodeId: featureCode.id } });
}

function createBoundaries(): Boundaries {
  const db = createIsolationDatabase();
  const ctx = new RequestContextService();
  const permissionResolver = new PermissionResolver(
    {
      rolePermission: db.prisma.rolePermission,
      tenantRolePermissionOverride: db.prisma.tenantRolePermissionOverride,
    } as unknown as ConstructorParameters<typeof PermissionResolver>[0],
    ctx
  );
  const entitlements = new EntitlementsService(
    db.prisma as unknown as ConstructorParameters<typeof EntitlementsService>[0]
  );
  const audit = new AuditWriter(
    db.prisma as unknown as ConstructorParameters<typeof AuditWriter>[0],
    ctx
  );
  const service = new TenantSettingsService(
    db.prisma as unknown as ConstructorParameters<typeof TenantSettingsService>[0],
    ctx,
    entitlements,
    permissionResolver,
    audit
  );
  return { db, ctx, service };
}

function runAsManager(
  ctx: RequestContextService,
  tenantId: string,
  roleId: string,
  userProfileId: string,
  callback: () => Promise<void>
): Promise<void> {
  return ctx.run(`req-${randomUUID()}`, async () => {
    ctx.setUserProfileId(userProfileId);
    ctx.setTenantMembership({
      tenantId,
      membershipId: randomUUID(),
      roleId,
      roleCode: "ADMIN",
    });
    return callback();
  });
}

describe("TenantSettingsService (unit)", () => {
  it("returns defaults when no row exists", async () => {
    const { ctx, service } = createBoundaries();
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const userProfileId = randomUUID();

    await runAsManager(ctx, tenantId, roleId, userProfileId, async () => {
      const settings = await service.get("sales");
      expect(settings).toEqual(salesSettingsDefinition.defaults);
    });
  });

  it("merges stored values over defaults", async () => {
    const { db, ctx, service } = createBoundaries();
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const userProfileId = randomUUID();

    db.prisma.tenantSettingNamespace.create({
      data: {
        tenantId,
        namespace: "sales",
        schemaVersion: 1,
        data: { defaultCurrency: "USD" },
      },
    });

    await runAsManager(ctx, tenantId, roleId, userProfileId, async () => {
      const settings = await service.get("sales");
      expect(settings).toEqual({
        defaultCurrency: "USD",
        requireCustomerForInvoice: false,
      });
    });
  });

  it("persists a partial patch and preserves sibling fields", async () => {
    const { db, ctx, service } = createBoundaries();
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const userProfileId = randomUUID();

    // Seed baseline row.
    db.prisma.tenantSettingNamespace.create({
      data: {
        tenantId,
        namespace: "sales",
        schemaVersion: 1,
        data: { defaultCurrency: "USD", requireCustomerForInvoice: true },
      },
    });

    // Grant the permission and entitlement so the update succeeds.
    seedSalesPermissionAndEntitlement(db, tenantId, roleId);

    await runAsManager(ctx, tenantId, roleId, userProfileId, async () => {
      const updated = await service.update("sales", { requireCustomerForInvoice: false });
      expect(updated).toEqual({ defaultCurrency: "USD", requireCustomerForInvoice: false });
    });

    const rows = db.prisma.tenantSettingNamespace.findMany({
      where: { tenantId, namespace: "sales" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].data).toEqual({ defaultCurrency: "USD", requireCustomerForInvoice: false });
    expect(rows[0].schemaVersion).toBe(salesSettingsDefinition.version);
  });

  it("rejects unknown fields with VALIDATION_FAILED and touches nothing", async () => {
    const { db, ctx, service } = createBoundaries();
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const userProfileId = randomUUID();

    seedSalesPermissionAndEntitlement(db, tenantId, roleId);

    await runAsManager(ctx, tenantId, roleId, userProfileId, async () => {
      const outcome: unknown = await service
        .update("sales", { unknownField: true })
        .catch((error: unknown) => error);
      expect(outcome).toBeInstanceOf(DomainError);
      expect((outcome as DomainError).code).toBe("VALIDATION_FAILED");
    });

    expect(db.tables.settingNamespaces.size).toBe(0);
  });

  it("rejects wrong-typed values with VALIDATION_FAILED", async () => {
    const { db, ctx, service } = createBoundaries();
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const userProfileId = randomUUID();

    seedSalesPermissionAndEntitlement(db, tenantId, roleId);

    await runAsManager(ctx, tenantId, roleId, userProfileId, async () => {
      const outcome: unknown = await service
        .update("sales", { requireCustomerForInvoice: "false" })
        .catch((error: unknown) => error);
      expect(outcome).toBeInstanceOf(DomainError);
      expect((outcome as DomainError).code).toBe("VALIDATION_FAILED");
    });
  });

  it("rejects secret-shaped payloads", async () => {
    const { db, ctx, service } = createBoundaries();
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const userProfileId = randomUUID();

    seedSalesPermissionAndEntitlement(db, tenantId, roleId);

    await runAsManager(ctx, tenantId, roleId, userProfileId, async () => {
      const outcome: unknown = await service
        .update("sales", { apiKey: "super-secret", defaultCurrency: "PYG" })
        .catch((error: unknown) => error);
      expect(outcome).toBeInstanceOf(DomainError);
      expect((outcome as DomainError).code).toBe("VALIDATION_FAILED");
    });
  });

  it("rejects unregistered namespaces", async () => {
    const { ctx, service } = createBoundaries();
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const userProfileId = randomUUID();

    await runAsManager(ctx, tenantId, roleId, userProfileId, async () => {
      const getOutcome: unknown = await service.get("nope").catch((error: unknown) => error);
      expect(getOutcome).toBeInstanceOf(DomainError);
      expect((getOutcome as DomainError).code).toBe("NOT_FOUND");

      const updateOutcome: unknown = await service
        .update("nope", {})
        .catch((error: unknown) => error);
      expect(updateOutcome).toBeInstanceOf(DomainError);
      expect((updateOutcome as DomainError).code).toBe("NOT_FOUND");
    });
  });

  it("stamps the registry schemaVersion on newly created rows", async () => {
    const { db, ctx, service } = createBoundaries();
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const userProfileId = randomUUID();

    seedSalesPermissionAndEntitlement(db, tenantId, roleId);

    await runAsManager(ctx, tenantId, roleId, userProfileId, async () => {
      await service.update("sales", { defaultCurrency: "USD" });
    });

    const row = db.prisma.tenantSettingNamespace.findUnique({
      where: { tenantId_namespace: { tenantId, namespace: "sales" } },
    });
    expect(row).not.toBeNull();
    expect(row!.schemaVersion).toBe(salesSettingsDefinition.version);
  });

  it("writes exactly one audit row per successful update inside the transaction", async () => {
    const { db, ctx, service } = createBoundaries();
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const userProfileId = randomUUID();

    seedSalesPermissionAndEntitlement(db, tenantId, roleId);

    await runAsManager(ctx, tenantId, roleId, userProfileId, async () => {
      await service.update("sales", { defaultCurrency: "USD" });
    });

    const audits = db.prisma.auditLog.findMany({ where: { action: "settings.namespace_updated" } });
    expect(audits).toHaveLength(1);
    expect(audits[0].tenantId).toBe(tenantId);
    expect(audits[0].actorUserProfileId).toBe(userProfileId);
    expect(audits[0].targetType).toBe("tenant_setting_namespace");
    expect(audits[0].metadata).toEqual({
      namespace: "sales",
      schemaVersion: salesSettingsDefinition.version,
      changedFields: ["defaultCurrency"],
    });
  });

  it("records an audit field diff for the namespace write", async () => {
    const { db, ctx, service } = createBoundaries();
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const userProfileId = randomUUID();

    // Seed a baseline row so a no-op sibling field does not appear in the diff.
    db.prisma.tenantSettingNamespace.create({
      data: {
        tenantId,
        namespace: "sales",
        schemaVersion: 1,
        data: { defaultCurrency: "PYG", requireCustomerForInvoice: true },
      },
    });
    seedSalesPermissionAndEntitlement(db, tenantId, roleId);

    await runAsManager(ctx, tenantId, roleId, userProfileId, async () => {
      await service.update("sales", { requireCustomerForInvoice: true });
    });

    const audits = db.prisma.auditLog.findMany({ where: { action: "settings.namespace_updated" } });
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toEqual({
      namespace: "sales",
      schemaVersion: salesSettingsDefinition.version,
      changedFields: [],
    });
  });

  it("requires each namespace's own registry key for writes (registry-driven auth)", async () => {
    const { ctx, service } = createBoundaries();
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const userProfileId = randomUUID();

    await runAsManager(ctx, tenantId, roleId, userProfileId, async () => {
      for (const definition of Object.values(SETTINGS_REGISTRY)) {
        const outcome: unknown = await service
          .update(definition.namespace, {})
          .catch((error: unknown) => error);
        expect(
          outcome,
          `namespace ${definition.namespace} must deny without its key`
        ).toBeInstanceOf(DomainError);
        expect((outcome as DomainError).code).toBe("FORBIDDEN");
      }
    });
  });

  it("allows a scheduling write with its own key and no feature grant", async () => {
    const { db, ctx, service } = createBoundaries();
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const userProfileId = randomUUID();

    const permission = db.prisma.permission.create({
      data: { key: "scheduling.settings.manage" },
    });
    db.prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });

    await runAsManager(ctx, tenantId, roleId, userProfileId, async () => {
      const updated = await service.update("scheduling", { conflictPolicy: "ALLOW" });
      expect(updated).toEqual({ conflictPolicy: "ALLOW", availability: [], blocks: [] });
    });
  });

  it("rejects an inverted scheduling availability window through the write path", async () => {
    const { db, ctx, service } = createBoundaries();
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const userProfileId = randomUUID();

    const permission = db.prisma.permission.create({
      data: { key: "scheduling.settings.manage" },
    });
    db.prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });

    await runAsManager(ctx, tenantId, roleId, userProfileId, async () => {
      const outcome: unknown = await service
        .update("scheduling", {
          availability: [
            {
              membershipId: randomUUID(),
              branchId: randomUUID(),
              weekday: 2,
              startMinute: 720,
              endMinute: 540,
            },
          ],
        })
        .catch((error: unknown) => error);
      expect(outcome).toBeInstanceOf(DomainError);
      expect((outcome as DomainError).code).toBe("VALIDATION_FAILED");
    });

    expect(db.tables.settingNamespaces.size).toBe(0);
  });

  it("rejects an inverted one-off block through the write path", async () => {
    const { db, ctx, service } = createBoundaries();
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const userProfileId = randomUUID();

    const permission = db.prisma.permission.create({
      data: { key: "scheduling.settings.manage" },
    });
    db.prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });

    await runAsManager(ctx, tenantId, roleId, userProfileId, async () => {
      const outcome: unknown = await service
        .update("scheduling", {
          blocks: [
            {
              membershipId: randomUUID(),
              branchId: randomUUID(),
              startsAt: "2026-01-16T14:00:00.000Z",
              endsAt: "2026-01-16T13:00:00.000Z",
            },
          ],
        })
        .catch((error: unknown) => error);
      expect(outcome).toBeInstanceOf(DomainError);
      expect((outcome as DomainError).code).toBe("VALIDATION_FAILED");
    });

    expect(db.tables.settingNamespaces.size).toBe(0);
  });

  it("rejects updates when the active role lacks the required permission", async () => {
    const { ctx, service } = createBoundaries();
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const userProfileId = randomUUID();

    await runAsManager(ctx, tenantId, roleId, userProfileId, async () => {
      const outcome: unknown = await service
        .update("sales", { defaultCurrency: "USD" })
        .catch((error: unknown) => error);
      expect(outcome).toBeInstanceOf(DomainError);
      expect((outcome as DomainError).code).toBe("FORBIDDEN");
    });
  });

  it("rejects updates when the feature entitlement is absent", async () => {
    const { db, ctx, service } = createBoundaries();
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const userProfileId = randomUUID();

    seedSalesPermission(db, roleId);

    await runAsManager(ctx, tenantId, roleId, userProfileId, async () => {
      const outcome: unknown = await service
        .update("sales", { defaultCurrency: "USD" })
        .catch((error: unknown) => error);
      expect(outcome).toBeInstanceOf(DomainError);
      expect((outcome as DomainError).code).toBe("FEATURE_NOT_ENTITLED");
    });
  });

  it("allows reads for non-entitled tenants", async () => {
    const { ctx, service } = createBoundaries();
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const userProfileId = randomUUID();

    await runAsManager(ctx, tenantId, roleId, userProfileId, async () => {
      const settings = await service.get("sales");
      expect(settings).toEqual(salesSettingsDefinition.defaults);
    });
  });

  it("keeps one row per tenant and namespace across multiple updates", async () => {
    const { db, ctx, service } = createBoundaries();
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const userProfileId = randomUUID();

    seedSalesPermissionAndEntitlement(db, tenantId, roleId);

    await runAsManager(ctx, tenantId, roleId, userProfileId, async () => {
      await service.update("sales", { defaultCurrency: "USD" });
      await service.update("sales", { requireCustomerForInvoice: true });
    });

    const rows = db.prisma.tenantSettingNamespace.findMany({ where: { tenantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].data).toEqual({ defaultCurrency: "USD", requireCustomerForInvoice: true });
  });
});
