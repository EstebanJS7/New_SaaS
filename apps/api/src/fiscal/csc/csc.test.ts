import { describe, expect, it, vi } from "vitest";
import { createFiscalCscReader } from "@newsaas/fiscal-persistence";
import {
  FISCAL_CSC_ALREADY_ACTIVE_MESSAGE,
  FISCAL_CSC_CONCURRENT_CHANGE_MESSAGE,
  FISCAL_CSC_TWO_ACTIVE_MESSAGE,
  FiscalCscService,
} from "./csc.service.js";
import { loadCscBodySchema, retireCscBodySchema } from "./csc.zod.js";

const VALUE = "Ab12".repeat(8);
const INPUT = { environment: "TEST" as const, idCsc: "0001", value: VALUE };
const TENANT = "11111111-1111-4111-8111-111111111111";
const TRIGGER_MESSAGE =
  'Error occurred during query execution: ConnectorError(... code: "23001", message: "tenant 1 already holds two ACTIVE CSCs for environment TEST: SIFEN allows up to two active, so retire one first" ...)';
interface Row {
  id: string;
  tenantId: string;
  environment: string;
  idCsc: string;
  secretRef: string;
  status: string;
  createdAt: Date;
  retiredAt: Date | null;
  retirementReason?: string | null;
}
function subject() {
  let tenantId = TENANT;
  const rows: Row[] = [];
  const secrets = new Map<string, string>();
  const audits: unknown[] = [];
  const match = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key as keyof Row] === value);
  const delegate = {
    findMany: vi.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.filter((row) => match(row, where)))
    ),
    findFirst: vi.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.find((row) => match(row, where)) ?? null)
    ),
    count: vi.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.filter((row) => match(row, where)).length)
    ),
    create: vi.fn(({ data }: { data: Omit<Row, "id" | "createdAt" | "retiredAt"> }) => {
      // Emulates the two database rules the service relies on: the partial
      // unique index and the at-most-two trigger, in the shapes Prisma raises.
      const active = rows.filter(
        (row) =>
          row.tenantId === data.tenantId &&
          row.environment === data.environment &&
          row.status === "ACTIVE"
      );
      if (active.some((row) => row.idCsc === data.idCsc)) {
        return Promise.reject(
          Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
            meta: { target: "tenant_fiscal_csc_one_active_per_id_key" },
          })
        );
      }
      if (active.length >= 2) {
        return Promise.reject(new Error(TRIGGER_MESSAGE));
      }
      const row = {
        ...data,
        id: `id-${rows.length + 1}`,
        createdAt: new Date(),
        retiredAt: null,
        retirementReason: null,
      };
      rows.push(row);
      return Promise.resolve(row);
    }),
    updateMany: vi.fn(({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
      const found = rows.filter((row) => match(row, where));
      found.forEach((row) => Object.assign(row, data));
      return Promise.resolve({ count: found.length });
    }),
  };
  const tx = { tenantFiscalCsc: delegate };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => {
      const oldRows = structuredClone(rows);
      const oldSecrets = new Map(secrets);
      const oldAudits = [...audits];
      try {
        return await work(tx);
      } catch (error) {
        rows.splice(0, rows.length, ...oldRows);
        secrets.clear();
        oldSecrets.forEach((value, key) => secrets.set(key, value));
        audits.splice(0, audits.length, ...oldAudits);
        throw error;
      }
    }),
  };
  const store = {
    put: vi.fn(
      ({ tenantId: tenant, key, value }: { tenantId: string; key: string; value: string }) => {
        secrets.set(`${tenant}/${key}`, value);
        return Promise.resolve({ key });
      }
    ),
    get: vi.fn(({ tenantId: tenant, key }: { tenantId: string; key: string }) =>
      Promise.resolve(secrets.get(`${tenant}/${key}`) ?? null)
    ),
    delete: vi.fn(({ tenantId: tenant, key }: { tenantId: string; key: string }) => {
      secrets.delete(`${tenant}/${key}`);
      return Promise.resolve();
    }),
  };
  const audit = {
    append: vi.fn((input: unknown) => {
      audits.push(input);
      return Promise.resolve({});
    }),
  };
  const entitlements = { has: vi.fn(() => Promise.resolve(true)) };
  const permissions = {
    resolveForActiveRequest: vi.fn(() =>
      Promise.resolve(new Set(["fiscal.signing_material.manage"]))
    ),
  };
  const service = new FiscalCscService(
    prisma as never,
    {
      requireTenantId: () => tenantId,
      requireUserProfileId: () => "actor",
    } as never,
    audit as never,
    entitlements as never,
    permissions as never,
    store as never
  );
  return {
    service,
    rows,
    secrets,
    audits,
    store,
    audit,
    prisma,
    delegate,
    entitlements,
    permissions,
    switchTenant: () => {
      tenantId = "22222222-2222-4222-8222-222222222222";
    },
  };
}

