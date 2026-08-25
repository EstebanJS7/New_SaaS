import { Injectable } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { PrismaService } from "@newsaas/database";
import { CredentialService } from "./credential.service.js";
import { LoginRateLimiterService } from "./login-rate-limiter.service.js";
import { SessionService } from "./session.service.js";

/** Uniform client-facing message: never reveals WHICH factor failed. */
const INVALID_CREDENTIALS_MESSAGE = "Invalid credentials.";

/** Public shape of an authenticated staff identity (no credential material). */
export interface AuthenticatedStaffIdentity {
  id: string;
  displayName: string;
}

export interface LoginResult {
  token: string;
  user: AuthenticatedStaffIdentity;
}

/**
 * Login orchestration (design D4 + spec: identity / Login + PG sessions).
 *
 * Anti-enumeration posture:
 * - unknown email and wrong password produce the byte-identical 401 envelope
 *   (`INVALID_CREDENTIALS_MESSAGE`);
 * - BOTH paths perform one full argon2id verification — the unknown-email path
 *   burns its work against a dummy hash of the same parameters, so wall-clock
 *   timing cannot distinguish "no such user" from "bad password".
 */
@Injectable()
export class AuthService {
  /** Lazily-derived decoy hash; one argon2 computation amortized forever. */
  private dummyHashPromise: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialService,
    private readonly sessions: SessionService,
    private readonly rateLimiter: LoginRateLimiterService
  ) {}

  async login(
    input: { readonly email: string; readonly password: string },
    meta: { readonly ip: string }
  ): Promise<LoginResult> {
    const limiterKey = this.rateLimiter.key(input.email, meta.ip);

    // Blocked traffic is rejected before any DB or crypto work happens.
    if (this.rateLimiter.isBlocked(limiterKey)) {
      throw new DomainError("RATE_LIMITED", "Too many failed login attempts. Try again later.");
    }

    const email = input.email.trim().toLowerCase();
    const profile = await this.prisma.userProfile.findUnique({
      where: { email },
      select: {
        id: true,
        displayName: true,
        credential: { select: { passwordHash: true } },
      },
    });

    // Constant-work pattern: verify against SOMETHING on every path.
    const storedHash = profile?.credential?.passwordHash ?? (await this.dummyHash());
    const passwordMatches = await this.credentials.verify(input.password, storedHash);

    if (!profile?.credential || !passwordMatches) {
      this.rateLimiter.recordFailure(limiterKey);
      throw new DomainError("UNAUTHENTICATED", INVALID_CREDENTIALS_MESSAGE);
    }

    this.rateLimiter.reset(limiterKey);

    const { token } = await this.sessions.issue(profile.id);
    return { token, user: { id: profile.id, displayName: profile.displayName } };
  }

  /** Revocation is delegated to SessionService; errors must never leak state. */
  logout(rawToken: unknown): Promise<void> {
    return this.sessions.revoke(rawToken);
  }

  /**
   * Decoy hash with identical cost parameters as real hashes, computed once
   * and reused. Failure of derivation would only delay the first unknown-email
   * attempt; it never changes the response contract.
   */
  private dummyHash(): Promise<string> {
    this.dummyHashPromise ??= this.credentials.hash("ns-dummy-credential-work");
    return this.dummyHashPromise;
  }
}
