import { randomUUID } from "node:crypto";

/**
 * In-memory Prisma BOUNDARY FAKE for the tenancy isolation harness.
 *
 * PrismaClient is a Proxy around runtime delegates, so `instanceof` checks are
 * meaningless by construction — a structural stub assigned over the
 * `PrismaService` DI token is indistinguishable from the real client to every
 * consumer (same seam proven by the auth integration suite). Delegate bodies
 * are intentionally sync (eslint require-await): awaiting plain values keeps
 * the runtime contract identical to the real async delegates.
 *
 * Scope discipline: ONLY the delegates the shipped surface actually touches
 * (staff sessions, memberships) plus the fixture-insert writes the harness
 * seeds with. Anything else failing loudly is a feature — it catches accidental
 * new data paths during review.
 *
 * NOTE ON CI TOPOLOGY: the quality job runs these suites against this boundary
 * fake; real-PostgreSQL behavior of the SCHEMA is proven separately by the
 * `migrations` job (`migrate deploy` on a fresh PG16 container). Together they
 * cover application-level scoping and persistence conventions without needing
 * a live PG inside the unit/integration runner.
 */

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
}

export interface RoleRow {
  id: string;
  code: string;
  name: string;
}

export interface UserProfileRow {
  id: string;
  email: string;
  displayName: string;
  status: string;
}

