import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { RequestContextService } from "../context/request-context.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import type { AuditWriter } from "../audit/audit-writer.service.js";
import {
  BRAND_OVERRIDE_SCHEMA_VERSION,
  BrandOverrideValidationError,
  validateBrandOverride,
} from "./brand-override.zod.js";
import { activeProductPreset, resolveBrand } from "./brand-resolver.js";
import type { BrandOverride } from "./dto.js";
import type { BrandingCache } from "./branding-cache.js";
import type { BrandingResolver } from "./branding-resolver.js";
import { BrandingService } from "./branding.service.js";
import type { BrandingAssetRow, TenantBrandingRow } from "./branding.service.js";
import type { CleanupProducer } from "./branding-reset-cleanup.producer.js";

/** Cleanup intent row captured by the reset transaction (U5). */
interface CleanupIntentRow {
  id: string;
  tenantId: string;
  resetAuditId: string | null;
  requestedByUserProfileId: string | null;
  storageKeys: string[];
  status: "PENDING" | "COMPLETED" | "DEAD_LETTER";
  attempts: number;
  lastError: string | null;
}

interface AuditAppendInput {
  action: string;
  actorUserProfileId?: string;
  tenantId?: string;
  metadata?: unknown;
}

describe("validateBrandOverride", () => {
  it("accepts a valid v1 override", () => {
    const result = validateBrandOverride({
      schemaVersion: 1,
      primary: "#0ea5e9",
      radius: "0.5rem",
      defaultAppearance: "dark",
    });
    expect(result).toEqual({
      schemaVersion: 1,
      primary: "#0ea5e9",
      radius: "0.5rem",
      defaultAppearance: "dark",
    });
  });

  it("rejects unknown keys with BRAND_OVERRIDE_UNKNOWN_KEY", () => {
    try {
      validateBrandOverride({
        schemaVersion: 1,
        fontHeading: "Inter",
      });
      expect.fail("expected validation error");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("BRAND_OVERRIDE_UNKNOWN_KEY");
    }
  });

  it("rejects unsupported schema versions", () => {
    try {
      validateBrandOverride({ schemaVersion: 2 });
      expect.fail("expected validation error");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("BRAND_OVERRIDE_UNSUPPORTED_SCHEMA_VERSION");
    }
  });

  it("rejects invalid color formats", () => {
    try {
      validateBrandOverride({ schemaVersion: 1, primary: "red" });
      expect.fail("expected validation error");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("BRAND_OVERRIDE_INVALID_VALUE");
    }
  });
});

describe("resolveBrand", () => {
  it("layers tenant overrides over the product preset", () => {
    const brand = resolveBrand(activeProductPreset, undefined, {
      schemaVersion: 1,
      accent: "#f43f5e",
    });
    expect(brand.theme.colors.accent).toBe("#f43f5e");
    expect(brand.theme.colors.primary).toBe(activeProductPreset.theme.colors.primary);
  });

  it("falls back to the preset when no tenant override is supplied", () => {
    const brand = resolveBrand(activeProductPreset);
    expect(brand.theme.colors.primary).toBe(activeProductPreset.theme.colors.primary);
    expect(brand.defaultAppearance).toBe("light");
  });
});

