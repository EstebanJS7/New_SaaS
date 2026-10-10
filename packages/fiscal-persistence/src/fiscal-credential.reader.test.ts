/**
 * FISC-012 WU-B — the credential read.
 *
 * The suite pins the boundary's decisions: the tenant and the environment are
 * both in the query, absence (row or secret) is `null`, the certificate comes
 * from the row and the key from the `SecretStore`, and the returned object is
 * exactly the port's four fields. The store is the real `InMemorySecretStore`,
 * so the cross-tenant case exercises the store's own scoping rather than a stub.
 */

import type { Prisma, PrismaService } from "@newsaas/database";
import {
  InMemorySecretStore,
  SecretStoreIntegrityError,
  type SecretStore,
  type SecretStoreDeleteArgs,
  type SecretStoreGetArgs,
  type SecretStorePutArgs,
} from "@newsaas/secret-store";
import { describe, expect, it } from "vitest";
import {
  createFiscalCredentialReader,
  type FiscalCredentialReadClient,
  type FiscalSigningMaterialReadRow,
} from "./fiscal-credential.reader.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const CREDENTIAL_REF = "fiscal-signing-key/3f2a";
const CERTIFICATE_PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
const PRIVATE_KEY_PEM = "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----";
const NOT_BEFORE = new Date("2026-01-01T00:00:00.000Z");
const NOT_AFTER = new Date("2027-01-01T00:00:00.000Z");

/** The row as it exists: the environment and the status are what the query sees. */
interface MaterialRow extends FiscalSigningMaterialReadRow {
  readonly tenantId: string;
  readonly environment: "TEST" | "PRODUCTION";
  readonly status: "ACTIVE" | "RETIRED";
}

function material(
  tenantId: string,
  environment: "TEST" | "PRODUCTION",
  status: "ACTIVE" | "RETIRED" = "ACTIVE"
): MaterialRow {
  return {
    tenantId,
    environment,
    status,
    credentialRef: CREDENTIAL_REF,
    certificatePem: CERTIFICATE_PEM,
    notBefore: NOT_BEFORE,
    notAfter: NOT_AFTER,
  };
}

/** Answers from the rows it holds, applying the same filters Prisma would. */
class ScopedMaterialClient implements FiscalCredentialReadClient {
  readonly findFirstArgs: Prisma.TenantFiscalSigningMaterialFindFirstArgs[] = [];
  readonly tenantFiscalSigningMaterial: FiscalCredentialReadClient["tenantFiscalSigningMaterial"];

  constructor(private readonly rows: readonly MaterialRow[]) {
    this.tenantFiscalSigningMaterial = {
      findFirst: (args) => {
        this.findFirstArgs.push(args);
        const where = args.where ?? {};
        const found = this.rows.find(
          (row) =>
            (where.tenantId === undefined || row.tenantId === where.tenantId) &&
            (where.environment === undefined || row.environment === where.environment) &&
            (where.status === undefined || row.status === where.status)
        );
        return Promise.resolve(found ?? null);
      },
    };
  }
}

/** Wraps the real store so a case can assert whether it was asked at all. */
class RecordingSecretStore implements SecretStore {
  readonly gets: SecretStoreGetArgs[] = [];

  constructor(private readonly inner: InMemorySecretStore) {}

  put(args: SecretStorePutArgs): Promise<{ key: string }> {
    return this.inner.put(args);
  }

  get(args: SecretStoreGetArgs): Promise<string | null> {
    this.gets.push(args);
    return this.inner.get(args);
  }

  delete(args: SecretStoreDeleteArgs): Promise<void> {
    return this.inner.delete(args);
  }

  has(args: SecretStoreGetArgs): Promise<boolean> {
    return this.inner.has(args);
  }
}

/** A store whose one secret exists but cannot be opened. */
class CorruptSecretStore implements SecretStore {
  put(): Promise<{ key: string }> {
    return Promise.reject(new SecretStoreIntegrityError("Not used by this case."));
  }

  get(): Promise<string | null> {
    return Promise.reject(new SecretStoreIntegrityError("The stored secret cannot be opened."));
  }

  delete(): Promise<void> {
    return Promise.resolve();
  }