/** Mirrors the temporal shape SessionService reads and refreshes (design D4). */
export interface StaffSessionRow {
  id: string;
  userProfileId: string;
  tokenHash: string;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

export interface TenantMembershipRow {
  id: string;
  tenantId: string;
  userProfileId: string;
  roleId: string;
  status: "ACTIVE" | "SUSPENDED";
  createdAt: Date;
}

interface MembershipWhere {
  id?: string;
  tenantId?: string;
  userProfileId?: string;
  status?: string;
}

interface MembershipOrder {
  createdAt?: "asc" | "desc";
  id?: "asc" | "desc";
}

export interface IsolationDatabase {
  prisma: {
    tenant: {
      create: (args: { data: { slug: string; name: string } }) => TenantRow;
    };
    role: {
      create: (args: { data: { code: string; name: string } }) => RoleRow;
    };
    userProfile: {
      create: (args: {
        data: { email: string; displayName: string; status: string };
      }) => UserProfileRow;
    };
    staffSession: {
      create: (args: { data: Omit<StaffSessionRow, "id" | "revokedAt"> }) => StaffSessionRow;
      findUnique: (args: { where: { tokenHash: string } }) => StaffSessionRow | null;
      update: (args: { where: { id: string }; data: Partial<StaffSessionRow> }) => StaffSessionRow;
      deleteMany: (args: { where: { tokenHash: string } }) => { count: number };
    };
    tenantMembership: {
      create: (args: {
        data: Omit<TenantMembershipRow, "id" | "createdAt"> & { createdAt?: Date };
      }) => TenantMembershipRow;
      findFirst: (args: {
        where: MembershipWhere;
        include?: { role?: unknown };
      }) => (TenantMembershipRow & { role?: { code: string } }) | null;
      findMany: (args: {
        where: MembershipWhere;
        orderBy?: MembershipOrder[];
      }) => TenantMembershipRow[];
      updateMany: (args: { where: MembershipWhere; data: { status: string } }) => { count: number };
    };
  };
  tables: {
    tenants: Map<string, TenantRow>;
    roles: Map<string, RoleRow>;
    profiles: Map<string, UserProfileRow>;
    sessions: Map<string, StaffSessionRow>;
    memberships: Map<string, TenantMembershipRow>;
  };
}

function matches(where: MembershipWhere, candidate: TenantMembershipRow): boolean {
  if (where.id !== undefined && where.id !== candidate.id) return false;
  if (where.tenantId !== undefined && where.tenantId !== candidate.tenantId) return false;
  if (where.userProfileId !== undefined && where.userProfileId !== candidate.userProfileId) {
    return false;
  }
  if (where.status !== undefined && where.status !== candidate.status) return false;
  return true;
}

function orderMemberships(
  rows: TenantMembershipRow[],
  orderBy: MembershipOrder[] | undefined
): TenantMembershipRow[] {
  const clauses = orderBy ?? [{ createdAt: "asc" as const }, { id: "asc" as const }];
  return [...rows].sort((left, right) => {
    for (const clause of clauses) {
      for (const key of Object.keys(clause) as (keyof MembershipOrder)[]) {
        const direction = clause[key];
        if (!direction) continue;
        const leftKey = left[key] instanceof Date ? (left[key] as Date).getTime() : left[key];
        const rightKey = right[key] instanceof Date ? (right[key] as Date).getTime() : right[key];
        const compared =
          typeof leftKey === "string" && typeof rightKey === "string"
            ? leftKey.localeCompare(rightKey)
            : Number(leftKey) - Number(rightKey);
        if (compared !== 0) {
          return direction === "asc" ? compared : -compared;
        }
      }
    }
    return 0;
  });
}

/** Builds one isolated database boundary; call per-boot for full isolation. */
export function createIsolationDatabase(): IsolationDatabase {
  const tenants = new Map<string, TenantRow>();
  const roles = new Map<string, RoleRow>();
  const profiles = new Map<string, UserProfileRow>();
  const sessions = new Map<string, StaffSessionRow>();
  const memberships = new Map<string, TenantMembershipRow>();

  const prisma: IsolationDatabase["prisma"] = {
    tenant: {
      create: ({ data }) => {
        const created: TenantRow = { id: randomUUID(), slug: data.slug, name: data.name };
        tenants.set(created.id, created);
        return created;
      },
    },
    role: {
      create: ({ data }) => {
        const created: RoleRow = { id: randomUUID(), code: data.code, name: data.name };
        roles.set(created.id, created);
        return created;
      },
    },
    userProfile: {
      create: ({ data }) => {
        const created: UserProfileRow = {
          id: randomUUID(),
          email: data.email,
          displayName: data.displayName,
          status: data.status,
        };
        profiles.set(created.id, created);
        return created;
      },
    },
    staffSession: {
      create: ({ data }) => {
        const created: StaffSessionRow = { id: randomUUID(), revokedAt: null, ...data };
        sessions.set(created.tokenHash, created);
        return created;
      },
      findUnique: ({ where }) => sessions.get(where.tokenHash) ?? null,
      update: ({ where, data }) => {
        const existing = [...sessions.values()].find((entry) => entry.id === where.id);
        // Structural P2025 mirrors the real delegate's rejected promise shape
        // (session.service detects lost races via err.code).
        if (!existing) {
          throw Object.assign(new Error("Record not found"), { code: "P2025" });
        }
        Object.assign(existing, data);
        return existing;
      },
      deleteMany: ({ where }) => ({ count: sessions.delete(where.tokenHash) ? 1 : 0 }),
    },
    tenantMembership: {
      create: ({ data }) => {
        const created: TenantMembershipRow = {
          id: randomUUID(),
          createdAt: data.createdAt ?? new Date("2026-01-01T00:00:00Z"),
          ...data,
        };
        memberships.set(created.id, created);
        return created;
      },
      findFirst: ({ where, include }) => {
        for (const candidate of memberships.values()) {
          if (!matches(where, candidate)) continue;
          if (include?.role) {
            // Reproduce the relational join: role row looked up by FK.
            const joinedRole = roles.get(candidate.roleId);
            return { ...candidate, role: { code: joinedRole?.code ?? "" } };
          }
          return candidate;
        }
        return null;
      },
      findMany: ({ where, orderBy }) =>
        orderMemberships(
          [...memberships.values()].filter((candidate) => matches(where, candidate)),
          orderBy
        ),
      updateMany: ({ where, data }) => {
        let count = 0;
        for (const candidate of memberships.values()) {
          if (!matches(where, candidate)) continue;
          candidate.status = data.status as TenantMembershipRow["status"];
          count += 1;
        }
        return { count };
      },
    },
  };

  return { prisma, tables: { tenants, roles, profiles, sessions, memberships } };
}
