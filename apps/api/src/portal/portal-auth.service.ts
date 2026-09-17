import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditWriter } from "../audit/audit-writer.service.js";
import { CredentialService } from "../auth/credential.service.js";
import { LoginRateLimiterService } from "../auth/login-rate-limiter.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PORTAL_FEATURE_CODE } from "./portal.constants.js";
import { PortalSessionService } from "./portal-session.service.js";

/** Uniform client-facing message: never reveals WHICH factor failed. */
const INVALID_PORTAL_CREDENTIALS_MESSAGE = "Invalid credentials.";

/** DTO schema version recorded on portal audit rows (stable, append-only). */
export const PORTAL_DTO_SCHEMA_VERSION = 1;

/** Public shape of an authenticated portal identity (no credential material). */
export interface AuthenticatedPortalIdentity {
  portalAccessId: string;
  tenantId: string;
  customerId: string;
}

export interface PortalLoginResult {
  token: string;
  portal: AuthenticatedPortalIdentity;
}

/** Structural Prisma surface consumed by the portal login boundary. */
interface PortalAuthPrisma {
  tenant: {
    findUnique: (args: {
      where: { slug: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
  customerPortalAccess: {
    findFirst: (args: {
      where: { tenantId: string; contactEmail: string; status: string };
      select: {
        id: true;
        tenantId: true;
        customerId: true;
        credential: { select: { passwordHash: true } };
      };
    }) => Promise<{
      id: string;
      tenantId: string;
      customerId: string;
      credential: { passwordHash: string } | null;
    } | null>;
  };
}

/**
 * Portal login orchestration (EPIC-08 D1/D8 + spec: First-party,
 * Customer-linked portal identity).
 *
 * The login id is the staff-managed `contactEmail` (D8), scoped by the tenant
 * slug the holder presents; the resolved session — NOT the slug — is the
 * authority for tenant and Customer, so a wrong slug can only ever fail to
 * match a holder, never steer tenant scoping.
 *
 * Anti-enumeration mirrors the staff login: unknown holder and wrong password
 * produce the byte-identical 401 envelope, and BOTH paths perform one full
 * argon2id verification (the unknown-holder path against a decoy hash with the
 * same parameters). No email is sent or verified — self-service signup,
 * invitation and recovery are explicitly out of this epic (EPIC-17).
 */
@Injectable()
export class PortalAuthService {
  /** Lazily-derived decoy hash; one argon2 computation amortized forever. */
  private dummyHashPromise: Promise<string> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PortalAuthPrisma,
    private readonly credentials: CredentialService,
    private readonly sessions: PortalSessionService,
    private readonly rateLimiter: LoginRateLimiterService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditWriter
  ) {}

  async login(
    input: { readonly tenantSlug: string; readonly email: string; readonly password: string },
    meta: { readonly ip: string }
  ): Promise<PortalLoginResult> {
    // Namespaced limiter key keeps the portal failure budget isolated from the
    // staff budget even though both share the in-process limiter (TD-005).
    const limiterKey = this.rateLimiter.key(`portal:${input.email}`, meta.ip);
    if (this.rateLimiter.isBlocked(limiterKey)) {
      throw new DomainError("RATE_LIMITED", "Too many failed login attempts. Try again later.");
    }

    const email = input.email.trim().toLowerCase();
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: input.tenantSlug },
      select: { id: true },
    });
    const access = tenant
      ? await this.prisma.customerPortalAccess.findFirst({
          where: { tenantId: tenant.id, contactEmail: email, status: "ACTIVE" },
          select: {
            id: true,
            tenantId: true,
            customerId: true,
            credential: { select: { passwordHash: true } },
          },
        })
      : null;

    // Constant-work pattern: verify against SOMETHING on every path.
    const storedHash = access?.credential?.passwordHash ?? (await this.dummyHash());
    const passwordMatches = await this.credentials.verify(input.password, storedHash);

    if (!access?.credential || !passwordMatches) {
      this.rateLimiter.recordFailure(limiterKey);
      // Audit-or-nothing, exactly like the staff login. A resolved holder is
      // PORTAL-attributed; an unmatched attempt is SYSTEM (no holder identity
      // exists to attribute). metadata.email is INTERNAL-classified identifier
      // data — never a credential.
      await this.audit.append({
        action: "portal.login_failed",
        ...(tenant && { tenantId: tenant.id }),
        ...(access && {
          actorPortalAccessId: access.id,
          targetType: "customer_portal_access",
          targetId: access.id,
        }),
        metadata: { email },
      });
      throw new DomainError("UNAUTHENTICATED", INVALID_PORTAL_CREDENTIALS_MESSAGE);
    }

    this.rateLimiter.reset(limiterKey);

    // Entitlement is re-checked on the login path too (the only @Public portal
    // route) so a tenant that lost its `portal` grant cannot open NEW sessions;
    // existing sessions are already rejected by the guard. Verified AFTER the
    // credential check so an unauthenticated caller learns nothing.
    if (!(await this.entitlements.has(access.tenantId, PORTAL_FEATURE_CODE))) {
      throw new DomainError(
        "FEATURE_NOT_ENTITLED",
        "Portal features are not enabled for this tenant."
      );
    }

    const { token } = await this.sessions.issue(access.id);
    await this.audit.append({
      action: "portal.login_succeeded",
      tenantId: access.tenantId,
      actorPortalAccessId: access.id,
      targetType: "customer_portal_access",
      targetId: access.id,
      metadata: { email, schemaVersion: PORTAL_DTO_SCHEMA_VERSION },
    });
    return {
      token,
      portal: {
        portalAccessId: access.id,
        tenantId: access.tenantId,
        customerId: access.customerId,
      },
    };
  }

  /** Revocation is delegated to the portal session service; errors never leak. */
  logout(rawToken: unknown): Promise<void> {
    return this.sessions.revoke(rawToken);
  }

  /**
   * Decoy hash with identical cost parameters as real hashes, computed once and
   * reused (same posture as the staff login).
   */
  private dummyHash(): Promise<string> {
    this.dummyHashPromise ??= this.credentials.hash("ns-portal-dummy-credential-work");
    return this.dummyHashPromise;
  }
}
