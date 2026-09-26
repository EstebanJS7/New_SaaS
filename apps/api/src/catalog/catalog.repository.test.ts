import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Prisma } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";
import type {
  CatalogItemCreateData,
  CatalogItemRow,
  CatalogItemTx,
  CatalogItemUpdateData,
  CatalogItemWhere,
} from "./catalog.repository.js";
import { CatalogRepository, CATALOG_ITEM_NOT_FOUND_MESSAGE } from "./catalog.repository.js";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ROLE_ID = randomUUID();
const TAX_RATE_EXEMPT = randomUUID();
const TAX_RATE_IVA_10 = randomUUID();

function row(
  overrides: Partial<CatalogItemRow> & { tenantId?: string; name?: string } = {}
): CatalogItemRow {
  return {
    id: randomUUID(),
    tenantId: overrides.tenantId ?? TENANT_A,
    kind: "PRODUCT",
    name: overrides.name ?? "Item",
    taxRateId: TAX_RATE_EXEMPT,
    referencePriceAmount: null,
    referencePriceCurrency: null,
    isActive: true,
    // EPIC-10 stock dimension: the column is NOT NULL with a database default,
    // so every persisted row literal carries it.
    tracksStock: true,
    createdAt: new Date("2026-09-25T00:00:00Z"),
    updatedAt: new Date("2026-09-25T00:00:00Z"),
    ...overrides,
  };
}

/**
 * Structural Prisma boundary fake (PrismaClient is a Proxy — no instanceof).
 * Delegate bodies are sync on purpose (eslint require-await): awaiting plain
 * values keeps the runtime contract identical to the real async delegates.
 *
 * Call records let tests prove WHICH predicate the repository sent — the
 * tenant-isolation evidence. The fake exposes NO delete delegate, so any
 * delete path would fail loudly rather than pass vacuously.
 */
function makeFakePrisma(seedRows: CatalogItemRow[]) {
  const rows = new Map<string, CatalogItemRow>(seedRows.map((entry) => [entry.id, entry]));
  const calls = {
    reads: 0,
    writes: 0,
    updates: 0,
    readWhere: [] as CatalogItemWhere[],
    writeWhere: [] as CatalogItemWhere[],
    writeData: [] as CatalogItemUpdateData[],
    createData: [] as (CatalogItemCreateData & { tenantId: string })[],
    orderBy: [] as unknown[],
  };

  function matches(where: CatalogItemWhere, candidate: CatalogItemRow): boolean {
    if (where.id !== undefined && where.id !== candidate.id) return false;
    if (where.tenantId !== undefined && where.tenantId !== candidate.tenantId) return false;
    if (where.kind !== undefined && where.kind !== candidate.kind) return false;
    if (where.isActive !== undefined && where.isActive !== candidate.isActive) return false;
    return true;
  }

  const prisma: CatalogItemTx = {
    catalogItem: {
      findFirst: (args: { where: CatalogItemWhere }): Promise<CatalogItemRow | null> => {
        calls.reads += 1;
        calls.readWhere.push({ ...args.where });
        return Promise.resolve(
          [...rows.values()].find((candidate) => matches(args.where, candidate)) ?? null
        );
      },
      findMany: (args: {
        where: CatalogItemWhere;
        orderBy?: unknown[];
      }): Promise<CatalogItemRow[]> => {
        calls.reads += 1;
        calls.readWhere.push({ ...args.where });
        calls.orderBy.push(args.orderBy);
        return Promise.resolve(
          [...rows.values()]
            .filter((candidate) => matches(args.where, candidate))
            .sort(
              (left, right) =>
                left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
            )
        );
      },
      create: (args: {
        data: CatalogItemCreateData & { tenantId: string };
      }): Promise<CatalogItemRow> => {
        calls.writes += 1;
        calls.createData.push({ ...args.data });
        const rawAmount = args.data.referencePriceAmount;
        const created: CatalogItemRow = {
          id: randomUUID(),
          tenantId: args.data.tenantId,
          kind: args.data.kind,
          name: args.data.name,
          taxRateId: args.data.taxRateId,
          referencePriceAmount:
            typeof rawAmount === "string" ? new Prisma.Decimal(rawAmount) : (rawAmount ?? null),
          referencePriceCurrency: args.data.referencePriceCurrency ?? null,
          isActive: true,
          // Mirrors the column default, so an omitted flag still lands true.
          tracksStock: args.data.tracksStock ?? true,
          createdAt: new Date("2026-09-25T00:00:00Z"),
          updatedAt: new Date("2026-09-25T00:00:00Z"),
        };
        rows.set(created.id, created);
        return Promise.resolve(created);
      },
      updateMany: (args: {
        where: CatalogItemWhere;
        data: CatalogItemUpdateData;
      }): Promise<{ count: number }> => {
        calls.writes += 1;
        calls.updates += 1;
        calls.writeWhere.push({ ...args.where });
        calls.writeData.push({ ...args.data });
        let count = 0;
        for (const candidate of rows.values()) {
          if (!matches(args.where, candidate)) continue;
          Object.assign(candidate, args.data);
          count += 1;
        }
        return Promise.resolve({ count });
      },
    },
  };

  return { prisma, rows, calls };
}

