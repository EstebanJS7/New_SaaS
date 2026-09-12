import type { PrismaClient } from "./generated/index.js";

/**
 * Reference seed data + logic (design D8, spec: rbac-entitlements-seed /
 * Idempotent reference seed).
 *
 * Everything here is inert reference data: roles/permissions are seeded but
 * never consulted by EPIC-01 authorization (authentication + membership only),
 * and no tenant receives an entitlement grant automatically. The executable
 * entrypoint is `prisma/seed.ts`; this module lives under `src/` so it is
 * covered by lint, typecheck and the vitest suites.
 *
 * IDEMPOTENCY CONTRACT: every write is an upsert keyed by the stable natural
 * key (role.code, permission.key, feature_code.code, plan.code and the two
 * compound pair uniques), executed in fixed array order — re-running produces
 * zero diffs.
 */

/** PRD §9 permission naming: two or three lowercase segments `domain.action` or `domain.resource.action`. */
export const PERMISSION_KEY_PATTERN = /^[a-z]+(?:\.[a-z_]+){1,2}$/;

/** PRD §10 feature codes are single lowercase tokens (underscores allowed). */
export const FEATURE_CODE_PATTERN = /^[a-z][a-z_]*$/;

export const ROLE_SEEDS = [
  { code: "OWNER", name: "Owner" },
  { code: "ADMIN", name: "Administrator" },
  { code: "VETERINARIAN", name: "Veterinarian" },
  { code: "RECEPTIONIST", name: "Receptionist" },
  { code: "CASHIER", name: "Cashier" },
  { code: "INVENTORY_MANAGER", name: "Inventory Manager" },
] as const;

export type RoleCode = (typeof ROLE_SEEDS)[number]["code"];

/**
 * Permission catalog (minimal, traceable derivation from PRD §9):
 * - `vet.clinical.create` and `inventory.stock.transfer` are verbatim §9
 *   examples; EPIC-06 expands the `vet.clinical` family with
 *   `read`/`update`/`close`/`amend`;
 * - `cash.session.close`, `fiscal.invoice.issue` and `users.membership.manage`
 *   expand §9's short-form examples (`cash.close`, `fiscal.issue`,
 *   `users.manage`) into strict `domain.resource.action` shape using the
 *   documented aggregates (`POST /cash/sessions/:id/close`, invoice issuing,
 *   tenant memberships);
 * - `scheduling.appointment.manage` covers the receptionist function over the
 *   Core scheduling domain.
 */
export const PERMISSION_SEEDS = [
  { key: "vet.clinical.create", name: "Create clinical records" },
  { key: "vet.clinical.read", name: "Read clinical records" },
  { key: "vet.clinical.update", name: "Update clinical records" },
  { key: "vet.clinical.close", name: "Close clinical encounters" },
  { key: "vet.clinical.amend", name: "Amend clinical encounters" },
  { key: "inventory.stock.transfer", name: "Transfer stock between branches" },
  { key: "cash.session.close", name: "Close cash sessions" },
  { key: "fiscal.invoice.issue", name: "Issue fiscal invoices" },
  { key: "users.membership.manage", name: "Manage staff memberships" },
  { key: "scheduling.appointment.manage", name: "Manage appointments" },
  { key: "sales.settings.manage", name: "Manage sales settings" },
  { key: "branding.settings.manage", name: "Manage tenant branding settings" },
  { key: "customers.read", name: "Read customers" },
  { key: "customers.create", name: "Create customers" },
  { key: "customers.update", name: "Update customers" },
  { key: "customers.deactivate", name: "Deactivate customers" },
  { key: "customers.address.manage", name: "Manage customer addresses" },
  { key: "customers.contact.manage", name: "Manage customer contacts" },
  { key: "patients.read", name: "Read patients" },
  { key: "patients.create", name: "Create patients" },
  { key: "patients.update", name: "Update patients" },
  { key: "patients.deactivate", name: "Deactivate patients" },
  { key: "patients.guardian.manage", name: "Manage patient guardians" },
] as const;

export type PermissionKey = (typeof PERMISSION_SEEDS)[number]["key"];

/**
 * Role→permission matrix. OWNER and ADMIN hold the full minimal set; each
 * operational role holds exactly what its PRD §9 function implies.
 */
