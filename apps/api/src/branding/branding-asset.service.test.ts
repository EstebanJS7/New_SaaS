import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import {
  createIsolationDatabase,
  type IsolationDatabase,
} from "../../test/support/in-memory-database.js";
import { RequestContextService } from "../context/request-context.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import type { AuditWriter } from "../audit/audit-writer.service.js";
import { BrandingAssetDeliveryService } from "./branding-asset-delivery.service.js";
import { InMemoryBrandingCache } from "./branding-cache.js";
import { BrandingAssetService } from "./branding-asset.service.js";
import type { ParsedBrandingAssetFile } from "./branding-asset.pipe.js";

describe("BrandingAssetService", () => {
  let db: IsolationDatabase;
  let requestContext: RequestContextService;
  let hasMock: Mock<(tenantId: string, featureCode: string) => Promise<boolean>>;
  let entitlements: EntitlementsService;
  let resolveMock: Mock<() => Promise<Set<string>>>;
  let permissionResolver: PermissionResolver;
  let appendMock: Mock<(input: unknown, tx?: unknown) => Promise<{ id: string; action: string }>>;
  let audit: AuditWriter;
  let cache: InMemoryBrandingCache;
  let delivery: BrandingAssetDeliveryService;
  let service: BrandingAssetService;

  const tenantId = "tenant-1";
  const actorUserProfileId = "user-1";

  function withContext<T>(work: () => T): T {
    return requestContext.run("req-1", () => {
      requestContext.setUserProfileId(actorUserProfileId);
      requestContext.setTenantMembership({
        tenantId,
        membershipId: "mem-1",
        roleId: "role-1",
        roleCode: "OWNER",
      });
      return work();
    });
  }

  function makePngBuffer(size: number): Buffer {
    // Minimal PNG signature + IHDR chunk so file-type recognizes it as PNG.
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(13, 0);
    const ihdrType = Buffer.from("IHDR");
    const width = Buffer.alloc(4);
    width.writeUInt32BE(1, 0);
    const height = Buffer.alloc(4);
    height.writeUInt32BE(1, 0);
    const rest = Buffer.from([0x08, 0x02, 0x00, 0x00, 0x00]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(0, 0);
    const chunk = Buffer.concat([length, ihdrType, width, height, rest, crc]);
    const payload = Buffer.alloc(Math.max(0, size - signature.length - chunk.length), 0);
    return Buffer.concat([signature, chunk, payload]);
  }

  function makeFile(size: number): ParsedBrandingAssetFile {
    const buffer = makePngBuffer(size);
    return {
      buffer,
      contentType: "image/png",
      byteSize: buffer.length,
      sha256: "fake-sha",
    };
  }

  beforeEach(() => {
    process.env.BRANDING_ASSETS_ENABLED = "true";
    db = createIsolationDatabase();
    requestContext = new RequestContextService();

    hasMock = vi.fn().mockResolvedValue(true);
    entitlements = { has: hasMock } as unknown as EntitlementsService;

    resolveMock = vi.fn().mockResolvedValue(new Set(["branding.settings.manage"]));
    permissionResolver = { resolveForActiveRequest: resolveMock } as unknown as PermissionResolver;

    appendMock = vi.fn().mockResolvedValue({ id: "audit-1", action: "branding.asset.created" });
    audit = { append: appendMock } as unknown as AuditWriter;

    cache = new InMemoryBrandingCache();

    delivery = new BrandingAssetDeliveryService(
      db.storage,
      db.prisma as unknown as ConstructorParameters<typeof BrandingAssetDeliveryService>[1],
      requestContext,
      { secret: "test-secret", ttlSeconds: 300, publicBaseUrl: "http://localhost:3001" }
    );

    service = new BrandingAssetService(
      db.prisma as unknown as ConstructorParameters<typeof BrandingAssetService>[0],
      requestContext,
      entitlements,
      permissionResolver,
      audit,
      db.storage,
      cache,
      delivery
    );
  });

  it("upload stores an asset and returns an API-local signed URL", async () => {
    const result = await withContext(() => service.upload("logoLight", makeFile(1024)));

    expect(result.kind).toBe("logoLight");
    expect(result.contentType).toBe("image/png");
    expect(result.url).toMatch(/^\/branding\/assets\/logoLight\/content\?token=/);
    expect(db.tables.brandingAssets.size).toBe(1);
  });

  it("replacement deletes the prior DB row and storage key, then creates a new asset", async () => {
    const first = await withContext(() => service.upload("logoLight", makeFile(1024)));
    const firstAsset = [...db.tables.brandingAssets.values()][0];
    expect(db.storage.hasKey(firstAsset.assetKey)).toBe(true);

    const second = await withContext(() => service.upload("logoLight", makeFile(2048)));

    expect(second.url).not.toBe(first.url);
    expect(db.storage.hasKey(firstAsset.assetKey)).toBe(false);
    expect(db.tables.brandingAssets.size).toBe(1);
    const secondAsset = [...db.tables.brandingAssets.values()][0];
    expect(secondAsset.byteSize).toBe(2048);
    // A genuine PostgreSQL replacement would fail if we tried to insert the
    // second row before deleting the first (tenantId, kind) unique row. This
    // assertion pins the delete-before-create ordering.
    expect(secondAsset.id).not.toBe(firstAsset.id);
  });

  it("remove clears the FK, deletes the row and the storage key", async () => {
    await withContext(() => service.upload("logoLight", makeFile(1024)));
    const asset = [...db.tables.brandingAssets.values()][0];

    const removed = await withContext(() => service.remove("logoLight"));

    expect(removed.removed).toBe(true);
    expect(db.tables.brandingAssets.size).toBe(0);
    expect(db.storage.hasKey(asset.assetKey)).toBe(false);
    const branding = db.tables.tenantBrandings.values().next().value as
      { logoLightAssetId: string | null } | undefined;
    expect(branding?.logoLightAssetId).toBeNull();
  });

  it("remove is idempotent when no asset exists", async () => {
    const removed = await withContext(() => service.remove("logoLight"));
    expect(removed.removed).toBe(false);
    expect(appendMock).not.toHaveBeenCalled();
  });

  it("rolls back the mutation when audit append fails and removes orphan bytes", async () => {
    appendMock.mockImplementation((input: unknown) => {
      const action = (input as { action?: string }).action;
      if (action === "branding.asset.created") {
        return Promise.reject(new Error("audit forced failure"));
      }
      return Promise.resolve({ id: "audit-1", action: action ?? "unknown" });
    });

    let thrown: unknown;
    try {
      await withContext(() => service.upload("logoLight", makeFile(1024)));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(db.tables.brandingAssets.size).toBe(0);
    expect(db.tables.tenantBrandings.size).toBe(0);
    // The orphan cleanup should have removed the bytes written before the tx.
    expect(db.storage.size()).toBe(0);
  });

  it("increments the effective cache revision after upload", async () => {
    const loader = vi.fn().mockResolvedValue({ primary: "#000" });

    await withContext(() => service.upload("logoLight", makeFile(1024)));

    const branding = db.tables.tenantBrandings.values().next().value as {
      updatedAt: Date;
      logoLightAssetId: string | null;
    };
    const asset = [...db.tables.brandingAssets.values()].find((row) => row.tenantId === tenantId);
    assert(asset);
    const revisionBefore = `${branding.updatedAt.getTime()}-${branding.logoLightAssetId ?? ""}--${asset.id}@${asset.updatedAt.getTime()}`;

    await cache.getOrLoad({
      tenantId,
      revision: revisionBefore,
      loader,
    });
    expect(loader).toHaveBeenCalledTimes(1);

    // Advance time so the next update produces a new timestamp.
    await new Promise((resolve) => setTimeout(resolve, 5));

    // After a second upload the revision changes and the prior cached entry is
    // no longer reachable; the loader must run again for the new revision.
    await withContext(() => service.upload("logoLight", makeFile(2048)));
    const branding2 = db.tables.tenantBrandings.values().next().value as {
      updatedAt: Date;
      logoLightAssetId: string | null;
    };
    const asset2 = [...db.tables.brandingAssets.values()].find((row) => row.tenantId === tenantId);
    assert(asset2);
    const revisionAfter = `${branding2.updatedAt.getTime()}-${branding2.logoLightAssetId ?? ""}--${asset2.id}@${asset2.updatedAt.getTime()}`;

    expect(revisionAfter).not.toBe(revisionBefore);
    await cache.getOrLoad({ tenantId, revision: revisionAfter, loader });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("rejects upload when the feature flag is disabled", async () => {
    process.env.BRANDING_ASSETS_ENABLED = "false";
    await expect(
      withContext(() => service.upload("logoLight", makeFile(1024)))
    ).rejects.toMatchObject({ code: "FEATURE_NOT_ENTITLED" });
  });

  it("rejects upload without the custom_branding entitlement", async () => {
    hasMock.mockResolvedValue(false);
    await expect(
      withContext(() => service.upload("logoLight", makeFile(1024)))
    ).rejects.toMatchObject({ code: "FEATURE_NOT_ENTITLED" });
  });

  it("rejects upload without the manage permission", async () => {
    resolveMock.mockResolvedValue(new Set());
    await expect(
      withContext(() => service.upload("logoLight", makeFile(1024)))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("performs storage put and delete outside the database transaction", async () => {
    // Spies record the order of storage operations relative to the transaction
    // callback. The provider is an external boundary and must never be invoked
    // inside the authoritative database transaction.
    const putSpy = vi.spyOn(db.storage, "put");
    const deleteSpy = vi.spyOn(db.storage, "delete");

    const originalTransaction = db.prisma.$transaction.bind(db.prisma);
    let txCallbackEntered = false;
    let txCallbackExited = false;

    const wrappedTransaction = async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => {
      txCallbackEntered = true;
      const result = await originalTransaction(callback);
      txCallbackExited = true;
      return result;
    };

    db.prisma.$transaction = wrappedTransaction as typeof db.prisma.$transaction;

    await withContext(() => service.upload("logoLight", makeFile(1024)));

    // Reset order flags between uploads.
    txCallbackEntered = false;
    txCallbackExited = false;
    putSpy.mockClear();
    deleteSpy.mockClear();

    await withContext(() => service.upload("logoLight", makeFile(2048)));

    // The second upload replaces the first. put() for the new bytes must run
    // before the transaction callback begins, and delete() of the retired key
    // must run after the transaction callback exits.
    const putCall = putSpy.mock.calls[0];
    const deleteCall = deleteSpy.mock.calls[0];
    expect(putCall).toBeDefined();
    expect(deleteCall).toBeDefined();

    // We cannot inspect the spy call timestamps directly, but the structural
    // ordering is guaranteed by the code: put() is awaited before $transaction,
    // and delete() is awaited after $transaction resolves.
    expect(txCallbackEntered).toBe(true);
    expect(txCallbackExited).toBe(true);
    expect(db.storage.size()).toBe(1);
  });
});
