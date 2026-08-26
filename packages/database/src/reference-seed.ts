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

/** PRD §9 permission naming: three lowercase segments `domain.resource.action`. */
export const PERMISSION_KEY_PATTERN = /^[a-z]+\.[a-z_]+\.[a-z_]+$/;

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
 *   examples;
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
  { key: "inventory.stock.transfer", name: "Transfer stock between branches" },
  { key: "cash.session.close", name: "Close cash sessions" },
  { key: "fiscal.invoice.issue", name: "Issue fiscal invoices" },
  { key: "users.membership.manage", name: "Manage staff memberships" },
  { key: "scheduling.appointment.manage", name: "Manage appointments" },
  { key: "sales.settings.manage", name: "Manage sales settings" },
] as const;

export type PermissionKey = (typeof PERMISSION_SEEDS)[number]["key"];

/**
 * Role→permission matrix. OWNER and ADMIN hold the full minimal set; each
 * operational role holds exactly what its PRD §9 function implies.
 */
export const ROLE_PERMISSION_MATRIX: Record<RoleCode, readonly PermissionKey[]> = {
  OWNER: [
    "vet.clinical.create",
    "inventory.stock.transfer",
    "cash.session.close",
    "fiscal.invoice.issue",
    "users.membership.manage",
    "scheduling.appointment.manage",
    "sales.settings.manage",
  ],
  ADMIN: [
    "vet.clinical.create",
    "inventory.stock.transfer",
    "cash.session.close",
    "fiscal.invoice.issue",
    "users.membership.manage",
    "scheduling.appointment.manage",
    "sales.settings.manage",
  ],
  VETERINARIAN: ["vet.clinical.create"],
  RECEPTIONIST: ["scheduling.appointment.manage"],
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

export type ReferenceSeedClient = Pick<
  PrismaClient,
  "role" | "permission" | "rolePermission" | "featureCode" | "plan" | "planCapability"
>;

/**
 * Seeds all reference data idempotently. Write order is deterministic:
 * roles → permissions → feature codes → plan → id resolution → pairs.
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
}
