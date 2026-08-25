import { describe, expect, it } from "vitest";
import type { AuthConfig } from "./auth.config.js";
import { CredentialService } from "./credential.service.js";

const CONFIG: AuthConfig = {
  argonMemoryCost: 19456,
  argonTimeCost: 2,
  argonParallelism: 1,
  sessionIdleTtlSeconds: 7200,
  sessionAbsoluteTtlSeconds: 43_200,
  cookieSecure: false,
};

describe("CredentialService", () => {
  it("produces argon2id hashes with the configured OWASP-floor parameters", async () => {
    const credentials = new CredentialService(CONFIG);

    const hash = await credentials.hash("correct horse battery staple");

    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).toContain("m=19456");
    expect(hash).toContain("t=2");
    expect(hash).toContain("p=1");
    // Random salt per derivation: same password never yields the same hash.
    const second = await credentials.hash("correct horse battery staple");
    expect(second).not.toBe(hash);
  });

  it("verifies the correct password and rejects wrong ones", async () => {
    const credentials = new CredentialService(CONFIG);
    const hash = await credentials.hash("s3cret-password");

    expect(await credentials.verify("s3cret-password", hash)).toBe(true);
    expect(await credentials.verify("wrong-password", hash)).toBe(false);
  });

  it("rejecting a hash derived for a DIFFERENT password is not a match", async () => {
    const credentials = new CredentialService(CONFIG);
    // Broken-verification discrimination: swapping operand order or hashes
    // must fail closed, not true-positive.
    const hashA = await credentials.hash("password-a");
    const hashB = await credentials.hash("password-b");
    expect(await credentials.verify("password-a", hashB)).toBe(false);
    expect(await credentials.verify("password-b", hashA)).toBe(false);
  });

  it("fails closed on malformed stored hashes instead of throwing", async () => {
    const credentials = new CredentialService(CONFIG);

    expect(await credentials.verify("whatever", "not-a-phc-string")).toBe(false);
    expect(await credentials.verify("whatever", "$argon2id$v=19$m=1,p=1,t=1$garbage")).toBe(false);
  });

  it("honors env-tunable parameters through config", async () => {
    const tuned = new CredentialService({
      ...CONFIG,
      argonMemoryCost: 8192,
      argonTimeCost: 3,
      argonParallelism: 2,
    });

    const hash = await tuned.hash("pw");

    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).toContain("m=8192");
    expect(hash).toContain("t=3");
    expect(hash).toContain("p=2");
    expect(tuned.needsRehash(hash)).toBe(false);
  });
});
