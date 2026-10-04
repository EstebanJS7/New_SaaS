import { describe, expect, it } from "vitest";
import {
  generateDataKey,
  openPayload,
  sealPayload,
  SECRET_DATA_KEY_BYTES,
  SECRET_STORE_ALGORITHM,
  unwrapDataKey,
  wrapDataKey,
} from "./secret-envelope.js";
import { SecretStoreIntegrityError } from "./secret-store.port.js";

const KEK = Buffer.alloc(SECRET_DATA_KEY_BYTES, 7);

describe("secret-envelope", () => {
  it("declares the AES-256-GCM algorithm", () => {
    expect(SECRET_STORE_ALGORITHM).toBe("AES-256-GCM");
  });

  it("generates a 32-byte data key that differs across calls", () => {
    const first = generateDataKey();
    const second = generateDataKey();
    expect(first.length).toBe(SECRET_DATA_KEY_BYTES);
    expect(first.equals(second)).toBe(false);
  });

  it("seals and opens a value under the same data key", () => {
    const dataKey = generateDataKey();
    const sealed = sealPayload({ plaintext: "hello", dataKey });
    expect(openPayload({ ...sealed, dataKey })).toBe("hello");
  });

  it("round-trips a multi-line PEM-like value byte for byte", () => {
    const plaintext = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END PRIVATE KEY-----\n";
    const dataKey = generateDataKey();
    const sealed = sealPayload({ plaintext, dataKey });
    expect(openPayload({ ...sealed, dataKey })).toBe(plaintext);
  });

  it("does not put the plaintext in the sealed bytes", () => {
    const plaintext = "super-secret-material";
    const sealed = sealPayload({ plaintext, dataKey: generateDataKey() });
    expect(sealed.ciphertext.includes(Buffer.from(plaintext, "utf8"))).toBe(false);
  });

  it("wraps and unwraps a data key under the master key", () => {
    const dataKey = generateDataKey();
    const wrapped = wrapDataKey({ dataKey, kek: KEK });
    const recovered = unwrapDataKey({ ...wrapped, kek: KEK });
    expect(recovered.equals(dataKey)).toBe(true);
  });

  it("does not put the data key in the wrapped bytes", () => {
    const dataKey = generateDataKey();
    const wrapped = wrapDataKey({ dataKey, kek: KEK });
    expect(wrapped.wrappedKey.includes(dataKey)).toBe(false);
  });

  it("rejects a wrapped data key presented as a payload", () => {
    const wrapped = wrapDataKey({ dataKey: generateDataKey(), kek: KEK });
    expect(() =>
      openPayload({
        ciphertext: wrapped.wrappedKey,
        iv: wrapped.wrapIv,
        authTag: wrapped.wrapAuthTag,
        dataKey: KEK,
      })
    ).toThrow(SecretStoreIntegrityError);
  });

  it("rejects a sealed payload presented as a wrapped data key", () => {
    const sealed = sealPayload({ plaintext: "value", dataKey: KEK });
    expect(() =>
      unwrapDataKey({
        wrappedKey: sealed.ciphertext,
        wrapIv: sealed.iv,
        wrapAuthTag: sealed.authTag,
        kek: KEK,
      })
    ).toThrow(SecretStoreIntegrityError);
  });

  it("fails closed under the wrong master key", () => {
    const wrapped = wrapDataKey({ dataKey: generateDataKey(), kek: KEK });
    expect(() =>
      unwrapDataKey({ ...wrapped, kek: Buffer.alloc(SECRET_DATA_KEY_BYTES, 9) })
    ).toThrow(SecretStoreIntegrityError);
  });

  it("fails closed under the wrong data key", () => {
    const sealed = sealPayload({ plaintext: "value", dataKey: generateDataKey() });
    expect(() => openPayload({ ...sealed, dataKey: generateDataKey() })).toThrow(
      SecretStoreIntegrityError
    );
  });

  it("rejects a master key that is not 32 bytes", () => {
    expect(() => wrapDataKey({ dataKey: generateDataKey(), kek: Buffer.alloc(16, 1) })).toThrow(
      SecretStoreIntegrityError
    );
    expect(() =>
      unwrapDataKey({
        wrappedKey: Buffer.alloc(32, 1),
        wrapIv: Buffer.alloc(12, 1),
        wrapAuthTag: Buffer.alloc(16, 1),
        kek: Buffer.alloc(16, 1),
      })
    ).toThrow(SecretStoreIntegrityError);
  });

  it("rejects a malformed authentication tag", () => {
    const dataKey = generateDataKey();
    const sealed = sealPayload({ plaintext: "value", dataKey });
    expect(() => openPayload({ ...sealed, authTag: Buffer.alloc(4, 1), dataKey })).toThrow(
      SecretStoreIntegrityError
    );
  });

  it("keeps the underlying crypto message out of the thrown message", () => {
    const sealed = sealPayload({ plaintext: "value", dataKey: generateDataKey() });
    try {
      openPayload({ ...sealed, dataKey: generateDataKey() });
      throw new Error("expected a SecretStoreIntegrityError");
    } catch (error) {
      expect(error).toBeInstanceOf(SecretStoreIntegrityError);
      expect((error as SecretStoreIntegrityError).message).toBe(
        "Stored secret could not be opened."
      );
      expect((error as SecretStoreIntegrityError).cause).toBeDefined();
    }
  });
});
