import { describe, expect, it } from "vitest";
import type { AuthConfig } from "./auth.config.js";
import { CredentialService } from "./credential.service.js";
import {
  assertPasswordAcceptable,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_TOO_LONG_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
} from "./password.policy.js";

const CONFIG: AuthConfig = {
  argonMemoryCost: 19456,
  argonTimeCost: 2,
  argonParallelism: 1,
  sessionIdleTtlSeconds: 7200,
  sessionAbsoluteTtlSeconds: 43_200,
  cookieSecure: false,
};

describe("the staff password policy (TD-048)", () => {
  it("accepts the floor and everything above it", () => {
    expect(() => assertPasswordAcceptable("x".repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
    expect(() => assertPasswordAcceptable("x".repeat(MIN_PASSWORD_LENGTH + 1))).not.toThrow();
    // No composition rules: the same eight characters are accepted whether they are
    // letters, digits or spaces, and a long passphrase is accepted outright.
    expect(() => assertPasswordAcceptable("        ")).not.toThrow();
    expect(() => assertPasswordAcceptable("correct horse battery staple")).not.toThrow();
  });

  it("refuses one character below the floor, with the message that names it", () => {
    expect(() => assertPasswordAcceptable("x".repeat(MIN_PASSWORD_LENGTH - 1))).toThrow(
      PASSWORD_TOO_SHORT_MESSAGE
    );
    // The message names the rule rather than leaving the user to guess it.
    expect(PASSWORD_TOO_SHORT_MESSAGE).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it("refuses a non-string, so a missing field is a validation failure", () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(() => assertPasswordAcceptable(bad)).toThrow(PASSWORD_TOO_SHORT_MESSAGE);
    }
  });

  it("refuses an unbounded input, because argon2 hashes the whole of it", () => {
    expect(() => assertPasswordAcceptable("x".repeat(MAX_PASSWORD_LENGTH + 1))).toThrow(
      PASSWORD_TOO_LONG_MESSAGE
    );
    // The ceiling mirrors the login body's, so a password that can be SET can always be
    // TYPED back in.
    expect(MAX_PASSWORD_LENGTH).toBe(1024);
  });

  it("is enforced at the CREDENTIAL BOUNDARY, so every caller inherits it", async () => {
    const credentials = new CredentialService(CONFIG);
    // The point of putting it here rather than at the reset endpoint: this call has no
    // endpoint at all, and it is still refused.
    await expect(credentials.hash("short")).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: PASSWORD_TOO_SHORT_MESSAGE,
    });
    // And it refuses BEFORE argon2 runs, so a rejected password costs nothing.
    await expect(credentials.hash("a-valid-password")).resolves.toMatch(/^\$argon2id\$/);
  });
});