export const ROLE_PERMISSION_MATRIX: Record<RoleCode, readonly PermissionKey[]> = {
  OWNER: [
    "vet.clinical.create",
    "vet.clinical.read",
    "vet.clinical.update",
    "vet.clinical.close",
    "vet.clinical.amend",
    "inventory.stock.transfer",
    "cash.session.close",
    "fiscal.invoice.issue",
    "users.membership.manage",
    "scheduling.appointment.manage",
    "sales.settings.manage",
    "branding.settings.manage",
    "customers.read",
    "customers.create",
    "customers.update",
    "customers.deactivate",
    "customers.address.manage",
    "customers.contact.manage",
    "patients.read",
    "patients.create",
    "patients.update",
    "patients.deactivate",
    "patients.guardian.manage",
  ],
  ADMIN: [
    "vet.clinical.create",
    "vet.clinical.read",
    "vet.clinical.update",
    "vet.clinical.close",
    "vet.clinical.amend",
    "inventory.stock.transfer",
    "cash.session.close",
    "fiscal.invoice.issue",
    "users.membership.manage",
    "scheduling.appointment.manage",
    "sales.settings.manage",
    "branding.settings.manage",
    "customers.read",
    "customers.create",
    "customers.update",
    "customers.deactivate",
    "customers.address.manage",
    "customers.contact.manage",
    "patients.read",
    "patients.create",
    "patients.update",
    "patients.deactivate",
    "patients.guardian.manage",
  ],
  VETERINARIAN: [
    "vet.clinical.create",
    "vet.clinical.read",
    "vet.clinical.update",
    "vet.clinical.close",
    "vet.clinical.amend",
    "customers.read",
    "patients.read",
    "patients.create",
    "patients.update",
  ],
  RECEPTIONIST: [
    "scheduling.appointment.manage",
    "customers.read",
    "customers.create",
    "customers.update",
    "customers.address.manage",
    "customers.contact.manage",
    "patients.read",
    "patients.create",
    "patients.update",
    "patients.guardian.manage",
  ],
  CASHIER: ["cash.session.close", "fiscal.invoice.issue"],
  INVENTORY_MANAGER: ["inventory.stock.transfer"],
};

/** The twelve MVP feature codes, verbatim from PRD §10. */
export const FEATURE_CODE_SEEDS = [
  "veterinary",
  "inventory",
  "purchases",
  "sales",
  "cash",
  "billing",
  "fiscal",
  "portal",
  "whatsapp",
  "multi_branch",
  "advanced_reports",
  "custom_branding",
] as const;

/**
 * The single inert starter plan mapped to ALL twelve codes (design D8). Being
 * mapped to a plan grants nothing — only explicit tenant_entitlement rows do.
 */
export const STARTER_PLAN_SEED = { code: "starter", name: "Starter" } as const;

/**
 * GLOBAL veterinary taxonomy catalog (Decision #2211). Species and Breed are
 * system-seeded reference data — never tenant-scoped and never tenant-filtered
 * — mirroring `FeatureCode`/`Role`. `code` is the stable natural key for a
 * Species; a Breed is keyed by `(speciesCode, code)`.
 */
export const SPECIES_SEEDS = [
  { code: "dog", name: "Dog" },
  { code: "cat", name: "Cat" },
  { code: "bird", name: "Bird" },
  { code: "rabbit", name: "Rabbit" },
  { code: "reptile", name: "Reptile" },
  { code: "other", name: "Other" },
] as const;

export type SpeciesCode = (typeof SPECIES_SEEDS)[number]["code"];

export const BREED_SEEDS = [
  { speciesCode: "dog", code: "mixed", name: "Mixed Breed" },
  { speciesCode: "dog", code: "labrador_retriever", name: "Labrador Retriever" },
  { speciesCode: "dog", code: "german_shepherd", name: "German Shepherd" },
  { speciesCode: "cat", code: "mixed", name: "Mixed Breed" },
  { speciesCode: "cat", code: "siamese", name: "Siamese" },
  { speciesCode: "cat", code: "persian", name: "Persian" },
  { speciesCode: "bird", code: "mixed", name: "Mixed Breed" },
  { speciesCode: "rabbit", code: "mixed", name: "Mixed Breed" },
  { speciesCode: "reptile", code: "mixed", name: "Mixed Breed" },
] as const;

export type ReferenceSeedClient = Pick<
  PrismaClient,
  | "role"
  | "permission"
  | "rolePermission"
  | "featureCode"
  | "plan"
  | "planCapability"
  | "species"
  | "breed"
>;

/**
 * Seeds all reference data idempotently. Write order is deterministic:
 * roles → permissions → feature codes → plan → id resolution → pairs →
 * global Species/Breed taxonomy.
 */
