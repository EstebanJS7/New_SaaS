import {
  ACCOUNT_ACTIVATION_TOKEN_TTL_MS,
  generatePasswordResetToken,
  hashPasswordResetToken,
} from "@newsaas/shared";
import { appendAuditLog, type AuditAppendTx } from "./audit-log.js";
import { DEMO_TENANT_SLUG } from "./demo-seed.js";
import { FEATURE_CODE_SEEDS, PLATFORM_TENANT_SLUG } from "./reference-seed.js";

/**
 * Operator provisioning of a real clinic ([[ONB-001]], PRD §36 "register organization
 * → create branch").
 *
 * Tenant creation stays ops-only (design D2: there is no self-service registration
 * surface in the API). This is the sanctioned operator path, run from the migrate
 * image on the server:
 *
 *   pnpm --filter @newsaas/database db:provision-tenant -- --slug ... --name ... \
 *     --owner-email ... --owner-name ...
 *
 * One transaction creates the tenant, its first branch, its entitlements, the owner's
 * profile (unless the address already has one) and an OWNER membership, and mints the
 * owner's ACTIVATION token. The plaintext token leaves this function exactly once, in
 * its return value, for the operator to hand to the owner; only its digest persists.
 */

/** Lowercase letters, digits and inner hyphens; 3–40 characters. It is a URL path segment. */
export const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/**
 * Slugs a clinic may not take. The portal lives at `/<slug>/…`, so a slug equal to a
 * top-level web route would shadow it; `platform` and `demo` are owned by the seeds.
 */
export const RESERVED_TENANT_SLUGS: readonly string[] = Object.freeze([
  PLATFORM_TENANT_SLUG,
  DEMO_TENANT_SLUG,
  "app",
  "api",
  "branding",
  "login",
  "forgot-password",
  "reset-password",
  "admin",
  "www",
]);

export const DEFAULT_BRANCH_NAME = "Casa central";

export interface ProvisionTenantInput {
  readonly slug: string;
  readonly name: string;
  readonly ownerEmail: string;
  readonly ownerName: string;
  readonly branchName?: string;
  /** Feature codes to grant. Defaults to the whole catalog (the launch sells everything). */
  readonly features?: readonly string[];
}

export interface ProvisionTenantResult {
  readonly tenantId: string;
  readonly branchId: string;
  readonly ownerProfileId: string;
  readonly ownerMembershipId: string;
  readonly grantedFeatures: readonly string[];
  /** Null when the owner's address already had a password (an existing account). */
  readonly activationToken: string | null;
  readonly activationExpiresAt: Date | null;
}

/** The delegates provisioning writes through, as the transaction client exposes them. */
export interface ProvisioningTx extends AuditAppendTx {
  tenant: {
    findUnique(args: { where: { slug: string }; select: { id: true } }): Promise<{
      id: string;
    } | null>;
    create(args: { data: { slug: string; name: string }; select: { id: true } }): Promise<{
      id: string;
    }>;
  };
  branch: {
    create(args: { data: { tenantId: string; name: string }; select: { id: true } }): Promise<{
      id: string;
    }>;
  };
  membershipBranch: {
    create(args: {
      data: { tenantId: string; membershipId: string; branchId: string };
    }): Promise<unknown>;
  };
  featureCode: {
    findMany(args: {
      where: { code: { in: string[] } };
      select: { id: true; code: true };
    }): Promise<{ id: string; code: string }[]>;
  };
  tenantEntitlement: {
    createMany(args: { data: { tenantId: string; featureCodeId: string }[] }): Promise<{
      count: number;
    }>;
  };
  role: {
    findUnique(args: { where: { code: string }; select: { id: true } }): Promise<{
      id: string;
    } | null>;
  };
  userProfile: {
    findUnique(args: {
      where: { email: string };
      select: { id: true; credential: { select: { userProfileId: true } } };
    }): Promise<{ id: string; credential: { userProfileId: string } | null } | null>;
    create(args: {
      data: { email: string; displayName: string; status: string };
      select: { id: true };
    }): Promise<{ id: string }>;
  };
  tenantMembership: {
    create(args: {
      data: { tenantId: string; userProfileId: string; roleId: string; status: "ACTIVE" };
      select: { id: true };
    }): Promise<{ id: string }>;
  };
  passwordResetToken: {
    create(args: {
      data: { userProfileId: string; tokenHash: string; expiresAt: Date };
      select: { id: true };
    }): Promise<{ id: string }>;
  };
}

export interface ProvisioningClient {
  $transaction<T>(callback: (tx: ProvisioningTx) => Promise<T>): Promise<T>;
}

