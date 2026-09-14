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

/**
 * Transactional delegate scope used inside {@link seedDemoPatients}'s
 * `$transaction`. An active Patient and its active primary guardian MUST commit
 * atomically: the deferred Patient-side constraint trigger
 * (`patient_exactly_one_primary_guardian_trigger`) only observes the guardian
 * when both writes land in the same transaction.
 */
export interface DemoPatientsSeedTxClient {
  patient: {
    createMany: (args: {
      data: {
        id: string;
        tenantId: string;
        name: string;
        speciesId: string;
        breedId?: string | null;
        sex: "MALE" | "FEMALE" | "UNKNOWN";
        isActive?: boolean;
      }[];
      skipDuplicates?: boolean;
    }) => Promise<{ count: number }>;
  };
  patientGuardian: {
    createMany: (args: {
      data: {
        id: string;
        tenantId: string;
        patientId: string;
        customerId: string;
        isPrimary?: boolean;
        isActive?: boolean;
        position?: number;
      }[];
      skipDuplicates?: boolean;
    }) => Promise<{ count: number }>;
  };
}

/**
 * Structural client contract consumed by {@link seedDemoPatients}. The global
 * Species/Breed taxonomy is REFERENCED (seeded by the reference seed), never
 * created here. `$transaction` mirrors Prisma's interactive form: the callback
 * receives the transactional delegate scope, so the Patient and guardian writes
 * commit or roll back together.
 */
