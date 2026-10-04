import { describe, expect, it } from "vitest";
import { EnvelopeSecretStore } from "./envelope-secret-store.js";
import { generateDataKey, wrapDataKey } from "./secret-envelope.js";
import { parseSecretStoreKeyRing } from "./secret-key-ring.js";
import {
  SecretStoreIntegrityError,
  type SecretRecordClient,
  type SecretRecordRow,
} from "./secret-store.port.js";

type StoredRow = SecretRecordRow & { tenantId: string; key: string };

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");
const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";

function createFakeClient(rows: StoredRow[] = []) {
  let createCount = 0;
  const client: SecretRecordClient = {
    tenantSecret: {
      create: ({ data }) => {
        createCount += 1;
        rows.push(data);
        return Promise.resolve({});
      },
      findFirst: ({ where }) =>
        Promise.resolve(
          rows.find((row) => row.tenantId === where.tenantId && row.key === where.key) ?? null
        ),
      deleteMany: ({ where }) => {
        const before = rows.length;
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          const row = rows[index];
          if (row.tenantId === where.tenantId && row.key === where.key) {
            rows.splice(index, 1);
          }
        }
        return Promise.resolve({ count: before - rows.length });
      },
    },
  };
  return { client, rows, createCount: () => createCount };
}

function ring(rawKeys: string, rawCurrentVersion?: string) {
  const parsed = parseSecretStoreKeyRing(rawKeys, rawCurrentVersion);
  if (!parsed) {
    throw new Error("expected a parsed key ring");
  }
  return parsed;
}

const RING_V1 = () => ring(`1:${KEY_A}`, "1");

