import { randomUUID } from "node:crypto";
import type {
  IsolationDatabase,
  PermissionRow,
  RoleRow,
  TenantMembershipRow,
  UserProfileRow,
} from "./in-memory-database.js";
import { insertLiveStaffSession } from "./seed-two-tenants.js";

/**
 * Bespoke RBAC fixtures for EPIC-02 enforcement/effective-permission suites.
 * Complements `seedTwoTenants` when a scenario needs SPECIFIC role→key data
 * (the whole point of EPIC-02: authority is DATA, so tests mutate it).
 */

/** Create-if-missing catalog row keyed by the stable permission key. */
export function ensurePermission(db: IsolationDatabase, key: string): PermissionRow {
  const existing = db.prisma.permission.findUnique({ where: { key } });
  return existing ?? db.prisma.permission.create({ data: { key, name: key } });
}

export interface SeededRbacRole {
  role: RoleRow;
  /** Grants exactly these catalog keys (rows created idempotently per boot). */
  grant(...keys: string[]): void;
  /** Removes one grant — the "authority is data" mutation lever. */
  revoke(key: string): void;
}

export function seedRoleWithKeys(
  db: IsolationDatabase,
  code: string,
  name: string,
  initialKeys: string[] = []
): SeededRbacRole {
  const role = db.prisma.role.create({ data: { code, name } });
  const permissionsByKey = new Map<string, PermissionRow>();

  const pairFor = (key: string): string => {
    let permission = permissionsByKey.get(key);
    if (!permission) {
      permission = ensurePermission(db, key);
      permissionsByKey.set(key, permission);
    }
    const existing = [...db.tables.rolePermissions.values()].find(
      (candidate) => candidate.roleId === role.id && candidate.permissionId === permission.id
    );
    if (!existing) {
      db.prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }
    return permission.id;
  };

  const seeded: SeededRbacRole = {
    role,
    grant: (key) => {
      pairFor(key);
    },
    revoke: (key) => {
      const permission = permissionsByKey.get(key);
      if (!permission) return;
      db.prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: permission.id },
      });
    },
  };
  for (const key of initialKeys) {
    seeded.grant(key);
  }
  return seeded;
}

export interface RbacActor {
  profile: UserProfileRow;
  membership: TenantMembershipRow | null;
  cookie: string;
}

export interface SeedActorOptions {
  email?: string;
  tenantId?: string;
  roleId?: string;
  status?: "ACTIVE" | "SUSPENDED";
  /** Controls which membership wins the ACTIVE-resolution race (asc order). */
  createdAt?: Date;
  /** Omit tenant/role to mint a session WITHOUT any membership. */
  withMembership?: boolean;
}

export function seedRbacActor(db: IsolationDatabase, options: SeedActorOptions = {}): RbacActor {
  const profile = db.prisma.userProfile.create({
    data: {
      email: options.email ?? `rbac-${randomUUID().slice(0, 8)}@isolation.test`,
      displayName: "RBAC actor",
      status: "active",
    },
  });

  let membership: TenantMembershipRow | null = null;
  if (options.withMembership ?? Boolean(options.tenantId)) {
    membership = db.prisma.tenantMembership.create({
      data: {
        tenantId: options.tenantId ?? randomUUID(),
        userProfileId: profile.id,
        roleId: options.roleId ?? randomUUID(),
        status: options.status ?? "ACTIVE",
        ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      },
    });
  }

  const { cookie } = insertLiveStaffSession(db, profile.id);
  return { profile, membership, cookie };
}
