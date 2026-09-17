import type {
  CustomerPortalAccessRow,
  IsolationDatabase,
  PortalSessionRow,
} from "./in-memory-database.js";
import { generateSessionToken, hashSessionToken } from "../../src/auth/session.service.js";
import { PORTAL_SESSION_COOKIE } from "../../src/portal/portal-session-cookie.js";

const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;

/**
 * Inserts a hashed live PORTAL session and returns its Cookie header value.
 * Mirrors `insertLiveStaffSession` so portal suites authenticate without paying
 * argon2 login costs or exercising the login surface under test.
 */
export function insertLivePortalSession(
  db: IsolationDatabase,
  portalAccessId: string,
  now: Date = new Date()
): { session: PortalSessionRow; cookie: string } {
  const token = generateSessionToken();
  const session = db.prisma.portalSession.create({
    data: {
      portalAccessId,
      tokenHash: hashSessionToken(token),
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
    },
  });
  return { session, cookie: `${PORTAL_SESSION_COOKIE}=${token}` };
}

export interface PortalAccessFixture {
  access: CustomerPortalAccessRow;
  /** Ready-to-use Cookie header for a live portal session on this holder. */
  cookie: string;
}

export interface SeedPortalAccessOptions {
  tenantId: string;
  customerId: string;
  contactEmail?: string;
  status?: string;
  /** Pre-computed argon2id hash (tests get it from the app's CredentialService). */
  passwordHash?: string;
  /** Skip the live-session insert (the holder still fits the schema). */
  withSession?: boolean;
  now?: Date;
}

/**
 * Creates a Customer-linked portal holder (and optionally its credential and a
 * live session) directly through the Prisma boundary — the portal twin of the
 * staff fixtures. Callers own cleanup via the exposed tables.
 */
export function seedPortalAccess(
  db: IsolationDatabase,
  options: SeedPortalAccessOptions
): PortalAccessFixture {
  const access = db.prisma.customerPortalAccess.create({
    data: {
      tenantId: options.tenantId,
      customerId: options.customerId,
      // Unique-per-call default keeps repeated seeds collision-free.
      contactEmail: options.contactEmail ?? `portal-holder-${accessSuffix()}@isolation.test`,
      status: options.status ?? "ACTIVE",
    },
  });

  if (options.passwordHash !== undefined) {
    db.prisma.portalCredential.create({
      data: { portalAccessId: access.id, passwordHash: options.passwordHash },
    });
  }

  const cookie =
    options.withSession === false ? "" : insertLivePortalSession(db, access.id, options.now).cookie;

  return { access, cookie };
}

function accessSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}
