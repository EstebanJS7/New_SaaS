import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
import { CredentialService } from "../auth/credential.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import {
  PORTAL_ACCESS_DTO_SCHEMA_VERSION,
  toPortalAccessResponse,
  type PortalAccessRecord,
  type PortalAccessResponse,
} from "./portal-access.dto.js";
import { PORTAL_FEATURE_CODE } from "./portal.constants.js";

/** Status string used by the schema scaffold for a usable holder. */
const ACTIVE_STATUS = "ACTIVE";
const REVOKED_STATUS = "REVOKED";

/** Stable 409 message for the one-active-holder-per-Customer rule (D1). */
const ACTIVE_HOLDER_MESSAGE = "This Customer already has an active portal holder.";

/**
 * Stable 409 message for the one-active-holder-per-login-email rule (D8). The
 * login id is the tenant-scoped `contactEmail`; two ACTIVE holders sharing it
 * would make portal login resolve an arbitrary Customer.
 */
const ACTIVE_EMAIL_MESSAGE = "This email is already an active portal holder in this tenant.";

/** Structural Prisma surface consumed by the staff portal-access boundary. */
interface PortalAccessPrisma {
  customer: {
    findFirst: (args: {
      where: { id: string; tenantId: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
  customerPortalAccess: {
    findFirst: (args: {
      where: {
        id?: string;
        tenantId: string;
        customerId?: string;
        contactEmail?: string;
        status?: string;
      };
    }) => Promise<PortalAccessRecord | null>;
    create: (args: {
      data: { tenantId: string; customerId: string; contactEmail: string; status: string };
    }) => Promise<PortalAccessRecord>;
    updateMany: (args: {
      where: { id: string; tenantId: string; status: string };
      data: { status: string };
    }) => Promise<{ count: number }>;
  };
  portalCredential: {
    create: (args: {
      data: { portalAccessId: string; passwordHash: string };
    }) => Promise<{ portalAccessId: string }>;
  };
  portalSession: {
    updateMany: (args: {
      where: { portalAccessId: string; revokedAt: null };
      data: { revokedAt: Date };
    }) => Promise<{ count: number }>;
  };
  /** Transactional audit target so the audit row co-commits with the mutation. */
  auditLog: AuditAppendTx["auditLog"];
  $transaction: <T>(fn: (tx: PortalAccessPrisma) => Promise<T>) => Promise<T>;
}

/**
 * Staff-operated portal-access provisioning/revocation (EPIC-08 D1/D7).
 *
 * Authorization is explicit on every path: server-derived tenant, the `portal`
 * entitlement, the route-declared `portal.access.manage` permission, and the
 * Customer's tenant ownership. A Customer owned by another tenant (or an
 * unknown UUID) is a byte-equivalent 404; a second ACTIVE holder for the same
 * Customer OR an ACTIVE holder already using the same login email is a 409 —
 * both leave NOTHING persisted, because the checks and the write share one
 * transaction with the co-committed audit row. Both rules are also enforced by
 * partial unique indexes, so a concurrent provision cannot race past them.
 *
 * Revocation additionally sweeps the holder's live portal sessions
 * (`revokedAt`), so the next portal request resolves to 401; historical rows
 * are retained, never deleted.
 */
@Injectable()
export class PortalAccessService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PortalAccessPrisma,
    private readonly requestContext: RequestContextService,
    private readonly entitlements: EntitlementsService,
    private readonly credentials: CredentialService,
    private readonly audit: AuditWriter
  ) {}

  async provision(
    customerId: string,
    input: { readonly email: string; readonly password: string }
  ): Promise<PortalAccessResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const actorUserProfileId = this.requestContext.requireUserProfileId();
    await this.requirePortalEntitlement(tenantId);

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });
    if (!customer) {
      throw new DomainError("NOT_FOUND", "Customer was not found.");
    }

    const contactEmail = input.email.trim().toLowerCase();
    // Hash BEFORE opening the transaction: argon2 must never run inside a DB
    // transaction (engineering rules: no long-running work holding a tx).
    const passwordHash = await this.credentials.hash(input.password);

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const active = await tx.customerPortalAccess.findFirst({
          where: { tenantId, customerId, status: ACTIVE_STATUS },
        });
        if (active) {
          // One active holder per Customer (design D1). Checked AND enforced by
          // the partial unique index; this pre-check keeps the common case a
          // clean 409 without relying on the constraint error.
          throw new DomainError("CONFLICT", ACTIVE_HOLDER_MESSAGE);
        }

