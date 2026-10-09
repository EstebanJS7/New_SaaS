import { describe, expect, it } from "vitest";
import {
  EnvelopeSecretStore,
  InMemorySecretStore,
  type SecretRecordClient,
} from "@newsaas/secret-store";
import { createSecretStoreFromEnv } from "./secrets.js";

const MASTER_KEY = Buffer.alloc(32, 1).toString("base64");
const ROTATED_KEY = Buffer.alloc(32, 2).toString("base64");

const records: SecretRecordClient = {
  tenantSecret: {
    create: () => Promise.resolve({}),
    findFirst: () => Promise.resolve(null),
    deleteMany: () => Promise.resolve({ count: 0 }),
  },
};

describe("createSecretStoreFromEnv", () => {
  it("selects the envelope driver when a master key is configured", () => {
    expect(
      createSecretStoreFromEnv("production", `1:${MASTER_KEY}`, undefined, records)
    ).toBeInstanceOf(EnvelopeSecretStore);
  });

  it("selects the in-memory driver outside production when nothing is configured", () => {
    expect(createSecretStoreFromEnv("development", undefined, undefined, records)).toBeInstanceOf(
      InMemorySecretStore
    );
    expect(createSecretStoreFromEnv("test", "", "", records)).toBeInstanceOf(InMemorySecretStore);
  });

  it("refuses to fall back to the in-memory driver in production", () => {
    expect(() => createSecretStoreFromEnv("production", undefined, undefined, records)).toThrow(
      /MASTER_KEYS is required in production/
    );
  });

  it("fails closed on a malformed master key", () => {
    expect(() =>
      createSecretStoreFromEnv("development", "not-a-version", undefined, records)
    ).toThrow(/version>:<base64/);
    expect(() => createSecretStoreFromEnv("development", `1:${MASTER_KEY}`, "2", records)).toThrow(
      /not present/
    );
  });

  it("uses the configured current version for new writes", () => {
    expect(
      createSecretStoreFromEnv("production", `1:${MASTER_KEY},2:${ROTATED_KEY}`, "2", records)
    ).toBeInstanceOf(EnvelopeSecretStore);
  });
});
