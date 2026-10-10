/**
 * FISC-015 WU-C — the CSC read.
 *
 * The suite pins the boundary's decisions, mirroring the credential read's: the
 * tenant and the environment are both in the query, absence (row or secret) is
 * `null`, the identifier comes from the row and the value from the `SecretStore`,
 * and the returned object is exactly the port's two fields. The store is the real
 * `InMemorySecretStore`, so the cross-tenant case exercises the store's own
 * scoping rather than a stub.
 *
 * One assertion here is deliberately about what is NOT returned: the row's
 * `secretRef` never reaches the caller. The value is RESTRICTED material and
 * nothing that consumes this read may log, serialize or echo it.
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
  createFiscalCscReader,
  type FiscalCscReadClient,
  type FiscalCscReadRow,
} from "./fiscal-csc.reader.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const SECRET_REF = "fiscal-csc/0001";
const CSC_VALUE = "ABCD0000000000000000000000000001";

/** The row as it exists: the environment and the status are what the query sees. */
interface CscRow extends FiscalCscReadRow {
  readonly tenantId: string;
  readonly environment: "TEST" | "PRODUCTION";
  readonly status: "ACTIVE" | "RETIRED";
}

function csc(
  tenantId: string,
  environment: "TEST" | "PRODUCTION",
  idCsc = "0001",
  status: "ACTIVE" | "RETIRED" = "ACTIVE"
): CscRow {
  return { tenantId, environment, status, idCsc, secretRef: SECRET_REF };
}

/** Answers from the rows it holds, applying the same filters Prisma would. */
class ScopedCscClient implements FiscalCscReadClient {
  readonly findFirstArgs: Prisma.TenantFiscalCscFindFirstArgs[] = [];
  readonly tenantFiscalCsc: FiscalCscReadClient["tenantFiscalCsc"];