export async function seedReferenceData(db: ReferenceSeedClient): Promise<void> {
  for (const role of ROLE_SEEDS) {
    await db.role.upsert({
      where: { code: role.code },
      create: { code: role.code, name: role.name },
      update: {}, // identity-stable rerun: never touch updated_at on unchanged rows
    });
  }

  for (const permission of PERMISSION_SEEDS) {
    await db.permission.upsert({
      where: { key: permission.key },
      create: { key: permission.key, name: permission.name },
      update: {}, // identity-stable rerun: never touch updated_at on unchanged rows
    });
  }

  for (const code of FEATURE_CODE_SEEDS) {
    await db.featureCode.upsert({
      where: { code },
      create: { code },
      update: {},
    });
  }

  await db.plan.upsert({
    where: { code: STARTER_PLAN_SEED.code },
    create: { code: STARTER_PLAN_SEED.code, name: STARTER_PLAN_SEED.name },
    update: {}, // identity-stable rerun: never touch updated_at on unchanged rows
  });

  // Resolve surrogate ids by natural key so pair rows can be written without
  // ever trusting generated UUID ordering.
  const roleIdByCode = new Map<string, string>();
  for (const role of ROLE_SEEDS) {
    const row = await db.role.findUnique({ where: { code: role.code }, select: { id: true } });
    if (!row) {
      throw new Error(`reference seed: role ${role.code} missing after upsert`);
    }
    roleIdByCode.set(role.code, row.id);
  }

  const permissionIdByKey = new Map<string, string>();
  for (const permission of PERMISSION_SEEDS) {
    const row = await db.permission.findUnique({
      where: { key: permission.key },
      select: { id: true },
    });
    if (!row) {
      throw new Error(`reference seed: permission ${permission.key} missing after upsert`);
    }
    permissionIdByKey.set(permission.key, row.id);
  }

  const featureIdByCode = new Map<string, string>();
  for (const code of FEATURE_CODE_SEEDS) {
    const row = await db.featureCode.findUnique({ where: { code }, select: { id: true } });
    if (!row) {
      throw new Error(`reference seed: feature code ${code} missing after upsert`);
    }
    featureIdByCode.set(code, row.id);
  }

  const plan = await db.plan.findUnique({
    where: { code: STARTER_PLAN_SEED.code },
    select: { id: true },
  });
  if (!plan) {
    throw new Error("reference seed: starter plan missing after upsert");
  }

  for (const role of ROLE_SEEDS) {
    const roleId = roleIdByCode.get(role.code);
    for (const key of ROLE_PERMISSION_MATRIX[role.code]) {
      const permissionId = permissionIdByKey.get(key);
      if (!roleId || !permissionId) {
        throw new Error(`reference seed: unresolved ids for ${role.code} / ${key}`);
      }
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        create: { roleId, permissionId },
        update: {},
      });
    }
  }

  for (const code of FEATURE_CODE_SEEDS) {
    const featureCodeId = featureIdByCode.get(code);
    if (!featureCodeId) {
      throw new Error(`reference seed: unresolved id for feature code ${code}`);
    }
    await db.planCapability.upsert({
      where: { planId_featureCodeId: { planId: plan.id, featureCodeId } },
      create: { planId: plan.id, featureCodeId },
      update: {},
    });
  }

  // GLOBAL taxonomy (Decision #2211): species first, then breeds keyed by the
  // resolved species id so the compound natural key is never guessed.
  for (const species of SPECIES_SEEDS) {
    await db.species.upsert({
      where: { code: species.code },
      create: { code: species.code, name: species.name },
      update: {}, // identity-stable rerun: never touch updated_at on unchanged rows
    });
  }

  const speciesIdByCode = new Map<string, string>();
  for (const species of SPECIES_SEEDS) {
    const row = await db.species.findUnique({
      where: { code: species.code },
      select: { id: true },
    });
    if (!row) {
      throw new Error(`reference seed: species ${species.code} missing after upsert`);
    }
    speciesIdByCode.set(species.code, row.id);
  }

  for (const breed of BREED_SEEDS) {
    const speciesId = speciesIdByCode.get(breed.speciesCode);
    if (!speciesId) {
      throw new Error(
        `reference seed: unresolved species id for breed ${breed.speciesCode}/${breed.code}`
      );
    }
    await db.breed.upsert({
      where: { speciesId_code: { speciesId, code: breed.code } },
      create: { speciesId, code: breed.code, name: breed.name },
      update: {},
    });
  }
}
