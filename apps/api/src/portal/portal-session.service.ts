import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { AUTH_CONFIG, type AuthConfig } from "../auth/auth.config.js";
import {
  IDLE_REFRESH_THROTTLE_MS,
  generateSessionToken,
  hashSessionToken,
} from "../auth/session.service.js";

/**
 * Structural view of a `portal_session` row used for expiry decisions.
 * Deliberately local (not the generated Prisma payload type): keeps this
 * service decoupled from the client generator while staying structurally
 * compatible with the delegates the real client and the in-memory fake return.
 */
interface PortalSessionRow {
  id: string;
  portalAccessId: string;
  tokenHash: string;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

/** Minimal access-row view needed to derive the portal's tenant/customer. */
interface PortalAccessRow {
  id: string;
  tenantId: string;
  customerId: string;
  status: string;
}

/**
 * Structural delegate contracts (generated client and test fakes alike).
 * `revokedAt: null` in the where clause means "still-active rows only".
 */
interface PortalSessionDelegate {
  create: (args: {
    data: {
      portalAccessId: string;
      tokenHash: string;
      lastSeenAt: Date;
      idleExpiresAt: Date;
      absoluteExpiresAt: Date;
    };
  }) => Promise<PortalSessionRow>;
  findUnique: (args: { where: { tokenHash: string } }) => Promise<PortalSessionRow | null>;
  update: (args: {
    where: { id: string };
    data: Partial<PortalSessionRow>;
  }) => Promise<PortalSessionRow>;
  updateMany: (args: {
    where: { tokenHash?: string; portalAccessId?: string; revokedAt?: null };
    data: { revokedAt: Date };
  }) => Promise<{ count: number }>;
}

interface PortalAccessDelegate {
  findUnique: (args: {
    where: { id: string };
    select: { id: true; tenantId: true; customerId: true; status: true };
  }) => Promise<PortalAccessRow | null>;
}

/**
 * PG-backed PORTAL sessions (EPIC-08 D1). Structurally parallel to the staff
 * `SessionService` — one row per login, opaque token stored as a SHA-256 hash,
 * rolling idle window with a 60s refresh throttle, absolute ceiling, and
 * revocation via `revokedAt` — but backed by `portal_session` and NEVER
 * interchangeable with staff sessions: a portal token hash lives only in the
 * portal table, so a staff cookie can never resolve here (or vice versa).
 *
 * Resolve also re-reads the owning access row: a session for a REVOKED (or
 * missing) holder is treated as dead even if the session row itself is still
 * live — defense in depth on top of revocation's session sweep.
 */
@Injectable()
export class PortalSessionService {
  constructor(
    // Explicit @Inject token keeps DI resolution token-based while the PARAM
    // TYPE stays the narrow contract this service actually needs.
    @Inject(PrismaService)
    private readonly prisma: {
      portalSession: PortalSessionDelegate;
      customerPortalAccess: PortalAccessDelegate;
    },
    // Symbol token: structural Pick<> types carry no usable design:type metadata.
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig
  ) {}

  /**
   * Issues a fresh portal session for the holder: opaque token, SHA-256 hash
   * persisted, ONE row per login (rotation).
   */
  async issue(
    portalAccessId: string,
    now: Date = new Date()
  ): Promise<{ token: string; sessionId: string }> {
    const token = generateSessionToken();
    const row = await this.prisma.portalSession.create({
      data: {
        portalAccessId,
        tokenHash: hashSessionToken(token),
        lastSeenAt: now,
        idleExpiresAt: new Date(now.getTime() + this.config.sessionIdleTtlSeconds * 1000),
        absoluteExpiresAt: new Date(now.getTime() + this.config.sessionAbsoluteTtlSeconds * 1000),
      },
    });
    return { token, sessionId: row.id };
  }

  /**
   * Resolves a raw portal cookie value into a live holder identity, or null
   * when the token is unknown/revoked/expired OR the owning portal access is no
   * longer ACTIVE. Tenant and Customer derive exclusively from that access row
   * — never from client input.
   */
  async resolve(rawToken: unknown, now: Date = new Date()): Promise<ResolvedPortalSession | null> {
    if (typeof rawToken !== "string" || rawToken.length === 0) {
      return null;
    }
    const row = await this.prisma.portalSession.findUnique({
      where: { tokenHash: hashSessionToken(rawToken) },
    });
    if (!row || !isLive(row, now)) {
      return null;
    }

    const access = await this.prisma.customerPortalAccess.findUnique({
      where: { id: row.portalAccessId },
      select: { id: true, tenantId: true, customerId: true, status: true },
    });
    if (!access) {
      return null;
    }
    if (access.status !== "ACTIVE") {
      return null;
    }

    try {
      await this.refreshIfStale(row, now);
    } catch (error) {
      // A concurrent revoke deleted/updated the row under us: resolve to
      // "unauthenticated" instead of surfacing a spurious INTERNAL 500.
      if (!isRecordDeleted(error)) {
        throw error;
      }
      return null;
    }

    return {
      portalAccessId: access.id,
      tenantId: access.tenantId,
      customerId: access.customerId,
      sessionId: row.id,
    };
  }

  /**
   * Marks the presented token revoked (idempotent): an unknown, malformed or
   * already-revoked token is a no-op. Historical rows are retained, never
   * deleted (spec: revocation preserves audited records).
   */
  async revoke(rawToken: unknown, now: Date = new Date()): Promise<void> {
    if (typeof rawToken !== "string" || rawToken.length === 0) {
      return;
    }
    await this.prisma.portalSession.updateMany({
      where: { tokenHash: hashSessionToken(rawToken), revokedAt: null },
      data: { revokedAt: now },
    });
  }

  private async refreshIfStale(row: PortalSessionRow, now: Date): Promise<void> {
    const staleForMs = now.getTime() - row.lastSeenAt.getTime();
    if (staleForMs <= IDLE_REFRESH_THROTTLE_MS) {
      return;
    }
    await this.prisma.portalSession.update({
      where: { id: row.id },
      data: {
        lastSeenAt: now,
        idleExpiresAt: new Date(now.getTime() + this.config.sessionIdleTtlSeconds * 1000),
      },
    });
  }
}

/** Minimal server-side view handed to callers; never exposes the raw row. */
export interface ResolvedPortalSession {
  portalAccessId: string;
  tenantId: string;
  customerId: string;
  sessionId: string;
}

/** Absolute expiry wins, then revocation, then the rolling idle window. */
function isLive(row: PortalSessionRow, now: Date): boolean {
  if (row.absoluteExpiresAt.getTime() <= now.getTime()) {
    return false;
  }
  if (row.revokedAt) {
    return false;
  }
  return row.idleExpiresAt.getTime() > now.getTime();
}

/**
 * True when the error is Prisma P2025 ("record not found"): a concurrent
 * revoke removed the row between our SELECT and the throttled refresh UPDATE.
 */
function isRecordDeleted(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2025"
  );
}
