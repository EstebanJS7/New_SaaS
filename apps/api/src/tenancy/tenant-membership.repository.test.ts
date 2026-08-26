import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DomainError } from "@newsaas/shared";
import type { ActiveMembershipResolution } from "./tenant-membership.repository.js";
import { TenantMembershipRepository } from "./tenant-membership.repository.js";
import { RequestContextService } from "../context/request-context.service.js";

interface MembershipRow {
  id: string;
  tenantId: string;
  userProfileId: string;
  roleId: string;
  status: string;
  createdAt: Date;
}

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const PROFILE_A = randomUUID();
const ROLE_ID = randomUUID();

function row(
  overrides: Partial<MembershipRow> & { tenantId?: string; userProfileId?: string }
): MembershipRow {
  return {
    id: randomUUID(),
    tenantId: overrides.tenantId ?? TENANT_A,
    userProfileId: overrides.userProfileId ?? PROFILE_A,
    roleId: ROLE_ID,
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

/**
 * Structural Prisma boundary fake (PrismaClient is a Proxy — no instanceof).
 * Delegate bodies are sync on purpose (eslint require-await): awaiting plain
 * values keeps the runtime contract identical to the real async delegates.
 * Read/write counters let tests prove the repository NEVER touches the
 * database before its context contract holds.
 */
function makeFakePrisma(seedRows: MembershipRow[]) {
  const rows = new Map<string, MembershipRow>(seedRows.map((entry) => [entry.id, entry]));
  const roles = new Map<string, { code: string; id: string }>([
    [ROLE_ID, { code: "OWNER", id: ROLE_ID }],
  ]);
  const calls = { reads: 0, writes: 0 };

  function matches(where: Record<string, unknown>, candidate: MembershipRow): boolean {
    if (where.id !== undefined && where.id !== candidate.id) return false;
    if (where.tenantId !== undefined && where.tenantId !== candidate.tenantId) return false;
    if (where.userProfileId !== undefined && where.userProfileId !== candidate.userProfileId) {
      return false;
    }
    if (where.status !== undefined && where.status !== candidate.status) return false;
    return true;
  }

  interface OrderClause {
    createdAt?: "asc" | "desc";
    id?: "asc" | "desc";
  }

  /**
   * Honors orderBy clauses (the real delegate sorts server-side; ignoring
   * them here would make findFirst silently depend on seed insertion order).
   */
  function compareBy(
    left: MembershipRow,
    right: MembershipRow,
    clauses: OrderClause[] | undefined
  ): number {
    for (const clause of clauses ?? [{ createdAt: "asc" as const }, { id: "asc" as const }]) {
      for (const key of Object.keys(clause) as (keyof OrderClause)[]) {
        const direction = clause[key];
        if (!direction) continue;
        const leftValue = left[key] instanceof Date ? left[key].getTime() : left[key];
        const rightValue = right[key] instanceof Date ? right[key].getTime() : right[key];
        const compared =
          typeof leftValue === "string" && typeof rightValue === "string"
            ? leftValue.localeCompare(rightValue)
            : Number(leftValue) - Number(rightValue);
        if (compared !== 0) {
          return direction === "asc" ? compared : -compared;
        }
      }
    }
    return 0;
  }

  const prisma = {
    tenantMembership: {
      findFirst: (args: {
        where: Record<string, unknown>;
        orderBy?: OrderClause[];
        include?: { role?: unknown };
      }): (MembershipRow & { role?: { code: string; id: string } }) | null => {
        calls.reads += 1;
        const matched = [...rows.values()]
          .filter((candidate) => matches(args.where, candidate))
          .sort((left, right) => compareBy(left, right, args.orderBy));
        const candidate = matched[0];
        if (!candidate) return null;
        if (args.include?.role) {
          const joinedRole = roles.get(candidate.roleId);
          return {
            ...candidate,
            role: { code: joinedRole?.code ?? "", id: joinedRole?.id ?? candidate.roleId },
          };
        }
        return candidate;
      },
      findMany: (args: { where: Record<string, unknown> }): MembershipRow[] => {
        calls.reads += 1;
        return [...rows.values()].filter((candidate) => matches(args.where, candidate));
      },
      updateMany: (args: {
        where: Record<string, unknown>;
        data: { status: string };
      }): { count: number } => {
        calls.writes += 1;
        let count = 0;
        for (const candidate of rows.values()) {
          if (!matches(args.where, candidate)) continue;
          candidate.status = args.data.status;
          count += 1;
        }
        return { count };
      },
    },
  };

  return { prisma, rows, roles, calls };
}

/** Runs `fn` inside an ALS scope whose tenancy claims match `tenantId`. */
async function withTenantContext<T>(
  tenantId: string | undefined,
  fn: (ctx: RequestContextService) => Promise<T>
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
    return fn(ctx);
  });
}

