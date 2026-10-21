import { describe, expect, it } from "vitest";
import {
  BREED_SEEDS,
  FEATURE_CODE_PATTERN,
  FEATURE_CODE_SEEDS,
  PERMISSION_KEY_PATTERN,
  PERMISSION_SEEDS,
  ROLE_PERMISSION_MATRIX,
  ROLE_SEEDS,
  SPECIES_SEEDS,
  STARTER_PLAN_SEED,
  TAX_RATE_SEEDS,
  seedReferenceData,
  PLATFORM_TENANT_SEED,
  type ReferenceSeedClient,
} from "./reference-seed.js";

/**
 * Reference seed contract tests (task 6.1, spec: rbac-entitlements-seed /
 * Idempotent reference seed — scenarios "Seed rerun safe" and "Permission key
 * convention").
 *
 * The suite drives {@link seedReferenceData} against a recording fake client
 * (asserted by contract, not instanceof — the generated PrismaClient
 * constructor returns a Proxy) so idempotency and ordering are proven without
 * a database. CI additionally runs the real seed twice against Postgres and
 * compares row counts (see .github/workflows/ci.yml migrations job).
 */

function createRecordingClient() {
  const calls: string[] = [];
  let counter = 0;
  const nextId = (): string => {
    counter += 1;
    return `generated-uuid-${String(counter).padStart(4, "0")}`;
  };

  interface CodeNameRow {
    id: string;
    code: string;
    name: string;
  }
  interface KeyNameRow {
    id: string;
    key: string;
    name: string;
  }
  interface CodeRow {
    id: string;
    code: string;
  }
  interface TaxRateRow {
    id: string;
    code: string;
    name: string;
    rate: string;
  }
  interface PairRow {
    id: string;
  }
  interface TenantRow {
    id: string;
    slug: string;
    name: string;
  }

  const roles = new Map<string, CodeNameRow>();
  const permissions = new Map<string, KeyNameRow>();
  const featureCodes = new Map<string, CodeRow>();
  const plans = new Map<string, CodeNameRow>();
  const rolePermissions = new Map<string, PairRow>();
  const planCapabilities = new Map<string, PairRow>();
  const species = new Map<string, CodeNameRow>();
  const breeds = new Map<string, CodeRow & { speciesId: string }>();
  const taxRates = new Map<string, TaxRateRow>();
  const tenants = new Map<string, TenantRow>();

  const client = {
    tenant: {
      upsert: (args: { where: { slug: string }; create: { slug: string; name: string } }) => {
        calls.push(`tenant.upsert:${args.where.slug}`);
        const existing = tenants.get(args.where.slug);
        if (existing) {
          existing.name = args.create.name;
        } else {
          tenants.set(args.where.slug, { id: nextId(), ...args.create });
        }
      },
      findUnique: (args: { where: { slug: string } }) => tenants.get(args.where.slug) ?? null,
    },
    role: {
      upsert: (args: { where: { code: string }; create: { code: string; name: string } }) => {
        calls.push(`role.upsert:${args.where.code}`);
        const existing = roles.get(args.where.code);
        if (existing) {
          existing.name = args.create.name;
        } else {
          roles.set(args.where.code, { id: nextId(), ...args.create });
        }
      },
      findUnique: (args: { where: { code: string } }) => roles.get(args.where.code) ?? null,
    },
    permission: {
      upsert: (args: { where: { key: string }; create: { key: string; name: string } }) => {
        calls.push(`permission.upsert:${args.where.key}`);
        const existing = permissions.get(args.where.key);
        if (existing) {
          existing.name = args.create.name;
        } else {
          permissions.set(args.where.key, { id: nextId(), ...args.create });
        }
      },
      findUnique: (args: { where: { key: string } }) => permissions.get(args.where.key) ?? null,
    },
    featureCode: {
      upsert: (args: { where: { code: string }; create: { code: string } }) => {
        calls.push(`featureCode.upsert:${args.where.code}`);
        if (!featureCodes.has(args.where.code)) {
          featureCodes.set(args.where.code, { id: nextId(), code: args.create.code });
        }
      },
      findUnique: (args: { where: { code: string } }) => featureCodes.get(args.where.code) ?? null,
    },
    plan: {
      upsert: (args: { where: { code: string }; create: { code: string; name: string } }) => {
        calls.push(`plan.upsert:${args.where.code}`);
        const existing = plans.get(args.where.code);
        if (existing) {
          existing.name = args.create.name;
        } else {
          plans.set(args.where.code, { id: nextId(), ...args.create });
        }
      },
      findUnique: (args: { where: { code: string } }) => plans.get(args.where.code) ?? null,
    },
    rolePermission: {
      upsert: (args: {
        where: { roleId_permissionId: { roleId: string; permissionId: string } };
      }) => {
        const { roleId, permissionId } = args.where.roleId_permissionId;
        calls.push(`rolePermission.upsert:${roleId}:${permissionId}`);
        const pair = `${roleId}:${permissionId}`;
        if (!rolePermissions.has(pair)) {
          rolePermissions.set(pair, { id: nextId() });
        }
      },
    },
    planCapability: {
      upsert: (args: {
        where: { planId_featureCodeId: { planId: string; featureCodeId: string } };
      }) => {
        const { planId, featureCodeId } = args.where.planId_featureCodeId;
        calls.push(`planCapability.upsert:${planId}:${featureCodeId}`);
        const pair = `${planId}:${featureCodeId}`;
        if (!planCapabilities.has(pair)) {
          planCapabilities.set(pair, { id: nextId() });
        }
      },
    },
    species: {
      upsert: (args: { where: { code: string }; create: { code: string; name: string } }) => {
        calls.push(`species.upsert:${args.where.code}`);
        const existing = species.get(args.where.code);
        if (existing) {
          existing.name = args.create.name;
        } else {
          species.set(args.where.code, { id: nextId(), ...args.create });
        }
      },
      findUnique: (args: { where: { code: string } }) => species.get(args.where.code) ?? null,
    },
    breed: {
      upsert: (args: {
        where: { speciesId_code: { speciesId: string; code: string } };
        create: { speciesId: string; code: string; name: string };
      }) => {
        const { speciesId, code } = args.where.speciesId_code;
        calls.push(`breed.upsert:${speciesId}:${code}`);
        const pair = `${speciesId}:${code}`;
        if (!breeds.has(pair)) {
          breeds.set(pair, { id: nextId(), speciesId, code });
        }
      },
      findUnique: (args: { where: { speciesId_code: { speciesId: string; code: string } } }) => {
        const { speciesId, code } = args.where.speciesId_code;
        return breeds.get(`${speciesId}:${code}`) ?? null;
      },
    },
    taxRate: {
      upsert: (args: {
        where: { code: string };
        create: { code: string; name: string; rate: string };
      }) => {
        calls.push(`taxRate.upsert:${args.where.code}`);
        const existing = taxRates.get(args.where.code);
        if (existing) {
          existing.name = args.create.name;
          existing.rate = args.create.rate;
        } else {
          taxRates.set(args.where.code, { id: nextId(), ...args.create });
        }
      },
      findUnique: (args: { where: { code: string } }) => taxRates.get(args.where.code) ?? null,
    },
  };

  const counts = () => ({
    tenants: tenants.size,
    roles: roles.size,
    permissions: permissions.size,
    featureCodes: featureCodes.size,
    plans: plans.size,
    rolePermissions: rolePermissions.size,
    planCapabilities: planCapabilities.size,
    species: species.size,
    breeds: breeds.size,
    taxRates: taxRates.size,
  });

  return { calls, counts, client, taxRates };
}

