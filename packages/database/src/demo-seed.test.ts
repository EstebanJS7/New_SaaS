import { describe, expect, it } from "vitest";
import {
  DEMO_FEATURE_GRANTS,
  DEMO_OWNER_EMAIL,
  DEMO_TENANT_SLUG,
  resolveDemoSeedGuard,
  seedDemoCustomers,
  seedDemoData,
  type DemoCustomersSeedClient,
  type DemoSeedClient,
} from "./demo-seed.js";

/**
 * Guard truth table (spec scenarios: "Demo seed opt-in only" and
 * "Production refused") — the guard is pure, so every branch is pinned here
 * without spawning the CLI.
 */
describe("resolveDemoSeedGuard", () => {
  const baseEnv = { DATABASE_URL: "postgres://irrelevant" };

  it("is disabled when the flag is unset (nothing may be created)", () => {
    const decision = resolveDemoSeedGuard({ ...baseEnv, ENABLE_DEMO_SEED: undefined });
    expect(decision.mode).toBe("disabled");
    expect(decision.reason).toContain("ENABLE_DEMO_SEED");
  });

  it("is disabled when the flag is any value other than the exact string true", () => {
    for (const candidate of ["false", "TRUE", "1", "yes", ""]) {
      const decision = resolveDemoSeedGuard({ ...baseEnv, ENABLE_DEMO_SEED: candidate });
      expect(decision.mode).toBe("disabled");
    }
  });

  it("refuses production even with the flag enabled", () => {
    const decision = resolveDemoSeedGuard({
      ...baseEnv,
      ENABLE_DEMO_SEED: "true",
      NODE_ENV: "production",
    });
    expect(decision.mode).toBe("refused");
    expect(decision.reason).toContain("never be enabled");
  });

  it("treats an UNSET NODE_ENV as production (fail-safe default)", () => {
    const decision = resolveDemoSeedGuard({ ...baseEnv, ENABLE_DEMO_SEED: "true" });
    expect(decision.mode).toBe("refused");
    expect(decision.reason).toContain("<unset>");
  });

  it("allows only explicit development/test environments", () => {
    for (const env of ["development", "test"] as const) {
      const decision = resolveDemoSeedGuard({
        ...baseEnv,
        ENABLE_DEMO_SEED: "true",
        NODE_ENV: env,
      });
      expect(decision.mode).toBe("enabled");
    }
  });
});

/**
 * Structural fake mirroring the delegates {@link DemoSeedClient} requires.
 * Upserts behave like Prisma: create-on-miss, update-on-hit, identity-stable.
 */