describe("TenantMembershipRepository — implicit tenant scoping", () => {
  it("listForActiveTenant observes ONLY the active tenant's rows without hand-written filters", async () => {
    const foreign = row({ tenantId: TENANT_B });
    const own = row({ tenantId: TENANT_A });
    const db = makeFakePrisma([foreign, own]);

    const views = await withTenantContext(TENANT_A, (ctx) =>
      new TenantMembershipRepository(db.prisma as never, ctx).listForActiveTenant()
    );

    expect(views.map((view) => view.id)).toEqual([own.id]);
    expect(views.map((view) => view.tenantId)).toEqual([TENANT_A]);
    expect(db.rows.get(foreign.id)?.tenantId).toBe(TENANT_B); // untouched, just unobservable
  });

  it("findByIdInActiveTenant returns own rows and masks FOREIGN ids as NOT_FOUND", async () => {
    const foreign = row({ tenantId: TENANT_B });
    const own = row({ tenantId: TENANT_A });
    const db = makeFakePrisma([own, foreign]);

    await withTenantContext(TENANT_A, async (ctx) => {
      const repo = new TenantMembershipRepository(db.prisma as never, ctx);
      const view = await repo.findByIdInActiveTenant(own.id);
      expect(view).toEqual({
        id: own.id,
        tenantId: TENANT_A,
        userProfileId: view.userProfileId,
        status: "ACTIVE",
      });

      try {
        await repo.findByIdInActiveTenant(foreign.id);
        expect.unreachable("foreign id must not resolve");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe("NOT_FOUND");
      }
    });
  });

  it("produces BYTE-EQUIVALENT rejections for nonexistent vs foreign ids", async () => {
    const foreign = row({ tenantId: TENANT_B });
    const db = makeFakePrisma([foreign]);
    const readPathErrors: DomainError[] = [];
    const writePathErrors: DomainError[] = [];

    await withTenantContext(TENANT_A, async (ctx) => {
      const repo = new TenantMembershipRepository(db.prisma as never, ctx);
      for (const id of [foreign.id, randomUUID()]) {
        try {
          await repo.findByIdInActiveTenant(id);
          expect.unreachable();
        } catch (error) {
          readPathErrors.push(error as DomainError);
        }
        try {
          await repo.updateStatusInActiveTenant(id, "SUSPENDED");
          expect.unreachable();
        } catch (error) {
          writePathErrors.push(error as DomainError);
        }
      }
    });

    expect(readPathErrors[0].message).toBe(readPathErrors[1].message);
    expect(readPathErrors[0].code).toBe(readPathErrors[1].code);
    expect(writePathErrors[0].message).toBe(writePathErrors[1].message);
    expect(writePathErrors[0].code).toBe(writePathErrors[1].code);
  });

  it("prevents CROSS-TENANT writes: foreign target fails not-found and stays unchanged", async () => {
    const foreign = row({ tenantId: TENANT_B, status: "ACTIVE" });
    const own = row({ tenantId: TENANT_A, status: "ACTIVE" });
    const db = makeFakePrisma([foreign, own]);

    await withTenantContext(TENANT_A, async (ctx) => {
      const repo = new TenantMembershipRepository(db.prisma as never, ctx);

      await repo.updateStatusInActiveTenant(own.id, "SUSPENDED");
      expect(db.rows.get(own.id)?.status).toBe("SUSPENDED");

      try {
        await repo.updateStatusInActiveTenant(foreign.id, "SUSPENDED");
        expect.unreachable("cross-tenant write must fail");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe("NOT_FOUND");
      }
      expect(db.rows.get(foreign.id)?.status).toBe("ACTIVE");
    });
  });

  it("throws FORBIDDEN BEFORE any database call when tenant context is absent", async () => {
    const db = makeFakePrisma([]);
    const outsideCtx = new RequestContextService();

    const repo = new TenantMembershipRepository(db.prisma as never, outsideCtx);
    // Outside any ALS run(): requireTenantId() must reject before a delegate
    // fires — the predicate is a PRECONDITION, not a post-query filter.
    await expect(repo.listForActiveTenant()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repo.findByIdInActiveTenant(randomUUID())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(repo.updateStatusInActiveTenant(randomUUID(), "ACTIVE")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(db.calls.reads).toBe(0);
    expect(db.calls.writes).toBe(0);
  });
});

describe("TenantMembershipRepository.resolveActiveForProfile", () => {
  it("resolves only ACTIVE memberships with role id/code and deterministic order", async () => {
    const suspended = row({ status: "SUSPENDED", createdAt: new Date("2026-01-01T00:00:00Z") });
    const oldestActive = row({
      status: "ACTIVE",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });
    const newerActive = row({
      status: "ACTIVE",
      createdAt: new Date("2026-03-01T00:00:00Z"),
    });
    const db = makeFakePrisma([newerActive, suspended, oldestActive]);

    const resolution: ActiveMembershipResolution | null = await withTenantContext(
      undefined,
      (ctx) =>
        new TenantMembershipRepository(db.prisma as never, ctx).resolveActiveForProfile(PROFILE_A)
    );

    expect(resolution).toMatchObject({
      id: oldestActive.id,
      tenantId: oldestActive.tenantId,
      roleId: ROLE_ID,
      roleCode: "OWNER",
    });
  });

  it("returns null when the profile has no ACTIVE membership", async () => {
    const db = makeFakePrisma([row({ status: "SUSPENDED" })]);
    const resolution = await withTenantContext(undefined, (ctx) =>
      new TenantMembershipRepository(db.prisma as never, ctx).resolveActiveForProfile(PROFILE_A)
    );
    expect(resolution).toBeNull();
  });
});
