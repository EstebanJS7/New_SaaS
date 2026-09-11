import { describe, expect, it } from "vitest";
import type { StoragePort } from "@newsaas/storage";
import {
  BrandingResetCleanupHandler,
  sanitizeCleanupError,
  type BrandingResetCleanupStatus,
  type CleanupHandlerPrisma,
  type CleanupIntentRecord,
} from "./cleanup.handler.js";

interface FakeIntent extends CleanupIntentRecord {
  lastError: string | null;
  completedAt: Date | null;
}

interface AuditEntry {
  action: string;
  actorType: string;
  tenantId?: string;
  targetId?: string;
  metadata: Record<string, unknown>;
}

/** In-memory intent delegate with the same guarded-update semantics as Prisma. */
function makePrisma(
  seed: FakeIntent[],
  options: { failAuditFor?: (action: string) => boolean } = {}
) {
  const intents = new Map(seed.map((intent) => [intent.id, { ...intent }]));
  const audits: AuditEntry[] = [];

  const prisma = {
    // Interactive transaction double: snapshots the mutable state and restores
    // it when the callback throws, so the atomicity guarantee (terminal
    // transition + SYSTEM audit commit together) is provable against this fake.
    $transaction: async <R>(work: (tx: unknown) => Promise<R>): Promise<R> => {
      const intentsSnapshot = new Map([...intents].map(([id, row]) => [id, { ...row }]));
      const auditsLength = audits.length;
      try {
        return await work(prisma);
      } catch (error) {
        intents.clear();
        for (const [id, row] of intentsSnapshot) intents.set(id, row);
        audits.length = auditsLength;
        throw error;
      }
    },
    brandingResetCleanupIntent: {
      findFirst: (args: { where: { id: string; tenantId?: string } }) => {
        const found = intents.get(args.where.id);
        if (!found) return Promise.resolve(null);
        if (args.where.tenantId !== undefined && found.tenantId !== args.where.tenantId) {
          return Promise.resolve(null);
        }
        return Promise.resolve({ ...found });
      },
      updateMany: (args: {
        where: { id: string; tenantId: string; status: BrandingResetCleanupStatus };
        data: {
          status?: BrandingResetCleanupStatus;
          attempts?: { increment: number };
          lastError?: string | null;
          completedAt?: Date | null;
        };
      }) => {
        const found = intents.get(args.where.id);
        if (!found) {
          return Promise.resolve({ count: 0 });
        }
        if (found.tenantId !== args.where.tenantId || found.status !== args.where.status) {
          return Promise.resolve({ count: 0 });
        }
        if (args.data.attempts) found.attempts += args.data.attempts.increment;
        if (args.data.lastError !== undefined) found.lastError = args.data.lastError;
        if (args.data.completedAt !== undefined) found.completedAt = args.data.completedAt;
        if (args.data.status !== undefined) found.status = args.data.status;
        return Promise.resolve({ count: 1 });
      },
    },
    auditLog: {
      create: (args: {
        data: {
          action: string;
          actorType: string;
          tenantId?: string;
          targetId?: string;
          metadata: unknown;
        };
      }) => {
        if (options.failAuditFor?.(args.data.action)) {
          return Promise.reject(new Error("audit write failed"));
        }
        audits.push({
          action: args.data.action,
          actorType: args.data.actorType,
          ...(args.data.tenantId !== undefined && { tenantId: args.data.tenantId }),
          ...(args.data.targetId !== undefined && { targetId: args.data.targetId }),
          metadata: (args.data.metadata ?? {}) as Record<string, unknown>,
        });
        return Promise.resolve({ id: `audit-${audits.length}` });
      },
    },
  };

  return { prisma: prisma as unknown as CleanupHandlerPrisma, intents, audits };
}

