import { describe, expect, it } from "vitest";
import { createOpaqueSecretKey, SECRET_KEY_PREFIXES } from "./secret-keys.js";

describe("createOpaqueSecretKey", () => {
  it("prefixes the key with the requested prefix", () => {
    expect(createOpaqueSecretKey("fsk")).toMatch(/^fsk_[A-Za-z0-9_-]{22}$/);
  });

  it("returns a distinct key on every call", () => {
    const keys = new Set(Array.from({ length: 64 }, () => createOpaqueSecretKey("fsk")));
    expect(keys.size).toBe(64);
  });

  it("exposes the fiscal signing-key prefix", () => {
    expect(SECRET_KEY_PREFIXES.fiscalSigningKey).toBe("fsk");
    expect(Object.isFrozen(SECRET_KEY_PREFIXES)).toBe(true);
  });
});
