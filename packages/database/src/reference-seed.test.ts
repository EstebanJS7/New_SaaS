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

  const roles = new Map<string, CodeNameRow>();
  const permissions = new Map<string, KeyNameRow>();
  const featureCodes = new Map<string, CodeRow>();
  const plans = new Map<string, CodeNameRow>();
  const rolePermissions = new Map<string, PairRow>();
  const planCapabilities = new Map<string, PairRow>();
  const species = new Map<string, CodeNameRow>();
  const breeds = new Map<string, CodeRow & { speciesId: string }>();
  const taxRates = new Map<string, TaxRateRow>();

  const client = {
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
      // arithmetic slip in the EPIC-08 commit; 26 + 2 = 28 was the real sum).
      permissions: 32,
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
    expect(first.calls.slice(0, ROLE_SEEDS.length)).toEqual(
      ROLE_SEEDS.map((role) => `role.upsert:${role.code}`)
    );
  });
});
