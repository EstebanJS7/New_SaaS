import { describe, expect, it } from "vitest";
import { reconcileStaleCleanupIntents, type ReconcilePrisma } from "./reconciliation.service.js";

type FindManyArgs = Parameters<ReconcilePrisma["brandingResetCleanupIntent"]["findMany"]>[0];

function makeReconcilePrisma(ids: string[]) {
  const queries: FindManyArgs[] = [];
  const prisma: ReconcilePrisma = {
    brandingResetCleanupIntent: {
      findMany: (args) => {
        queries.push(args);
        return Promise.resolve(ids.map((id) => ({ id })));
      },
    },
  };
  return { prisma, queries };
}

describe("reconcileStaleCleanupIntents", () => {
  it("re-enqueues stale PENDING intents and reports counts", async () => {
    const { prisma, queries } = makeReconcilePrisma(["a", "b"]);
    const enqueued: string[] = [];
    const now = new Date("2026-09-11T12:00:00.000Z");

    const result = await reconcileStaleCleanupIntents({
      prisma,
      enqueue: (intentId) => {
        enqueued.push(intentId);
        return Promise.resolve();
      },
      now,
      staleMs: 120_000,
    });

    expect(result).toEqual({ scanned: 2, enqueued: 2, failed: 0 });
    expect(enqueued).toEqual(["a", "b"]);

    const query = queries[0];
    expect(query?.where.status).toBe("PENDING");
    expect(query?.where.createdAt.lt.toISOString()).toBe("2026-09-11T11:58:00.000Z");
    expect(query?.orderBy).toEqual({ createdAt: "asc" });
  });

  it("counts a single enqueue failure without aborting the sweep", async () => {
    const { prisma } = makeReconcilePrisma(["a", "b", "c"]);
    const enqueued: string[] = [];

    const result = await reconcileStaleCleanupIntents({
      prisma,
      enqueue: (intentId) => {
        if (intentId === "b") return Promise.reject(new Error("redis down"));
        enqueued.push(intentId);
        return Promise.resolve();
      },
      now: new Date(),
      staleMs: 1_000,
    });

    expect(result).toEqual({ scanned: 3, enqueued: 2, failed: 1 });
    expect(enqueued).toEqual(["a", "c"]);
  });

  it("honors the batch limit", async () => {
    const { prisma, queries } = makeReconcilePrisma([]);

    await reconcileStaleCleanupIntents({
      prisma,
      enqueue: () => Promise.resolve(),
      now: new Date(),
      staleMs: 1_000,
      batchLimit: 25,
    });

    expect(queries[0]?.take).toBe(25);
  });
});
