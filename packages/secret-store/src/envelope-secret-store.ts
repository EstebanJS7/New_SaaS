/**
 * Envelope secret store: the persistent driver.
 *
 * Every write generates a fresh data key, wraps it with the current master key
 * and seals the value with it. Nothing plaintext and nothing unwrapped is ever
 * written, and no method logs, throws or returns key material: a failure reports
 * *that* a secret could not be opened, never the bytes involved.
 */

import {
  generateDataKey,
  openPayload,
  sealPayload,
  SECRET_STORE_ALGORITHM,
  unwrapDataKey,
  wrapDataKey,
} from "./secret-envelope.js";
import type { SecretStoreKeyRing } from "./secret-key-ring.js";
import {
  SecretStoreIntegrityError,
  type SecretRecordClient,
  type SecretStore,
  type SecretStoreDeleteArgs,
  type SecretStoreGetArgs,
  type SecretStorePutArgs,
} from "./secret-store.port.js";

export class EnvelopeSecretStore implements SecretStore {
  constructor(
    private readonly records: SecretRecordClient,
    private readonly keyRing: SecretStoreKeyRing
  ) {}

  private clientFor(tx: SecretRecordClient | undefined): SecretRecordClient {
    return tx ?? this.records;
  }

  private kekFor(version: number): Buffer {
    const kek = this.keyRing.keys.get(version);
    if (!kek) {
      throw new SecretStoreIntegrityError(
        `Stored secret was sealed under master-key version ${version}, which is not configured.`
      );
    }
    return kek;
  }

  /**
   * Copies a crypto result into the persistence layer's byte shape. One small
   * copy per field is the price of keeping `SecretRecordClient` structurally
   * verified instead of casting the client to it.
   */
  private static toPersistedBytes(value: Buffer): Uint8Array<ArrayBuffer> {
    return new Uint8Array(value);
  }

  async put(args: SecretStorePutArgs): Promise<{ key: string }> {
    const dataKey = generateDataKey();
    const { wrappedKey, wrapIv, wrapAuthTag } = wrapDataKey({
      dataKey,
      kek: this.kekFor(this.keyRing.currentVersion),
    });
    const { ciphertext, iv, authTag } = sealPayload({ plaintext: args.value, dataKey });

    await this.clientFor(args.tx).tenantSecret.create({
      data: {
        tenantId: args.tenantId,
        key: args.key,
        algorithm: SECRET_STORE_ALGORITHM,
        keyVersion: this.keyRing.currentVersion,
        wrappedKey: EnvelopeSecretStore.toPersistedBytes(wrappedKey),
        wrapIv: EnvelopeSecretStore.toPersistedBytes(wrapIv),
        wrapAuthTag: EnvelopeSecretStore.toPersistedBytes(wrapAuthTag),
        ciphertext: EnvelopeSecretStore.toPersistedBytes(ciphertext),
        iv: EnvelopeSecretStore.toPersistedBytes(iv),
        authTag: EnvelopeSecretStore.toPersistedBytes(authTag),
      },
    });

    return { key: args.key };
  }

  async get(args: SecretStoreGetArgs): Promise<string | null> {
    const row = await this.records.tenantSecret.findFirst({
      where: { tenantId: args.tenantId, key: args.key },
    });
    if (!row) {
      return null;
    }

    const dataKey = unwrapDataKey({
      wrappedKey: row.wrappedKey,
      wrapIv: row.wrapIv,
      wrapAuthTag: row.wrapAuthTag,
      kek: this.kekFor(row.keyVersion),
    });
    return openPayload({
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.authTag,
      dataKey,
    });
  }

  async delete(args: SecretStoreDeleteArgs): Promise<void> {
    await this.clientFor(args.tx).tenantSecret.deleteMany({
      where: { tenantId: args.tenantId, key: args.key },
    });
  }

  async has(args: SecretStoreGetArgs): Promise<boolean> {
    const row = await this.records.tenantSecret.findFirst({
      where: { tenantId: args.tenantId, key: args.key },
    });
    return row !== null;
  }
}
