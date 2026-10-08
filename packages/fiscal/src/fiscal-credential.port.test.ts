/**
 * FISC-010 WU-C — the credential boundary's own contract.
 *
 * Three things are asserted here, and only the first is about behaviour:
 *
 * 1. The null port answers `null` for every read — absence is a state, not an
 *    exception (ADR-008 §2).
 * 2. `isCredentialFresh` is **pure and clock-driven**: both boundaries are
 *    exclusive/inclusive exactly as ADR-008 writes them (`notBefore <= now <
 *    notAfter`), the clock is an argument rather than an ambient read, and the
 *    credential is never mutated.
 * 3. The token is a `symbol`, so two independently declared ports cannot collide
 *    by name the way Nest's string tokens allow.
 */

import { describe, expect, it } from "vitest";

import {
  createNullFiscalCredentialPort,
  FISCAL_CREDENTIAL_PORT,
  isCredentialFresh,
  type FiscalTransportCredential,
} from "./fiscal-credential.port.js";

const NOT_BEFORE = new Date("2026-01-01T00:00:00.000Z");
const NOT_AFTER = new Date("2027-01-01T00:00:00.000Z");

function credential(): FiscalTransportCredential {
  return {
    certificatePem: "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n",
    privateKeyPem: "-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\n",
    notBefore: NOT_BEFORE,
    notAfter: NOT_AFTER,
  };
}

describe("createNullFiscalCredentialPort", () => {
  it("answers null for every tenant and every environment", async () => {
    const port = createNullFiscalCredentialPort();

    await expect(port.read({ tenantId: "tenant-a", environment: "TEST" })).resolves.toBeNull();
    await expect(
      port.read({ tenantId: "tenant-a", environment: "PRODUCTION" })
    ).resolves.toBeNull();
    await expect(port.read({ tenantId: "", environment: "TEST" })).resolves.toBeNull();
  });

  it("answers a promise rather than throwing, so the absence is a value", async () => {
    const result = createNullFiscalCredentialPort().read({
      tenantId: "tenant-a",
      environment: "TEST",
    });
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBeNull();
  });
});

describe("isCredentialFresh", () => {
  it("is inclusive at notBefore and exclusive at notAfter", () => {
    expect(isCredentialFresh(credential(), new Date(NOT_BEFORE.getTime() - 1))).toBe(false);
    expect(isCredentialFresh(credential(), NOT_BEFORE)).toBe(true);
    expect(isCredentialFresh(credential(), new Date(NOT_BEFORE.getTime() + 1))).toBe(true);
    expect(isCredentialFresh(credential(), new Date(NOT_AFTER.getTime() - 1))).toBe(true);
    expect(isCredentialFresh(credential(), NOT_AFTER)).toBe(false);
    expect(isCredentialFresh(credential(), new Date(NOT_AFTER.getTime() + 1))).toBe(false);
  });

  it("is pure: same inputs, same answer, and the credential is untouched", () => {
    const frozen = Object.freeze(credential());
    const before = { ...frozen };

    expect(isCredentialFresh(frozen, NOT_BEFORE)).toBe(true);
    expect(isCredentialFresh(frozen, NOT_BEFORE)).toBe(true);

    expect(frozen).toEqual(before);
    expect(Object.isFrozen(frozen)).toBe(true);
  });
});

describe("FISCAL_CREDENTIAL_PORT", () => {
  it("is a symbol token, not a string two modules could collide on", () => {
    expect(typeof FISCAL_CREDENTIAL_PORT).toBe("symbol");
    expect(FISCAL_CREDENTIAL_PORT.toString()).toBe("Symbol(FISCAL_CREDENTIAL_PORT)");
    expect(FISCAL_CREDENTIAL_PORT).not.toBe(Symbol("FISCAL_CREDENTIAL_PORT"));
  });
});
