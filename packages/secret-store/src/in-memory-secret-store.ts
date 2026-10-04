/**
 * In-memory secret store: **test and local development only**.
 *
 * It holds plaintext in process memory and loses everything on restart, so it
 * must never hold tenant signing material in a deployment.
 * {@link resolveSecretStoreSelection} refuses to select it in production, and
 * `apiEnvSchema`'s `superRefine` refuses to boot without a master key there —
 * two independent gates, so a skipped validation cannot silently land here.
 */

import type {
  SecretStore,
  SecretStoreDeleteArgs,
  SecretStoreGetArgs,
  SecretStorePutArgs,
} from "./secret-store.port.js";

function compositeKey(tenantId: string, key: string): string {
  return `${tenantId}\u0000${key}`;
}

export class InMemorySecretStore implements SecretStore {
  private readonly entries = new Map<string, string>();

  put(args: SecretStorePutArgs): Promise<{ key: string }> {
    this.entries.set(compositeKey(args.tenantId, args.key), args.value);
    return Promise.resolve({ key: args.key });
  }

  get(args: SecretStoreGetArgs): Promise<string | null> {
    return Promise.resolve(this.entries.get(compositeKey(args.tenantId, args.key)) ?? null);
  }

  delete(args: SecretStoreDeleteArgs): Promise<void> {
    this.entries.delete(compositeKey(args.tenantId, args.key));
    return Promise.resolve();
  }

  has(args: SecretStoreGetArgs): Promise<boolean> {
    return Promise.resolve(this.entries.has(compositeKey(args.tenantId, args.key)));
  }
}