describe("BrandingService", () => {
  let requestContext: RequestContextService;
  let hasMock: Mock<(tenantId: string, featureCode: string) => Promise<boolean>>;
  let entitlements: EntitlementsService;
  let resolveMock: Mock<() => Promise<Set<string>>>;
  let permissionResolver: PermissionResolver;
  let appendMock: Mock<(input: AuditAppendInput) => Promise<{ id: string; action: string }>>;
  let audit: AuditWriter;
  let tenantBrandings: Map<string, TenantBrandingRow>;
  let brandingAssets: Map<string, BrandingAssetRow>;
  let assetSequence: number;
  let cleanupIntents: Map<string, CleanupIntentRow>;
  let intentSequence: number;
  let enqueueMock: Mock<(intentId: string) => Promise<void>>;
  let cleanupProducer: CleanupProducer;
  let resolver: BrandingResolver;
  let cache: BrandingCache;
  let invalidateCacheMock: Mock<(args: { tenantId: string }) => void>;
  let prisma: {
    $transaction: <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;
    tenantBranding: {
      findUnique: (args: { where: { tenantId: string } }) => TenantBrandingRow | null;
      upsert: (args: {
        where: { tenantId: string };
        create: unknown;
        update: unknown;
      }) => TenantBrandingRow;
      delete: (args: { where: { tenantId: string } }) => TenantBrandingRow;
    };
    brandingAsset: {
      findMany: (args: { where: { tenantId: string } }) => BrandingAssetRow[];
      delete: (args: { where: { id: string } }) => BrandingAssetRow;
    };
    brandingResetCleanupIntent: {
      create: (args: {
        data: {
          tenantId: string;
          resetAuditId: string | null;
          requestedByUserProfileId: string | null;
          storageKeys: string[];
        };
      }) => CleanupIntentRow;
    };
  };

  function makeService(): BrandingService {
    return new BrandingService(
      prisma as unknown as ConstructorParameters<typeof BrandingService>[0],
      requestContext,
      entitlements,
      permissionResolver,
      audit,
      resolver,
      cache,
      cleanupProducer
    );
  }

  /**
   * Seeds a tenant asset row while enforcing the real `@@unique([tenantId,
   * kind])` constraint. Before the reset-cleanup fix a second insert of the
   * same kind throws `P2002`, which is the exact regression the fix removes.
   */
  function insertBrandingAsset(tenantId: string, kind: string, assetKey: string): BrandingAssetRow {
    const duplicate = [...brandingAssets.values()].some(
      (asset) => asset.tenantId === tenantId && asset.kind === kind
    );
    if (duplicate) {
      throw Object.assign(new Error("Unique constraint failed on (tenantId, kind)"), {
        code: "P2002",
      });
    }
    assetSequence += 1;
    const created: BrandingAssetRow = {
      id: `asset-${assetSequence}`,
      tenantId,
      kind,
      assetKey,
    };
    brandingAssets.set(created.id, created);
    return created;
  }

  function makeFakeResolver(): BrandingResolver {
    return {
      resolveSourceAndBrand: (tenantId: string) => {
        const row = [...tenantBrandings.values()].find((r) => r.tenantId === tenantId) ?? null;
        let overrides: BrandOverride | null;
        try {
          overrides = row ? validateBrandOverride(row.overrides) : null;
        } catch (error) {
          if (error instanceof BrandOverrideValidationError) {
            throw Object.assign(new Error(`Invalid: ${error.code}`), { code: "VALIDATION_FAILED" });
          }
          throw error;
        }
        return Promise.resolve({
          source: row ? "tenant" : "preset",
          brand: resolveBrand(activeProductPreset, undefined, overrides),
        });
      },
    } as unknown as BrandingResolver;
  }

  function withContext<T>(work: () => T): T {
    return requestContext.run("req-1", () => {
      requestContext.setUserProfileId("user-1");
      requestContext.setTenantMembership({
        tenantId: "tenant-1",
        membershipId: "mem-1",
        roleId: "role-1",
        roleCode: "OWNER",
      });
      return work();
    });
  }

  beforeEach(() => {
    requestContext = new RequestContextService();

    hasMock = vi.fn().mockResolvedValue(true);
    entitlements = { has: hasMock } as unknown as EntitlementsService;

    resolveMock = vi.fn().mockResolvedValue(new Set(["branding.settings.manage"]));
    permissionResolver = { resolveForActiveRequest: resolveMock } as unknown as PermissionResolver;

    appendMock = vi
      .fn<(input: AuditAppendInput) => Promise<{ id: string; action: string }>>()
      .mockResolvedValue({ id: "audit-1", action: "branding.updated" });
    audit = { append: appendMock } as unknown as AuditWriter;

    tenantBrandings = new Map<string, TenantBrandingRow>();
    brandingAssets = new Map<string, BrandingAssetRow>();
    assetSequence = 0;
    cleanupIntents = new Map<string, CleanupIntentRow>();
    intentSequence = 0;

    enqueueMock = vi.fn().mockResolvedValue(undefined);
    cleanupProducer = { enqueue: enqueueMock };

    resolver = makeFakeResolver();

    invalidateCacheMock = vi.fn();
    cache = { invalidate: invalidateCacheMock } as unknown as BrandingCache;

    prisma = {
      // Mirrors the real transactional boundary: mutations made through the
      // callback are restored when it throws, so "rollback leaves no intent"
      // is proven against this fake rather than only asserted by ordering.
      $transaction: async <T>(work: (tx: unknown) => Promise<T>) => {
        const intents = new Map(cleanupIntents);
        const brandings = new Map(tenantBrandings);
        const assets = new Map(brandingAssets);
        try {
          return await work(prisma);
        } catch (error) {
          cleanupIntents.clear();
          for (const [id, row] of intents) cleanupIntents.set(id, row);
          tenantBrandings.clear();
          for (const [id, row] of brandings) tenantBrandings.set(id, row);
          brandingAssets.clear();
          for (const [id, row] of assets) brandingAssets.set(id, row);
          throw error;
        }
      },
      tenantBranding: {
        findUnique: ({ where }) =>
          [...tenantBrandings.values()].find((row) => row.tenantId === where.tenantId) ?? null,
        upsert: ({ where, create, update }) => {
          const existing = [...tenantBrandings.values()].find(
            (row) => row.tenantId === where.tenantId
          );
          const now = new Date();
          if (existing) {
            const data = update as Omit<TenantBrandingRow, "id" | "tenantId" | "createdAt">;
            existing.schemaVersion = data.schemaVersion;
            existing.overrides = data.overrides;
            existing.updatedByUserProfileId = data.updatedByUserProfileId ?? null;
            existing.updatedAt = now;
            return existing;
          }
          const created: TenantBrandingRow = {
            id: "tb-1",
            tenantId: where.tenantId,
            ...(create as Omit<TenantBrandingRow, "id" | "tenantId">),
            createdAt: now,
            updatedAt: now,
          };
          tenantBrandings.set(created.id, created);
          return created;
        },
        delete: ({ where }) => {
          const existing = [...tenantBrandings.values()].find(
            (row) => row.tenantId === where.tenantId
          );
          if (!existing) {
            throw Object.assign(new Error("Record not found"), { code: "P2025" });
          }
          tenantBrandings.delete(existing.id);
          return existing;
        },
      },
      brandingAsset: {
        findMany: ({ where }) =>
          [...brandingAssets.values()].filter((asset) => asset.tenantId === where.tenantId),
        delete: ({ where }) => {
          const existing = brandingAssets.get(where.id);
          if (!existing) {
            throw Object.assign(new Error("Record not found"), { code: "P2025" });
          }
          brandingAssets.delete(existing.id);
          return existing;
        },
      },
      brandingResetCleanupIntent: {
        create: ({ data }) => {
          intentSequence += 1;
          const created: CleanupIntentRow = {
            id: `intent-${intentSequence}`,
            tenantId: data.tenantId,
            resetAuditId: data.resetAuditId,
            requestedByUserProfileId: data.requestedByUserProfileId,
            storageKeys: data.storageKeys,
            status: "PENDING",
            attempts: 0,
            lastError: null,
          };
          cleanupIntents.set(created.id, created);
          return created;
        },
      },
    };
  });

  it("returns preset source when no row exists", async () => {
    const service = makeService();
    const result = await withContext(() => service.get());
    expect(result.source).toBe("preset");
    expect(result.brand.theme.colors.primary).toBe(activeProductPreset.theme.colors.primary);
  });

  it("creates a tenant branding row on update", async () => {
    const service = makeService();
    const result = await withContext(() =>
      service.update({
        overrides: { schemaVersion: 1, primary: "#0ea5e9" },
        reason: "Rebrand",
      })
    );
    expect(result.source).toBe("tenant");
    expect(result.brand.theme.colors.primary).toBe("#0ea5e9");
    expect(tenantBrandings.size).toBe(1);
    expect(appendMock).toHaveBeenCalledTimes(1);
    const appendCall = appendMock.mock.calls[0][0];
    expect(appendCall.action).toBe("branding.updated");
    expect(appendCall.metadata).toMatchObject({
      schemaVersion: BRAND_OVERRIDE_SCHEMA_VERSION,
      reason: "Rebrand",
    });
    expect(invalidateCacheMock).toHaveBeenCalledWith({ tenantId: "tenant-1" });
  });

  it("rejects update without the manage permission", async () => {
    resolveMock.mockResolvedValue(new Set());
    const service = makeService();
    await expect(
      withContext(() =>
        service.update({
          overrides: { schemaVersion: 1, primary: "#0ea5e9" },
        })
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects update without the custom_branding entitlement", async () => {
    hasMock.mockResolvedValue(false);
    const service = makeService();
    await expect(
      withContext(() =>
        service.update({
          overrides: { schemaVersion: 1, primary: "#0ea5e9" },
        })
      )
    ).rejects.toMatchObject({ code: "FEATURE_NOT_ENTITLED" });
  });

  it("resets tenant branding idempotently", async () => {
    const service = makeService();
    await withContext(() =>
      service.update({
        overrides: { schemaVersion: 1, primary: "#0ea5e9" },
      })
    );
    appendMock.mockClear();

    const result = await withContext(() => service.reset({ reason: "Rollback" }));
    expect(result.source).toBe("preset");
    expect(tenantBrandings.size).toBe(0);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock.mock.calls[0][0].action).toBe("branding.reset");
    expect(invalidateCacheMock).toHaveBeenCalledWith({ tenantId: "tenant-1" });

    const secondReset = await withContext(() => service.reset({}));
    expect(secondReset.source).toBe("preset");
  });

  it("reset deletes asset rows, captures their keys in a cleanup intent, and audits prior metadata", async () => {
    const service = makeService();
    const light = insertBrandingAsset("tenant-1", "LOGO_LIGHT", "key-light");
    const dark = insertBrandingAsset("tenant-1", "LOGO_DARK", "key-dark");
    tenantBrandings.set("tb-1", {
      id: "tb-1",
      tenantId: "tenant-1",
      schemaVersion: 1,
      overrides: { schemaVersion: 1, primary: "#0ea5e9" },
      logoLightAssetId: light.id,
      logoDarkAssetId: dark.id,
      faviconAssetId: null,
      updatedByUserProfileId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await withContext(() => service.reset({ reason: "Rollback" }));

    expect(result.source).toBe("preset");
    expect(tenantBrandings.size).toBe(0);
    expect(brandingAssets.size).toBe(0);

    // Reset persists a durable intent instead of deleting storage in-request;
    // the captured keys are exactly the rows removed above.
    expect(cleanupIntents.size).toBe(1);
    const intent = [...cleanupIntents.values()][0];
    expect(intent.tenantId).toBe("tenant-1");
    expect(intent.storageKeys).toEqual(["key-light", "key-dark"]);
    expect(intent.status).toBe("PENDING");
    expect(intent.resetAuditId).toBe("audit-1");
    expect(intent.requestedByUserProfileId).toBe("user-1");
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith(intent.id);

    expect(appendMock).toHaveBeenCalledTimes(1);
    const appendCall = appendMock.mock.calls[0][0];
    expect(appendCall.action).toBe("branding.reset");
    expect(appendCall.actorUserProfileId).toBe("user-1");
    expect(appendCall.tenantId).toBe("tenant-1");
    expect(appendCall.metadata).toMatchObject({
      hadExistingRow: true,
      hadAssets: { logoLight: true, logoDark: true, favicon: false },
      priorAssetIds: [light.id, dark.id],
      priorAssetKeys: ["key-light", "key-dark"],
    });
    expect(invalidateCacheMock).toHaveBeenCalledWith({ tenantId: "tenant-1" });
  });

  it("rolls back the cleanup intent when the reset transaction fails", async () => {
    const service = makeService();
    insertBrandingAsset("tenant-1", "LOGO_LIGHT", "key-light");
    appendMock.mockImplementation((input) => {
      if (input.action === "branding.reset") {
        throw new Error("audit forced failure");
      }
      return Promise.resolve({ id: "audit-1", action: input.action });
    });

    await expect(withContext(() => service.reset({}))).rejects.toThrow("audit forced failure");

    // Transaction rollback must leave neither the intent nor the deleted rows.
    expect(cleanupIntents.size).toBe(0);
    expect(brandingAssets.size).toBe(1);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("keeps the intent PENDING, resolves, and logs a sanitized structured event when enqueue fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const service = makeService();
      insertBrandingAsset("tenant-1", "LOGO_LIGHT", "key-light");
      enqueueMock.mockRejectedValue(new Error("redis unavailable"));

      const result = await withContext(() => service.reset({}));

      expect(result.source).toBe("preset");
      expect(cleanupIntents.size).toBe(1);
      const intent = [...cleanupIntents.values()][0];
      expect(intent.status).toBe("PENDING");

      // Observability: one sanitized structured event, never a silent swallow.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message, fields] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
      expect(message).toContain("enqueue failed");
      expect(fields).toMatchObject({
        intentId: intent.id,
        tenantId: "tenant-1",
        error: { type: "Error", message: "redis unavailable" },
      });
      // Captured storage keys are INTERNAL and must not leak into logs.
      expect(JSON.stringify(fields)).not.toContain("key-light");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("re-upload of the same kind succeeds after reset (no P2002)", async () => {
    const service = makeService();
    insertBrandingAsset("tenant-1", "LOGO_LIGHT", "key-light");

    await withContext(() => service.reset({}));

    expect(() => insertBrandingAsset("tenant-1", "LOGO_LIGHT", "key-new")).not.toThrow();
    expect(brandingAssets.size).toBe(1);
  });

  it("empty and repeated reset are idempotent, orphan no intent, and keep the unique index free", async () => {
    const service = makeService();
    const first = await withContext(() => service.reset({}));
    expect(first.source).toBe("preset");

    const second = await withContext(() => service.reset({}));
    expect(second.source).toBe("preset");

    expect(brandingAssets.size).toBe(0);
    expect(cleanupIntents.size).toBe(0);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(() => insertBrandingAsset("tenant-1", "FAVICON", "key-favicon")).not.toThrow();
  });

  it("throws when stored overrides are corrupt", async () => {
    const service = makeService();
    tenantBrandings.set("tb-1", {
      id: "tb-1",
      tenantId: "tenant-1",
      schemaVersion: 1,
      overrides: { schemaVersion: 1, primary: "not-a-color" },
      updatedByUserProfileId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(withContext(() => service.get())).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});
