import { describe, expect, it } from "vitest";
import { parseSecretStoreKeyRing, resolveSecretStoreSelection } from "./secret-key-ring.js";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");
const SHORT_KEY = Buffer.alloc(16, 3).toString("base64");

function ring(rawKeys: string, rawCurrentVersion?: string) {
  const parsed = parseSecretStoreKeyRing(rawKeys, rawCurrentVersion);
  if (!parsed) {
    throw new Error("expected a parsed key ring");
  }
  return parsed;
}

describe("parseSecretStoreKeyRing", () => {
  it("returns null when no keys are configured", () => {
    expect(parseSecretStoreKeyRing(undefined, undefined)).toBeNull();
    expect(parseSecretStoreKeyRing("", "")).toBeNull();
    expect(parseSecretStoreKeyRing("   ", "  ")).toBeNull();
  });

  it("parses a single key and makes it current", () => {
    const parsed = ring(`1:${KEY_A}`);
    expect(parsed.currentVersion).toBe(1);
    expect(parsed.keys.size).toBe(1);
    expect(parsed.keys.get(1)?.length).toBe(32);
  });

  it("honours an explicit current version", () => {
    const parsed = ring(`1:${KEY_A},2:${KEY_B}`, "2");
    expect(parsed.currentVersion).toBe(2);
    expect(parsed.keys.get(1)?.equals(parsed.keys.get(2) ?? Buffer.alloc(0))).toBe(false);
  });

  it("defaults the current version to the highest declared one", () => {
    expect(ring(`1:${KEY_A},2:${KEY_B}`).currentVersion).toBe(2);
    expect(ring(`3:${KEY_B},1:${KEY_A}`).currentVersion).toBe(3);
  });

  it("tolerates surrounding whitespace", () => {
    const parsed = ring(` 1:${KEY_A} , 2:${KEY_B} `, " 2 ");
    expect(parsed.currentVersion).toBe(2);
    expect(parsed.keys.size).toBe(2);
  });

  it("rejects a version configured without any keys", () => {
    expect(() => parseSecretStoreKeyRing(undefined, "2")).toThrow(/MASTER_KEYS is empty/);
  });

  it("rejects an entry without a separator", () => {
    expect(() => parseSecretStoreKeyRing(KEY_A, undefined)).toThrow(/version>:<base64/);
  });

  it("rejects a non-positive-integer version", () => {
    expect(() => parseSecretStoreKeyRing(`0:${KEY_A}`, undefined)).toThrow(/positive integer/);
    expect(() => parseSecretStoreKeyRing(`x:${KEY_A}`, undefined)).toThrow(/positive integer/);
    expect(() => parseSecretStoreKeyRing(`1.5:${KEY_A}`, undefined)).toThrow(/positive integer/);
  });

  it("rejects a value that is not base64", () => {
    expect(() => parseSecretStoreKeyRing("1:!!!!", undefined)).toThrow(/not valid base64/);
    expect(() => parseSecretStoreKeyRing("1:abc*def", undefined)).toThrow(/not valid base64/);
  });

  it("rejects a key that does not decode to 32 bytes", () => {
    expect(() => parseSecretStoreKeyRing(`1:${SHORT_KEY}`, undefined)).toThrow(/32 bytes/);
  });

  it("rejects a duplicate version", () => {
    expect(() => parseSecretStoreKeyRing(`1:${KEY_A},1:${KEY_B}`, undefined)).toThrow(
      /more than once/
    );
  });

  it("rejects an empty entry", () => {
    expect(() => parseSecretStoreKeyRing(`1:${KEY_A},,2:${KEY_B}`, undefined)).toThrow(
      /empty entry/
    );
  });

  it("rejects a current version absent from the list", () => {
    expect(() => parseSecretStoreKeyRing(`1:${KEY_A}`, "2")).toThrow(/not present/);
  });

  it("rejects a malformed current version", () => {
    expect(() => parseSecretStoreKeyRing(`1:${KEY_A}`, "two")).toThrow(/positive integer/);
    expect(() => parseSecretStoreKeyRing(`1:${KEY_A}`, "0")).toThrow(/positive integer/);
  });
});

describe("resolveSecretStoreSelection", () => {
  it("selects the envelope driver whenever a key ring is configured", () => {
    expect(resolveSecretStoreSelection("production", ring(`1:${KEY_A}`))).toBe("envelope");
    expect(resolveSecretStoreSelection("development", ring(`1:${KEY_A}`))).toBe("envelope");
  });

  it("refuses to select the in-memory driver in production", () => {
    expect(() => resolveSecretStoreSelection("production", null)).toThrow(
      /MASTER_KEYS is required in production/
    );
  });

  it("falls back to the in-memory driver outside production", () => {
    expect(resolveSecretStoreSelection("development", null)).toBe("in-memory");
    expect(resolveSecretStoreSelection("test", null)).toBe("in-memory");
    expect(resolveSecretStoreSelection(undefined, null)).toBe("in-memory");
  });
});
