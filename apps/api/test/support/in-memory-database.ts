import { randomUUID } from "node:crypto";
import { InMemoryStorageDriver } from "@newsaas/storage";

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
  status: "ACTIVE" | "SUSPENDED";
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

/** Settings namespace row (EPIC-02 TenantSettingNamespace). */
export interface TenantSettingNamespaceRow {
  id: string;
  tenantId: string;
  namespace: string;
  schemaVersion: number;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** Tenant branding override row (EPIC-03 Phase B). */
export interface TenantBrandingRow {
  id: string;
  tenantId: string;
  schemaVersion: number;
  overrides: unknown;
  displayName: string | null;
  logoLightAssetId: string | null;
  logoDarkAssetId: string | null;
  faviconAssetId: string | null;
  updatedByUserProfileId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Tenant-owned branding asset row (DEC-004 PR 1). */
export interface BrandingAssetRow {
  id: string;
  tenantId: string;
  kind: "LOGO_LIGHT" | "LOGO_DARK" | "FAVICON";
  assetKey: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  uploadedByUserProfileId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Durable branding-reset storage cleanup intent row (U5). */
export interface BrandingResetCleanupIntentRow {
  id: string;
  tenantId: string;
  resetAuditId: string | null;
  requestedByUserProfileId: string | null;
  storageKeys: string[];
  status: "PENDING" | "COMPLETED" | "DEAD_LETTER";
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

/** Customer aggregate row (EPIC-04). */
export interface CustomerRow {
  id: string;
  tenantId: string;
  kind: "INDIVIDUAL" | "COMPANY";
  displayName: string;
  legalName: string | null;
  taxId: string | null;
  firstName: string | null;
  lastName: string | null;
  documentNumber: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Customer address row (EPIC-04). */
export interface CustomerAddressRow {
  id: string;
  tenantId: string;
  customerId: string;
  label: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countryCode: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Customer contact row (EPIC-04). */
export interface CustomerContactRow {
  id: string;
  tenantId: string;
  customerId: string;
  kind: "EMAIL" | "PHONE";
  label: string | null;
  value: string;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
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
      create: (args: {
        data: { slug: string; name: string; status?: "ACTIVE" | "SUSPENDED" };
      }) => TenantRow;
      findUnique: (args: {
        where: { id?: string; slug?: string; status?: "ACTIVE" | "SUSPENDED" };
      }) => TenantRow | null;
    };
    tenantBranding: {
      findUnique: (args: { where: { tenantId: string } }) => TenantBrandingRow | null;
      upsert: (args: {
        where: { tenantId: string };
        create: Omit<TenantBrandingRow, "id" | "createdAt" | "updatedAt">;
        update: Partial<Omit<TenantBrandingRow, "id" | "tenantId" | "createdAt">>;
      }) => TenantBrandingRow;
      update: (args: {
        where: { tenantId: string };
        data: Partial<Omit<TenantBrandingRow, "id" | "tenantId" | "createdAt">>;
      }) => TenantBrandingRow;
      delete: (args: { where: { tenantId: string } }) => TenantBrandingRow;
    };
    brandingAsset: {
      create: (args: {
        data: Omit<BrandingAssetRow, "id" | "createdAt" | "updatedAt">;
      }) => BrandingAssetRow;
      findUnique: (args: { where: { id: string } }) => BrandingAssetRow | null;
      findFirst: (args: { where: { tenantId: string; kind: string } }) => BrandingAssetRow | null;
      findMany: (args: { where: { tenantId: string } }) => BrandingAssetRow[];
      delete: (args: { where: { id: string } }) => BrandingAssetRow;
    };
    brandingResetCleanupIntent: {
      create: (args: {
        data: {
          tenantId: string;
          resetAuditId?: string | null;
          requestedByUserProfileId?: string | null;
          storageKeys: string[];
          status?: BrandingResetCleanupIntentRow["status"];
          attempts?: number;
        };
      }) => BrandingResetCleanupIntentRow;
      findMany: (args?: {
        where?: { tenantId?: string; status?: BrandingResetCleanupIntentRow["status"] };
      }) => BrandingResetCleanupIntentRow[];
    };
    customer: {
      findMany: (args: {
        where: { tenantId: string; isActive?: boolean };
        orderBy?: { displayName?: "asc" | "desc" };
      }) => CustomerRow[];
      findFirst: (args: { where: { id: string; tenantId: string } }) => CustomerRow | null;
      findUnique: (args: { where: { id: string } }) => CustomerRow | null;
      create: (args: { data: Omit<CustomerRow, "id" | "createdAt" | "updatedAt"> }) => CustomerRow;
      updateMany: (args: {
        where: { id: string; tenantId: string; isActive?: boolean };
        data: Partial<Omit<CustomerRow, "id" | "tenantId" | "createdAt">>;
      }) => { count: number };
    };
    customerAddress: {
      findMany: (args: {
        where: { tenantId: string; customerId: string; isActive?: boolean };
        orderBy?: { createdAt?: "asc" | "desc" };
      }) => CustomerAddressRow[];
      findFirst: (args: {
        where: { id: string; tenantId: string; customerId: string };
      }) => CustomerAddressRow | null;
      findUnique: (args: { where: { id: string } }) => CustomerAddressRow | null;
      create: (args: {
        data: Omit<CustomerAddressRow, "id" | "createdAt" | "updatedAt">;
      }) => CustomerAddressRow;
      updateMany: (args: {
        where: { id: string; tenantId: string; customerId: string; isActive?: boolean };
        data: Partial<Omit<CustomerAddressRow, "id" | "tenantId" | "customerId" | "createdAt">>;
      }) => { count: number };
    };
    customerContact: {
      findMany: (args: {
        where: { tenantId: string; customerId: string; isActive?: boolean };
        orderBy?: { createdAt?: "asc" | "desc" };
      }) => CustomerContactRow[];
      findFirst: (args: {
        where: { id: string; tenantId: string; customerId: string };
      }) => CustomerContactRow | null;
      findUnique: (args: { where: { id: string } }) => CustomerContactRow | null;
      create: (args: {
        data: Omit<CustomerContactRow, "id" | "createdAt" | "updatedAt">;
      }) => CustomerContactRow;
      updateMany: (args: {
        where: { id: string; tenantId: string; customerId: string; isActive?: boolean };
        data: Partial<Omit<CustomerContactRow, "id" | "tenantId" | "customerId" | "createdAt">>;
      }) => { count: number };
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
    tenantSettingNamespace: {
      findUnique: (args: {
        where: { tenantId_namespace: { tenantId: string; namespace: string } };
      }) => TenantSettingNamespaceRow | null;
      findMany: (args: {
        where?: { tenantId?: string; namespace?: string };
      }) => TenantSettingNamespaceRow[];
      create: (args: {
        data: Omit<TenantSettingNamespaceRow, "id" | "createdAt" | "updatedAt">;
      }) => TenantSettingNamespaceRow;
      update: (args: {
        where: { tenantId_namespace: { tenantId: string; namespace: string } };
        data: Partial<
          Omit<TenantSettingNamespaceRow, "id" | "tenantId" | "namespace" | "createdAt">
        >;
      }) => TenantSettingNamespaceRow;
      upsert: (args: {
        where: { tenantId_namespace: { tenantId: string; namespace: string } };
        create: Omit<TenantSettingNamespaceRow, "id" | "createdAt" | "updatedAt">;
        update: Partial<
          Omit<TenantSettingNamespaceRow, "id" | "tenantId" | "namespace" | "createdAt">
        >;
      }) => TenantSettingNamespaceRow;
      deleteMany: (args: { where: { tenantId?: string; namespace?: string } }) => { count: number };
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
    settingNamespaces: Map<string, TenantSettingNamespaceRow>;
    tenantBrandings: Map<string, TenantBrandingRow>;
    brandingAssets: Map<string, BrandingAssetRow>;
    brandingResetCleanupIntents: Map<string, BrandingResetCleanupIntentRow>;
    customers: Map<string, CustomerRow>;
    customerAddresses: Map<string, CustomerAddressRow>;
    customerContacts: Map<string, CustomerContactRow>;
  };
  /** In-memory object storage for tests to inspect signed URLs and key retirement. */
  storage: InMemoryStorageDriver;
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
  const settingNamespaces = new Map<string, TenantSettingNamespaceRow>();
  const tenantBrandings = new Map<string, TenantBrandingRow>();
  const brandingAssets = new Map<string, BrandingAssetRow>();
  const brandingResetCleanupIntents = new Map<string, BrandingResetCleanupIntentRow>();
  const customers = new Map<string, CustomerRow>();
  const customerAddresses = new Map<string, CustomerAddressRow>();
  const customerContacts = new Map<string, CustomerContactRow>();

  type TableSnapshot = Record<string, Map<string, unknown>>;

  const allTables: Record<string, Map<string, unknown>> = {
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
    settingNamespaces,
    tenantBrandings,
    brandingAssets,
    brandingResetCleanupIntents,
    customers,
    customerAddresses,
    customerContacts,
  };

  function snapshotTables(): TableSnapshot {
    const snapshot: TableSnapshot = {};
    for (const [name, table] of Object.entries(allTables)) {
      const cloned = new Map<string, unknown>();
      for (const [id, row] of table) {
        cloned.set(id, structuredClone(row));
      }
      snapshot[name] = cloned;
    }
    return snapshot;
  }

  function restoreTables(snapshot: TableSnapshot): void {
    for (const [name, table] of Object.entries(allTables)) {
      const snapshotTable = snapshot[name];
      table.clear();
      for (const [id, row] of snapshotTable) {
        table.set(id, structuredClone(row));
      }
    }
  }

  type PrismaLike = IsolationDatabase["prisma"];
  // `$transaction` executes the callback against the SAME in-memory maps but
  // snapshots them first so a thrown error rolls back every mutation — this
  // makes audit-or-nothing tests honest on the in-memory boundary. Real
  // transactional semantics are still proven by the live-PostgreSQL evidence
  // gate (TD-006).
  const prisma: PrismaLike = {
    $transaction: async <T>(callback: (tx: PrismaLike) => Promise<T>): Promise<T> => {
      const snapshot = snapshotTables();
      try {
        return await callback(prisma);
      } catch (error) {
        restoreTables(snapshot);
        throw error;
      }
    },
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
      // Mirrors Prisma's `@default(ACTIVE)`: callers that omit status still
      // receive an ACTIVE tenant.
      create: ({ data }) => {
        const created: TenantRow = {
          id: randomUUID(),
          slug: data.slug,
          name: data.name,
          status: data.status ?? "ACTIVE",
        };
        tenants.set(created.id, created);
        return created;
      },
      findUnique: ({ where }) => {
        const candidate = [...tenants.values()].find(
          (row) =>
            (where.id !== undefined && row.id === where.id) ||
            (where.slug !== undefined && row.slug === where.slug)
        );
        if (!candidate) return null;
        // Compound extended-where-unique: the status predicate ANDs with the
        // identity predicate, so a SUSPENDED row falls through to null.
        if (where.status !== undefined && candidate.status !== where.status) return null;
        return candidate;
      },
    },
    tenantBranding: {
      findUnique: ({ where }) =>
        [...tenantBrandings.values()].find((candidate) => candidate.tenantId === where.tenantId) ??
        null,
      upsert: ({ where, create, update }) => {
        const existing = [...tenantBrandings.values()].find(
          (candidate) => candidate.tenantId === where.tenantId
        );
        const now = new Date();
        if (existing) {
          if (update.schemaVersion !== undefined) existing.schemaVersion = update.schemaVersion;
          if (update.overrides !== undefined) existing.overrides = update.overrides;
          if (update.displayName !== undefined) existing.displayName = update.displayName ?? null;
          if (update.logoLightAssetId !== undefined)
            existing.logoLightAssetId = update.logoLightAssetId ?? null;
          if (update.logoDarkAssetId !== undefined)
            existing.logoDarkAssetId = update.logoDarkAssetId ?? null;
          if (update.faviconAssetId !== undefined)
            existing.faviconAssetId = update.faviconAssetId ?? null;
          if (update.updatedByUserProfileId !== undefined)
            existing.updatedByUserProfileId = update.updatedByUserProfileId ?? null;
          existing.updatedAt = now;
          return existing;
        }
        const created: TenantBrandingRow = {
          id: randomUUID(),
          ...create,
          displayName: create.displayName ?? null,
          logoLightAssetId: create.logoLightAssetId ?? null,
          logoDarkAssetId: create.logoDarkAssetId ?? null,
          faviconAssetId: create.faviconAssetId ?? null,
          updatedByUserProfileId: create.updatedByUserProfileId ?? null,
          createdAt: now,
          updatedAt: now,
        };
        tenantBrandings.set(created.id, created);
        return created;
      },
      update: ({ where, data }) => {
        const existing = [...tenantBrandings.values()].find(
          (candidate) => candidate.tenantId === where.tenantId
        );
        if (!existing) {
          throw Object.assign(new Error("Record not found"), { code: "P2025" });
        }
        if (data.schemaVersion !== undefined) existing.schemaVersion = data.schemaVersion;
        if (data.overrides !== undefined) existing.overrides = data.overrides;
        if (data.displayName !== undefined) existing.displayName = data.displayName ?? null;
        if (data.logoLightAssetId !== undefined)
          existing.logoLightAssetId = data.logoLightAssetId ?? null;
        if (data.logoDarkAssetId !== undefined)
          existing.logoDarkAssetId = data.logoDarkAssetId ?? null;
        if (data.faviconAssetId !== undefined)
          existing.faviconAssetId = data.faviconAssetId ?? null;
        if (data.updatedByUserProfileId !== undefined)
          existing.updatedByUserProfileId = data.updatedByUserProfileId ?? null;
        existing.updatedAt = new Date();
        return existing;
      },
      delete: ({ where }) => {
        const existing = [...tenantBrandings.values()].find(
          (candidate) => candidate.tenantId === where.tenantId
        );
        if (!existing) {
          throw Object.assign(new Error("Record not found"), { code: "P2025" });
        }
        tenantBrandings.delete(existing.id);
        return existing;
      },
    },
    brandingAsset: {
      create: ({ data }) => {
        const now = new Date();
        const created: BrandingAssetRow = {
          id: randomUUID(),
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        brandingAssets.set(created.id, created);
        return created;
      },
      findUnique: ({ where }) => brandingAssets.get(where.id) ?? null,
      findFirst: ({ where }) =>
        [...brandingAssets.values()].find(
          (candidate) => candidate.tenantId === where.tenantId && candidate.kind === where.kind
        ) ?? null,
      findMany: ({ where }) =>
        [...brandingAssets.values()].filter((candidate) => candidate.tenantId === where.tenantId),
      delete: ({ where }) => {
        const existing = brandingAssets.get(where.id);
        if (!existing) {
          throw Object.assign(new Error("Record not found"), { code: "P2025" });
        }
        brandingAssets.delete(existing.id);
        return existing;
      },
    },
    brandingResetCleanupIntent: {
      create: ({ data }) => {
        const now = new Date();
        const created: BrandingResetCleanupIntentRow = {
          id: randomUUID(),
          tenantId: data.tenantId,
          resetAuditId: data.resetAuditId ?? null,
          requestedByUserProfileId: data.requestedByUserProfileId ?? null,
          storageKeys: [...data.storageKeys],
          status: data.status ?? "PENDING",
          attempts: data.attempts ?? 0,
          lastError: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        };
        brandingResetCleanupIntents.set(created.id, created);
        return created;
      },
      findMany: ({ where } = {}) =>
        [...brandingResetCleanupIntents.values()].filter(
          (candidate) =>
            (where?.tenantId === undefined || candidate.tenantId === where.tenantId) &&
            (where?.status === undefined || candidate.status === where.status)
        ),
    },
    customer: {
      findMany: ({ where, orderBy }) => {
        let rows = [...customers.values()].filter(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            (where.isActive === undefined || candidate.isActive === where.isActive)
        );
        if (orderBy?.displayName) {
          rows = rows.sort((left, right) => left.displayName.localeCompare(right.displayName));
          if (orderBy.displayName === "desc") rows.reverse();
        }
        return rows;
      },
      findFirst: ({ where }) =>
        [...customers.values()].find(
          (candidate) => candidate.id === where.id && candidate.tenantId === where.tenantId
        ) ?? null,
      findUnique: ({ where }) => customers.get(where.id) ?? null,
      create: ({ data }) => {
        const now = new Date();
        const created: CustomerRow = {
          id: randomUUID(),
          ...data,
          isActive: data.isActive ?? true,
          createdAt: now,
          updatedAt: now,
        };
        customers.set(created.id, created);
        return created;
      },
      updateMany: ({ where, data }) => {
        const existing = customers.get(where.id);
        if (
          existing?.tenantId !== where.tenantId ||
          (where.isActive !== undefined && existing?.isActive !== where.isActive)
        ) {
          return { count: 0 };
        }
        const updated: CustomerRow = { ...existing, updatedAt: new Date() };
        if (data.displayName !== undefined) updated.displayName = data.displayName;
        if (data.legalName !== undefined) updated.legalName = data.legalName ?? null;
        if (data.taxId !== undefined) updated.taxId = data.taxId ?? null;
        if (data.firstName !== undefined) updated.firstName = data.firstName ?? null;
        if (data.lastName !== undefined) updated.lastName = data.lastName ?? null;
        if (data.documentNumber !== undefined) updated.documentNumber = data.documentNumber ?? null;
        if (data.isActive !== undefined) updated.isActive = data.isActive;
        customers.set(updated.id, updated);
        return { count: 1 };
      },
    },
    customerAddress: {
      findMany: ({ where, orderBy }) => {
        let rows = [...customerAddresses.values()].filter(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            candidate.customerId === where.customerId &&
            (where.isActive === undefined || candidate.isActive === where.isActive)
        );
        if (orderBy?.createdAt) {
          rows = rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
          if (orderBy.createdAt === "desc") rows.reverse();
        }
        return rows;
      },
      findFirst: ({ where }) =>
        [...customerAddresses.values()].find(
          (candidate) =>
            candidate.id === where.id &&
            candidate.tenantId === where.tenantId &&
            candidate.customerId === where.customerId
        ) ?? null,
      findUnique: ({ where }) => customerAddresses.get(where.id) ?? null,
      create: ({ data }) => {
        const now = new Date();
        const created: CustomerAddressRow = {
          id: randomUUID(),
          ...data,
          isActive: data.isActive ?? true,
          createdAt: now,
          updatedAt: now,
        };
        customerAddresses.set(created.id, created);
        return created;
      },
      updateMany: ({ where, data }) => {
        const existing = customerAddresses.get(where.id);
        if (
          existing?.tenantId !== where.tenantId ||
          existing?.customerId !== where.customerId ||
          (where.isActive !== undefined && existing?.isActive !== where.isActive)
        ) {
          return { count: 0 };
        }
        const updated: CustomerAddressRow = { ...existing, updatedAt: new Date() };
        if (data.label !== undefined) updated.label = data.label ?? null;
        if (data.line1 !== undefined) updated.line1 = data.line1 ?? null;
        if (data.line2 !== undefined) updated.line2 = data.line2 ?? null;
        if (data.city !== undefined) updated.city = data.city ?? null;
        if (data.state !== undefined) updated.state = data.state ?? null;
        if (data.postalCode !== undefined) updated.postalCode = data.postalCode ?? null;
        if (data.countryCode !== undefined) updated.countryCode = data.countryCode ?? null;
        if (data.isActive !== undefined) updated.isActive = data.isActive;
        customerAddresses.set(updated.id, updated);
        return { count: 1 };
      },
    },
    customerContact: {
      findMany: ({ where, orderBy }) => {
        let rows = [...customerContacts.values()].filter(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            candidate.customerId === where.customerId &&
            (where.isActive === undefined || candidate.isActive === where.isActive)
        );
        if (orderBy?.createdAt) {
          rows = rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
          if (orderBy.createdAt === "desc") rows.reverse();
        }
        return rows;
      },
      findFirst: ({ where }) =>
        [...customerContacts.values()].find(
          (candidate) =>
            candidate.id === where.id &&
            candidate.tenantId === where.tenantId &&
            candidate.customerId === where.customerId
        ) ?? null,
      findUnique: ({ where }) => customerContacts.get(where.id) ?? null,
      create: ({ data }) => {
        const now = new Date();
        const created: CustomerContactRow = {
          id: randomUUID(),
          ...data,
          isActive: data.isActive ?? true,
          createdAt: now,
          updatedAt: now,
        };
        customerContacts.set(created.id, created);
        return created;
      },
      updateMany: ({ where, data }) => {
        const existing = customerContacts.get(where.id);
        if (
          existing?.tenantId !== where.tenantId ||
          existing?.customerId !== where.customerId ||
          (where.isActive !== undefined && existing?.isActive !== where.isActive)
        ) {
          return { count: 0 };
        }
        const updated: CustomerContactRow = { ...existing, updatedAt: new Date() };
        if (data.kind !== undefined) updated.kind = data.kind;
        if (data.label !== undefined) updated.label = data.label ?? null;
        if (data.value !== undefined) updated.value = data.value;
        if (data.isPrimary !== undefined) updated.isPrimary = data.isPrimary;
        if (data.isActive !== undefined) updated.isActive = data.isActive;
        customerContacts.set(updated.id, updated);
        return { count: 1 };
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
    tenantSettingNamespace: {
      findUnique: ({ where }) =>
        [...settingNamespaces.values()].find(
          (candidate) =>
            candidate.tenantId === where.tenantId_namespace.tenantId &&
            candidate.namespace === where.tenantId_namespace.namespace
        ) ?? null,
      findMany: ({ where } = {}) =>
        [...settingNamespaces.values()].filter(
          (candidate) =>
            (where?.tenantId === undefined || candidate.tenantId === where.tenantId) &&
            (where?.namespace === undefined || candidate.namespace === where.namespace)
        ),
      create: ({ data }) => {
        const now = new Date();
        const created: TenantSettingNamespaceRow = {
          id: randomUUID(),
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        settingNamespaces.set(created.id, created);
        return created;
      },
      update: ({ where, data }) => {
        const existing = [...settingNamespaces.values()].find(
          (candidate) =>
            candidate.tenantId === where.tenantId_namespace.tenantId &&
            candidate.namespace === where.tenantId_namespace.namespace
        );
        if (!existing) {
          throw Object.assign(new Error("Record not found"), { code: "P2025" });
        }
        if (data.schemaVersion !== undefined) existing.schemaVersion = data.schemaVersion;
        if (data.data !== undefined) existing.data = data.data;
        existing.updatedAt = new Date();
        return existing;
      },
      upsert: ({ where, create, update }) => {
        const existing = [...settingNamespaces.values()].find(
          (candidate) =>
            candidate.tenantId === where.tenantId_namespace.tenantId &&
            candidate.namespace === where.tenantId_namespace.namespace
        );
        if (existing) {
          if (update.schemaVersion !== undefined) existing.schemaVersion = update.schemaVersion;
          if (update.data !== undefined) existing.data = update.data;
          existing.updatedAt = new Date();
          return existing;
        }
        const now = new Date();
        const created: TenantSettingNamespaceRow = {
          id: randomUUID(),
          ...create,
          createdAt: now,
          updatedAt: now,
        };
        settingNamespaces.set(created.id, created);
        return created;
      },
      deleteMany: ({ where }) => {
        let count = 0;
        for (const [id, candidate] of settingNamespaces) {
          if (
            (where.tenantId === undefined || candidate.tenantId === where.tenantId) &&
            (where.namespace === undefined || candidate.namespace === where.namespace)
          ) {
            settingNamespaces.delete(id);
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

  const storage = new InMemoryStorageDriver();

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
      settingNamespaces,
      tenantBrandings,
      brandingAssets,
      brandingResetCleanupIntents,
      customers,
      customerAddresses,
      customerContacts,
    },
    storage,
  };
}
