import { randomUUID } from "node:crypto";
import { STAFF_SESSION_COOKIE } from "../../src/auth/session-cookie.js";
import { generateSessionToken, hashSessionToken } from "../../src/auth/session.service.js";
import type {
  IsolationDatabase,
  RoleRow,
  StaffSessionRow,
  TenantMembershipRow,
  TenantRow,
  UserProfileRow,
} from "./in-memory-database.js";

export interface SeededActor {
  profile: UserProfileRow;
  membership: TenantMembershipRow | null;
  /** Ready-to-use Cookie header value for this actor's live staff session. */
  cookie: string;
}

export interface TwoTenantFixture {
  suffix: string;
  tenants: { a: TenantRow; b: TenantRow };
  role: RoleRow;
  actors: {
    /** Full ACTIVE member of tenant A — the primary probing identity. */
    a: SeededActor;
    /** Full ACTIVE member of tenant B — the foreign-resource owner. */
    b: SeededActor;
    /** Member of A whose membership is SUSPENDED (ACTIVE-only rule probe). */
    suspendedA: SeededActor;
    /** Live session but ZERO memberships anywhere (no-authority probe). */
    noMembership: SeededActor;
  };
  /**
   * Removes every row this fixture created (ephemeral cleanup). Safe to call
   * once; idempotent against repeated calls.
   */
  cleanup: () => void;
}

const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;

interface SeedOptions {
  now?: Date;
}

/**
 * Inserts a hashed live staff session and returns its Cookie header value.
 * Exported for EPIC-02 suites that seed bespoke actors beyond the standard
 * two-tenant matrix.
 */
export function insertLiveStaffSession(
  db: IsolationDatabase,
  userProfileId: string,
  now: Date = new Date()
): { session: StaffSessionRow; cookie: string } {
  const token = generateSessionToken();
  const session = db.prisma.staffSession.create({
    data: {
      userProfileId,
      tokenHash: hashSessionToken(token),
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
    },
  });
  return { session, cookie: `${STAFF_SESSION_COOKIE}=${token}` };
}

/**
 * Seeds TWO fully isolated tenants plus four staff actors directly through the
 * Prisma boundary (design D10 note: fixtures are independent of the S5
 * reference/demo seeds — roles are inserted here, never assumed).
 *
 * Actor matrix:
 * - `a` / `b`: symmetric ACTIVE members of A and B (cross-tenant probes).
 * - `suspendedA`: proves SUSPENDED ≠ ACTIVE for tenant authority.
 * - `noMembership`: proves authentication alone grants no tenant authority.
 *
 * Sessions are inserted as hashed rows and handed back as Cookie headers, so
 * suites authenticate without paying argon2 login costs or touching `/auth/*`
 * surfaces under test.
 */
export function seedTwoTenants(db: IsolationDatabase, options: SeedOptions = {}): TwoTenantFixture {
  // Unique-per-call natural keys keep repeated seeds collision-free even when
  // a future harness shares one database boundary across boots.
  const suffix = randomUUID().slice(0, 8);
  const now = options.now ?? new Date();

  const role = db.prisma.role.create({
    data: { code: `OWNER-${suffix}`, name: "Owner (isolation fixture)" },
  });

  // EPIC-02: the third guard link enforces deny-by-default, so fixture actors
  // hold exactly the ONE catalog key the shipped private routes declare
  // (`users.membership.manage`) — least privilege keeps the isolation suites
  // exercising real permission resolution, not an implicit superuser.
  const MANAGE_KEY = "users.membership.manage";
  const existingPermission = db.prisma.permission.findUnique({ where: { key: MANAGE_KEY } });
  const managePermission =
    existingPermission ?? db.prisma.permission.create({ data: { key: MANAGE_KEY } });
  const permissionOwnedByFixture = existingPermission === null;
  const managePair = db.prisma.rolePermission.create({
    data: { roleId: role.id, permissionId: managePermission.id },
  });

  const tenantA = db.prisma.tenant.create({
    data: { slug: `tenant-a-${suffix}`, name: "Isolation Tenant A" },
  });
  const tenantB = db.prisma.tenant.create({
    data: { slug: `tenant-b-${suffix}`, name: "Isolation Tenant B" },
  });

  function insertProfile(letter: string): UserProfileRow {
    return db.prisma.userProfile.create({
      data: {
        email: `staff-${letter}-${suffix}@isolation.test`,
        displayName: `Staff ${letter.toUpperCase()} (${suffix})`,
        status: "active",
      },
    });
  }

  const profileA = insertProfile("a");
  const profileB = insertProfile("b");
  const profileSuspended = insertProfile("s");
  const profileNoMembership = insertProfile("n");

  const membershipA = db.prisma.tenantMembership.create({
    data: {
      tenantId: tenantA.id,
      userProfileId: profileA.id,
      roleId: role.id,
      status: "ACTIVE",
    },
  });
  const membershipSuspended = db.prisma.tenantMembership.create({
    data: {
      tenantId: tenantA.id,
      userProfileId: profileSuspended.id,
      roleId: role.id,
      status: "SUSPENDED",
    },
  });
  const membershipB = db.prisma.tenantMembership.create({
    data: {
      tenantId: tenantB.id,
      userProfileId: profileB.id,
      roleId: role.id,
      status: "ACTIVE",
    },
  });

  const sessions = {
    a: insertLiveStaffSession(db, profileA.id, now),
    b: insertLiveStaffSession(db, profileB.id, now),
    suspendedA: insertLiveStaffSession(db, profileSuspended.id, now),
    noMembership: insertLiveStaffSession(db, profileNoMembership.id, now),
  };

  const createdSessionHashes = Object.values(sessions).map((entry) => entry.session.tokenHash);

  return {
    suffix,
    tenants: { a: tenantA, b: tenantB },
    role,
    actors: {
      a: { profile: profileA, membership: membershipA, cookie: sessions.a.cookie },
      b: { profile: profileB, membership: membershipB, cookie: sessions.b.cookie },
      suspendedA: {
        profile: profileSuspended,
        membership: membershipSuspended,
        cookie: sessions.suspendedA.cookie,
      },
      noMembership: {
        profile: profileNoMembership,
        membership: null,
        cookie: sessions.noMembership.cookie,
      },
    },
    cleanup: (): void => {
      for (const tokenHash of createdSessionHashes) {
        db.tables.sessions.delete(tokenHash);
      }
      for (const membership of [membershipA, membershipB, membershipSuspended]) {
        db.tables.memberships.delete(membership.id);
      }
      for (const profile of [profileA, profileB, profileSuspended, profileNoMembership]) {
        db.tables.profiles.delete(profile.id);
      }
      db.tables.rolePermissions.delete(managePair.id);
      if (permissionOwnedByFixture) {
        db.tables.permissions.delete(managePermission.id);
      }
      db.tables.roles.delete(role.id);
      db.tables.tenants.delete(tenantA.id);
      db.tables.tenants.delete(tenantB.id);
    },
  };
}