/** Contract cast: the recording fake satisfies the delegates the seed touches. */
const asSeedClient = (client: object): ReferenceSeedClient => client as ReferenceSeedClient;

async function seededOnce() {
  const fake = createRecordingClient();
  await seedReferenceData(asSeedClient(fake.client));
  return fake;
}

describe("reference seed · catalog contents (PRD §9 / §10)", () => {
  it("seeds exactly the six PRD §9 roles", () => {
    expect(ROLE_SEEDS.map((role) => role.code)).toEqual([
      "OWNER",
      "ADMIN",
      "VETERINARIAN",
      "RECEPTIONIST",
      "CASHIER",
      "INVENTORY_MANAGER",
    ]);
  });

  it("formats every permission key as domain.action or domain.resource.action", () => {
    for (const permission of PERMISSION_SEEDS) {
      expect(permission.key).toMatch(PERMISSION_KEY_PATTERN);
    }
    for (const keys of Object.values(ROLE_PERMISSION_MATRIX)) {
      for (const key of keys) {
        expect(key).toMatch(PERMISSION_KEY_PATTERN);
      }
    }
  });

  it("seeds exactly the twelve PRD §10 feature codes in canonical format", () => {
    expect(FEATURE_CODE_SEEDS).toEqual([
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
    ]);
    for (const code of FEATURE_CODE_SEEDS) {
      expect(code).toMatch(FEATURE_CODE_PATTERN);
    }
  });

  it("binds every catalog permission to at least one role without orphans", () => {
    const assigned = new Set<string>();
    for (const [roleCode, keys] of Object.entries(ROLE_PERMISSION_MATRIX)) {
      expect(keys.length, `role ${roleCode} must hold at least one permission`).toBeGreaterThan(0);
      for (const key of keys) {
        assigned.add(key);
      }
    }
    expect([...assigned].sort()).toEqual(PERMISSION_SEEDS.map((p) => p.key).sort());
  });

  it("grants sales.settings.manage to OWNER and ADMIN only", () => {
    expect(ROLE_PERMISSION_MATRIX.OWNER).toContain("sales.settings.manage");
    expect(ROLE_PERMISSION_MATRIX.ADMIN).toContain("sales.settings.manage");
    for (const roleCode of [
      "VETERINARIAN",
      "RECEPTIONIST",
      "CASHIER",
      "INVENTORY_MANAGER",
    ] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain("sales.settings.manage");
    }
  });

  it("grants branding.settings.manage to OWNER and ADMIN only", () => {
    expect(ROLE_PERMISSION_MATRIX.OWNER).toContain("branding.settings.manage");
    expect(ROLE_PERMISSION_MATRIX.ADMIN).toContain("branding.settings.manage");
    for (const roleCode of [
      "VETERINARIAN",
      "RECEPTIONIST",
      "CASHIER",
      "INVENTORY_MANAGER",
    ] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain("branding.settings.manage");
    }
  });

  it("grants the customer baseline matrix", () => {
    expect(ROLE_PERMISSION_MATRIX.OWNER).toEqual(
      expect.arrayContaining([
        "customers.read",
        "customers.create",
        "customers.update",
        "customers.deactivate",
        "customers.address.manage",
        "customers.contact.manage",
      ])
    );
    expect(ROLE_PERMISSION_MATRIX.ADMIN).toEqual(
      expect.arrayContaining([
        "customers.read",
        "customers.create",
        "customers.update",
        "customers.deactivate",
        "customers.address.manage",
        "customers.contact.manage",
      ])
    );
    expect(ROLE_PERMISSION_MATRIX.RECEPTIONIST).toEqual(
      expect.arrayContaining([
        "customers.read",
        "customers.create",
        "customers.update",
        "customers.address.manage",
        "customers.contact.manage",
      ])
    );
    expect(ROLE_PERMISSION_MATRIX.RECEPTIONIST).not.toContain("customers.deactivate");
    expect(ROLE_PERMISSION_MATRIX.VETERINARIAN).toEqual([
      "inventory.stock.read",
      "vet.clinical.create",
      "vet.clinical.read",
      "vet.clinical.update",
      "vet.clinical.close",
      "vet.clinical.amend",
      "scheduling.appointment.read",
      "scheduling.appointment.transition",
      "customers.read",
      "patients.read",
      "patients.create",
      "patients.update",
      "catalog.read",
      "suppliers.read",
      "purchases.read",
      "sales.read",
      "notifications.delivery.read",
      "cash.read",
      "billing.read",
      "fiscal.read",
      "reports.read",
      "imports.read",
    ]);
    for (const roleCode of ["CASHIER", "INVENTORY_MANAGER"] as const) {
      for (const key of [
        "customers.read",
        "customers.create",
        "customers.update",
        "customers.deactivate",
        "customers.address.manage",
        "customers.contact.manage",
      ]) {
        expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain(key);
      }
    }
  });

  it("seeds the patient permission catalog and baseline matrix (EPIC-05 PAT-001)", () => {
    const patientKeys = [
      "patients.read",
      "patients.create",
      "patients.update",
      "patients.deactivate",
      "patients.guardian.manage",
    ] as const;
    const catalogKeys = PERMISSION_SEEDS.map((permission) => permission.key);
    for (const key of patientKeys) {
      expect(catalogKeys).toContain(key);
      expect(key).toMatch(PERMISSION_KEY_PATTERN);
    }

    expect(ROLE_PERMISSION_MATRIX.OWNER).toEqual(expect.arrayContaining([...patientKeys]));
    expect(ROLE_PERMISSION_MATRIX.ADMIN).toEqual(expect.arrayContaining([...patientKeys]));
    expect(ROLE_PERMISSION_MATRIX.RECEPTIONIST).toEqual(
      expect.arrayContaining([
        "patients.read",
        "patients.create",
        "patients.update",
        "patients.guardian.manage",
      ])
    );
    // Front-desk owns linking/deactivation; vets register/edit identity only.
    expect(ROLE_PERMISSION_MATRIX.RECEPTIONIST).not.toContain("patients.deactivate");
    expect(ROLE_PERMISSION_MATRIX.VETERINARIAN).toEqual(
      expect.arrayContaining(["patients.read", "patients.create", "patients.update"])
    );
    expect(ROLE_PERMISSION_MATRIX.VETERINARIAN).not.toContain("patients.deactivate");
    expect(ROLE_PERMISSION_MATRIX.VETERINARIAN).not.toContain("patients.guardian.manage");
    for (const roleCode of ["CASHIER", "INVENTORY_MANAGER"] as const) {
      for (const key of patientKeys) {
        expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain(key);
      }
    }
  });

  it("seeds the clinical permission catalog and baseline matrix (EPIC-06 CLI)", () => {
    const clinicalKeys = [
      "vet.clinical.create",
      "vet.clinical.read",
      "vet.clinical.update",
      "vet.clinical.close",
      "vet.clinical.amend",
    ] as const;
    const catalogKeys = PERMISSION_SEEDS.map((permission) => permission.key);
    for (const key of clinicalKeys) {
      expect(catalogKeys).toContain(key);
      expect(key).toMatch(PERMISSION_KEY_PATTERN);
    }

    // Clinical authority is held by the owner, the admin and the veterinarian.
    for (const roleCode of ["OWNER", "ADMIN", "VETERINARIAN"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toEqual(expect.arrayContaining([...clinicalKeys]));
    }
    // Front-desk, cash and inventory roles never hold clinical authority.
    for (const roleCode of ["RECEPTIONIST", "CASHIER", "INVENTORY_MANAGER"] as const) {
      for (const key of clinicalKeys) {
        expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain(key);
      }
    }
  });

  it("seeds the catalog permission catalog and decided matrix (EPIC-09 WU2)", () => {
    const catalogPermissionKeys = [
      "catalog.read",
      "catalog.create",
      "catalog.update",
      "catalog.deactivate",
    ] as const;
    const seededKeys = PERMISSION_SEEDS.map((permission) => permission.key);
    for (const key of catalogPermissionKeys) {
      expect(seededKeys).toContain(key);
      expect(key).toMatch(PERMISSION_KEY_PATTERN);
    }

    // Maintainer matrix (2026-09-25): the catalog is the inventory domain, so
    // the owner, the admin and the inventory manager hold all four keys.
    for (const roleCode of ["OWNER", "ADMIN", "INVENTORY_MANAGER"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toEqual(
        expect.arrayContaining([...catalogPermissionKeys])
      );
    }
    // Front-desk, veterinary and cash roles read the catalog but never write
    // it; the three write keys stay withheld from every non-owning role.
    const writeKeys = ["catalog.create", "catalog.update", "catalog.deactivate"] as const;
    for (const roleCode of ["VETERINARIAN", "RECEPTIONIST", "CASHIER"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toContain("catalog.read");
      for (const key of writeKeys) {
        expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain(key);
      }
    }
  });

  it("seeds the inventory stock permission catalog and decided matrix (EPIC-10 WU1)", () => {
    const inventoryKeys = ["inventory.stock.read", "inventory.stock.adjust"] as const;
    const seededKeys = PERMISSION_SEEDS.map((permission) => permission.key);
    for (const key of inventoryKeys) {
      expect(seededKeys).toContain(key);
      expect(key).toMatch(PERMISSION_KEY_PATTERN);
    }

    // Maintainer matrix (2026-09-25): the owning roles adjust stock; every
    // operational role reads it.
    for (const roleCode of ["OWNER", "ADMIN", "INVENTORY_MANAGER"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toEqual(
        expect.arrayContaining(["inventory.stock.read", "inventory.stock.adjust"])
      );
    }
    for (const roleCode of ["VETERINARIAN", "RECEPTIONIST", "CASHIER"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toContain("inventory.stock.read");
      expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain("inventory.stock.adjust");
    }
    // The pre-existing transfer key keeps its EPIC-01 ownership unchanged.
    for (const roleCode of ["OWNER", "ADMIN", "INVENTORY_MANAGER"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toContain("inventory.stock.transfer");
    }
    for (const roleCode of ["VETERINARIAN", "RECEPTIONIST", "CASHIER"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain("inventory.stock.transfer");
    }
  });

  it("seeds the supplier permission catalog and decided matrix (EPIC-11 WU1)", () => {
    const supplierPermissionKeys = [
      "suppliers.read",
      "suppliers.create",
      "suppliers.update",
      "suppliers.deactivate",
    ] as const;
    const seededKeys = PERMISSION_SEEDS.map((permission) => permission.key);
    for (const key of supplierPermissionKeys) {
      expect(seededKeys).toContain(key);
      expect(key).toMatch(PERMISSION_KEY_PATTERN);
    }

    // Maintainer matrix (DEC-016, 2026-09-26): every operational role reads
    // suppliers; only the owner, the admin and the inventory manager write
    // them. No entitlement gate applies — suppliers are a Core capability.
    for (const roleCode of ["OWNER", "ADMIN", "INVENTORY_MANAGER"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toEqual(
        expect.arrayContaining([...supplierPermissionKeys])
      );
    }
    const supplierWriteKeys = [
      "suppliers.create",
      "suppliers.update",
      "suppliers.deactivate",
    ] as const;
    for (const roleCode of ["VETERINARIAN", "RECEPTIONIST", "CASHIER"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toContain("suppliers.read");
      for (const key of supplierWriteKeys) {
        expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain(key);
      }
    }
    // The `purchases` entitlement is deliberately NOT consulted (DEC-016).
    expect(FEATURE_CODE_SEEDS).toContain("purchases");
  });

  it("seeds the purchase permission catalog and decided matrix (EPIC-11 PUR-001/PUR-002)", () => {
    const purchasePermissionKeys = [
      "purchases.read",
      "purchases.create",
      "purchases.update",
      "purchases.cancel",
      "purchases.receive",
    ] as const;
    const seededKeys = PERMISSION_SEEDS.map((permission) => permission.key);
    for (const key of purchasePermissionKeys) {
      expect(seededKeys).toContain(key);
      expect(key).toMatch(PERMISSION_KEY_PATTERN);
    }

    // Maintainer matrix (DEC-016, 2026-09-26): every operational role reads
    // purchases; only the owner, the admin and the inventory manager hold the
    // four write keys, `purchases.receive` included. These five keys are the
    // DEC-016 total of 43.
    for (const roleCode of ["OWNER", "ADMIN", "INVENTORY_MANAGER"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toEqual(
        expect.arrayContaining([...purchasePermissionKeys])
      );
    }
    const purchaseWriteKeys = [
      "purchases.create",
      "purchases.update",
      "purchases.cancel",
      "purchases.receive",
    ] as const;
    for (const roleCode of ["VETERINARIAN", "RECEPTIONIST", "CASHIER"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toContain("purchases.read");
      for (const key of purchaseWriteKeys) {
        expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain(key);
      }
    }
  });

  it("seeds the sale permission catalog and decided matrix (EPIC-12 POS-001)", () => {
    const salePermissionKeys = [
      "sales.read",
      "sales.create",
      "sales.update",
      "sales.cancel",
    ] as const;
    const seededKeys = PERMISSION_SEEDS.map((permission) => permission.key);
    for (const key of salePermissionKeys) {
      expect(seededKeys).toContain(key);
      expect(key).toMatch(PERMISSION_KEY_PATTERN);
    }

    // Maintainer matrix (DEC-026, 2026-09-27): all six roles read sales; only
    // the owner, the admin and the cashier hold the three write keys. Unlike
    // the catalog/inventory/purchases Core precedent, the sales surface is ALSO
    // gated on the `sales` entitlement (DEC-026); that second gate is asserted
    // in the API slice where the guard actually runs.
    for (const roleCode of ["OWNER", "ADMIN", "CASHIER"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toEqual(
        expect.arrayContaining([...salePermissionKeys])
      );
    }
    const saleWriteKeys = ["sales.create", "sales.update", "sales.cancel"] as const;
    for (const roleCode of ["VETERINARIAN", "RECEPTIONIST", "INVENTORY_MANAGER"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toContain("sales.read");
      for (const key of saleWriteKeys) {
        expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain(key);
      }
    }
    // POS-003 owns `sales.complete`. It was deliberately absent while POS-001
    // shipped and is seeded by the POS-003 slice; its matrix is asserted in the
    // POS-003 family test below. POS-002 owns the `cash.*` keys, which are
    // seeded by its own slice and asserted in the cash family test below.
    expect(seededKeys).toContain("sales.complete");
    // The pre-existing close key stays reserved for EPIC-13 (DEC-026).
    expect(seededKeys).toContain("cash.session.close");
  });

  it("seeds the cash permission catalog and decided matrix (EPIC-12 POS-002)", () => {
    const cashPermissionKeys = ["cash.read", "cash.register.create", "cash.session.open"] as const;
    const seededKeys = PERMISSION_SEEDS.map((permission) => permission.key);
    for (const key of cashPermissionKeys) {
      expect(seededKeys).toContain(key);
      expect(key).toMatch(PERMISSION_KEY_PATTERN);
    }

    // Maintainer matrix (DEC-026 and its 2026-09-29 subsequent-scope note): all
    // six roles read cash — the DEC-016 read-wide shape — and only the owner,
    // the admin and the cashier create registers and open sessions. The cash
    // surface is ALSO gated on the `cash` entitlement rather than on `sales`;
    // that second gate is asserted in the API slice where the guard actually
    // runs.
    for (const roleCode of [
      "OWNER",
      "ADMIN",
      "VETERINARIAN",
      "RECEPTIONIST",
      "CASHIER",
      "INVENTORY_MANAGER",
    ] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toContain("cash.read");
    }
    for (const roleCode of ["OWNER", "ADMIN", "CASHIER"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toEqual(
        expect.arrayContaining(["cash.register.create", "cash.session.open"])
      );
    }
    const cashWriteKeys = ["cash.register.create", "cash.session.open"] as const;
    for (const roleCode of ["VETERINARIAN", "RECEPTIONIST", "INVENTORY_MANAGER"] as const) {
      for (const key of cashWriteKeys) {
        expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain(key);
      }
    }
    // EPIC-13 keeps the close command: this slice must not re-scope it, and the
    // `cash` capability already exists as a feature code (PRD §10).
    expect(seededKeys).toContain("cash.session.close");
    expect(FEATURE_CODE_SEEDS).toContain("cash");
  });

  it("seeds the sale completion permission and decided matrix (EPIC-12 POS-003)", () => {
    const completionPermissionKeys = ["sales.complete"] as const;
    const seededKeys = PERMISSION_SEEDS.map((permission) => permission.key);
    for (const key of completionPermissionKeys) {
      expect(seededKeys).toContain(key);
      expect(key).toMatch(PERMISSION_KEY_PATTERN);
    }

    // Maintainer matrix (DEC-026 and its 2026-09-29 subsequent-scope note):
    // completion is the command that writes money, stock and cash, so it
    // follows the read-wide/write-to-the-owning-roles shape — the owner, the
    // admin and the cashier hold it, and no other role does. The `sales`
    // entitlement is the second gate and is asserted in the API slice where the
    // guard actually runs.
    for (const roleCode of ["OWNER", "ADMIN", "CASHIER"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toContain("sales.complete");
    }
    for (const roleCode of ["VETERINARIAN", "RECEPTIONIST", "INVENTORY_MANAGER"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain("sales.complete");
    }
    // The pre-existing close key stays reserved for EPIC-13: this slice must not
    // re-scope it.
    expect(seededKeys).toContain("cash.session.close");
  });

  it("seeds the cash movement permission and decided matrix (EPIC-13 CASH-002)", () => {
    const movementPermissionKey = "cash.movement.create";
    const seededKeys = PERMISSION_SEEDS.map((permission) => permission.key);
    expect(seededKeys).toContain(movementPermissionKey);
    expect(movementPermissionKey).toMatch(PERMISSION_KEY_PATTERN);

    // Maintainer matrix (DEC-034, 2026-09-29): a standalone movement writes money
    // into the immutable cash ledger, so it follows the existing cash write shape
    // — the owner, the admin and the cashier hold it and no other role does. It
    // is a Cash-domain key, so the `cash` capability is the second gate and is
    // asserted in the API slice where the guard actually runs.
    for (const roleCode of ["OWNER", "ADMIN", "CASHIER"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toContain(movementPermissionKey);
    }
    for (const roleCode of ["VETERINARIAN", "RECEPTIONIST", "INVENTORY_MANAGER"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain(movementPermissionKey);
    }
    // DEC-034 moves the seeded catalog 51 -> 52; the pre-existing close key is
    // consumed by CASH-003 and is neither added nor re-counted here.
    expect(seededKeys).toContain("cash.session.close");
    expect(FEATURE_CODE_SEEDS).toContain("cash");
  });

  it("seeds the reports permissions and decided matrix (EPIC-18 REP-002)", () => {
    const seededKeys = PERMISSION_SEEDS.map((permission) => permission.key);
    for (const key of ["reports.read", "reports.export"] as const) {
      expect(seededKeys).toContain(key);
      expect(key).toMatch(PERMISSION_KEY_PATTERN);
    }

    // DEC-062: reports are NOT gated by a feature code, so the family is guarded
    // by permissions alone. `reports.read` follows the read-wide shape every
    // other `*.read` key has: all six roles see the tenant's own aggregates.
    for (const roleCode of [
      "OWNER",
      "ADMIN",
      "VETERINARIAN",
      "RECEPTIONIST",
      "CASHIER",
      "INVENTORY_MANAGER",
    ] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toContain("reports.read");
    }

    // `reports.export` is EXACTLY the two owning roles: reading an aggregate on
    // screen and taking a file out of the system are different decisions, and a
    // CSV leaves the tenant's boundary.
    for (const roleCode of ["OWNER", "ADMIN"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toContain("reports.export");
    }
    for (const roleCode of [
      "VETERINARIAN",
      "RECEPTIONIST",
      "CASHIER",
      "INVENTORY_MANAGER",
    ] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain("reports.export");
    }

    // DEC-062 leaves `advanced_reports` unspent and adds NO thirteenth code.
    expect(FEATURE_CODE_SEEDS).toHaveLength(12);
    expect(FEATURE_CODE_SEEDS).toContain("advanced_reports");
  });

  it("seeds the imports permissions and decided matrix (EPIC-19 IMP-001)", () => {
    const seededKeys = PERMISSION_SEEDS.map((permission) => permission.key);
    for (const key of ["imports.read", "imports.run"] as const) {
      expect(seededKeys).toContain(key);
      expect(key).toMatch(PERMISSION_KEY_PATTERN);
    }

    // DEC-072: importing is NOT gated by a feature code (a thirteenth code was
    // refused after DEC-058 and DEC-062 refused the same move), so the family is
    // guarded by permissions alone. `imports.read` follows the read-wide shape
    // every other `*.read` key has: all six roles see the tenant's own imports.
    for (const roleCode of [
      "OWNER",
      "ADMIN",
      "VETERINARIAN",
      "RECEPTIONIST",
      "CASHIER",
      "INVENTORY_MANAGER",
    ] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toContain("imports.read");
    }

    // `imports.run` is EXACTLY the two owning roles. It is the one action that
    // creates hundreds of records in one command, so it is the action an
    // operator should be deliberate about.
    for (const roleCode of ["OWNER", "ADMIN"] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).toContain("imports.run");
    }
    for (const roleCode of [
      "VETERINARIAN",
      "RECEPTIONIST",
      "CASHIER",
      "INVENTORY_MANAGER",
    ] as const) {
      expect(ROLE_PERMISSION_MATRIX[roleCode]).not.toContain("imports.run");
    }

    // DEC-072 leaves the twelve codes untouched: importing is a staff action
    // over data the tenant already owns, not an entitlement.
    expect(FEATURE_CODE_SEEDS).toHaveLength(12);
    expect(FEATURE_CODE_SEEDS).not.toContain("imports");
  });

  it("seeds the global Species/Breed taxonomy without tenant scoping (Decision #2211)", () => {
    expect(SPECIES_SEEDS.map((species) => species.code)).toEqual([
      "dog",
      "cat",
      "bird",
      "rabbit",
      "reptile",
      "other",
    ]);
    for (const species of SPECIES_SEEDS) {
      expect(species.code).toMatch(/^[a-z][a-z_]*$/);
    }
    const speciesCodes = new Set<string>(SPECIES_SEEDS.map((species) => species.code));
    for (const breed of BREED_SEEDS) {
      expect(speciesCodes.has(breed.speciesCode)).toBe(true);
      expect(breed.code).toMatch(/^[a-z][a-z_]*$/);
    }
    // Each breed belongs to exactly one species; the natural key is unique.
    const pairKeys = BREED_SEEDS.map((breed) => `${breed.speciesCode}/${breed.code}`);
    expect(new Set(pairKeys).size).toBe(BREED_SEEDS.length);
  });

  it("ships the single inert starter plan", () => {
    expect(STARTER_PLAN_SEED.code).toBe("starter");
  });

  it("seeds the three global Paraguay tax rates as reference data (PRD §15, EPIC-09)", () => {
    expect(TAX_RATE_SEEDS.map((taxRate) => taxRate.code)).toEqual(["EXEMPT", "IVA_5", "IVA_10"]);
    expect(TAX_RATE_SEEDS.map((taxRate) => taxRate.rate)).toEqual(["0.00", "5.00", "10.00"]);
    for (const taxRate of TAX_RATE_SEEDS) {
      // `rate` matches the Decimal(5, 2) column: at most three integer digits
      // and exactly two decimals, written as a literal to avoid float drift.
      expect(taxRate.rate).toMatch(/^\d{1,3}\.\d{2}$/);
      expect(taxRate.name.length).toBeGreaterThan(0);
    }
    // The natural key is unique, so the upsert is deterministic.
    const codes = TAX_RATE_SEEDS.map((taxRate) => taxRate.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("reference seed · idempotency (spec scenario: Seed rerun safe)", () => {
  it("writes the expected row volumes", async () => {
    const expectedPairs = Object.values(ROLE_PERMISSION_MATRIX).reduce(
      (total, keys) => total + keys.length,
      0
    );
    const fake = await seededOnce();
    expect(fake.counts()).toEqual({
      roles: 6,
      // 26 pre-EPIC-08 keys + portal.access.manage + portal.settings.manage +
      // the four catalog.* keys added by EPIC-09 WU2 (the earlier "24" was an
      // arithmetic slip in the EPIC-08 commit; 26 + 2 = 28 was the real sum) +
      // the two inventory.stock.* keys added by EPIC-10 WU1 + the four
      // suppliers.* keys added by EPIC-11 WU1 + the five purchases.* keys added
      // by EPIC-11 PUR-001/PUR-002. The fifth purchase key, `purchases.receive`,
      // completed the DEC-016 total of 43, and the four sales.* keys added by
      // EPIC-12 POS-001 moved the seeded catalog to 47. EPIC-12 POS-002 adds
      // `cash.read`, `cash.register.create` and `cash.session.open`, moving it to
      // 50; POS-003's `sales.complete` completes the epic's 43 -> 51 total and
      // moves the probe to 51.
      // EPIC-13 CASH-002 adds `cash.movement.create` (DEC-034), the standalone
      // non-sale movement command key, moving the seeded catalog 51 -> 52.
      // EPIC-14 BILL-001 adds the four `billing.*` keys (DEC-040), moving it
      // 52 -> 56. FISC-005b adds read-wide `fiscal.read` (D7), moving 56 -> 57.
      // FISC-007 adds `fiscal.signing_material.manage` for the two owning roles
      // (DEC-053/ADR-005), moving 57 -> 58. FISC-011 adds
      // `fiscal.profile.manage` (58 -> 59), and FISC-016 WU-D adds
      // `fiscal.range.void` for the same two roles, moving 59 -> 60: retiring a
      // range locally and telling the tax administration its numbers will never
      // be used are different acts with different blast radii. NOTIF-003 WU-D1
      // adds `notifications.settings.manage` for the same two roles, moving
      // 60 -> 61: the reminder's policy is tenant configuration like every other
      // namespace's, and DEC-058 keeps it off the feature catalog. NOTIF-004 adds
      // `notifications.delivery.read` for ALL SIX roles -- the same reach every
      // other `*.read` key has -- moving 61 -> 62. EPIC-18 REP-002 adds the
      // two-key `reports` family (DEC-062): `reports.read` is read-wide like
      // every other `*.read` key and `reports.export` is held by the two owning
      // roles only, moving 62 -> 64. EPIC-19 IMP-001 adds the two-key `imports`
      // family (DEC-072): `imports.read` is read-wide like every other `*.read`
      // key, and `imports.run` — the one command that creates hundreds of
      // records in one go — is held by the two owning roles only, moving
      // 64 -> 66.
      // DAT-007: the platform tenant owns identity-scoped messages (a staff
      // password-recovery email), because the delivery aggregate's tenant_id is
      // NOT NULL and the reset belongs to an IDENTITY rather than to a customer.
      tenants: 1,
      permissions: 66,
      featureCodes: 12,
      plans: 1,
      rolePermissions: expectedPairs,
      planCapabilities: FEATURE_CODE_SEEDS.length,
      species: SPECIES_SEEDS.length,
      breeds: BREED_SEEDS.length,
      taxRates: TAX_RATE_SEEDS.length,
    });
  });

  it("upserts the three global tax rates by natural code, after the taxonomy", async () => {
    const fake = await seededOnce();
    const expectedRateCalls = TAX_RATE_SEEDS.map((taxRate) => `taxRate.upsert:${taxRate.code}`);
    expect(fake.calls.filter((call) => call.startsWith("taxRate."))).toEqual(expectedRateCalls);

    // Global reference data: keyed by the stable code, never by a tenant or a
    // generated id, and the persisted Decimal(5, 2) literal is the seeded one.
    for (const call of fake.calls.filter((entry) => entry.startsWith("taxRate."))) {
      expect(call).not.toContain("generated-uuid");
      expect(call).not.toContain("tenant");
    }
    expect(fake.taxRates.size).toBe(TAX_RATE_SEEDS.length);
    for (const taxRate of TAX_RATE_SEEDS) {
      expect(fake.taxRates.get(taxRate.code)).toMatchObject({
        code: taxRate.code,
        name: taxRate.name,
        rate: taxRate.rate,
      });
    }
  });

  it("re-runs the tax-rate upserts identically without duplicating a rate", async () => {
    const fake = createRecordingClient();
    const db = asSeedClient(fake.client);

    await seedReferenceData(db);
    const expectedRateCalls = TAX_RATE_SEEDS.map((taxRate) => `taxRate.upsert:${taxRate.code}`);
    const firstRunRateCalls = fake.calls.filter((call) => call.startsWith("taxRate."));
    const firstRunIds = TAX_RATE_SEEDS.map((taxRate) => fake.taxRates.get(taxRate.code)?.id);
    // Non-vacuity: the first run really wrote all three rates.
    expect(firstRunRateCalls).toEqual(expectedRateCalls);
    expect(firstRunIds.every((id) => id !== undefined)).toBe(true);

    await seedReferenceData(db);

    const allRateCalls = fake.calls.filter((call) => call.startsWith("taxRate."));
    expect(allRateCalls.slice(firstRunRateCalls.length)).toEqual(firstRunRateCalls);
    expect(fake.taxRates.size).toBe(TAX_RATE_SEEDS.length);
    // Identity-stable: the rerun reused the same rows instead of re-creating them.
    expect(TAX_RATE_SEEDS.map((taxRate) => fake.taxRates.get(taxRate.code)?.id)).toEqual(
      firstRunIds
    );
  });

  it("re-running produces zero diffs: no new rows, identical upsert pattern", async () => {
    const fake = createRecordingClient();
    const db = asSeedClient(fake.client);

    await seedReferenceData(db);
    const firstRunCalls = [...fake.calls];
    const firstRunCounts = fake.counts();

    await seedReferenceData(db);

    expect(fake.counts()).toEqual(firstRunCounts);
    expect(fake.calls.slice(firstRunCalls.length)).toEqual(firstRunCalls);
  });

  it("upserts top-level records by natural keys, never generated ids", async () => {
    // Pair tables (role_permission / plan_capability) legitimately address rows
    // through their compound FK uniques after resolving ids by natural key;
    // Breed likewise resolves its parent species id from the species natural
    // key. Every other top-level entity must target its stable code/key
    // directly.
    const fake = await seededOnce();
    const topLevelCalls = fake.calls.filter(
      (call) =>
        !call.startsWith("rolePermission.") &&
        !call.startsWith("planCapability.") &&
        !call.startsWith("breed.")
    );
    expect(topLevelCalls.length).toBeGreaterThan(0);
    for (const call of topLevelCalls) {
      expect(call.includes("generated-uuid")).toBe(false);
    }
  });

  it("never writes tenant entitlements — grants stay explicit", async () => {
    const fake = await seededOnce();
    for (const call of fake.calls) {
      expect(call.includes("tenantEntitlement")).toBe(false);
    }
  });

  it("executes deterministic orderings across independent runs", async () => {
    const first = await seededOnce();
    const second = await seededOnce();
    expect(first.calls).toEqual(second.calls);
    // DAT-007 put the platform tenant FIRST: it is the destination of
    // identity-scoped messages, so a deployment that forgot it should fail at seed
    // time rather than on the first password recovery.
    expect(first.calls[0]).toBe(`tenant.upsert:${PLATFORM_TENANT_SEED.slug}`);
    expect(first.calls.slice(1, ROLE_SEEDS.length + 1)).toEqual(
      ROLE_SEEDS.map((role) => `role.upsert:${role.code}`)
    );
  });
});