  has(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

describe("createFiscalCredentialReader", () => {
  it("fits the real Prisma client by construction", () => {
    // Compile-time: the client is declared with Prisma's own argument types, so
    // `PrismaService` is assignable without a cast. A Prisma upgrade that stops
    // matching breaks HERE rather than in the worker's wiring.
    const fits: PrismaService extends FiscalCredentialReadClient ? true : never = true;
    expect(fits).toBe(true);
  });

  it("returns the row's certificate and the stored key", async () => {
    const secrets = new InMemorySecretStore();
    await secrets.put({ tenantId: TENANT_A, key: CREDENTIAL_REF, value: PRIVATE_KEY_PEM });
    const client = new ScopedMaterialClient([material(TENANT_A, "TEST")]);

    const credential = await createFiscalCredentialReader({ client, secretStore: secrets }).read({
      tenantId: TENANT_A,
      environment: "TEST",
    });

    expect(credential).toEqual({
      certificatePem: CERTIFICATE_PEM,
      privateKeyPem: PRIVATE_KEY_PEM,
      notBefore: NOT_BEFORE,
      notAfter: NOT_AFTER,
    });
    // The tenant and the environment are both part of the query, and only an
    // ACTIVE material is eligible.
    expect(client.findFirstArgs[0]?.where).toEqual({
      tenantId: TENANT_A,
      environment: "TEST",
      status: "ACTIVE",
    });
  });

  it("returns exactly the port's four fields", async () => {
    const secrets = new InMemorySecretStore();
    await secrets.put({ tenantId: TENANT_A, key: CREDENTIAL_REF, value: PRIVATE_KEY_PEM });
    const client = new ScopedMaterialClient([material(TENANT_A, "TEST")]);

    const credential = await createFiscalCredentialReader({ client, secretStore: secrets }).read({
      tenantId: TENANT_A,
      environment: "TEST",
    });

    // No `credentialRef`, no environment, no status, no row identity.
    expect(Object.keys(credential ?? {}).sort()).toEqual([
      "certificatePem",
      "notAfter",
      "notBefore",
      "privateKeyPem",
    ]);
  });

  it("returns null when the tenant has no ACTIVE material, without asking the store", async () => {
    const secrets = new RecordingSecretStore(new InMemorySecretStore());
    const client = new ScopedMaterialClient([]);

    const credential = await createFiscalCredentialReader({ client, secretStore: secrets }).read({
      tenantId: TENANT_A,
      environment: "TEST",
    });

    expect(credential).toBeNull();
    expect(client.findFirstArgs[0]?.where).toMatchObject({ tenantId: TENANT_A });
    expect(secrets.gets).toEqual([]);
  });

  it("returns null for the other environment's material rather than substituting it", async () => {
    const secrets = new RecordingSecretStore(new InMemorySecretStore());
    await secrets.put({ tenantId: TENANT_A, key: CREDENTIAL_REF, value: PRIVATE_KEY_PEM });
    const client = new ScopedMaterialClient([material(TENANT_A, "TEST")]);

    const credential = await createFiscalCredentialReader({ client, secretStore: secrets }).read({
      tenantId: TENANT_A,
      environment: "PRODUCTION",
    });

    expect(credential).toBeNull();
    expect(client.findFirstArgs[0]?.where).toEqual({
      tenantId: TENANT_A,
      environment: "PRODUCTION",
      status: "ACTIVE",
    });
    expect(secrets.gets).toEqual([]);
  });

  it("returns null when the ACTIVE row's secret is gone", async () => {
    const secrets = new RecordingSecretStore(new InMemorySecretStore());
    const client = new ScopedMaterialClient([material(TENANT_A, "TEST")]);

    const credential = await createFiscalCredentialReader({ client, secretStore: secrets }).read({
      tenantId: TENANT_A,
      environment: "TEST",
    });

    expect(credential).toBeNull();
    expect(secrets.gets).toEqual([{ tenantId: TENANT_A, key: CREDENTIAL_REF }]);
  });

  it("does not return a key stored under another tenant", async () => {
    const secrets = new RecordingSecretStore(new InMemorySecretStore());
    await secrets.put({ tenantId: TENANT_A, key: CREDENTIAL_REF, value: PRIVATE_KEY_PEM });
    // Tenant B holds its own ACTIVE row that names the same opaque key, so the
    // query finds a row and the store's scoping is the only thing standing
    // between tenant B and tenant A's private key.
    const client = new ScopedMaterialClient([
      material(TENANT_A, "TEST"),
      material(TENANT_B, "TEST"),
    ]);

    const credential = await createFiscalCredentialReader({ client, secretStore: secrets }).read({
      tenantId: TENANT_B,
      environment: "TEST",
    });

    expect(credential).toBeNull();
    expect(client.findFirstArgs[0]?.where).toMatchObject({ tenantId: TENANT_B });
    expect(secrets.gets).toEqual([{ tenantId: TENANT_B, key: CREDENTIAL_REF }]);
  });

  it("propagates a corrupt secret instead of reporting it absent", async () => {
    const client = new ScopedMaterialClient([material(TENANT_A, "TEST")]);
    const reader = createFiscalCredentialReader({
      client,
      secretStore: new CorruptSecretStore(),
    });

    await expect(reader.read({ tenantId: TENANT_A, environment: "TEST" })).rejects.toBeInstanceOf(
      SecretStoreIntegrityError
    );
  });
});
