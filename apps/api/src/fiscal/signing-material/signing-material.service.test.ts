/* eslint-disable @typescript-eslint/require-await */
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildTestPkcs12, extractSigningMaterial, TEST_PKCS12_PASSWORD } from "@newsaas/fiscal";
import { InMemorySecretStore } from "@newsaas/secret-store";
import {
  FISCAL_SIGNING_MATERIAL_AMBIGUOUS_CERTIFICATE_MESSAGE,
  FISCAL_SIGNING_MATERIAL_INVALID_CONTAINER_MESSAGE,
  FISCAL_SIGNING_MATERIAL_INVALID_PASSWORD_MESSAGE,
  FISCAL_SIGNING_MATERIAL_KEY_CERTIFICATE_MISMATCH_MESSAGE,
  FISCAL_SIGNING_MATERIAL_MISSING_CERTIFICATE_MESSAGE,
  FiscalSigningMaterialService,
} from "./signing-material.service.js";
import {
  FISCAL_SIGNING_MATERIAL_NOT_FOUND_MESSAGE,
  type FiscalSigningMaterialClient,
  type FiscalSigningMaterialRow,
  type FiscalSigningMaterialTx,
  type FiscalSigningMaterialWriteTx,
} from "./signing-material.repository.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const ACTOR_ID = "user-1";

type RowData = Omit<FiscalSigningMaterialRow, "id" | "createdAt" | "updatedAt">;

interface Subject {
  service: FiscalSigningMaterialService;
  rows: FiscalSigningMaterialRow[];
  secrets: InMemorySecretStore;
  audits: Record<string, unknown>[];
  entitlements: { has: ReturnType<typeof vi.fn> };
  permissionResolver: { resolveForActiveRequest: ReturnType<typeof vi.fn> };
}

/**
 * A hand-written in-memory stand-in for the aggregate's persistence. Secrets are
 * backed by the real in-memory secret store, so "was the key destroyed?" is an
 * observable question rather than an assumption about a mock.
 */