/** Configurable storage double recording deletions and supporting failures. */
function makeStorage(failKeys: readonly string[] = []) {
  const failing = new Set(failKeys);
  const deleted: string[] = [];
  const storage: StoragePort = {
    put: () => Promise.reject(new Error("put not used")),
    delete: (args) => {
      if (failing.has(args.key)) return Promise.reject(new Error("storage unavailable"));
      deleted.push(args.key);
      return Promise.resolve();
    },
    signedUrl: () => Promise.reject(new Error("signedUrl not used")),
    get: () => Promise.reject(new Error("get not used")),
  };
  return { storage, deleted };
}

function seedIntent(overrides: Partial<FakeIntent> = {}): FakeIntent {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "22222222-2222-4222-8222-222222222222",
    storageKeys: ["brand_a", "brand_b"],
    status: "PENDING",
    attempts: 0,
    lastError: null,
    completedAt: null,
    ...overrides,
  };
}

describe("BrandingResetCleanupHandler", () => {
  it("deletes only the captured keys, completes, and writes one SYSTEM audit", async () => {
    const intent = seedIntent();
    const { prisma, intents, audits } = makePrisma([intent]);
    const { storage, deleted } = makeStorage();
    const handler = new BrandingResetCleanupHandler(prisma, storage, { maxAttempts: 3 });

    const outcome = await handler.handle(intent.id);

    expect(outcome).toBe("completed");
    expect(deleted).toEqual(["brand_a", "brand_b"]);
    expect(intents.get(intent.id)?.status).toBe("COMPLETED");
    expect(intents.get(intent.id)?.attempts).toBe(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "branding.reset.storage_retired",
      actorType: "SYSTEM",
      tenantId: intent.tenantId,
      targetId: intent.id,
    });
  });

  it("is idempotent: replaying a COMPLETED intent is a no-op without duplicate audit", async () => {
    const intent = seedIntent({ status: "COMPLETED", attempts: 1 });
    const { prisma, audits } = makePrisma([intent]);
    const { storage, deleted } = makeStorage();
    const handler = new BrandingResetCleanupHandler(prisma, storage, { maxAttempts: 3 });

    const outcome = await handler.handle(intent.id);

    expect(outcome).toBe("skipped");
    expect(deleted).toEqual([]);
    expect(audits).toHaveLength(0);
  });

  it("treats an unknown intent id as not found", async () => {
    const { prisma, audits } = makePrisma([]);
    const { storage, deleted } = makeStorage();
    const handler = new BrandingResetCleanupHandler(prisma, storage, { maxAttempts: 3 });

    expect(await handler.handle("00000000-0000-4000-8000-000000000000")).toBe("not_found");
    expect(deleted).toEqual([]);
    expect(audits).toHaveLength(0);
  });

  it("denies cross-tenant access: wrong tenant context deletes nothing", async () => {
    const intent = seedIntent();
    const { prisma, audits } = makePrisma([intent]);
    const { storage, deleted } = makeStorage();
    const handler = new BrandingResetCleanupHandler(prisma, storage, { maxAttempts: 3 });

    const outcome = await handler.handle(intent.id, "99999999-9999-4999-8999-999999999999");

    expect(outcome).toBe("not_found");
    expect(deleted).toEqual([]);
    expect(audits).toHaveLength(0);
  });

  it("retries a transient failure and succeeds on the next pass", async () => {
    const intent = seedIntent({ storageKeys: ["brand_a"] });
    const { prisma, intents, audits } = makePrisma([intent]);
    let failing = true;
    const deleted: string[] = [];
    const storage: StoragePort = {
      put: () => Promise.reject(new Error("put not used")),
      delete: (args) => {
        if (failing) return Promise.reject(new Error("storage unavailable"));
        deleted.push(args.key);
        return Promise.resolve();
      },
      signedUrl: () => Promise.reject(new Error("signedUrl not used")),
      get: () => Promise.reject(new Error("get not used")),
    };
    const handler = new BrandingResetCleanupHandler(prisma, storage, { maxAttempts: 3 });

    await expect(handler.handle(intent.id)).rejects.toThrow("storage unavailable");
    expect(intents.get(intent.id)?.status).toBe("PENDING");
    expect(intents.get(intent.id)?.attempts).toBe(1);
    expect(intents.get(intent.id)?.lastError).toContain("storage unavailable");
    expect(audits).toHaveLength(0);

    failing = false;
    expect(await handler.handle(intent.id)).toBe("completed");
    expect(intents.get(intent.id)?.status).toBe("COMPLETED");
    expect(intents.get(intent.id)?.attempts).toBe(2);
    expect(deleted).toEqual(["brand_a"]);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe("branding.reset.storage_retired");
  });

  it("terminates visibly at the attempt bound with one sanitized failure audit", async () => {
    const intent = seedIntent();
    const { prisma, intents, audits } = makePrisma([intent]);
    const { storage } = makeStorage(["brand_a", "brand_b"]);
    const handler = new BrandingResetCleanupHandler(prisma, storage, { maxAttempts: 2 });

    await expect(handler.handle(intent.id)).rejects.toThrow("storage unavailable");
    expect(intents.get(intent.id)?.status).toBe("PENDING");
    expect(intents.get(intent.id)?.attempts).toBe(1);
    expect(audits).toHaveLength(0);

    await expect(handler.handle(intent.id)).rejects.toThrow("storage unavailable");
    expect(intents.get(intent.id)?.status).toBe("DEAD_LETTER");
    expect(intents.get(intent.id)?.attempts).toBe(2);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "branding.reset.storage_cleanup_failed",
      actorType: "SYSTEM",
      tenantId: intent.tenantId,
      metadata: { attempts: 2, lastError: "storage unavailable" },
    });

    // Terminal state is final: a later replay does not retry or re-audit.
    expect(await handler.handle(intent.id)).toBe("skipped");
    expect(audits).toHaveLength(1);
  });

  it("rolls back the COMPLETED transition when its SYSTEM audit append fails", async () => {
    const intent = seedIntent();
    const { prisma, intents, audits } = makePrisma([intent], {
      failAuditFor: (action) => action === "branding.reset.storage_retired",
    });
    const { storage, deleted } = makeStorage();
    const handler = new BrandingResetCleanupHandler(prisma, storage, { maxAttempts: 3 });

    await expect(handler.handle(intent.id)).rejects.toThrow("audit write failed");

    // Atomicity: no COMPLETED intent may exist without its success audit, and
    // the un-audited transition must roll back so the job is retryable.
    expect(deleted).toEqual(["brand_a", "brand_b"]);
    expect(intents.get(intent.id)?.status).toBe("PENDING");
    expect(intents.get(intent.id)?.attempts).toBe(0);
    expect(audits).toHaveLength(0);
  });

  it("rolls back the DEAD_LETTER transition when its failure audit append fails", async () => {
    const intent = seedIntent({ storageKeys: ["brand_a"] });
    const { prisma, intents, audits } = makePrisma([intent], {
      failAuditFor: (action) => action === "branding.reset.storage_cleanup_failed",
    });
    const { storage } = makeStorage(["brand_a"]);
    const handler = new BrandingResetCleanupHandler(prisma, storage, { maxAttempts: 1 });

    await expect(handler.handle(intent.id)).rejects.toThrow("audit write failed");

    // Atomicity: a terminal DEAD_LETTER cannot survive a failed failure-audit.
    expect(intents.get(intent.id)?.status).toBe("PENDING");
    expect(intents.get(intent.id)?.attempts).toBe(0);
    expect(audits).toHaveLength(0);
  });
});

describe("sanitizeCleanupError", () => {
  it("collapses whitespace and truncates long messages", () => {
    const long = `line one\nline two\n${"x".repeat(500)}`;
    const sanitized = sanitizeCleanupError(new Error(long));
    expect(sanitized).not.toContain("\n");
    expect(sanitized.length).toBe(300);
  });

  it("falls back to a fixed message for empty/unknown errors", () => {
    expect(sanitizeCleanupError(new Error("   "))).toBe("cleanup failed");
    expect(sanitizeCleanupError(undefined)).toBe("cleanup failed");
  });
});
