/**
 * Master-key ring resolution.
 *
 * A KEK rotation must not require a data migration, so the master key is a
 * versioned ring: new writes use the current version, and reads use the version
 * recorded in the row. A row sealed under version 1 therefore keeps decrypting
 * after version 2 becomes current.
 *
 * Parsing fails closed: any malformed entry is an error rather than a silently
 * accepted key, because a mis-parsed master key would make every stored secret
 * unreadable.
 */

import { SECRET_DATA_KEY_BYTES } from "./secret-envelope.js";

export interface SecretStoreKeyRing {
  readonly currentVersion: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

export type SecretStoreSelection = "envelope" | "in-memory";

/** Standard base64 with optional padding. Rejects anything Node would decode leniently. */
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function parseKeyEntry(entry: string): { version: number; key: Buffer } {
  const separator = entry.indexOf(":");
  if (separator <= 0) {
    throw new Error('SECRET_STORE_MASTER_KEYS entries must look like "<version>:<base64>".');
  }

  const versionRaw = entry.slice(0, separator).trim();
  const keyRaw = entry.slice(separator + 1).trim();
  const version = Number(versionRaw);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`SECRET_STORE_MASTER_KEYS version "${versionRaw}" must be a positive integer.`);
  }

  if (!BASE64_PATTERN.test(keyRaw)) {
    throw new Error(`SECRET_STORE_MASTER_KEYS version ${version} is not valid base64.`);
  }
  const key = Buffer.from(keyRaw, "base64");
  if (key.length !== SECRET_DATA_KEY_BYTES) {
    throw new Error(
      `SECRET_STORE_MASTER_KEYS version ${version} must decode to ${SECRET_DATA_KEY_BYTES} bytes.`
    );
  }

  return { version, key };
}

/**
 * Parses `SECRET_STORE_MASTER_KEYS` (`"1:<base64>,2:<base64>"`) and
 * `SECRET_STORE_MASTER_KEY_VERSION` (`"2"`).
 *
 * Returns `null` when no keys are configured, which is the development and test
 * in-memory mode. When `SECRET_STORE_MASTER_KEY_VERSION` is absent the highest
 * declared version becomes current, so adding a key to the list is a complete
 * rotation.
 *
 * Throws on an entry without a separator, a non-positive-integer version, a
 * value that is not base64 or does not decode to 32 bytes, a duplicate version,
 * a version configured without any keys, or a current version absent from the
 * list.
 */
export function parseSecretStoreKeyRing(
  rawKeys: string | undefined,
  rawCurrentVersion: string | undefined
): SecretStoreKeyRing | null {
  const keysRaw = rawKeys?.trim() ?? "";
  const currentRaw = rawCurrentVersion?.trim() ?? "";

  if (keysRaw.length === 0) {
    if (currentRaw.length > 0) {
      throw new Error(
        "SECRET_STORE_MASTER_KEY_VERSION is set but SECRET_STORE_MASTER_KEYS is empty."
      );
    }
    return null;
  }

  const keys = new Map<number, Buffer>();
  for (const rawEntry of keysRaw.split(",")) {
    const entry = rawEntry.trim();
    if (entry.length === 0) {
      throw new Error("SECRET_STORE_MASTER_KEYS contains an empty entry.");
    }
    const { version, key } = parseKeyEntry(entry);
    if (keys.has(version)) {
      throw new Error(`SECRET_STORE_MASTER_KEYS declares version ${version} more than once.`);
    }
    keys.set(version, key);
  }

  let currentVersion: number;
  if (currentRaw.length > 0) {
    currentVersion = Number(currentRaw);
    if (!Number.isInteger(currentVersion) || currentVersion < 1) {
      throw new Error("SECRET_STORE_MASTER_KEY_VERSION must be a positive integer.");
    }
  } else {
    currentVersion = Math.max(...keys.keys());
  }

  if (!keys.has(currentVersion)) {
    throw new Error(
      `SECRET_STORE_MASTER_KEY_VERSION ${currentVersion} is not present in SECRET_STORE_MASTER_KEYS.`
    );
  }

  return { currentVersion, keys };
}

/**
 * Chooses the driver. `envelope` whenever a key ring is configured.
 *
 * The production refusal is duplicated on purpose: `apiEnvSchema`'s
 * `superRefine` is the authoritative boot gate, and this one is defense in
 * depth, so a boot path that skipped validation still cannot silently select
 * the in-memory driver in production — the same shape `resolveFiscalProvider`
 * uses for the fake fiscal provider.
 */
export function resolveSecretStoreSelection(
  nodeEnv: string | undefined,
  keyRing: SecretStoreKeyRing | null
): SecretStoreSelection {
  if (keyRing) {
    return "envelope";
  }
  if (nodeEnv === "production") {
    throw new Error(
      "SECRET_STORE_MASTER_KEYS is required in production: the in-memory secret store must never hold tenant signing material."
    );
  }
  return "in-memory";
}
