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

/**
 * Structural client contract consumed by {@link seedDemoCustomers}. Keeping the
 * customer seed separate from {@link DemoSeedClient} lets the existing demo
 * tenant/unit tests stay focused on tenant/user/entitlement setup while the
 * customer fixture path is exercised in integration tests during H1.
 */
export interface DemoCustomersSeedClient {
  customer: {
    createMany: (args: {
      data: {
        id: string;
        tenantId: string;
        kind: "INDIVIDUAL" | "COMPANY";
        displayName: string;
        legalName?: string | null;
        taxId?: string | null;
        firstName?: string | null;
        lastName?: string | null;
        documentNumber?: string | null;
        isActive?: boolean;
      }[];
      skipDuplicates?: boolean;
    }) => Promise<{ count: number }>;
  };
  customerAddress: {
    createMany: (args: {
      data: {
        id: string;
        tenantId: string;
        customerId: string;
        label?: string | null;
        line1?: string | null;
        line2?: string | null;
        city?: string | null;
        state?: string | null;
        postalCode?: string | null;
        countryCode?: string | null;
        isActive?: boolean;
      }[];
      skipDuplicates?: boolean;
    }) => Promise<{ count: number }>;
  };
  customerContact: {
    createMany: (args: {
      data: {
        id: string;
        tenantId: string;
        customerId: string;
        kind: "EMAIL" | "PHONE";
        label?: string | null;
        value: string;
        isPrimary?: boolean;
        isActive?: boolean;
      }[];
      skipDuplicates?: boolean;
    }) => Promise<{ count: number }>;
  };
}

export interface DemoCustomersSeedResult {
  customers: number;
  addresses: number;
  contacts: number;
}

/** Synthetic demo customers. UUIDs are fixed so re-runs stay idempotent. */
function buildDemoCustomers(tenantId: string) {
  return [
    {
      id: "11111111-1111-1111-1111-111111111111",
      tenantId,
      kind: "INDIVIDUAL" as const,
      displayName: "Ana García",
      firstName: "Ana",
      lastName: "García",
      documentNumber: "12345678",
      isActive: true,
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      tenantId,
      kind: "COMPANY" as const,
      displayName: "Paws & Whiskers S.A.",
      legalName: "Paws & Whiskers Sociedad Anónima",
      taxId: "80012345-6",
      isActive: true,
    },
  ];
}

function buildDemoAddresses(tenantId: string) {
  return [
    {
      id: "33333333-3333-3333-3333-333333333333",
      tenantId,
      customerId: "11111111-1111-1111-1111-111111111111",
      label: "Home",
      line1: "Calle Falsa 123",
      city: "Buenos Aires",
      postalCode: "C1000",
      countryCode: "AR",
      isActive: true,
    },
    {
      id: "44444444-4444-4444-4444-444444444444",
      tenantId,
      customerId: "22222222-2222-2222-2222-222222222222",
      label: "Billing",
      line1: "Av. del Libertador 4567",
      city: "Buenos Aires",
      postalCode: "C1425",
      countryCode: "AR",
      isActive: true,
    },
  ];
}

function buildDemoContacts(tenantId: string) {
  return [
    {
      id: "55555555-5555-5555-5555-555555555555",
      tenantId,
      customerId: "11111111-1111-1111-1111-111111111111",
      kind: "PHONE" as const,
      label: "Mobile",
      value: "+54 9 11 1234-5678",
      isPrimary: true,
      isActive: true,
    },
    {
      id: "66666666-6666-6666-6666-666666666666",
      tenantId,
      customerId: "11111111-1111-1111-1111-111111111111",
      kind: "EMAIL" as const,
      label: "Personal",
      value: "ana.garcia@demo.newsaas.test",
      isPrimary: true,
      isActive: true,
    },
    {
      id: "77777777-7777-7777-7777-777777777777",
      tenantId,
      customerId: "22222222-2222-2222-2222-222222222222",
      kind: "EMAIL" as const,
      label: "Billing",
      value: "facturacion@pawsandwhiskers.demo",
      isPrimary: true,
      isActive: true,
    },
  ];
}

/**
 * Seeds synthetic Customers, Addresses and Contacts for the demo tenant.
 * Fixed UUIDs and `skipDuplicates` make the path idempotent without relying on
 * application-level unique constraints that do not exist yet.
 */
export async function seedDemoCustomers(
  db: DemoCustomersSeedClient,
  tenantId: string
): Promise<DemoCustomersSeedResult> {
  const customers = await db.customer.createMany({
    data: buildDemoCustomers(tenantId),
    skipDuplicates: true,
  });
  const addresses = await db.customerAddress.createMany({
    data: buildDemoAddresses(tenantId),
    skipDuplicates: true,
  });
  const contacts = await db.customerContact.createMany({
    data: buildDemoContacts(tenantId),
    skipDuplicates: true,
  });

  return {
    customers: customers.count,
    addresses: addresses.count,
    contacts: contacts.count,
  };
}

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