        const emailHolder = await tx.customerPortalAccess.findFirst({
          where: { tenantId, contactEmail, status: ACTIVE_STATUS },
        });
        if (emailHolder) {
          // The login id is (tenant, contactEmail) among ACTIVE holders (D8).
          // Checked AND enforced by
          // `customer_portal_access_active_contact_email_key`; without this a
          // second Customer could claim the same login email and portal login
          // would resolve an arbitrary holder.
          throw new DomainError("CONFLICT", ACTIVE_EMAIL_MESSAGE);
        }

        const created = await tx.customerPortalAccess.create({
          data: { tenantId, customerId, contactEmail, status: ACTIVE_STATUS },
        });
        await tx.portalCredential.create({
          data: { portalAccessId: created.id, passwordHash },
        });

        await this.audit.append(
          {
            action: "portal_access.provisioned",
            tenantId,
            actorUserProfileId,
            targetType: "customer_portal_access",
            targetId: created.id,
            metadata: {
              schemaVersion: PORTAL_ACCESS_DTO_SCHEMA_VERSION,
              changedFields: ["contactEmail", "status"],
              customerId,
            },
          },
          tx
        );

        return created;
      });

      return toPortalAccessResponse(row);
    } catch (error) {
      // Lost the race against a concurrent provision: one of the two partial
      // unique indexes rejects the write. Discriminate on the violated target
      // (customer_id vs contact_email) so the caller still receives the matching
      // 409 CONFLICT instead of leaking an INTERNAL 500.
      if (isUniqueViolation(error)) {
        throw new DomainError("CONFLICT", conflictMessageFor(error));
      }
      throw error;
    }
  }

  async revoke(customerId: string): Promise<PortalAccessResponse> {
    const tenantId = this.requestContext.requireTenantId();
    const actorUserProfileId = this.requestContext.requireUserProfileId();
    await this.requirePortalEntitlement(tenantId);

    const row = await this.prisma.$transaction(async (tx) => {
      const active = await tx.customerPortalAccess.findFirst({
        where: { tenantId, customerId, status: ACTIVE_STATUS },
      });
      if (!active) {
        // Unknown Customer, cross-tenant Customer, or no active holder — one
        // byte-equivalent 404. Nothing to revoke.
        throw new DomainError("NOT_FOUND", "Portal access was not found.");
      }

      const { count } = await tx.customerPortalAccess.updateMany({
        where: { id: active.id, tenantId, status: ACTIVE_STATUS },
        data: { status: REVOKED_STATUS },
      });
      if (count === 0) {
        // Concurrent revocation won the race; treat as already-revoked.
        throw new DomainError("NOT_FOUND", "Portal access was not found.");
      }

      await tx.portalSession.updateMany({
        where: { portalAccessId: active.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await this.audit.append(
        {
          action: "portal_access.revoked",
          tenantId,
          actorUserProfileId,
          targetType: "customer_portal_access",
          targetId: active.id,
          metadata: {
            schemaVersion: PORTAL_ACCESS_DTO_SCHEMA_VERSION,
            changedFields: ["status"],
            customerId,
          },
        },
        tx
      );

      return { ...active, status: REVOKED_STATUS };
    });

    return toPortalAccessResponse(row);
  }

  /** The `portal` entitlement gates provisioning AND revocation (spec). */
  private async requirePortalEntitlement(tenantId: string): Promise<void> {
    if (!(await this.entitlements.has(tenantId, PORTAL_FEATURE_CODE))) {
      throw new DomainError(
        "FEATURE_NOT_ENTITLED",
        "Portal features are not enabled for this tenant."
      );
    }
  }
}

/** Prisma P2002: unique-constraint violation (one of the ACTIVE partial indexes). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Picks the stable 409 message for the violated partial index. Prisma reports
 * the offending fields/index in `meta.target`; anything unrecognized falls back
 * to the Customer rule (the historically shipped behavior).
 */
function conflictMessageFor(error: unknown): string {
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  const fields = Array.isArray(target)
    ? target.filter((field): field is string => typeof field === "string").join(",")
    : typeof target === "string"
      ? target
      : "";
  return fields.includes("contact_email") ? ACTIVE_EMAIL_MESSAGE : ACTIVE_HOLDER_MESSAGE;
}