function makeFakeDb() {
  interface Row {
    id: string;
    [key: string]: unknown;
  }

  let sequence = 0;
  const nextId = (): string => `id-${(sequence += 1)}`;

  const tables = {
    roles: new Map<string, Row & { code: string }>(),
    tenants: new Map<string, Row & { slug: string }>(),
    profiles: new Map<string, Row & { email: string }>(),
    credentials: new Map<string, Row>(),
    memberships: new Map<string, Row>(),
    featureCodes: new Map<string, Row & { code: string }>(),
    entitlements: new Map<string, Row>(),
  };

  // Reference data the demo seed REFERENCES but must not create.
  tables.roles.set("role-owner", { id: "role-owner", code: "OWNER" });
  DEMO_FEATURE_GRANTS.forEach((code) =>
    tables.featureCodes.set(`fc-${code}`, { id: `fc-${code}`, code })
  );

  const db = {
    role: {
      // Sync bodies (eslint require-await): awaiting plain values keeps the
      // runtime contract identical to the real async delegates.
      findUnique: ({ where }: { where: { code: string } }) =>
        Promise.resolve([...tables.roles.values()].find((row) => row.code === where.code) ?? null),
    },
    tenant: {
      upsert: ({
        where,
        create,
      }: {
        where: { slug: string };
        create: { slug: string; name: string };
        update: Record<string, never>;
      }) => {
        const existing = [...tables.tenants.values()].find((row) => row.slug === where.slug);
        if (existing) return Promise.resolve(existing);
        const row = { id: nextId(), ...create };
        tables.tenants.set(row.id, row);
        return Promise.resolve(row);
      },
    },
    userProfile: {
      upsert: ({
        where,
        create,
      }: {
        where: { email: string };
        create: { email: string; displayName: string; status: string };
        update: Record<string, never>;
      }) => {
        const existing = [...tables.profiles.values()].find((row) => row.email === where.email);
        if (existing) return Promise.resolve(existing);
        const row = { id: nextId(), ...create };
        tables.profiles.set(row.id, row);
        return Promise.resolve(row);
      },
    },
    userCredential: {
      upsert: ({
        where,
        create,
        update,
      }: {
        where: { userProfileId: string };
        create: { userProfileId: string; passwordHash: string };
        update: { passwordHash: string };
      }) => {
        const existing = tables.credentials.get(where.userProfileId);
        if (existing) {
          existing.passwordHash = update.passwordHash;
          return Promise.resolve(existing);
        }
        const created = { id: nextId(), ...create };
        tables.credentials.set(String(created.userProfileId), created);
        return Promise.resolve(created);
      },
    },
    tenantMembership: {
      upsert: ({
        where,
        create,
      }: {
        where: { tenantId_userProfileId: { tenantId: string; userProfileId: string } };
        create: { tenantId: string; userProfileId: string; roleId: string; status: string };
        update: Record<string, never>;
      }) => {
        const key = `${where.tenantId_userProfileId.tenantId}:${where.tenantId_userProfileId.userProfileId}`;
        const existing = tables.memberships.get(key);
        if (existing) return Promise.resolve(existing);
        const row = { id: nextId(), ...create };
        tables.memberships.set(key, row);
        return Promise.resolve(row);
      },
    },
    featureCode: {
      findUnique: ({ where }: { where: { code: string } }) =>
        Promise.resolve(
          [...tables.featureCodes.values()].find((row) => row.code === where.code) ?? null
        ),
    },
    tenantEntitlement: {
      upsert: ({
        where,
        create,
      }: {
        where: { tenantId_featureCodeId: { tenantId: string; featureCodeId: string } };
        create: { tenantId: string; featureCodeId: string };
        update: Record<string, never>;
      }) => {
        const key = `${where.tenantId_featureCodeId.tenantId}:${where.tenantId_featureCodeId.featureCodeId}`;
        const existing = tables.entitlements.get(key);
        if (existing) return Promise.resolve(existing);
        const row = { id: nextId(), ...create };
        tables.entitlements.set(key, row);
        return Promise.resolve(row);
      },
    },
  };

  return { db: db as unknown as DemoSeedClient, tables };
}