/** Runs `fn` inside an ALS scope whose tenancy claims match `tenantId`. */
function withTenantContext<T>(
  tenantId: string | undefined,
  fn: (repo: CatalogRepository) => Promise<T>,
  prisma: CatalogItemTx
): Promise<T> {
  const ctx = new RequestContextService();
  return ctx.run(`req-${randomUUID()}`, () => {
    if (tenantId) {
      ctx.setTenantMembership({
        tenantId,
        membershipId: randomUUID(),
        roleId: ROLE_ID,
        roleCode: "OWNER",
      });
    }
    return fn(new CatalogRepository(prisma, ctx));
  });
}

function createInput(overrides: Partial<CatalogItemCreateData> = {}): CatalogItemCreateData {
  return {
    kind: "PRODUCT",
    name: "Consultation",
    taxRateId: TAX_RATE_EXEMPT,
    ...overrides,
  };
}

describe("CatalogRepository — implicit tenant scoping", () => {
  it("resolves the tenant from the request context and cannot be overridden by any argument", async () => {
    const db = makeFakePrisma([]);

    // A JS caller (not the typed call site) smuggles a foreign tenantId.
    const smuggled = { ...createInput({ name: "Smuggled" }), tenantId: TENANT_B };
    const created = await withTenantContext(TENANT_A, (repo) => repo.create(smuggled), db.prisma);

    expect(created.tenantId).toBe(TENANT_A);
    expect(db.calls.createData[0]?.tenantId).toBe(TENANT_A);
    expect(db.rows.get(created.id)?.tenantId).toBe(TENANT_A);
  });

  it("follows the ACTIVE tenant, never a caller-supplied one: the same id is visible in A and foreign in B", async () => {
    const own = row({ tenantId: TENANT_A, name: "Own" });
    const db = makeFakePrisma([own]);

    const foundInA = await withTenantContext(TENANT_A, (repo) => repo.findById(own.id), db.prisma);
    expect(foundInA.id).toBe(own.id);

    await expect(
      withTenantContext(TENANT_B, (repo) => repo.findById(own.id), db.prisma)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("forwards the required taxRateId and the exact reference price pair on create", async () => {
    const db = makeFakePrisma([]);
    const price = new Prisma.Decimal("125000.50");

    const created = await withTenantContext(
      TENANT_A,
      (repo) =>
        repo.create(
          createInput({
            kind: "MEDICATION",
            name: "Antibiotic",
            taxRateId: TAX_RATE_IVA_10,
            referencePriceAmount: price,
            referencePriceCurrency: "PYG",
          })
        ),
      db.prisma
    );

    expect(created).toMatchObject({
      kind: "MEDICATION",
      name: "Antibiotic",
      taxRateId: TAX_RATE_IVA_10,
      referencePriceCurrency: "PYG",
      isActive: true,
    });
    expect(created.referencePriceAmount?.toString()).toBe("125000.5");
  });

  it("masks a FOREIGN id and an UNKNOWN id with the same NOT_FOUND outcome", async () => {
    const foreign = row({ tenantId: TENANT_B });
    const db = makeFakePrisma([foreign]);
    const errors: DomainError[] = [];

    await withTenantContext(
      TENANT_A,
      async (repo) => {
        for (const id of [foreign.id, randomUUID()]) {
          try {
            await repo.findById(id);
            expect.unreachable("foreign/unknown id must not resolve");
          } catch (error) {
            errors.push(error as DomainError);
          }
        }
      },
      db.prisma
    );

    expect(errors[0]).toBeInstanceOf(DomainError);
    expect(errors[0].code).toBe("NOT_FOUND");
    expect(errors[0].message).toBe(CATALOG_ITEM_NOT_FOUND_MESSAGE);
    expect(errors[1].code).toBe(errors[0].code);
    expect(errors[1].message).toBe(errors[0].message);
  });

  it("lists ONLY the active tenant's rows, applying each supported filter and no implicit isActive predicate", async () => {
    const ownActive = row({ tenantId: TENANT_A, name: "Alpha", kind: "PRODUCT" });
    const ownInactive = row({
      tenantId: TENANT_A,
      name: "Beta",
      kind: "SERVICE",
      isActive: false,
    });
    const foreign = row({ tenantId: TENANT_B, name: "Gamma", kind: "PRODUCT" });
    const db = makeFakePrisma([foreign, ownInactive, ownActive]);

    const all = await withTenantContext(TENANT_A, (repo) => repo.list(), db.prisma);
    expect(all.map((entry) => entry.name)).toEqual(["Alpha", "Beta"]);
    expect(db.calls.readWhere[0]).toEqual({ tenantId: TENANT_A });
    expect(db.calls.orderBy[0]).toEqual([{ name: "asc" }, { id: "asc" }]);

    const products = await withTenantContext(
      TENANT_A,
      (repo) => repo.list({ kind: "PRODUCT" }),
      db.prisma
    );
    expect(products.map((entry) => entry.name)).toEqual(["Alpha"]);

    const inactive = await withTenantContext(
      TENANT_A,
      (repo) => repo.list({ isActive: false }),
      db.prisma
    );
    expect(inactive.map((entry) => entry.name)).toEqual(["Beta"]);

    const foreignView = await withTenantContext(
      TENANT_B,
      (repo) => repo.list({ kind: "PRODUCT" }),
      db.prisma
    );
    expect(foreignView.map((entry) => entry.id)).toEqual([foreign.id]);
  });

  it("updates through updateMany with the context tenant predicate and drops a rogue tenantId property", async () => {
    const own = row({ tenantId: TENANT_A, name: "Before" });
    const db = makeFakePrisma([own]);
    const smuggling = { name: "After", tenantId: TENANT_B } as CatalogItemUpdateData;

    const updated = await withTenantContext(
      TENANT_A,
      (repo) => repo.update(own.id, smuggling),
      db.prisma
    );

    expect(updated.name).toBe("After");
    expect(updated.tenantId).toBe(TENANT_A);
    expect(db.calls.writeWhere[0]).toEqual({ id: own.id, tenantId: TENANT_A });
    expect(db.calls.writeData[0]).toEqual({ name: "After" });
  });

  it("forwards tracksStock on create and update, and leaves it untouched when omitted", async () => {
    const db = makeFakePrisma([]);

    await withTenantContext(
      TENANT_A,
      async (repo) => {
        const created = await repo.create(createInput({ kind: "SERVICE", tracksStock: false }));
        expect(db.calls.createData[0]?.tracksStock).toBe(false);
        expect(created.tracksStock).toBe(false);

        // A present flag is part of the allowlisted update payload...
        const flipped = await repo.update(created.id, { tracksStock: true });
        expect(db.calls.writeData[0]).toEqual({ tracksStock: true });
        expect(flipped.tracksStock).toBe(true);

        // ...and an omitted one is not sent at all, so the stored value stays.
        const renamed = await repo.update(created.id, { name: "Renamed" });
        expect(db.calls.writeData[1]).toEqual({ name: "Renamed" });
        expect(renamed.tracksStock).toBe(true);
      },
      db.prisma
    );
  });

  it("prevents CROSS-TENANT writes: a foreign target fails not-found and stays unchanged", async () => {
    const foreign = row({ tenantId: TENANT_B, name: "Foreign" });
    const db = makeFakePrisma([foreign]);

    await withTenantContext(
      TENANT_A,
      async (repo) => {
        await expect(repo.update(foreign.id, { name: "Hijacked" })).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        await expect(repo.deactivate(foreign.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      },
      db.prisma
    );

    expect(db.rows.get(foreign.id)?.name).toBe("Foreign");
    expect(db.rows.get(foreign.id)?.isActive).toBe(true);
    expect(db.rows.get(foreign.id)?.tenantId).toBe(TENANT_B);
  });

  it("deactivates softly and idempotently: the row is retained and a second call does not throw", async () => {
    const own = row({ tenantId: TENANT_A, name: "Retained" });
    const db = makeFakePrisma([own]);

    await withTenantContext(
      TENANT_A,
      async (repo) => {
        const first = await repo.deactivate(own.id);
        expect(first.isActive).toBe(false);
        expect(db.calls.writeData[0]).toEqual({ isActive: false });

        const second = await repo.deactivate(own.id);
        expect(second.isActive).toBe(false);
        expect(db.calls.writeWhere[1]).toEqual({ id: own.id, tenantId: TENANT_A, isActive: true });
      },
      db.prisma
    );

    // Soft, not destructive: the row still exists for the owning tenant.
    expect(db.rows.has(own.id)).toBe(true);
    expect(db.rows.get(own.id)?.isActive).toBe(false);
  });

  it("uses the caller's transaction client when one is provided", async () => {
    const own = row({ tenantId: TENANT_A, name: "Before" });
    const db = makeFakePrisma([own]);
    const txDb = makeFakePrisma([own]);

    const updated = await withTenantContext(
      TENANT_A,
      (repo) => repo.update(own.id, { name: "InTx" }, txDb.prisma),
      db.prisma
    );

    expect(updated.name).toBe("InTx");
    expect(txDb.calls.updates).toBe(1);
    expect(db.calls.updates).toBe(0);
    expect(db.calls.reads).toBe(0);
  });

  it("exposes NO delete path and no non-tenant-scoped surface", () => {
    const db = makeFakePrisma([]);
    const ctx = new RequestContextService();
    const repo = new CatalogRepository(db.prisma, ctx);
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(repo))
      .filter((name) => name !== "constructor")
      .sort();

    expect(surface).toEqual(["create", "deactivate", "findById", "list", "update"]);
    for (const forbidden of ["delete", "deleteMany", "remove", "destroy", "hardDelete"]) {
      expect(surface).not.toContain(forbidden);
    }
  });

  it("throws FORBIDDEN BEFORE any database call when tenant context is absent", async () => {
    const db = makeFakePrisma([row({ tenantId: TENANT_A })]);

    await withTenantContext(
      undefined,
      async (repo) => {
        await expect(repo.create(createInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(repo.findById(randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(repo.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(repo.update(randomUUID(), { name: "x" })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(repo.deactivate(randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" });
      },
      db.prisma
    );

    expect(db.calls.reads).toBe(0);
    expect(db.calls.writes).toBe(0);
  });
});
