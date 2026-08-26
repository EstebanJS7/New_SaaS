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

/** Append-only audit row shape written by AuditWriter (design D9). */
export interface AuditLogRow {
  id: string;
  action: string;
  actorType: "STAFF" | "SYSTEM";
  metadata: Record<string, unknown>;
  tenantId?: string;
  actorUserProfileId?: string;
  targetType?: string;
  targetId?: string;
  requestId?: string;
}

export interface FeatureCodeRow {
  id: string;
  code: string;
}

export interface TenantEntitlementRow {
  id: string;
  tenantId: string;
  featureCodeId: string;
}

/** Permission catalog row (EPIC-02): key is the stable natural key. */
export interface PermissionRow {
  id: string;
  key: string;
  name: string;
}

/** Role↔permission mapping row (EPIC-02 enforcement data). */
export interface RolePermissionRow {
  id: string;
  roleId: string;
  permissionId: string;
}

/** Tenant-local override verdict over a global role's baseline key (DEC-003). */
export interface TenantRolePermissionOverrideRow {
  id: string;
  tenantId: string;
  roleId: string;
  permissionKey: string;
  granted: boolean;
}

interface MembershipWhere {
  id?: string;
  tenantId?: string;
  userProfileId?: string;
  status?: string;
  /** Scalar or `{ in: [...] }` — mirrors the Prisma filter shapes we use. */
  roleId?: string | { in?: string[] };
}

interface MembershipOrder {
  createdAt?: "asc" | "desc";
  id?: "asc" | "desc";
}

export interface IsolationDatabase {
  prisma: {
    $transaction: <T>(callback: (tx: IsolationDatabase["prisma"]) => Promise<T>) => Promise<T>;
    /**
     * Raw-SQL seam for SELECT ... FOR UPDATE row locks (review CRITICAL-2).
     * The shipped surface issues exactly ONE raw query shape — the tenant-wide
     * active-membership lock — matched here by its table name; anything else
     * fails loudly instead of silently returning wrong rows.
     *
     * HONEST LIMITATION (documented in TD-006): a synchronous in-memory map
     * CANNOT prove interleaving/serialization semantics of real READ
     * COMMITTED PostgreSQL; this delegate only proves WHICH rows the decision
     * reads. Live-PG proof remains TD-006's evidence gate.
     */
    $queryRaw: (
      query: TemplateStringsArray | string,
      ...values: unknown[]
    ) => Promise<{ id: string; role_id: string }[]>;
    tenant: {
      create: (args: { data: { slug: string; name: string } }) => TenantRow;
    };
    role: {
      create: (args: { data: { code: string; name: string } }) => RoleRow;
      findUnique: (args: { where: { code: string } }) => RoleRow | null;
      findMany: (args: { where?: { code?: { in?: string[] } } }) => RoleRow[];
    };
    permission: {
      create: (args: { data: { key: string; name?: string } }) => PermissionRow;
      findUnique: (args: { where: { key: string } }) => PermissionRow | null;
      findMany: (args: {
        where?: { key?: { in?: string[] } };
        orderBy?: { key?: "asc" | "desc" };
      }) => PermissionRow[];
    };
    rolePermission: {
      create: (args: { data: { roleId: string; permissionId: string } }) => RolePermissionRow;
      findMany: (args: {
        where: { roleId?: string; permissionId?: string };
        select?: unknown;
      }) => (RolePermissionRow & { permission?: { key: string } })[];
      deleteMany: (args: { where: { roleId?: string; permissionId?: string } }) => {
        count: number;
      };
    };
    tenantRolePermissionOverride: {
      create: (args: {
        data: { tenantId: string; roleId: string; permissionKey: string; granted: boolean };
      }) => TenantRolePermissionOverrideRow;
      findMany: (args: {
        where: { tenantId?: string; roleId?: string; permissionKey?: string };
      }) => TenantRolePermissionOverrideRow[];
      deleteMany: (args: {
        where: { tenantId?: string; roleId?: string; permissionKey?: string };
      }) => { count: number };
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
        orderBy?: MembershipOrder[];
        include?: { role?: unknown };
      }) => (TenantMembershipRow & { role?: { code: string } }) | null;
      findMany: (args: {
        where: MembershipWhere;
        orderBy?: MembershipOrder[];
        include?: { role?: unknown };
      }) => (TenantMembershipRow & { role?: { code: string } })[];
      updateMany: (args: { where: MembershipWhere; data: { status: string } }) => { count: number };
      update: (args: {
        where: { id: string };
        data: { roleId?: string; status?: string };
      }) => TenantMembershipRow;
    };
    auditLog: {
      create: (args: { data: Omit<AuditLogRow, "id"> & { id?: string } }) => AuditLogRow;
      findFirst: (args: { where: { action?: string; requestId?: string } }) => AuditLogRow | null;
      findMany: (args?: { where?: { action?: string; requestId?: string } }) => AuditLogRow[];
    };
    featureCode: {
      create: (args: { data: { code: string } }) => FeatureCodeRow;
      findUnique: (args: { where: { code: string } }) => FeatureCodeRow | null;
    };
    tenantEntitlement: {
      create: (args: { data: { tenantId: string; featureCodeId: string } }) => TenantEntitlementRow;
      findFirst: (args: {
        where: { tenantId: string; featureCode: { code: string } };
      }) => TenantEntitlementRow | null;
    };
  };
  tables: {
    tenants: Map<string, TenantRow>;
    roles: Map<string, RoleRow>;
    profiles: Map<string, UserProfileRow>;
    sessions: Map<string, StaffSessionRow>;
    memberships: Map<string, TenantMembershipRow>;
    audits: Map<string, AuditLogRow>;
    featureCodes: Map<string, FeatureCodeRow>;
    entitlements: Map<string, TenantEntitlementRow>;
    permissions: Map<string, PermissionRow>;
    rolePermissions: Map<string, RolePermissionRow>;
    rolePermissionOverrides: Map<string, TenantRolePermissionOverrideRow>;
  };
}

