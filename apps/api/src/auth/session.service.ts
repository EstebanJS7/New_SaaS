import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { AUTH_CONFIG, type AuthConfig } from "./auth.config.js";

/**
 * Structural view of a staff_session row used for expiry decisions.
 * Deliberately local (not the generated Prisma payload type): keeps this
 * service decoupled from the client generator while staying structurally
 * compatible with what the delegates return.
 */
interface StaffSessionRow {
  id: string;
  userProfileId: string;
  tokenHash: string;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

/**
 * Rolling refresh throttle (design D4): `last_seen_at` is refreshed only when
 * staler than 60s, so high-frequency authenticated traffic does not turn every
 * request into a session-row write.
 */
export const IDLE_REFRESH_THROTTLE_MS = 60_000;

/** Opaque token entropy (design D4): 32 random bytes, base64url-encoded. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Sessions are stored by SHA-256 token hash — a database leak must not yield
 * replayable bearer tokens. Lookup always happens by hash.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Minimal server-side view handed to callers; never exposes the raw row. */
export interface ResolvedStaffSession {
  userProfileId: string;
  sessionId: string;
}

/**
 * True when the error is Prisma P2025 ("record not found"): between our SELECT
 * and the throttled refresh UPDATE, a concurrent logout hard-deleted the row.
 * That lost race means "session is gone" — never a server fault.
 */
function isRecordDeleted(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2025"
  );
}

/**
 * PG-backed staff sessions (design D4). One row per login (rotation); logout
 * hard-deletes the row so replayed cookies fail lookups. Expiry is checked
 * server-authoritatively: absolute first (kills regardless of freshness),
 * then revocation, then the rolling idle window.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    // Symbol token: structural Pick<> types carry no usable design:type metadata.
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig
  ) {}

  /**
   * Issues a fresh session for the profile: generates an opaque token, stores
   * only its SHA-256 hash, and inserts ONE row (per-login rotation).
   */
  async issue(
    userProfileId: string,
    now: Date = new Date()
  ): Promise<{ token: string; session: ResolvedStaffSession }> {
    const token = generateSessionToken();
    const row = await this.prisma.staffSession.create({
      data: {
        userProfileId,
        tokenHash: hashSessionToken(token),
        lastSeenAt: now,
        idleExpiresAt: new Date(now.getTime() + this.config.sessionIdleTtlSeconds * 1000),
        absoluteExpiresAt: new Date(now.getTime() + this.config.sessionAbsoluteTtlSeconds * 1000),
      },
    });
    return { token, session: { userProfileId: row.userProfileId, sessionId: row.id } };
  }

  /**
   * Resolves a raw bearer cookie value into a live session, or null when the
   * token is unknown/revoked/expired. A still-valid session gets its rolling
   * window extended when the last refresh is staler than 60s.
   */
  async resolve(rawToken: unknown, now: Date = new Date()): Promise<ResolvedStaffSession | null> {
    if (typeof rawToken !== "string" || rawToken.length === 0) {
      return null;
    }
    const row = await this.prisma.staffSession.findUnique({
      where: { tokenHash: hashSessionToken(rawToken) },
    });
    if (!row || !this.isLive(row, now)) {
      return null;
    }

    try {
      await this.refreshIfStale(row, now);
    } catch (error) {
      // Logout won the race against this refresh: the row is already deleted.
      // Resolve to "unauthenticated" (caller renders the 401 envelope) instead
      // of letting P2025 surface as a spurious INTERNAL 500. Any other storage
      // failure still propagates.
      if (!isRecordDeleted(error)) {
        throw error;
      }
      return null;
    }

    return { userProfileId: row.userProfileId, sessionId: row.id };
  }

  /**
   * Hard-deletes the session row (design D4 logout semantics). Idempotent:
   * deleting an already-gone or malformed token is a no-op.
   */
  async revoke(rawToken: unknown): Promise<void> {
    if (typeof rawToken !== "string" || rawToken.length === 0) {
      return;
    }
    await this.prisma.staffSession.deleteMany({
      where: { tokenHash: hashSessionToken(rawToken) },
    });
  }

  private isLive(row: StaffSessionRow, now: Date): boolean {
    // Absolute expiry wins over everything — even a freshly-seen session dies
    // at the hard ceiling (forces re-authentication within bounded time).
    if (row.absoluteExpiresAt.getTime() <= now.getTime()) {
      return false;
    }
    if (row.revokedAt) {
      return false;
    }
    return row.idleExpiresAt.getTime() > now.getTime();
  }

  private async refreshIfStale(row: StaffSessionRow, now: Date): Promise<void> {
    const staleForMs = now.getTime() - row.lastSeenAt.getTime();
    if (staleForMs <= IDLE_REFRESH_THROTTLE_MS) {
      return;
    }
    await this.prisma.staffSession.update({
      where: { id: row.id },
      data: {
        lastSeenAt: now,
        idleExpiresAt: new Date(now.getTime() + this.config.sessionIdleTtlSeconds * 1000),
      },
    });
  }
}
