import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { RequestContextService } from "../context/request-context.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import type { AuditWriter } from "../audit/audit-writer.service.js";
import { BRAND_OVERRIDE_SCHEMA_VERSION, validateBrandOverride } from "./brand-override.zod.js";
import { activeProductPreset, resolveBrand } from "./brand-resolver.js";
import { BrandingService } from "./branding.service.js";
import type { TenantBrandingRow } from "./branding.service.js";

interface AuditAppendInput {
  action: string;
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
  };

  function makeService(): BrandingService {
    return new BrandingService(
      prisma as unknown as ConstructorParameters<typeof BrandingService>[0],
      requestContext,
      entitlements,
      permissionResolver,
      audit
    );
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

    prisma = {
      $transaction: async <T>(work: (tx: unknown) => Promise<T>) => work(prisma),
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

    const secondReset = await withContext(() => service.reset({}));
    expect(secondReset.source).toBe("preset");
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
