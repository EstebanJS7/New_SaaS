import { describe, expect, it } from "vitest";
import {
  createFiscalRangeVoidStore,
  type FiscalRangeVoidPrismaClient,
} from "./range-void.store.js";

/**
 * FISC-016 WU-D — the Prisma side of the range void's record.
 *
 * The store is deliberately thin, so what is asserted is the two things a thin
 * adapter can still get wrong: **the tenant in every statement's `where`** (a
 * cross-tenant read can only produce nothing) and **the row it writes**, which is
 * append-only and therefore never an update.
 */

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const RANGE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_RANGE_ID = "44444444-4444-4444-8444-444444444444";
const CREATED_AT = new Date("2026-10-11T12:00:00.000Z");

interface RecordedCall {
  readonly method: "create" | "findMany";
  readonly args: Record<string, unknown>;
}

/**
 * A client whose delegate records the statements and answers from a table that
 * is filtered by `tenantId` exactly as PostgreSQL would be.
 */
function buildClient(): { client: FiscalRangeVoidPrismaClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const rows = [
    {
      id: "void-a",
      tenantId: TENANT_A,
      rangeId: RANGE_ID,
      fromNumber: 42,
      toNumber: 9_999_999,
      reason: "The operator stopped using this range",
      outcome: "VOIDED" as const,
      reasonCode: "0300",
      providerReason: "Evento aceptado",
      providerReference: "1234567890",
      rangeStatus: "RETIRED" as const,
      createdAt: CREATED_AT,
    },
    {
      id: "void-b",
      tenantId: TENANT_B,
      rangeId: OTHER_RANGE_ID,
      fromNumber: 7,
      toNumber: 9_999_999,
      reason: "Another tenant's range",
      outcome: "REJECTED" as const,
      reasonCode: "0400",
      providerReason: null,
      providerReference: null,
      rangeStatus: "ACTIVE" as const,
      createdAt: CREATED_AT,
    },
  ];

  const client: FiscalRangeVoidPrismaClient = {
    fiscalRangeVoid: {
      findMany: (args) => {
        calls.push({ method: "findMany", args });
        const where = (args.where ?? {}) as { tenantId?: string; rangeId?: string };
        const selected = rows.filter(
          (row) =>
            row.tenantId === where.tenantId &&
            (where.rangeId === undefined || row.rangeId === where.rangeId)
        );
        // Newest first, as the query asks for.
        return Promise.resolve([...selected].reverse());
      },
      create: (args) => {
        calls.push({ method: "create", args });
        const data = (args.data ?? {}) as Record<string, unknown>;
        return Promise.resolve({
          id: "void-created",
          tenantId: data.tenantId as string,
          rangeId: data.rangeId as string,
          fromNumber: data.fromNumber as number,
          toNumber: data.toNumber as number,
          reason: data.reason as string,
          outcome: data.outcome as "VOIDED",
          reasonCode: (data.reasonCode ?? null) as string | null,
          providerReason: (data.providerReason ?? null) as string | null,
          providerReference: (data.providerReference ?? null) as string | null,
          rangeStatus: data.rangeStatus as "RETIRED",
          createdAt: CREATED_AT,
        });
      },
    },
  };
  return { client, calls };
}

describe("createFiscalRangeVoidStore", () => {
  it("records the void with the caller's tenant, once, as an insert", async () => {
    const { client, calls } = buildClient();
    const store = createFiscalRangeVoidStore(client);

    const row = await store.recordVoid({
      key: { tenantId: TENANT_A },
      rangeId: RANGE_ID,
      fromNumber: 42,
      toNumber: 9_999_999,
      reason: "The operator stopped using this range",
      outcome: "VOIDED",
      reasonCode: "0300",
      providerReason: "Evento aceptado",
      providerReference: "1234567890",
      rangeStatus: "RETIRED",
    });

    expect(calls.map((call) => call.method)).toEqual(["create"]);
    expect(calls[0]?.args).toEqual({
      data: {
        tenantId: TENANT_A,
        rangeId: RANGE_ID,
        fromNumber: 42,
        toNumber: 9_999_999,
        reason: "The operator stopped using this range",
        outcome: "VOIDED",
        reasonCode: "0300",
        providerReason: "Evento aceptado",
        providerReference: "1234567890",
        rangeStatus: "RETIRED",
      },
    });
    expect(row.tenantId).toBe(TENANT_A);
    expect(row.outcome).toBe("VOIDED");
    expect(row.rangeStatus).toBe("RETIRED");
  });

  it("writes a refusal with the fields the answer left empty as null, never omitted", async () => {
    const { client, calls } = buildClient();
    const store = createFiscalRangeVoidStore(client);

    await store.recordVoid({
      key: { tenantId: TENANT_A },
      rangeId: RANGE_ID,
      fromNumber: 42,
      toNumber: 9_999_999,
      reason: "The operator stopped using this range",
      outcome: "TRANSIENT_FAILURE",
      reasonCode: "TIMEOUT",
      providerReason: null,
      providerReference: null,
      rangeStatus: "ACTIVE",
    });

    expect((calls[0]?.args.data as Record<string, unknown>).providerReason).toBeNull();
    expect((calls[0]?.args.data as Record<string, unknown>).providerReference).toBeNull();
  });

  it("scopes the reader by the resolved tenant and orders newest first", async () => {
    const { client, calls } = buildClient();
    const store = createFiscalRangeVoidStore(client);

    const rows = await store.readRangeVoids({ key: { tenantId: TENANT_A }, rangeId: RANGE_ID });

    expect(calls[0]?.args).toEqual({
      where: { tenantId: TENANT_A, rangeId: RANGE_ID },
      orderBy: { createdAt: "desc" },
    });
    expect(rows.map((row) => row.id)).toEqual(["void-a"]);
    expect(rows[0]?.providerReference).toBe("1234567890");
  });

  it("answers nothing for another tenant's range, rather than the row itself", async () => {
    const { client } = buildClient();
    const store = createFiscalRangeVoidStore(client);

    // Tenant A asking about tenant B's range: the read is scoped, so it can only
    // ever answer nothing (the repository's own rule: a cross-tenant id is a
    // `404`, never a leak).
    await expect(
      store.readRangeVoids({ key: { tenantId: TENANT_A }, rangeId: OTHER_RANGE_ID })
    ).resolves.toEqual([]);
    // And tenant B asking about its own range finds exactly its own row.
    await expect(
      store.readRangeVoids({ key: { tenantId: TENANT_B }, rangeId: OTHER_RANGE_ID })
    ).resolves.toHaveLength(1);
  });

  it("lists one range's voids without another range's", async () => {
    const { client, calls } = buildClient();
    const store = createFiscalRangeVoidStore(client);

    await store.readRangeVoids({ key: { tenantId: TENANT_A }, rangeId: OTHER_RANGE_ID });

    expect(calls).toHaveLength(1);
    expect((calls[0]?.args.where as Record<string, unknown>).rangeId).toBe(OTHER_RANGE_ID);
  });
});
