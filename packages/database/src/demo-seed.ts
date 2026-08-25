import { FEATURE_CODE_SEEDS } from "./reference-seed.js";

/**
 * Guarded demo tenant seed logic (design D8, spec: rbac-entitlements-seed /
 * Guarded demo tenant seed).
 *
 * The executable entrypoint is `prisma/demo-seed.ts`, surfaced through the
 * EPIC-00 guarded CLI convention (`.opencode/commands/demo-seed.ts`); this
 * module lives under `src/` so the guard and the data path are covered by
 * lint, typecheck and unit tests.
 *
 * GUARD CONTRACT (fail-safe by construction):
 * - disabled unless `ENABLE_DEMO_SEED === "true"`;
 * - REFUSED in any environment that is not explicitly `development` or
 *   `test` — an unset or exotic NODE_ENV is treated as production, mirroring
 *   the secure-by-default posture of the auth config.
 *
 * DATA PATH: one synthetic tenant (`demo`), its owner profile + argon2id
 * credential + ACTIVE OWNER membership, and explicit `tenant_entitlement`
 * grants for every seeded feature code. Everything upserts on stable natural
 * keys so re-running converges without duplicates. The reference seed
 * (`db:seed`) MUST have run first: roles/feature codes are referenced, never
 * created here.
 */

/** Demo tenant natural key (tenant.slug UNIQUE). */
export const DEMO_TENANT_SLUG = "demo";

/** Demo owner natural key (user_profile.email UNIQUE, app-lowercased). */
export const DEMO_OWNER_EMAIL = "owner@demo.newsaas.test";

export const DEMO_OWNER_DISPLAY_NAME = "Demo Owner";
export const DEMO_TENANT_NAME = "Demo Veterinary Clinic";

/**
 * Grants are EXPLICIT rows (design D8): no plan mapping ever grants access,
 * so the demo tenant receives every MVP feature code as a real grant. The
 * list is derived from the seeded catalog instead of a second literal.
 */
export const DEMO_FEATURE_GRANTS: readonly string[] = FEATURE_CODE_SEEDS;

export type DemoSeedGuardDecision =
  | { mode: "disabled"; reason: string }
  | { mode: "refused"; reason: string }
  | { mode: "enabled"; reason: string };

/** Pure guard resolution — the single authority for run/refuse decisions. */
export function resolveDemoSeedGuard(env: NodeJS.ProcessEnv): DemoSeedGuardDecision {
  if (env.ENABLE_DEMO_SEED !== "true") {
    return {
      mode: "disabled",
      reason: 'ENABLE_DEMO_SEED is not set to "true".',
    };
  }

  if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
    return {
      mode: "refused",
      reason: `ENABLE_DEMO_SEED must never be enabled outside development/test (NODE_ENV=${env.NODE_ENV ?? "<unset>"}).`,
    };
  }

  return { mode: "enabled", reason: "Explicitly enabled for a non-production environment." };
}

/**
 * Structural client contract consumed by {@link seedDemoData} — exactly the
 * delegates the demo path touches, satisfied by both the generated PrismaClient
 * and test fakes.
 */
export interface DemoSeedClient {
  role: {
    findUnique: (args: { where: { code: string }; select: { id: true } }) => Promise<{
      id: string;
    } | null>;
  };
  tenant: {
    upsert: (args: {
      where: { slug: string };
      create: { slug: string; name: string };
      update: Record<string, never>;
    }) => Promise<{ id: string; slug: string; name: string }>;
  };
  userProfile: {
    upsert: (args: {
      where: { email: string };
      create: { email: string; displayName: string; status: string };
      update: Record<string, never>;
    }) => Promise<{ id: string; email: string; displayName: string; status: string }>;
  };
  userCredential: {
    upsert: (args: {
      where: { userProfileId: string };
      create: { userProfileId: string; passwordHash: string };
      update: { passwordHash: string };
    }) => Promise<{ userProfileId: string; passwordHash: string }>;
  };
  tenantMembership: {
    upsert: (args: {
      where: { tenantId_userProfileId: { tenantId: string; userProfileId: string } };
      create: { tenantId: string; userProfileId: string; roleId: string; status: string };
      update: Record<string, never>;
    }) => Promise<{ id: string; tenantId: string; userProfileId: string }>;
  };
  featureCode: {
    findUnique: (args: { where: { code: string }; select: { id: true } }) => Promise<{
      id: string;
    } | null>;
  };
  tenantEntitlement: {
    upsert: (args: {
      where: { tenantId_featureCodeId: { tenantId: string; featureCodeId: string } };
      create: { tenantId: string; featureCodeId: string };
      update: Record<string, never>;
    }) => Promise<{ id: string; tenantId: string; featureCodeId: string }>;
  };
}

export interface DemoSeedInput {
  /** Pre-computed argon2id hash for the demo owner password (RESTRICTED). */
  readonly passwordHash: string;
}

export interface DemoSeedResult {
  tenantId: string;
  ownerProfileId: string;
  membershipId: string;
  grantedFeatureCodes: number;
}

/**
 * Seeds the synthetic demo tenant. Idempotent by natural-key upserts; throws
 * instructively when the reference seed has not populated roles/codes yet.
 */
export async function seedDemoData(
  db: DemoSeedClient,
  input: DemoSeedInput
): Promise<DemoSeedResult> {
  const ownerRole = await db.role.findUnique({ where: { code: "OWNER" }, select: { id: true } });
  if (!ownerRole) {
    throw new Error(
      "demo seed: role OWNER missing — run the reference seed (`db:seed`) before the demo seed"
    );
  }

  const tenant = await db.tenant.upsert({
    where: { slug: DEMO_TENANT_SLUG },
    create: { slug: DEMO_TENANT_SLUG, name: DEMO_TENANT_NAME },
    update: {},
  });

  // Email stored app-lowercased (schema convention) — the constant already is.
  const owner = await db.userProfile.upsert({
    where: { email: DEMO_OWNER_EMAIL },
    create: {
      email: DEMO_OWNER_EMAIL,
      displayName: DEMO_OWNER_DISPLAY_NAME,
      status: "active",
    },
    update: {},
  });

  await db.userCredential.upsert({
    where: { userProfileId: owner.id },
    create: { userProfileId: owner.id, passwordHash: input.passwordHash },
    // Refresh keeps the demo credential usable if parameters evolve.
    update: { passwordHash: input.passwordHash },
  });

  const membership = await db.tenantMembership.upsert({
    where: {
      tenantId_userProfileId: { tenantId: tenant.id, userProfileId: owner.id },
    },
    create: {
      tenantId: tenant.id,
      userProfileId: owner.id,
      roleId: ownerRole.id,
      status: "ACTIVE",
    },
    update: {},
  });

  let granted = 0;
  for (const code of DEMO_FEATURE_GRANTS) {
    const featureCode = await db.featureCode.findUnique({ where: { code }, select: { id: true } });
    if (!featureCode) {
      throw new Error(
        `demo seed: feature code ${code} missing — run the reference seed (\`db:seed\`) first`
      );
    }
    await db.tenantEntitlement.upsert({
      where: {
        tenantId_featureCodeId: { tenantId: tenant.id, featureCodeId: featureCode.id },
      },
      create: { tenantId: tenant.id, featureCodeId: featureCode.id },
      update: {},
    });
    granted += 1;
  }

  return {
    tenantId: tenant.id,
    ownerProfileId: owner.id,
    membershipId: membership.id,
    grantedFeatureCodes: granted,
  };
}