describe("seedDemoData", () => {
  const input = { passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$demo$hash" };

  it("creates the demo tenant, owner profile+credential, membership and explicit grants", async () => {
    const { db, tables } = makeFakeDb();

    const result = await seedDemoData(db, input);

    expect(tables.tenants.size).toBe(1);
    expect(tables.profiles.size).toBe(1);
    expect([...tables.profiles.values()][0].email).toBe(DEMO_OWNER_EMAIL);
    // Credential is keyed by the owner profile id and holds ONLY a hash.
    expect(tables.credentials.has(result.ownerProfileId)).toBe(true);
    expect(tables.memberships.size).toBe(1);
    expect(result.grantedFeatureCodes).toBe(DEMO_FEATURE_GRANTS.length);
    expect(tables.entitlements.size).toBe(DEMO_FEATURE_GRANTS.length);

    const membership = [...tables.memberships.values()][0];
    expect(membership.status).toBe("ACTIVE");
    expect(membership.roleId).toBe("role-owner");
    // No reference rows were duplicated by the demo path.
    expect(tables.roles.size).toBe(1);
    expect(tables.featureCodes.size).toBe(DEMO_FEATURE_GRANTS.length);
  });

  it("converges on rerun: no duplicate tenants, profiles or grants", async () => {
    const { db, tables } = makeFakeDb();

    await seedDemoData(db, input);
    const second = await seedDemoData(db, input);

    expect(tables.tenants.size).toBe(1);
    expect(tables.profiles.size).toBe(1);
    expect(tables.credentials.size).toBe(1);
    expect(tables.memberships.size).toBe(1);
    expect(tables.entitlements.size).toBe(DEMO_FEATURE_GRANTS.length);
    expect(second.grantedFeatureCodes).toBe(DEMO_FEATURE_GRANTS.length);
    expect(second.ownerProfileId).toBe((await seedDemoData(db, input)).ownerProfileId);
  });

  it("refreshes the credential hash when parameters evolve", async () => {
    const { db, tables } = makeFakeDb();
    await seedDemoData(db, input);

    const rotated = { passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$rotated$hash" };
    await seedDemoData(db, rotated);

    expect([...tables.credentials.values()][0].passwordHash).toBe(rotated.passwordHash);
  });

  it("fails instructively when the reference seed has not run (OWNER role missing)", async () => {
    const { db, tables } = makeFakeDb();
    tables.roles.clear();

    await expect(seedDemoData(db, input)).rejects.toThrow(/reference seed/);
    // Nothing was created by the aborted run.
    expect(tables.tenants.size).toBe(0);
    expect(tables.profiles.size).toBe(0);
  });

  it("fails instructively when a feature code is missing from the catalog", async () => {
    const { db, tables } = makeFakeDb();
    tables.featureCodes.clear();

    await expect(seedDemoData(db, input)).rejects.toThrow(/feature code .* missing/);
    expect(tables.entitlements.size).toBe(0);
  });

  it("uses the stable demo natural keys", async () => {
    const { db, tables } = makeFakeDb();
    await seedDemoData(db, input);

    expect([...tables.tenants.values()][0].slug).toBe(DEMO_TENANT_SLUG);
    expect([...tables.profiles.values()][0].email).toBe(DEMO_OWNER_EMAIL);
  });
});

/**
 * Structural fake mirroring the customer seed delegates.
 */
function makeFakeCustomerDb(): {
  db: DemoCustomersSeedClient;
  tables: {
    customers: Map<string, { id: string; tenantId: string; kind: string; displayName: string }>;
    addresses: Map<string, { id: string; tenantId: string; customerId: string }>;
    contacts: Map<
      string,
      { id: string; tenantId: string; customerId: string; kind: string; value: string }
    >;
  };
} {
  interface CustomerRow {
    id: string;
    tenantId: string;
    kind: "INDIVIDUAL" | "COMPANY";
    displayName: string;
    [key: string]: unknown;
  }
  interface AddressRow {
    id: string;
    tenantId: string;
    customerId: string;
    [key: string]: unknown;
  }
  interface ContactRow {
    id: string;
    tenantId: string;
    customerId: string;
    kind: "EMAIL" | "PHONE";
    value: string;
    [key: string]: unknown;
  }

  const tables = {
    customers: new Map<string, CustomerRow>(),
    addresses: new Map<string, AddressRow>(),
    contacts: new Map<string, ContactRow>(),
  };

  const db = {
    customer: {
      createMany: ({ data }: { data: CustomerRow[]; skipDuplicates?: boolean }) => {
        for (const row of data) {
          tables.customers.set(row.id, row);
        }
        return Promise.resolve({ count: data.length });
      },
    },
    customerAddress: {
      createMany: ({ data }: { data: AddressRow[]; skipDuplicates?: boolean }) => {
        for (const row of data) {
          tables.addresses.set(row.id, row);
        }
        return Promise.resolve({ count: data.length });
      },
    },
    customerContact: {
      createMany: ({ data }: { data: ContactRow[]; skipDuplicates?: boolean }) => {
        for (const row of data) {
          tables.contacts.set(row.id, row);
        }
        return Promise.resolve({ count: data.length });
      },
    },
  };

  return { db, tables };
}

describe("seedDemoCustomers", () => {
  it("seeds an individual, a company, linked addresses and contacts", async () => {
    const { db, tables } = makeFakeCustomerDb();

    const result = await seedDemoCustomers(db, "tenant-demo");

    expect(result.customers).toBe(2);
    expect(result.addresses).toBe(2);
    expect(result.contacts).toBe(3);

    const customers = [...tables.customers.values()];
    expect(customers.some((row) => row.kind === "INDIVIDUAL")).toBe(true);
    expect(customers.some((row) => row.kind === "COMPANY")).toBe(true);
    expect(customers.every((row) => row.tenantId === "tenant-demo")).toBe(true);

    const addresses = [...tables.addresses.values()];
    expect(addresses.every((row) => row.tenantId === "tenant-demo")).toBe(true);
    expect(addresses.every((row) => customers.some((c) => c.id === row.customerId))).toBe(true);

    const contacts = [...tables.contacts.values()];
    expect(contacts.some((row) => row.kind === "PHONE")).toBe(true);
    expect(contacts.some((row) => row.kind === "EMAIL")).toBe(true);
    expect(contacts.every((row) => row.tenantId === "tenant-demo")).toBe(true);
    expect(contacts.every((row) => customers.some((c) => c.id === row.customerId))).toBe(true);
  });
});
