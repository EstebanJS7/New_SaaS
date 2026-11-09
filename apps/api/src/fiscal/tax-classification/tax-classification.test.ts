import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@newsaas/database";
import { TaxClassificationService, classificationBodySchema } from "./tax-classification.js";

const GRAVADO = { affectation: "GRAVADO_IVA" as const, proportionality: null };
function subject() {
  let tenantId = "tenant-a";
  const rows: {
    tenantId: string;
    rateCode: string;
    affectation: string;
    proportionality: Prisma.Decimal | null;
  }[] = [];
  const audit = { append: vi.fn(() => Promise.resolve({})) };
  const findMany = vi.fn(({ where }: { where: { tenantId: string } }) =>
    Promise.resolve(rows.filter((row) => row.tenantId === where.tenantId))
  );
  const upsert = vi.fn(
    ({
      where,
      create,
      update,
    }: {
      where: { tenantId_rateCode: { tenantId: string; rateCode: string } };
      create: (typeof rows)[number];
      update: typeof GRAVADO;
    }) => {
      let row = rows.find(
        (row) =>
          row.tenantId === where.tenantId_rateCode.tenantId &&
          row.rateCode === where.tenantId_rateCode.rateCode
      );
      if (row) Object.assign(row, update);
      else {
        row = {
          ...create,
          proportionality:
            create.proportionality === null ? null : new Prisma.Decimal(create.proportionality),
        };
        rows.push(row);
      }
      return Promise.resolve(row);
    }
  );
  const rates = [
    { code: "IVA_10", rate: new Prisma.Decimal(10) },
    { code: "IVA_0", rate: new Prisma.Decimal(0) },
  ];
  const client = {
    tenantTaxClassification: { findMany, upsert },
    taxRate: {
      findMany: () => Promise.resolve(rates),
      findUnique: ({ where }: { where: { code: string } }) =>
        Promise.resolve(rates.find((rate) => rate.code === where.code) ?? null),
    },
  };
  const db = {
    ...client,
    $transaction: vi.fn(async (work: (tx: typeof client) => Promise<unknown>) => {
      const before = rows.map((row) => ({ ...row }));
      try {
        return await work(client);
      } catch (error) {
        rows.splice(0, rows.length, ...before);
        throw error;
      }
    }),
  };
  const feature = { has: vi.fn(() => Promise.resolve(true)) };
  const permissions = {
    resolveForActiveRequest: vi.fn(() => Promise.resolve(new Set(["fiscal.profile.manage"]))),
  };
  const service = new TaxClassificationService(
    db as never,
    { requireTenantId: () => tenantId, requireUserProfileId: () => "actor" } as never,
    audit as never,
    feature as never,
    permissions as never
  );
  return {
    service,
    rows,
    audit,
    feature,
    permissions,
    db,
    switchTenant: () => {
      tenantId = "tenant-b";
    },
  };
}

describe("explicit tenant tax classifications", () => {
  it("validates strict affectation and bounded partial proportion without defaults", () => {
    expect(classificationBodySchema.parse(GRAVADO)).toEqual(GRAVADO);
    expect(
      classificationBodySchema.safeParse({
        affectation: "GRAVADO_PARCIAL",
        proportionality: "100.00",
      }).success
    ).toBe(true);
    expect(
      classificationBodySchema.safeParse({ affectation: "GRAVADO_PARCIAL", proportionality: "0" })
        .success
    ).toBe(true);
    for (const input of [
      {},
      { ...GRAVADO, tenantId: "tenant-b" },
      { ...GRAVADO, affectation: "UNKNOWN" },
      { ...GRAVADO, proportionality: "10" },
      { affectation: "GRAVADO_PARCIAL", proportionality: null },
      { affectation: "GRAVADO_PARCIAL", proportionality: "100.01" },
      { affectation: "GRAVADO_PARCIAL", proportionality: "1.001" },
      { affectation: "GRAVADO_PARCIAL", proportionality: "-1" },
    ])
      expect(classificationBodySchema.safeParse(input).success).toBe(false);
  });
  it("lists undeclared rates separately, saves and isolates a declaration with minimal audit", async () => {
    const s = subject();
    expect((await s.service.list()).items).toEqual([]);
    const saved = await s.service.save("IVA_10", GRAVADO);
    expect(saved).toEqual({ rateCode: "IVA_10", ...GRAVADO });
    expect((await s.service.list()).items).toEqual([saved]);
    expect(s.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "fiscal.tax_classification.saved",
        tenantId: "tenant-a",
        metadata: { rateCode: "IVA_10", ...GRAVADO },
      }),
      expect.any(Object)
    );
    s.switchTenant();
    expect((await s.service.list()).items).toEqual([]);
    await s.service.save("IVA_10", { affectation: "GRAVADO_PARCIAL", proportionality: "50.00" });
    expect(s.rows).toHaveLength(2);
    expect(s.rows[0].affectation).toBe("GRAVADO_IVA");
  });
  it("rejects absent rates and inconsistent treatment without writes or audits", async () => {
    const s = subject();
    await expect(s.service.save("UNKNOWN", GRAVADO)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(s.service.save("IVA_0", GRAVADO)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(
      s.service.save("IVA_10", { affectation: "EXENTO", proportionality: null })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(s.rows).toEqual([]);
    expect(s.audit.append).not.toHaveBeenCalled();
    expect(
      await s.service.save("IVA_0", { affectation: "EXONERADO", proportionality: null })
    ).toEqual({ rateCode: "IVA_0", affectation: "EXONERADO", proportionality: null });
  });
  it("rolls back on audit failure", async () => {
    const s = subject();
    s.audit.append.mockRejectedValueOnce(new Error("audit failure"));
    await expect(s.service.save("IVA_10", GRAVADO)).rejects.toThrow("audit failure");
    expect((await s.service.list()).items).toEqual([]);
  });
  it.each(["list", "save"] as const)(
    "gates %s by feature and permission before persistence",
    async (method) => {
      const s = subject();
      const run = () => (method === "list" ? s.service.list() : s.service.save("IVA_10", GRAVADO));
      s.feature.has.mockResolvedValue(false);
      await expect(run()).rejects.toMatchObject({ code: "FEATURE_NOT_ENTITLED" });
      s.feature.has.mockResolvedValue(true);
      s.permissions.resolveForActiveRequest.mockResolvedValue(new Set());
      await expect(run()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(s.db.$transaction).not.toHaveBeenCalled();
      expect(s.rows).toEqual([]);
      expect(s.audit.append).not.toHaveBeenCalled();
    }
  );
});