describe("CSC strict input", () => {
  it("accepts exactly the required SIFEN shape without transforming the secret", () => {
    expect(loadCscBodySchema.parse(INPUT)).toEqual(INPUT);
    for (const invalid of [
      { ...INPUT, environment: "DEV" },
      { ...INPUT, idCsc: "001" },
      { ...INPUT, idCsc: "00001" },
      { ...INPUT, idCsc: "00 1" },
      { ...INPUT, idCsc: 1 },
      { ...INPUT, value: VALUE.slice(1) },
      { ...INPUT, value: VALUE + "a" },
      { ...INPUT, value: "!".repeat(32) },
      { ...INPUT, tenantId: TENANT },
      { ...INPUT, value: " " + VALUE },
    ])
      expect(loadCscBodySchema.safeParse(invalid).success).toBe(false);
  });
  it("requires a bounded reason and rejects extra keys", () => {
    expect(retireCscBodySchema.parse({ reason: " rotation " })).toEqual({ reason: "rotation" });
    for (const reason of ["", " ", "x".repeat(501)])
      expect(retireCscBodySchema.safeParse({ reason }).success).toBe(false);
    expect(retireCscBodySchema.safeParse({ reason: "rotation", value: VALUE }).success).toBe(false);
  });
});

describe("CSC lifecycle", () => {
  it("stores only an opaque reference and returns/audits metadata, readable by the worker", async () => {
    const s = subject();
    const loaded = await s.service.load(INPUT);
    expect(s.rows).toHaveLength(1);
    expect(s.secrets.size).toBe(1);
    expect(loaded).toEqual({
      id: "id-1",
      environment: "TEST",
      idCsc: "0001",
      status: "ACTIVE",
      createdAt: loaded.createdAt,
      retiredAt: null,
      retirementReason: null,
    });
    expect(loaded.createdAt).toBeInstanceOf(Date);
    expect(await s.service.list()).toEqual([loaded]);
    expect(s.audits).toEqual([
      expect.objectContaining({
        action: "fiscal.csc.loaded",
        metadata: { environment: "TEST", idCsc: "0001" },
      }),
    ]);
    expect(JSON.stringify([s.rows, loaded, s.audits])).not.toContain(VALUE);
    expect(loaded).not.toHaveProperty("secretRef");
    expect(s.rows[0]?.secretRef).toMatch(/^fcsc_[A-Za-z0-9_-]{22}$/);
    // The row is written before the secret, so a refused insert never stores one.
    expect(s.delegate.create.mock.invocationCallOrder[0]).toBeLessThan(
      s.store.put.mock.invocationCallOrder[0] ?? 0
    );
    const reader = createFiscalCscReader({
      client: s.prisma,
      secretStore: s.store as never,
    });
    expect(await reader.read({ tenantId: TENANT, environment: "TEST" })).toEqual({
      idCsc: "0001",
      csc: VALUE,
    });
    expect(await reader.read({ tenantId: TENANT, environment: "PRODUCTION" })).toBeNull();
    expect(s.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(s.store.put).toHaveBeenCalledWith(
      expect.objectContaining({
        tx: { tenantFiscalCsc: s.delegate },
        tenantId: TENANT,
        value: VALUE,
      })
    );
  });
  it("refuses duplicate and third active codes without row, secret or audit writes", async () => {
    const s = subject();
    await s.service.load(INPUT);
    const before = () => [
      s.rows.length,
      s.secrets.size,
      s.audits.length,
      s.store.put.mock.calls.length,
    ];
    const initial = before();
    await expect(s.service.load(INPUT)).rejects.toMatchObject({
      code: "CONFLICT",
      message: FISCAL_CSC_ALREADY_ACTIVE_MESSAGE,
    });
    expect(before()).toEqual(initial);
    await s.service.load({ ...INPUT, idCsc: "0002" });
    const two = before();
    await expect(s.service.load({ ...INPUT, idCsc: "0003" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: FISCAL_CSC_TWO_ACTIVE_MESSAGE,
    });
    expect(before()).toEqual(two);
    await s.service.load({ ...INPUT, environment: "PRODUCTION" });
    expect(s.rows).toHaveLength(3);
  });
  it("retires once, removes the secret and preserves the row and reason", async () => {
    const s = subject();
    const loaded = await s.service.load(INPUT);
    const retired = await s.service.retire({ id: loaded.id, reason: "rotation" });
    expect(retired).toMatchObject({
      id: loaded.id,
      status: "RETIRED",
      retirementReason: "rotation",
      retiredAt: retired.retiredAt,
    });
    expect(retired.retiredAt).toBeInstanceOf(Date);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({
      retirementReason: "rotation",
      retiredByUserProfileId: "actor",
    });
    expect(s.secrets.size).toBe(0);
    expect(s.audits[1]).toMatchObject({ action: "fiscal.csc.retired" });
    expect(s.audits[1]).toHaveProperty("metadata", { environment: "TEST", idCsc: "0001" });
    await expect(s.service.retire({ id: loaded.id, reason: "again" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(s.audits).toHaveLength(2);
    expect(s.store.delete).toHaveBeenCalledTimes(1);
    await s.service.load(INPUT);
    expect(s.secrets.size).toBe(1);
  });
  it("hides foreign and absent IDs and isolates reads without mutating anything", async () => {
    const s = subject();
    const loaded = await s.service.load(INPUT);
    s.switchTenant();
    expect(await s.service.list()).toEqual([]);
    for (const id of [loaded.id, "absent"]) {
      await expect(s.service.retire({ id, reason: "rotation" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
    expect(s.rows).toHaveLength(1);
    expect(s.secrets.size).toBe(1);
    expect(s.audits).toHaveLength(1);
  });
  it.each(["list", "load", "retire"] as const)(
    "gates %s by entitlement and permission before any read/write",
    async (method) => {
      const s = subject();
      const run = () =>
        method === "list"
          ? s.service.list()
          : method === "load"
            ? s.service.load(INPUT)
            : s.service.retire({ id: "id-1", reason: "rotation" });
      s.entitlements.has.mockResolvedValue(false);
      await expect(run()).rejects.toMatchObject({ code: "FEATURE_NOT_ENTITLED" });
      s.entitlements.has.mockResolvedValue(true);
      s.permissions.resolveForActiveRequest.mockResolvedValue(new Set());
      await expect(run()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(s.delegate.findMany).not.toHaveBeenCalled();
      expect(s.prisma.$transaction).not.toHaveBeenCalled();
      expect(s.secrets.size).toBe(0);
      expect(s.audits).toEqual([]);
    }
  );
  it("rolls back row and secret on audit failure and does not expose the secret in errors", async () => {
    const s = subject();
    s.audit.append.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(s.service.load(INPUT)).rejects.toThrow("audit unavailable");
    expect(s.rows).toEqual([]);
    expect(s.secrets.size).toBe(0);
    expect(s.audits).toEqual([]);
    s.prisma.$transaction.mockRejectedValueOnce({ code: "P2034", message: VALUE });
    const raced = await s.service.load(INPUT).catch((error: unknown) => error);
    expect(raced).toMatchObject({
      code: "CONFLICT",
      message: FISCAL_CSC_CONCURRENT_CHANGE_MESSAGE,
    });
    expect(JSON.stringify(raced)).not.toContain(VALUE);
    // A unique violation on any other index is not this rule and propagates.
    const unrelated = { code: "P2002", meta: { target: "tenant_fiscal_csc_tenant_id_id_key" } };
    s.prisma.$transaction.mockRejectedValueOnce(unrelated);
    await expect(s.service.load(INPUT)).rejects.toBe(unrelated);
  });
});
