/**
 * Envelope cryptography for stored secrets.
 *
 * A random data key encrypts the material; the data key is itself wrapped by a
 * platform master key. Both operations use AES-256-GCM with a fresh 12-byte IV,
 * and both bind a distinct additional-authenticated-data context so a wrapped
 * data key can never be presented where a payload is expected, or the reverse.
 *
 * These are pure functions: they hold no state and read no configuration, so
 * the wrapping and sealing rules are unit-testable without a database.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { SecretStoreIntegrityError } from "./secret-store.port.js";

export const SECRET_STORE_ALGORITHM = "AES-256-GCM";
export const SECRET_DATA_KEY_BYTES = 32;
export const SECRET_GCM_IV_BYTES = 12;

const GCM_AUTH_TAG_BYTES = 16;
/**
 * Node's algorithm name for the OpenSSL call. It is lowercase so the typings
 * resolve the GCM overload, which is the one exposing `setAAD` and
 * `getAuthTag`; {@link SECRET_STORE_ALGORITHM} is the uppercase label persisted
 * with the row.
 */
const GCM_ALGORITHM = "aes-256-gcm";
const DEK_AAD = Buffer.from("newsaas.secret-store.v1:dek", "utf8");
const PAYLOAD_AAD = Buffer.from("newsaas.secret-store.v1:payload", "utf8");

function assertKeyLength(key: Buffer, label: string): void {
  if (key.length !== SECRET_DATA_KEY_BYTES) {
    throw new SecretStoreIntegrityError(
      `A ${label} must be exactly ${SECRET_DATA_KEY_BYTES} bytes.`
    );
  }
}

function assertCiphertextShape(parts: readonly Uint8Array[], label: string): void {
  for (const part of parts) {
    if (part.length === 0) {
      throw new SecretStoreIntegrityError(`Stored ${label} is incomplete.`);
    }
  }
}

/** Generates a fresh data key. Never persisted unwrapped. */
export function generateDataKey(): Buffer {
  return randomBytes(SECRET_DATA_KEY_BYTES);
}

/** Wraps a data key with the master key. The only place a DEK is written out. */
export function wrapDataKey(args: { dataKey: Buffer; kek: Buffer }): {
  wrappedKey: Buffer;
  wrapIv: Buffer;
  wrapAuthTag: Buffer;
} {
  assertKeyLength(args.dataKey, "data key");
  assertKeyLength(args.kek, "master key");

  const wrapIv = randomBytes(SECRET_GCM_IV_BYTES);
  const cipher = createCipheriv(GCM_ALGORITHM, args.kek, wrapIv);
  cipher.setAAD(DEK_AAD);
  const wrappedKey = Buffer.concat([cipher.update(args.dataKey), cipher.final()]);
  return { wrappedKey, wrapIv, wrapAuthTag: cipher.getAuthTag() };
}

/**
 * Recovers a data key. Throws {@link SecretStoreIntegrityError} on a failed
 * authentication tag or an unexpected recovered length; the underlying crypto
 * message is preserved as `cause` and never surfaced in `message`.
 */
export function unwrapDataKey(args: {
  wrappedKey: Uint8Array;
  wrapIv: Uint8Array;
  wrapAuthTag: Uint8Array;
  kek: Buffer;
}): Buffer {
  assertKeyLength(args.kek, "master key");
  assertCiphertextShape([args.wrappedKey, args.wrapIv, args.wrapAuthTag], "wrapped data key");

  try {
    const decipher = createDecipheriv(GCM_ALGORITHM, args.kek, Buffer.from(args.wrapIv));
    decipher.setAAD(DEK_AAD);
    decipher.setAuthTag(Buffer.from(args.wrapAuthTag));
    const dataKey = Buffer.concat([
      decipher.update(Buffer.from(args.wrappedKey)),
      decipher.final(),
    ]);
    if (dataKey.length !== SECRET_DATA_KEY_BYTES) {
      throw new SecretStoreIntegrityError("Stored data key has an unexpected length.");
    }
    return dataKey;
  } catch (cause) {
    if (cause instanceof SecretStoreIntegrityError) {
      throw cause;
    }
    throw new SecretStoreIntegrityError("Stored data key could not be unwrapped.", { cause });
  }
}

/** Seals a plaintext value under a data key. */
export function sealPayload(args: { plaintext: string; dataKey: Buffer }): {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
} {
  assertKeyLength(args.dataKey, "data key");

  const iv = randomBytes(SECRET_GCM_IV_BYTES);
  const cipher = createCipheriv(GCM_ALGORITHM, args.dataKey, iv);
  cipher.setAAD(PAYLOAD_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(args.plaintext, "utf8")),
    cipher.final(),
  ]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

/**
 * Opens a sealed value. Throws {@link SecretStoreIntegrityError} on a failed
 * authentication tag, with the crypto message kept in `cause`.
 */
export function openPayload(args: {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
  dataKey: Buffer;
}): string {
  assertKeyLength(args.dataKey, "data key");
  assertCiphertextShape([args.iv, args.authTag], "payload");
  if (args.authTag.length !== GCM_AUTH_TAG_BYTES) {
    throw new SecretStoreIntegrityError("Stored payload authentication tag is malformed.");
  }

  try {
    const decipher = createDecipheriv(GCM_ALGORITHM, args.dataKey, Buffer.from(args.iv));
    decipher.setAAD(PAYLOAD_AAD);
    decipher.setAuthTag(Buffer.from(args.authTag));
    return Buffer.concat([
      decipher.update(Buffer.from(args.ciphertext)),
      decipher.final(),
    ]).toString("utf8");
  } catch (cause) {
    throw new SecretStoreIntegrityError("Stored secret could not be opened.", { cause });
  }
}