function makeSubject(): Subject {
  const rows: FiscalSigningMaterialRow[] = [];
  const secrets = new InMemorySecretStore();
  const audits: Record<string, unknown>[] = [];
  let nextId = 0;

  const delegate = {
    create: async ({ data }: { data: RowData }) => {
      const now = new Date();
      const row: FiscalSigningMaterialRow = {
        ...data,
        id: `row-${++nextId}`,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(row);
      return row;
    },
    findFirst: async ({
      where,
    }: {
      where: {
        tenantId: string;
        id?: string;
        environment?: string;
        status?: string;
      };
    }) =>
      rows.find(
        (row) =>
          row.tenantId === where.tenantId &&
          (where.id === undefined || row.id === where.id) &&
          (where.environment === undefined || row.environment === where.environment) &&
          (where.status === undefined || row.status === where.status)
      ) ?? null,
    findMany: async ({ where }: { where: { tenantId: string } }) =>
      rows
        .filter((row) => row.tenantId === where.tenantId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    updateMany: async ({
      where,
      data,
    }: {
      where: { tenantId: string; id: string; status: "ACTIVE" };
      data: {
        status: "RETIRED";
        retiredAt: Date;
        retiredByUserProfileId: string | null;
        retirementReason: string;
      };
    }) => {
      const row = rows.find(
        (candidate) =>
          candidate.id === where.id &&
          candidate.tenantId === where.tenantId &&
          candidate.status === where.status
      );
      if (!row) {
        return { count: 0 };
      }
      Object.assign(row, data);
      return { count: 1 };
    },
  };

  // The secret-store delegate is never reached: the service injects the in-memory
  // store directly. It exists because the write-transaction type composes it.
  const unusedSecretDelegate = {
    create: async () => ({}),
    findFirst: async () => null,
    deleteMany: async () => ({ count: 0 }),
  };

  const client: FiscalSigningMaterialClient = {
    tenantFiscalSigningMaterial: delegate,
    tenantSecret: unusedSecretDelegate,
    auditLog: { create: async () => ({ id: "audit-1" }) },
    $transaction: async <T>(work: (tx: FiscalSigningMaterialWriteTx) => Promise<T>) =>
      work({
        tenantFiscalSigningMaterial: delegate,
        tenantSecret: unusedSecretDelegate,
        auditLog: { create: async () => ({ id: "audit-1" }) },
      }),
  };

  const context = {
    requireTenantId: () => TENANT_ID,
    requireUserProfileId: () => ACTOR_ID,
  };
  const repository = {
    list: async () => delegate.findMany({ where: { tenantId: TENANT_ID } }),
    findActive: async (environment: "TEST" | "PRODUCTION", tx: FiscalSigningMaterialTx) =>
      tx.tenantFiscalSigningMaterial.findFirst({
        where: { tenantId: TENANT_ID, environment, status: "ACTIVE" },
      }),
    findById: async (id: string, tx: FiscalSigningMaterialTx) =>
      tx.tenantFiscalSigningMaterial.findFirst({ where: { tenantId: TENANT_ID, id } }),
    retireIfActive: async (
      args: {
        id: string;
        retiredAt: Date;
        retiredByUserProfileId: string | null;
        retirementReason: string;
      },
      tx: FiscalSigningMaterialTx
    ) =>
      (
        await tx.tenantFiscalSigningMaterial.updateMany({
          where: { tenantId: TENANT_ID, id: args.id, status: "ACTIVE" },
          data: { ...args, status: "RETIRED" },
        })
      ).count,
    create: async (data: RowData, tx: FiscalSigningMaterialTx) =>
      tx.tenantFiscalSigningMaterial.create({ data: { ...data, tenantId: TENANT_ID } }),
  };

  const audit = {
    append: vi.fn(async (input: Record<string, unknown>) => {
      audits.push(input);
      return {};
    }),
  };
  const entitlements = { has: vi.fn(async () => true) };
  const permissionResolver = {
    resolveForActiveRequest: vi.fn(async () => new Set(["fiscal.signing_material.manage"])),
  };

  const service = new FiscalSigningMaterialService(
    client,
    repository as never,
    context as never,
    audit as never,
    entitlements as never,
    permissionResolver as never,
    secrets
  );

  return { service, rows, secrets, audits, entitlements, permissionResolver };
}

async function testContainer(): Promise<Buffer> {
  return buildTestPkcs12({ password: TEST_PKCS12_PASSWORD });
}

function generateMismatchedKey(): Uint8Array {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return new Uint8Array(privateKey.export({ type: "pkcs8", format: "der" }));
}

describe("FiscalSigningMaterialService.upload", () => {
  it("stores exactly one secret, keyed by the new material's credential reference", async () => {
    const subject = makeSubject();

    const view = await subject.service.upload({
      environment: "TEST",
      container: await testContainer(),
      password: TEST_PKCS12_PASSWORD,
    });

    expect(subject.rows).toHaveLength(1);
    const row = subject.rows[0];
    expect(row.credentialRef).toMatch(/^fsk_/);

    const stored = await subject.secrets.get({ tenantId: TENANT_ID, key: row.credentialRef });
    const expected = await extractSigningMaterial({
      container: await testContainer(),
      password: TEST_PKCS12_PASSWORD,
    });
    expect(stored).toBe(expected.privateKeyPem);
    expect(stored).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(view.status).toBe("ACTIVE");
  });

  it("never persists the password, the private key or the credential reference outside its row", async () => {
    const subject = makeSubject();
    await subject.service.upload({
      environment: "TEST",
      container: await testContainer(),
      password: TEST_PKCS12_PASSWORD,
    });

    const row = subject.rows[0];
    expect(JSON.stringify(subject.rows)).not.toContain(TEST_PKCS12_PASSWORD);
    expect(JSON.stringify(subject.audits)).not.toContain(TEST_PKCS12_PASSWORD);
    expect(JSON.stringify(subject.audits)).not.toContain(row.credentialRef);
    expect(JSON.stringify(subject.audits)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(subject.rows)).not.toContain("PRIVATE KEY");
  });

  it("rotates within the environment and destroys the previous key", async () => {
    const subject = makeSubject();
    const container = await testContainer();

    await subject.service.upload({
      environment: "TEST",
      container,
      password: TEST_PKCS12_PASSWORD,
    });
    const previous = subject.rows[0];
    await subject.service.upload({
      environment: "TEST",
      container,
      password: TEST_PKCS12_PASSWORD,
    });

    const activeForTest = subject.rows.filter(
      (row) => row.environment === "TEST" && row.status === "ACTIVE"
    );
    expect(activeForTest).toHaveLength(1);
    expect(previous.status).toBe("RETIRED");
    expect(previous.retirementReason).toBe("rotated");
    // ADR-005/D5: a retired material never keeps a usable key.
    expect(await subject.secrets.has({ tenantId: TENANT_ID, key: previous.credentialRef })).toBe(
      false
    );
    expect(
      await subject.secrets.has({ tenantId: TENANT_ID, key: activeForTest[0].credentialRef })
    ).toBe(true);
  });

  it("leaves the other environment's material untouched", async () => {
    const subject = makeSubject();
    const container = await testContainer();

    const test = await subject.service.upload({
      environment: "TEST",
      container,
      password: TEST_PKCS12_PASSWORD,
    });
    await subject.service.upload({
      environment: "PRODUCTION",
      container,
      password: TEST_PKCS12_PASSWORD,
    });

    expect(subject.rows).toHaveLength(2);
    expect(subject.rows.filter((row) => row.status === "ACTIVE")).toHaveLength(2);
    expect(subject.rows.find((row) => row.id === test.id)?.status).toBe("ACTIVE");
    expect(
      subject.rows.filter((row) => row.environment === "TEST" && row.status === "ACTIVE")
    ).toHaveLength(1);
  });

  it("writes the pinned audit payload and nothing more", async () => {
    const subject = makeSubject();
    const view = await subject.service.upload({
      environment: "PRODUCTION",
      container: await testContainer(),
      password: TEST_PKCS12_PASSWORD,
    });

    expect(subject.audits).toHaveLength(1);
    expect(subject.audits[0]).toMatchObject({
      action: "fiscal.signing_material.uploaded",
      tenantId: TENANT_ID,
      actorUserProfileId: ACTOR_ID,
      targetType: "fiscal_signing_material",
      targetId: view.id,
      metadata: {
        schemaVersion: 1,
        environment: "PRODUCTION",
        certificateSerial: view.certificateSerial,
        certificateFingerprintSha256: view.certificateFingerprintSha256,
      },
    });
    expect(Object.keys(subject.audits[0].metadata as object).sort()).toEqual([
      "certificateFingerprintSha256",
      "certificateSerial",
      "environment",
      "schemaVersion",
    ]);
  });

  it("maps a file that is not a container to its own message", async () => {
    const subject = makeSubject();
    await expect(
      subject.service.upload({
        environment: "TEST",
        container: new Uint8Array(Buffer.from("not a container")),
        password: TEST_PKCS12_PASSWORD,
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: FISCAL_SIGNING_MATERIAL_INVALID_CONTAINER_MESSAGE,
    });
    expect(subject.rows).toHaveLength(0);
    expect(subject.audits).toHaveLength(0);
  });

  it("maps a wrong password to its own message", async () => {
    const subject = makeSubject();
    await expect(
      subject.service.upload({
        environment: "TEST",
        container: new Uint8Array(await testContainer()),
        password: "wrong-password",
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: FISCAL_SIGNING_MATERIAL_INVALID_PASSWORD_MESSAGE,
    });
  });

  it("maps a container without a certificate to its own message", async () => {
    const subject = makeSubject();
    const container = await buildTestPkcs12({
      password: TEST_PKCS12_PASSWORD,
      certificates: [],
    });
    await expect(
      subject.service.upload({
        environment: "TEST",
        container: new Uint8Array(container),
        password: TEST_PKCS12_PASSWORD,
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: FISCAL_SIGNING_MATERIAL_MISSING_CERTIFICATE_MESSAGE,
    });
  });

  it("maps more than one certificate to its own message", async () => {
    const subject = makeSubject();
    const certificate = (
      await extractSigningMaterial({
        container: await testContainer(),
        password: TEST_PKCS12_PASSWORD,
      })
    ).certificateDer;
    const container = await buildTestPkcs12({
      password: TEST_PKCS12_PASSWORD,
      certificates: [
        { certId: "1.2.840.113549.1.9.22.1", der: certificate },
        { certId: "1.2.840.113549.1.9.22.1", der: certificate },
      ],
    });
    await expect(
      subject.service.upload({
        environment: "TEST",
        container: new Uint8Array(container),
        password: TEST_PKCS12_PASSWORD,
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: FISCAL_SIGNING_MATERIAL_AMBIGUOUS_CERTIFICATE_MESSAGE,
    });
  });

  it("maps a key that does not match the certificate to its own message", async () => {
    const subject = makeSubject();
    const container = await buildTestPkcs12({
      password: TEST_PKCS12_PASSWORD,
      privateKeyPkcs8Der: generateMismatchedKey(),
    });
    await expect(
      subject.service.upload({
        environment: "TEST",
        container: new Uint8Array(container),
        password: TEST_PKCS12_PASSWORD,
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: FISCAL_SIGNING_MATERIAL_KEY_CERTIFICATE_MISMATCH_MESSAGE,
    });
    expect(subject.rows).toHaveLength(0);
  });
});

describe("FiscalSigningMaterialService.retire", () => {
  it("retires the row, destroys the key and writes the pinned audit payload", async () => {
    const subject = makeSubject();
    const view = await subject.service.upload({
      environment: "TEST",
      container: await testContainer(),
      password: TEST_PKCS12_PASSWORD,
    });
    const row = subject.rows[0];

    const retired = await subject.service.retire({ id: view.id, reason: "compromised" });

    expect(retired.status).toBe("RETIRED");
    expect(retired.retiredAt).toBeInstanceOf(Date);
    expect(row.retirementReason).toBe("compromised");
    expect(row.retiredByUserProfileId).toBe(ACTOR_ID);
    expect(await subject.secrets.has({ tenantId: TENANT_ID, key: row.credentialRef })).toBe(false);
    expect(subject.audits.at(-1)).toMatchObject({
      action: "fiscal.signing_material.retired",
      targetId: view.id,
      metadata: {
        schemaVersion: 1,
        environment: "TEST",
        certificateSerial: row.certificateSerial,
        reason: "compromised",
      },
    });
  });

  it("refuses a second retirement with a conflict", async () => {
    const subject = makeSubject();
    const view = await subject.service.upload({
      environment: "TEST",
      container: await testContainer(),
      password: TEST_PKCS12_PASSWORD,
    });
    await subject.service.retire({ id: view.id, reason: "first" });

    await expect(subject.service.retire({ id: view.id, reason: "again" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("reports an unknown or foreign id as not found", async () => {
    const subject = makeSubject();

    await expect(subject.service.retire({ id: "unknown", reason: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: FISCAL_SIGNING_MATERIAL_NOT_FOUND_MESSAGE,
    });
  });
});

describe("FiscalSigningMaterialService projection and gates", () => {
  it("returns metadata only, never the credential reference or a PEM", async () => {
    const subject = makeSubject();
    const view = await subject.service.upload({
      environment: "TEST",
      container: await testContainer(),
      password: TEST_PKCS12_PASSWORD,
    });

    expect(Object.keys(view).sort()).toEqual(
      [
        "certificateFingerprintSha256",
        "certificateSerial",
        "certificateSubject",
        "createdAt",
        "environment",
        "id",
        "keyAlgorithm",
        "notAfter",
        "notBefore",
        "retiredAt",
        "status",
      ].sort()
    );
    expect(JSON.stringify(view)).not.toContain("PRIVATE KEY");
  });

  it("lists both environments newest first", async () => {
    const subject = makeSubject();
    const container = await testContainer();
    await subject.service.upload({
      environment: "TEST",
      container,
      password: TEST_PKCS12_PASSWORD,
    });
    await subject.service.upload({
      environment: "PRODUCTION",
      container,
      password: TEST_PKCS12_PASSWORD,
    });

    const listed = await subject.service.list();
    expect(listed).toHaveLength(2);
    expect(listed.map((item) => item.environment)).toEqual(["PRODUCTION", "TEST"]);
  });

  it.each(["list", "upload", "retire"] as const)(
    "checks the fiscal entitlement before the permission for %s",
    async (operation) => {
      const subject = makeSubject();
      subject.entitlements.has.mockResolvedValue(false);

      const run = async (): Promise<void> => {
        if (operation === "list") {
          await subject.service.list();
        } else if (operation === "upload") {
          await subject.service.upload({
            environment: "TEST",
            container: new Uint8Array(await testContainer()),
            password: TEST_PKCS12_PASSWORD,
          });
        } else {
          await subject.service.retire({ id: "row-1", reason: "x" });
        }
      };

      await expect(run()).rejects.toMatchObject({ code: "FEATURE_NOT_ENTITLED" });
      expect(subject.permissionResolver.resolveForActiveRequest).not.toHaveBeenCalled();
    }
  );

  it.each(["list", "upload", "retire"] as const)(
    "refuses %s without the signing-material permission",
    async (operation) => {
      const subject = makeSubject();
      subject.permissionResolver.resolveForActiveRequest.mockResolvedValue(new Set());

      const run = async (): Promise<void> => {
        if (operation === "list") {
          await subject.service.list();
        } else if (operation === "upload") {
          await subject.service.upload({
            environment: "TEST",
            container: new Uint8Array(await testContainer()),
            password: TEST_PKCS12_PASSWORD,
          });
        } else {
          await subject.service.retire({ id: "row-1", reason: "x" });
        }
      };

      await expect(run()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );

  it("does not parse or store anything when the gate refuses", async () => {
    const subject = makeSubject();
    subject.permissionResolver.resolveForActiveRequest.mockResolvedValue(new Set());

    await expect(
      subject.service.upload({
        environment: "TEST",
        container: new Uint8Array(await testContainer()),
        password: TEST_PKCS12_PASSWORD,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(subject.rows).toHaveLength(0);
    expect(subject.audits).toHaveLength(0);
  });
});