/** Thrown for operator input the command refuses; the CLI prints the message as is. */
export class ProvisioningError extends Error {
  override readonly name = "ProvisioningError";
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validates and normalizes operator input; throws {@link ProvisioningError} on the first problem. */
export function normalizeProvisionInput(
  input: ProvisionTenantInput
): Required<ProvisionTenantInput> {
  const slug = input.slug.trim().toLowerCase();
  const name = input.name.trim();
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const ownerName = input.ownerName.trim();
  const branchName = (input.branchName ?? DEFAULT_BRANCH_NAME).trim();
  const features = [...new Set(input.features ?? FEATURE_CODE_SEEDS)];

  if (!TENANT_SLUG_PATTERN.test(slug)) {
    throw new ProvisioningError(
      `Slug inválido "${slug}": 3 a 40 caracteres, minúsculas, números y guiones internos.`
    );
  }
  if (RESERVED_TENANT_SLUGS.includes(slug)) {
    throw new ProvisioningError(`El slug "${slug}" está reservado.`);
  }
  if (name.length === 0 || name.length > 120) {
    throw new ProvisioningError("El nombre de la clínica debe tener entre 1 y 120 caracteres.");
  }
  if (!EMAIL_PATTERN.test(ownerEmail) || ownerEmail.length > 254) {
    throw new ProvisioningError(`Email del propietario inválido: "${ownerEmail}".`);
  }
  if (ownerName.length === 0 || ownerName.length > 120) {
    throw new ProvisioningError("El nombre del propietario debe tener entre 1 y 120 caracteres.");
  }
  if (branchName.length === 0 || branchName.length > 120) {
    throw new ProvisioningError("El nombre de la sucursal debe tener entre 1 y 120 caracteres.");
  }
  const unknown = features.filter(
    (code) => !(FEATURE_CODE_SEEDS as readonly string[]).includes(code)
  );
  if (unknown.length > 0) {
    throw new ProvisioningError(
      `Funciones desconocidas: ${unknown.join(", ")}. Válidas: ${FEATURE_CODE_SEEDS.join(", ")}.`
    );
  }
  return { slug, name, ownerEmail, ownerName, branchName, features };
}

export async function provisionTenant(
  db: ProvisioningClient,
  rawInput: ProvisionTenantInput,
  now: Date = new Date()
): Promise<ProvisionTenantResult> {
  const input = normalizeProvisionInput(rawInput);

  return db.$transaction(async (tx) => {
    const taken = await tx.tenant.findUnique({ where: { slug: input.slug }, select: { id: true } });
    if (taken) throw new ProvisioningError(`Ya existe una clínica con el slug "${input.slug}".`);

    const ownerRole = await tx.role.findUnique({ where: { code: "OWNER" }, select: { id: true } });
    if (!ownerRole) {
      throw new ProvisioningError(
        "Falta el rol OWNER: ejecutá primero los datos de referencia (db:seed)."
      );
    }

    const codes = await tx.featureCode.findMany({
      where: { code: { in: [...input.features] } },
      select: { id: true, code: true },
    });
    if (codes.length !== input.features.length) {
      throw new ProvisioningError(
        "El catálogo de funciones no coincide con los datos de referencia: ejecutá db:seed."
      );
    }

    const tenant = await tx.tenant.create({
      data: { slug: input.slug, name: input.name },
      select: { id: true },
    });
    const branch = await tx.branch.create({
      data: { tenantId: tenant.id, name: input.branchName },
      select: { id: true },
    });
    await tx.tenantEntitlement.createMany({
      data: codes.map((code) => ({ tenantId: tenant.id, featureCodeId: code.id })),
    });

    const existing = await tx.userProfile.findUnique({
      where: { email: input.ownerEmail },
      select: { id: true, credential: { select: { userProfileId: true } } },
    });
    const owner =
      existing ??
      (await tx.userProfile.create({
        data: { email: input.ownerEmail, displayName: input.ownerName, status: "active" },
        select: { id: true },
      }));
    const membership = await tx.tenantMembership.create({
      data: {
        tenantId: tenant.id,
        userProfileId: owner.id,
        roleId: ownerRole.id,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    // DEC-094 §6: the owner works at the clinic's first branch.
    await tx.membershipBranch.create({
      data: { tenantId: tenant.id, membershipId: membership.id, branchId: branch.id },
    });

    let activationToken: string | null = null;
    let activationExpiresAt: Date | null = null;
    if (!existing?.credential) {
      activationToken = generatePasswordResetToken();
      activationExpiresAt = new Date(now.getTime() + ACCOUNT_ACTIVATION_TOKEN_TTL_MS);
      await tx.passwordResetToken.create({
        data: {
          userProfileId: owner.id,
          tokenHash: hashPasswordResetToken(activationToken),
          expiresAt: activationExpiresAt,
        },
        select: { id: true },
      });
    }

    await appendAuditLog(tx, {
      action: "platform.tenant_provisioned",
      actorType: "SYSTEM",
      tenantId: tenant.id,
      targetType: "tenant",
      targetId: tenant.id,
      // Codes and counts only: no address, no name.
      metadata: {
        features: [...input.features].sort(),
        ownerMembershipId: membership.id,
        ownerActivationPending: activationToken !== null,
      },
    });

    return {
      tenantId: tenant.id,
      branchId: branch.id,
      ownerProfileId: owner.id,
      ownerMembershipId: membership.id,
      grantedFeatures: [...input.features].sort(),
      activationToken,
      activationExpiresAt,
    };
  });
}