function matches(where: MembershipWhere, candidate: TenantMembershipRow): boolean {
  if (where.id !== undefined && where.id !== candidate.id) return false;
  if (where.tenantId !== undefined && where.tenantId !== candidate.tenantId) return false;
  if (where.userProfileId !== undefined && where.userProfileId !== candidate.userProfileId) {
    return false;
  }
  if (where.status !== undefined && where.status !== candidate.status) return false;
  if (where.roleId !== undefined) {
    const expected = where.roleId;
    if (typeof expected === "string") {
      if (expected !== candidate.roleId) return false;
    } else if (expected.in && !expected.in.includes(candidate.roleId)) {
      return false;
    }
  }
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
  const audits = new Map<string, AuditLogRow>();
  const featureCodes = new Map<string, FeatureCodeRow>();
  const entitlements = new Map<string, TenantEntitlementRow>();
  const permissions = new Map<string, PermissionRow>();
  const rolePermissions = new Map<string, RolePermissionRow>();
  const rolePermissionOverrides = new Map<string, TenantRolePermissionOverrideRow>();

  type PrismaLike = IsolationDatabase["prisma"];
  // `$transaction` executes the callback against the SAME in-memory maps —
  // there is nothing to roll back (documented fake limitation; real
  // transactional semantics are proven by the CI `migrations` job).
  const prisma: PrismaLike = {
    $transaction: <T>(callback: (tx: PrismaLike) => Promise<T>): Promise<T> => callback(prisma),
    $queryRaw: (query, ...values) => {
      // Match THE one shipped raw query (all active membership rows for the
      // tenant). The only bound value is the server-resolved tenant id.
      const text = typeof query === "string" ? query : query.join("");
      if (!text.includes("tenant_membership") || !text.includes("FOR UPDATE")) {
        throw new Error(
          `in-memory $queryRaw fake only supports the tenant_membership FOR UPDATE lock (got: ${text.slice(0, 60)}...)`
        );
      }
      const [tenantId] = values as string[];
      return Promise.resolve(
        [...memberships.values()]
          .filter((candidate) => candidate.tenantId === tenantId && candidate.status === "ACTIVE")
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((candidate) => ({ id: candidate.id, role_id: candidate.roleId }))
      );
    },
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
      findUnique: ({ where }) =>
        [...roles.values()].find((candidate) => candidate.code === where.code) ?? null,
      findMany: ({ where } = {}) => {
        const all = [...roles.values()];
        const codes = where?.code?.in;
        return codes ? all.filter((candidate) => codes.includes(candidate.code)) : all;
      },
    },
    permission: {
      create: ({ data }) => {
        const created: PermissionRow = { id: randomUUID(), key: data.key, name: data.name ?? "" };
        permissions.set(created.id, created);
        return created;
      },
      findUnique: ({ where }) =>
        [...permissions.values()].find((candidate) => candidate.key === where.key) ?? null,
      findMany: ({ where, orderBy } = {}) => {
        const all = [...permissions.values()];
        const keys = where?.key?.in;
        const filtered = keys ? all.filter((candidate) => keys.includes(candidate.key)) : all;
        return orderBy?.key === "asc"
          ? filtered.sort((left, right) => left.key.localeCompare(right.key))
          : orderBy?.key === "desc"
            ? filtered.sort((left, right) => right.key.localeCompare(left.key))
            : filtered;
      },
    },
    rolePermission: {
      create: ({ data }) => {
        const created: RolePermissionRow = { id: randomUUID(), ...data };
        rolePermissions.set(created.id, created);
        return created;
      },
      findMany: ({ where }) =>
        [...rolePermissions.values()]
          .filter(
            (candidate) =>
              (where.roleId === undefined || candidate.roleId === where.roleId) &&
              (where.permissionId === undefined || candidate.permissionId === where.permissionId)
          )
          .map((candidate) => ({
            ...candidate,
            permission: {
              key:
                [...permissions.values()].find((entry) => entry.id === candidate.permissionId)
                  ?.key ?? "",
            },
          })),
      deleteMany: ({ where }) => {
        let count = 0;
        for (const [id, candidate] of rolePermissions) {
          if (
            (where.roleId === undefined || candidate.roleId === where.roleId) &&
            (where.permissionId === undefined || candidate.permissionId === where.permissionId)
          ) {
            rolePermissions.delete(id);
            count += 1;
          }
        }
        return { count };
      },
    },
    tenantRolePermissionOverride: {
      create: ({ data }) => {
        const created: TenantRolePermissionOverrideRow = { id: randomUUID(), ...data };
        rolePermissionOverrides.set(created.id, created);
        return created;
      },
      findMany: ({ where }) =>
        [...rolePermissionOverrides.values()].filter(
          (candidate) =>
            (where.tenantId === undefined || candidate.tenantId === where.tenantId) &&
            (where.roleId === undefined || candidate.roleId === where.roleId) &&
            (where.permissionKey === undefined || candidate.permissionKey === where.permissionKey)
        ),
      deleteMany: ({ where }) => {
        let count = 0;
        for (const [id, candidate] of rolePermissionOverrides) {
          if (
            (where.tenantId === undefined || candidate.tenantId === where.tenantId) &&
            (where.roleId === undefined || candidate.roleId === where.roleId) &&
            (where.permissionKey === undefined || candidate.permissionKey === where.permissionKey)
          ) {
            rolePermissionOverrides.delete(id);
            count += 1;
          }
        }
        return { count };
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
      findFirst: ({ where, orderBy, include }) => {
        const matched = orderMemberships(
          [...memberships.values()].filter((candidate) => matches(where, candidate)),
          orderBy
        );
        const candidate = matched[0];
        if (!candidate) return null;
        if (include?.role) {
          // Reproduce the relational join: role row looked up by FK
          // (`id` included since EPIC-02 forwards roleId through ALS).
          const joinedRole = roles.get(candidate.roleId);
          return {
            ...candidate,
            role: { code: joinedRole?.code ?? "", id: joinedRole?.id ?? candidate.roleId },
          };
        }
        return candidate;
      },
      findMany: ({ where, orderBy, include }) => {
        const rows = orderMemberships(
          [...memberships.values()].filter((candidate) => matches(where, candidate)),
          orderBy
        );
        if (!include?.role) return rows;
        return rows.map((candidate) => ({
          ...candidate,
          role: { code: roles.get(candidate.roleId)?.code ?? "", id: candidate.roleId },
        }));
      },
      updateMany: ({ where, data }) => {
        let count = 0;
        for (const candidate of memberships.values()) {
          if (!matches(where, candidate)) continue;
          candidate.status = data.status as TenantMembershipRow["status"];
          count += 1;
        }
        return { count };
      },
      update: ({ where, data }) => {
        const existing = memberships.get(where.id);
        if (!existing) {
          // Structural P2025 mirrors the real delegate's rejected shape.
          throw Object.assign(new Error("Record not found"), { code: "P2025" });
        }
        if (data.roleId !== undefined) existing.roleId = data.roleId;
        if (data.status !== undefined) {
          existing.status = data.status as TenantMembershipRow["status"];
        }
        return existing;
      },
    },
    auditLog: {
      create: ({ data }) => {
        const created: AuditLogRow = { id: randomUUID(), ...data };
        audits.set(created.id, created);
        return created;
      },
      findFirst: ({ where }) =>
        [...audits.values()].find(
          (candidate) =>
            (where.action === undefined || candidate.action === where.action) &&
            (where.requestId === undefined || candidate.requestId === where.requestId)
        ) ?? null,
      findMany: ({ where } = {}) =>
        [...audits.values()].filter(
          (candidate) =>
            (where?.action === undefined || candidate.action === where.action) &&
            (where?.requestId === undefined || candidate.requestId === where.requestId)
        ),
    },
    featureCode: {
      create: ({ data }) => {
        const created: FeatureCodeRow = { id: randomUUID(), code: data.code };
        featureCodes.set(created.id, created);
        return created;
      },
      findUnique: ({ where }) =>
        [...featureCodes.values()].find((candidate) => candidate.code === where.code) ?? null,
    },
    tenantEntitlement: {
      create: ({ data }) => {
        const created: TenantEntitlementRow = { id: randomUUID(), ...data };
        entitlements.set(created.id, created);
        return created;
      },
      // Reproduces the relation filter of the real delegate: the grant must
      // reference a feature_code whose code matches.
      findFirst: ({ where }) =>
        [...entitlements.values()].find((candidate) => {
          if (candidate.tenantId !== where.tenantId) return false;
          const linkedCode = featureCodes.get(candidate.featureCodeId)?.code;
          return linkedCode === where.featureCode.code;
        }) ?? null,
    },
  };

  return {
    prisma,
    tables: {
      tenants,
      roles,
      profiles,
      sessions,
      memberships,
      audits,
      featureCodes,
      entitlements,
      permissions,
      rolePermissions,
      rolePermissionOverrides,
    },
  };
}