  constructor(private readonly rows: readonly CscRow[]) {
    this.tenantFiscalCsc = {
      findFirst: (args) => {
        this.findFirstArgs.push(args);
        const where = args.where ?? {};
        const found = this.rows
          .filter(
            (row) =>
              (where.tenantId === undefined || row.tenantId === where.tenantId) &&
              (where.environment === undefined || row.environment === where.environment) &&
              (where.status === undefined || row.status === where.status)
          )
          .sort((left, right) => left.idCsc.localeCompare(right.idCsc));
        return Promise.resolve(found[0] ?? null);
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

describe("createFiscalCscReader", () => {
  it("fits the real Prisma client by construction", () => {
    const fits: PrismaService extends FiscalCscReadClient ? true : never = true;
    expect(fits).toBe(true);
  });

  it("returns the row's identifier and the stored value", async () => {
    const secrets = new InMemorySecretStore();
    await secrets.put({ tenantId: TENANT_A, key: SECRET_REF, value: CSC_VALUE });
    const client = new ScopedCscClient([csc(TENANT_A, "TEST")]);

    const result = await createFiscalCscReader({ client, secretStore: secrets }).read({
      tenantId: TENANT_A,
      environment: "TEST",
    });

    expect(result).toEqual({ idCsc: "0001", csc: CSC_VALUE });
    // The tenant, the environment and the status are all part of the query, and
    // only an ACTIVE row is eligible.
    expect(client.findFirstArgs[0]?.where).toEqual({
      tenantId: TENANT_A,
      environment: "TEST",
      status: "ACTIVE",
    });
  });

  it("returns exactly the port's two fields, and never the reference", async () => {
    const secrets = new InMemorySecretStore();
    await secrets.put({ tenantId: TENANT_A, key: SECRET_REF, value: CSC_VALUE });
    const client = new ScopedCscClient([csc(TENANT_A, "TEST")]);

    const result = await createFiscalCscReader({ client, secretStore: secrets }).read({
      tenantId: TENANT_A,
      environment: "TEST",
    });

    // No `secretRef`, no environment, no status, no row identity: the reference
    // is the one column that must never leave this boundary.
    expect(Object.keys(result ?? {}).sort()).toEqual(["csc", "idCsc"]);
    expect(JSON.stringify(result)).not.toContain(SECRET_REF);
  });

  it("returns null when the tenant has no ACTIVE CSC, without asking the store", async () => {
    const secrets = new RecordingSecretStore(new InMemorySecretStore());
    const client = new ScopedCscClient([]);

    const result = await createFiscalCscReader({ client, secretStore: secrets }).read({
      tenantId: TENANT_A,
      environment: "TEST",
    });

    expect(result).toBeNull();
    expect(client.findFirstArgs[0]?.where).toMatchObject({ tenantId: TENANT_A });
    expect(secrets.gets).toEqual([]);
  });

  it("returns null for a RETIRED row rather than using it", async () => {
    const secrets = new RecordingSecretStore(new InMemorySecretStore());
    await secrets.put({ tenantId: TENANT_A, key: SECRET_REF, value: CSC_VALUE });
    const client = new ScopedCscClient([csc(TENANT_A, "TEST", "0001", "RETIRED")]);

    const result = await createFiscalCscReader({ client, secretStore: secrets }).read({
      tenantId: TENANT_A,
      environment: "TEST",
    });

    expect(result).toBeNull();
    expect(client.findFirstArgs[0]?.where).toEqual({
      tenantId: TENANT_A,
      environment: "TEST",
      status: "ACTIVE",
    });
    expect(secrets.gets).toEqual([]);
  });

  it("returns null for the other environment's CSC rather than substituting it", async () => {
    const secrets = new RecordingSecretStore(new InMemorySecretStore());
    await secrets.put({ tenantId: TENANT_A, key: SECRET_REF, value: CSC_VALUE });
    const client = new ScopedCscClient([csc(TENANT_A, "TEST")]);

    const result = await createFiscalCscReader({ client, secretStore: secrets }).read({
      tenantId: TENANT_A,
      environment: "PRODUCTION",
    });

    expect(result).toBeNull();
    expect(client.findFirstArgs[0]?.where).toEqual({
      tenantId: TENANT_A,
      environment: "PRODUCTION",
      status: "ACTIVE",
    });
    expect(secrets.gets).toEqual([]);
  });

  it("returns null when the ACTIVE row's secret is gone", async () => {
    const secrets = new RecordingSecretStore(new InMemorySecretStore());
    const client = new ScopedCscClient([csc(TENANT_A, "TEST")]);

    const result = await createFiscalCscReader({ client, secretStore: secrets }).read({
      tenantId: TENANT_A,
      environment: "TEST",
    });

    // Fail closed: the row says there is a CSC and the store says there is not,
    // so the caller must refuse rather than hash an empty value into the QR.
    expect(result).toBeNull();
    expect(secrets.gets).toEqual([{ tenantId: TENANT_A, key: SECRET_REF }]);
  });

  it("does not return a value stored under another tenant", async () => {
    const secrets = new RecordingSecretStore(new InMemorySecretStore());
    await secrets.put({ tenantId: TENANT_A, key: SECRET_REF, value: CSC_VALUE });
    // Tenant B holds its own ACTIVE row that names the same opaque key, so the
    // query finds a row and the store's scoping is the only thing standing
    // between tenant B and tenant A's CSC.
    const client = new ScopedCscClient([csc(TENANT_A, "TEST"), csc(TENANT_B, "TEST")]);

    const result = await createFiscalCscReader({ client, secretStore: secrets }).read({
      tenantId: TENANT_B,
      environment: "TEST",
    });

    expect(result).toBeNull();
    expect(client.findFirstArgs[0]?.where).toMatchObject({ tenantId: TENANT_B });
    expect(secrets.gets).toEqual([{ tenantId: TENANT_B, key: SECRET_REF }]);
  });

  it("picks deterministically when the tenant holds the two CSCs the Manual allows", async () => {
    const secrets = new InMemorySecretStore();
    await secrets.put({ tenantId: TENANT_A, key: SECRET_REF, value: CSC_VALUE });
    const client = new ScopedCscClient([csc(TENANT_A, "TEST", "0002"), csc(TENANT_A, "TEST")]);

    const result = await createFiscalCscReader({ client, secretStore: secrets }).read({
      tenantId: TENANT_A,
      environment: "TEST",
    });

    // §24.2 allows up to two ACTIVE codes, so the read cannot rely on there
    // being one: it orders by the identifier, and the QR carries whichever one
    // it used.
    expect(result?.idCsc).toBe("0001");
    expect(client.findFirstArgs[0]?.orderBy).toEqual({ idCsc: "asc" });
  });

  it("propagates a corrupt secret instead of reporting it absent", async () => {
    const client = new ScopedCscClient([csc(TENANT_A, "TEST")]);
    const reader = createFiscalCscReader({ client, secretStore: new CorruptSecretStore() });

    await expect(reader.read({ tenantId: TENANT_A, environment: "TEST" })).rejects.toBeInstanceOf(
      SecretStoreIntegrityError
    );
  });
});