export interface DemoPatientsSeedClient extends DemoPatientsSeedTxClient {
  species: {
    findUnique: (args: { where: { code: string }; select: { id: true } }) => Promise<{
      id: string;
    } | null>;
  };
  breed: {
    findUnique: (args: {
      where: { speciesId_code: { speciesId: string; code: string } };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
  $transaction: <T>(fn: (tx: DemoPatientsSeedTxClient) => Promise<T>) => Promise<T>;
}

export interface DemoPatientsSeedResult {
  patients: number;
  guardians: number;
}

/** Demo patient natural keys (global Species/Breed codes, Decision #2211). */
export const DEMO_PATIENT_SPECIES_CODE = "dog";
export const DEMO_PATIENT_BREED_CODE = "mixed";

/** Fixed UUIDs keep the demo path idempotent without app-level uniques. */
export const DEMO_PATIENT_DOG_ID = "88888888-8888-8888-8888-888888888888";
const DEMO_PATIENT_CAT_ID = "99999999-9999-9999-9999-999999999999";
const DEMO_GUARDIAN_DOG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DEMO_GUARDIAN_CAT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/** Linked demo customer (see {@link buildDemoCustomers}). */
const DEMO_GUARDIAN_CUSTOMER_ID = "11111111-1111-1111-1111-111111111111";

function buildDemoPatients(tenantId: string, speciesId: string, breedId: string | null) {
  return [
    {
      id: DEMO_PATIENT_DOG_ID,
      tenantId,
      name: "Bobby",
      speciesId,
      breedId,
      sex: "MALE" as const,
      isActive: true,
    },
    {
      id: DEMO_PATIENT_CAT_ID,
      tenantId,
      name: "Michi",
      speciesId,
      breedId: null,
      sex: "FEMALE" as const,
      isActive: true,
    },
  ];
}

function buildDemoGuardians(tenantId: string) {
  return [
    {
      id: DEMO_GUARDIAN_DOG_ID,
      tenantId,
      patientId: DEMO_PATIENT_DOG_ID,
      customerId: DEMO_GUARDIAN_CUSTOMER_ID,
      isPrimary: true,
      isActive: true,
      position: 0,
    },
    // Every active demo Patient needs its own active primary guardian; without
    // Michi's link the deferred Patient trigger rejects the seed at COMMIT.
    {
      id: DEMO_GUARDIAN_CAT_ID,
      tenantId,
      patientId: DEMO_PATIENT_CAT_ID,
      customerId: DEMO_GUARDIAN_CUSTOMER_ID,
      isPrimary: true,
      isActive: true,
      position: 0,
    },
  ];
}

/**
 * Seeds synthetic Patients and one active primary guardian per Patient for the
 * demo tenant. Global Species/Breed references are resolved from the reference
 * seed and never created here; fixed UUIDs plus `skipDuplicates` keep the path
 * idempotent. Patient and guardian writes share one `$transaction` so the
 * deferred exactly-one-primary constraint is satisfied at COMMIT.
 */
export async function seedDemoPatients(
  db: DemoPatientsSeedClient,
  tenantId: string
): Promise<DemoPatientsSeedResult> {
  const species = await db.species.findUnique({
    where: { code: DEMO_PATIENT_SPECIES_CODE },
    select: { id: true },
  });
  if (!species) {
    throw new Error(
      "demo seed: global species catalog missing — run the reference seed (`db:seed`) before the demo seed"
    );
  }
  const breed = await db.breed.findUnique({
    where: {
      speciesId_code: { speciesId: species.id, code: DEMO_PATIENT_BREED_CODE },
    },
    select: { id: true },
  });

  return db.$transaction(async (tx) => {
    const patients = await tx.patient.createMany({
      data: buildDemoPatients(tenantId, species.id, breed?.id ?? null),
      skipDuplicates: true,
    });
    const guardians = await tx.patientGuardian.createMany({
      data: buildDemoGuardians(tenantId),
      skipDuplicates: true,
    });

    return { patients: patients.count, guardians: guardians.count };
  });
}

/**
 * Transactional delegate scope used inside {@link seedDemoClinical}'s
 * `$transaction`.
 */
export interface DemoClinicalSeedTxClient {
  clinicalEncounter: {
    createMany: (args: {
      data: {
        id: string;
        tenantId: string;
        patientId: string;
        status: "DRAFT" | "CLOSED";
        version?: number;
        reasonForVisit?: string | null;
        anamnesis?: string | null;
        diagnosis?: string | null;
        treatmentPlan?: string | null;
        internalNotes?: string | null;
        clientSummary?: string | null;
      }[];
      skipDuplicates?: boolean;
    }) => Promise<{ count: number }>;
  };
  clinicalWeight: {
    createMany: (args: {
      data: {
        id: string;
        tenantId: string;
        patientId: string;
        /** Positive decimal rendered as a string for exact persistence. */
        quantity: string;
        measuredAt: Date;
      }[];
      skipDuplicates?: boolean;
    }) => Promise<{ count: number }>;
  };
}

/**
 * Structural client contract consumed by {@link seedDemoClinical}. The demo
 * Patient is REFERENCED (created by the patient demo seed), never created here.
 */
export interface DemoClinicalSeedClient extends DemoClinicalSeedTxClient {
  patient: {
    findFirst: (args: {
      where: { id: string; tenantId: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
  $transaction: <T>(fn: (tx: DemoClinicalSeedTxClient) => Promise<T>) => Promise<T>;
}

export interface DemoClinicalSeedResult {
  encounters: number;
  weights: number;
}

/** Fixed clinical fixture ids keep the demo path idempotent. */
const DEMO_CLINICAL_ENCOUNTER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const DEMO_CLINICAL_WEIGHT_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

/** Fixed synthetic timestamp keeps the fixture byte-stable across reruns. */
const DEMO_CLINICAL_MEASURED_AT = new Date("2026-01-15T10:00:00.000Z");

function buildDemoEncounters(tenantId: string, patientId: string) {
  return [
    {
      id: DEMO_CLINICAL_ENCOUNTER_ID,
      tenantId,
      patientId,
      status: "DRAFT" as const,
      version: 1,
      reasonForVisit: "Synthetic annual wellness exam",
      anamnesis: "Synthetic demo anamnesis; no real patient information.",
      diagnosis: "Healthy (synthetic demo)",
      treatmentPlan: "Routine follow-up in one year.",
      internalNotes: "Synthetic demo internal note; staff-only.",
      clientSummary: "Routine wellness visit completed.",
    },
  ];
}

function buildDemoWeights(tenantId: string, patientId: string) {
  return [
    {
      id: DEMO_CLINICAL_WEIGHT_ID,
      tenantId,
      patientId,
      quantity: "12.500",
      measuredAt: DEMO_CLINICAL_MEASURED_AT,
    },
  ];
}

/**
 * Seeds one synthetic clinical encounter and one weight record for the demo
 * tenant, anchored to the fixed demo Patient. Content is clearly synthetic and
 * carries no real PII; fixed UUIDs plus `skipDuplicates` keep the path
 * idempotent, and both writes share one `$transaction`.
 */
export async function seedDemoClinical(
  db: DemoClinicalSeedClient,
  tenantId: string
): Promise<DemoClinicalSeedResult> {
  const patient = await db.patient.findFirst({
    where: { id: DEMO_PATIENT_DOG_ID, tenantId },
    select: { id: true },
  });
  if (!patient) {
    throw new Error(
      "demo seed: demo patient missing — run the patient demo seed before the clinical demo seed"
    );
  }

  return db.$transaction(async (tx) => {
    const encounters = await tx.clinicalEncounter.createMany({
      data: buildDemoEncounters(tenantId, patient.id),
      skipDuplicates: true,
    });
    const weights = await tx.clinicalWeight.createMany({
      data: buildDemoWeights(tenantId, patient.id),
      skipDuplicates: true,
    });

    return { encounters: encounters.count, weights: weights.count };
  });
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