describe("EnvelopeSecretStore", () => {
  it("returns the identical value it stored, including a multi-line value", async () => {
    const { client } = createFakeClient();
    const store = new EnvelopeSecretStore(client, RING_V1());
    const value = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END PRIVATE KEY-----\n";

    await store.put({ tenantId: TENANT, key: "fsk_one", value });

    expect(await store.get({ tenantId: TENANT, key: "fsk_one" })).toBe(value);
  });

  it("returns null when the tenant does not match the stored row", async () => {
    const { client } = createFakeClient();
    const store = new EnvelopeSecretStore(client, RING_V1());
    await store.put({ tenantId: TENANT, key: "fsk_one", value: "value" });

    expect(await store.get({ tenantId: OTHER_TENANT, key: "fsk_one" })).toBeNull();
    expect(await store.has({ tenantId: OTHER_TENANT, key: "fsk_one" })).toBe(false);
  });

  it("deletes idempotently and stops returning the value", async () => {
    const { client, rows } = createFakeClient();
    const store = new EnvelopeSecretStore(client, RING_V1());
    await store.put({ tenantId: TENANT, key: "fsk_one", value: "value" });

    await store.delete({ tenantId: TENANT, key: "fsk_one" });
    await store.delete({ tenantId: TENANT, key: "fsk_one" });

    expect(rows).toHaveLength(0);
    expect(await store.get({ tenantId: TENANT, key: "fsk_one" })).toBeNull();
  });

  it("does not delete another tenant's row with the same key name", async () => {
    const { client, rows } = createFakeClient();
    const store = new EnvelopeSecretStore(client, RING_V1());
    await store.put({ tenantId: TENANT, key: "fsk_one", value: "mine" });
    await store.put({ tenantId: OTHER_TENANT, key: "fsk_one", value: "theirs" });

    await store.delete({ tenantId: OTHER_TENANT, key: "fsk_one" });

    expect(rows).toHaveLength(1);
    expect(await store.get({ tenantId: TENANT, key: "fsk_one" })).toBe("mine");
  });

  it("reports presence without decrypting", async () => {
    const { client, rows } = createFakeClient();
    const store = new EnvelopeSecretStore(client, RING_V1());
    await store.put({ tenantId: TENANT, key: "fsk_one", value: "value" });

    expect(await store.has({ tenantId: TENANT, key: "fsk_one" })).toBe(true);

    // A row sealed under an unavailable master-key version is still present.
    rows.push({
      tenantId: TENANT,
      key: "fsk_orphan",
      algorithm: "AES-256-GCM",
      keyVersion: 99,
      wrappedKey: new Uint8Array(32),
      wrapIv: new Uint8Array(12),
      wrapAuthTag: new Uint8Array(16),
      ciphertext: new Uint8Array(8),
      iv: new Uint8Array(12),
      authTag: new Uint8Array(16),
    });

    expect(await store.has({ tenantId: TENANT, key: "fsk_orphan" })).toBe(true);
    await expect(store.get({ tenantId: TENANT, key: "fsk_orphan" })).rejects.toBeInstanceOf(
      SecretStoreIntegrityError
    );
  });

  it("never persists the plaintext", async () => {
    const { client, rows } = createFakeClient();
    const store = new EnvelopeSecretStore(client, RING_V1());
    const value = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END PRIVATE KEY-----\n";

    await store.put({ tenantId: TENANT, key: "fsk_one", value });

    const row = rows[0];
    const persisted = Buffer.concat([
      Buffer.from(row.ciphertext),
      Buffer.from(row.wrappedKey),
      Buffer.from(row.iv),
      Buffer.from(row.authTag),
      Buffer.from(row.wrapIv),
      Buffer.from(row.wrapAuthTag),
    ]);

    expect(persisted.includes(Buffer.from(value, "utf8"))).toBe(false);
    expect(persisted.includes(Buffer.from("BEGIN PRIVATE KEY", "utf8"))).toBe(false);
    expect(row.algorithm).toBe("AES-256-GCM");
    expect(row.keyVersion).toBe(1);
  });

  it("fails closed when the row was sealed under a different master key", async () => {
    const { client } = createFakeClient();
    await new EnvelopeSecretStore(client, RING_V1()).put({
      tenantId: TENANT,
      key: "fsk_one",
      value: "value",
    });

    const otherKeyRing = ring(`1:${KEY_B}`, "1");
    await expect(
      new EnvelopeSecretStore(client, otherKeyRing).get({ tenantId: TENANT, key: "fsk_one" })
    ).rejects.toBeInstanceOf(SecretStoreIntegrityError);
  });

  it("still decrypts an older version while a newer version is current", async () => {
    const { client, rows } = createFakeClient();
    await new EnvelopeSecretStore(client, ring(`1:${KEY_A},2:${KEY_B}`, "1")).put({
      tenantId: TENANT,
      key: "fsk_v1",
      value: "sealed under version one",
    });

    expect(rows[0].keyVersion).toBe(1);

    const rotated = new EnvelopeSecretStore(client, ring(`1:${KEY_A},2:${KEY_B}`, "2"));
    expect(await rotated.get({ tenantId: TENANT, key: "fsk_v1" })).toBe("sealed under version one");

    await rotated.put({ tenantId: TENANT, key: "fsk_v2", value: "sealed under version two" });
    expect(rows[1].keyVersion).toBe(2);
  });

  it("fails closed when the row's master-key version is not configured", async () => {
    const { client, rows } = createFakeClient();
    await new EnvelopeSecretStore(client, RING_V1()).put({
      tenantId: TENANT,
      key: "fsk_one",
      value: "value",
    });

    const onlyV2 = new EnvelopeSecretStore(client, ring(`2:${KEY_B}`, "2"));
    await expect(onlyV2.get({ tenantId: TENANT, key: "fsk_one" })).rejects.toBeInstanceOf(
      SecretStoreIntegrityError
    );
    expect(rows).toHaveLength(1);
  });

  it("writes through the caller transaction and not through the default client", async () => {
    const defaultClient = createFakeClient();
    const txClient = createFakeClient();
    const store = new EnvelopeSecretStore(defaultClient.client, RING_V1());

    await store.put({
      tenantId: TENANT,
      key: "fsk_one",
      value: "value",
      tx: txClient.client,
    });
    await store.delete({ tenantId: TENANT, key: "fsk_one", tx: txClient.client });

    expect(txClient.createCount()).toBe(1);
    expect(defaultClient.createCount()).toBe(0);
    expect(txClient.rows).toHaveLength(0);
    expect(defaultClient.rows).toHaveLength(0);
  });

  it("round-trips through a row that the store itself wrote", async () => {
    const { client, rows } = createFakeClient();
    const store = new EnvelopeSecretStore(client, RING_V1());
    const value = generateDataKey().toString("base64");

    await store.put({ tenantId: TENANT, key: "fsk_one", value });
    const row = rows[0];

    // The wrapped key is not the data key, and the payload is not the plaintext.
    const wrapped = wrapDataKey({ dataKey: generateDataKey(), kek: Buffer.alloc(32, 5) });
    expect(row.wrappedKey.length).toBe(wrapped.wrappedKey.length);
    expect(await store.get({ tenantId: TENANT, key: "fsk_one" })).toBe(value);
  });
});
