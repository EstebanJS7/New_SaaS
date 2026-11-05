import { describe, expect, it, vi } from "vitest";
import { hashPasswordResetToken } from "@newsaas/shared";
import { FEATURE_CODE_SEEDS } from "./reference-seed.js";
import {
  DEFAULT_BRANCH_NAME,
  ProvisioningError,
  normalizeProvisionInput,
  provisionTenant,
  type ProvisioningClient,
  type ProvisioningTx,
} from "./tenant-provisioning.js";

const TENANT_ID = "77777777-7777-4777-8777-777777777777";
const OLD_PROFILE = "88888888-8888-4888-8888-888888888888";
const NOW = new Date("2026-11-02T12:00:00.000Z");
const input = {
  slug: "san-roque",
  name: "Veterinaria San Roque",
  ownerEmail: "  Duenia@SanRoque.com.py ",
  ownerName: "María Pérez",
};

function setup(
  options: { slugTaken?: boolean; existingOwner?: unknown; ownerRole?: boolean } = {}
) {
  const calls: string[] = [];
  const audits: unknown[] = [];
  const tx = {
    tenant: {
      findUnique: vi.fn(() => Promise.resolve(options.slugTaken ? { id: "t-old" } : null)),
      create: vi.fn(() => {
        calls.push("tenant");
        return Promise.resolve({ id: TENANT_ID });
      }),
    },
    branch: {
      create: vi.fn(() => {
        calls.push("branch");
        return Promise.resolve({ id: "b-1" });
      }),
    },
    featureCode: {
      findMany: vi.fn((args: { where: { code: { in: string[] } } }) =>
        Promise.resolve(args.where.code.in.map((code) => ({ id: `fc-${code}`, code })))
      ),
    },
    tenantEntitlement: {
      createMany: vi.fn((args: { data: unknown[] }) => {
        calls.push("entitlements");
        return Promise.resolve({ count: args.data.length });
      }),
    },
    role: {
      findUnique: vi.fn(() =>
        Promise.resolve(options.ownerRole === false ? null : { id: "r-owner" })
      ),
    },
    userProfile: {
      findUnique: vi.fn(() =>
        Promise.resolve(options.existingOwner === undefined ? null : options.existingOwner)
      ),
      create: vi.fn(() => {
        calls.push("profile");
        return Promise.resolve({ id: "p-1" });
      }),
    },
    tenantMembership: {
      create: vi.fn(() => {
        calls.push("membership");
        return Promise.resolve({ id: "m-1" });
      }),
    },
    membershipBranch: {
      create: vi.fn(() => {
        calls.push("assignment");
        return Promise.resolve({});
      }),
    },
    passwordResetToken: {
      create: vi.fn(() => {
        calls.push("token");
        return Promise.resolve({ id: "tok-1" });
      }),
    },
    auditLog: {
      create: vi.fn((args: { data: unknown }) => {
        calls.push("audit");
        audits.push(args.data);
        return Promise.resolve({ id: "a-1" });
      }),
    },
  };
  const db: ProvisioningClient = {
    $transaction: (callback) => callback(tx as unknown as ProvisioningTx),
  };
  return { db, tx, calls, audits };
}

describe("normalizeProvisionInput (ONB-001)", () => {
  it("normalizes the address and defaults the branch and the features", () => {
    const normalized = normalizeProvisionInput(input);
    expect(normalized.ownerEmail).toBe("duenia@sanroque.com.py");
    expect(normalized.branchName).toBe(DEFAULT_BRANCH_NAME);
    expect(normalized.features).toEqual([...FEATURE_CODE_SEEDS]);
  });

  it.each([
    ["ab", "too short"],
    ["San-Roque", "uppercase is lowercased, so this one is valid"],
    ["-roque", "leading hyphen"],
    ["roque-", "trailing hyphen"],
    ["san roque", "space"],
  ])("judges the slug %s (%s)", (slug, why) => {
    const run = () => normalizeProvisionInput({ ...input, slug });
    if (why.startsWith("uppercase")) expect(run().slug).toBe("san-roque");
    else expect(run).toThrow(ProvisioningError);
  });

  it.each(["platform", "demo", "login", "app", "api", "reset-password"])(
    "refuses the reserved slug %s",
    (slug) => {
      expect(() => normalizeProvisionInput({ ...input, slug })).toThrow(/reservado/);
    }
  );

  it("refuses an unknown feature code and names the valid ones", () => {
    expect(() => normalizeProvisionInput({ ...input, features: ["veterinary", "rocket"] })).toThrow(
      /rocket/
    );
  });

  it("refuses an invalid owner address", () => {
    expect(() => normalizeProvisionInput({ ...input, ownerEmail: "not-an-email" })).toThrow(
      ProvisioningError
    );
  });
});

describe("provisionTenant (ONB-001)", () => {
  it("creates tenant, branch, entitlements, owner and membership, and mints a 72 h activation token", async () => {
    const { db, tx, calls, audits } = setup();
    const result = await provisionTenant(db, input, NOW);

    expect(calls).toEqual([
      "tenant",
      "branch",
      "entitlements",
      "profile",
      "membership",
      "assignment",
      "token",
      "audit",
    ]);
    expect(tx.branch.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT_ID, name: DEFAULT_BRANCH_NAME },
      select: { id: true },
    });
    expect(tx.tenantEntitlement.createMany.mock.calls[0]?.[0].data).toHaveLength(
      FEATURE_CODE_SEEDS.length
    );
    expect(tx.tenantMembership.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT_ID, userProfileId: "p-1", roleId: "r-owner", status: "ACTIVE" },
      select: { id: true },
    });
    // DEC-094 §6: the owner works at the first branch.
    expect(tx.membershipBranch.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT_ID, membershipId: "m-1", branchId: "b-1" },
    });

    expect(result.activationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.activationExpiresAt?.toISOString()).toBe("2026-11-05T12:00:00.000Z");
    const stored = (
      tx.passwordResetToken.create.mock.calls[0] as unknown as [{ data: { tokenHash: string } }]
    )[0].data.tokenHash;
    // Only the digest persists.
    expect(stored).toBe(hashPasswordResetToken(result.activationToken ?? ""));
    expect(stored).not.toBe(result.activationToken);

    expect(audits[0]).toMatchObject({
      action: "platform.tenant_provisioned",
      actorType: "SYSTEM",
      tenantId: TENANT_ID,
    });
    expect(JSON.stringify(audits[0])).not.toContain("sanroque");
  });

  it("attaches an owner who already has an account, without a token", async () => {
    const { db, tx, calls } = setup({
      existingOwner: { id: OLD_PROFILE, credential: { userProfileId: OLD_PROFILE } },
    });
    const result = await provisionTenant(db, input, NOW);
    expect(tx.userProfile.create).not.toHaveBeenCalled();
    expect(calls).not.toContain("token");
    expect(result.activationToken).toBeNull();
    expect(result.ownerProfileId).toBe(OLD_PROFILE);
  });

  it("refuses a slug that is already taken, before writing anything", async () => {
    const { db, calls } = setup({ slugTaken: true });
    await expect(provisionTenant(db, input, NOW)).rejects.toThrow(/Ya existe/);
    expect(calls).toEqual([]);
  });

  it("refuses when the reference seed has not run", async () => {
    const { db, calls } = setup({ ownerRole: false });
    await expect(provisionTenant(db, input, NOW)).rejects.toThrow(/db:seed/);
    expect(calls).toEqual([]);
  });
});
